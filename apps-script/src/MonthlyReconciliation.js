/**
 * MonthlyReconciliation.js — End-of-month reconciliation report.
 *
 * Compares three data sources for a given month:
 *   1. raw_monthly  — Ground truth from monthly summary emails (authoritative)
 *   2. raw_cumulative — Last daily cumulative snapshot (may miss final day)
 *   3. fact_daily_metric — Sum of inferred daily values
 *
 * When raw_monthly data is available, it is used as the authoritative source.
 * Otherwise falls back to the last cumulative snapshot from raw_cumulative.
 */

var RECONCILIATION_SHEET = 'monthly_reconciliation';
var RECONCILIATION_HEADERS = [
  'month', 'store_id', 'store_name', 'time_bucket', 'sales_channel', 'metric_name',
  'source', 'final_score_pct', 'final_n', 'final_numerator',
  'sum_daily_n', 'sum_daily_numerator', 'sum_daily_score_pct',
  'n_delta', 'numerator_delta', 'score_delta',
  'daily_row_count', 'reconciled_at'
];

/**
 * Run reconciliation for the previous month (auto-detected).
 */
function runMonthlyReconciliation() {
  var now = new Date();
  var prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  var yyyy = prevMonth.getFullYear();
  var mm = String(prevMonth.getMonth() + 1);
  if (mm.length === 1) mm = '0' + mm;
  var monthStr = yyyy + '-' + mm;

  Logger.log('Running monthly reconciliation for ' + monthStr);
  reconcileMonth(monthStr);
}

/**
 * Run reconciliation for a specific month (prompted via UI).
 */
function runMonthlyReconciliationPrompt() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt(
    'Monthly Reconciliation',
    'Enter month to reconcile (YYYY-MM), e.g. 2026-03',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;

  var monthStr = String(response.getResponseText() || '').trim();
  if (!/^\d{4}-\d{2}$/.test(monthStr)) {
    ui.alert('Invalid format. Use YYYY-MM.');
    return;
  }

  reconcileMonth(monthStr);
  ui.alert('Reconciliation complete for ' + monthStr + '. Check the ' + RECONCILIATION_SHEET + ' sheet.');
}

/**
 * Core reconciliation logic for a given YYYY-MM month.
 * Prefers raw_monthly (from monthly summary emails) as ground truth.
 * Falls back to the last daily cumulative snapshot from raw_cumulative.
 */
function reconcileMonth(monthStr) {
  var monthlyData = readSheetData(CONFIG.SHEET_NAMES.RAW_MONTHLY);
  var monthlyForMonth = filterByMonth(monthlyData, 'month', monthStr);

  var source = 'raw_monthly';
  var groundTruth;

  if (monthlyForMonth.length > 0) {
    groundTruth = buildMonthlyGroundTruth(monthlyForMonth);
    Logger.log('Using raw_monthly as ground truth (' + monthlyForMonth.length + ' rows).');
  } else {
    var rawData = readSheetData(CONFIG.SHEET_NAMES.RAW_CUMULATIVE);
    var monthRaw = filterByMonth(rawData, 'business_date', monthStr);
    if (monthRaw.length === 0) {
      Logger.log('No data found for ' + monthStr + ' in raw_monthly or raw_cumulative.');
      return;
    }
    groundTruth = buildFinalCumulativeSnapshot(monthRaw);
    source = 'raw_cumulative';
    Logger.log('No raw_monthly data for ' + monthStr + '. Falling back to raw_cumulative.');
  }

  var factData = readSheetData(CONFIG.SHEET_NAMES.FACT_DAILY);
  var monthFact = filterByMonth(factData, 'business_date', monthStr);
  var dailySums = buildDailySums(monthFact);

  var reconcRows = [];

  var dimKeys = Object.keys(groundTruth);
  for (var i = 0; i < dimKeys.length; i++) {
    var key = dimKeys[i];
    var truth = groundTruth[key];
    var daily = dailySums[key] || { sumN: 0, sumNumerator: 0, rowCount: 0 };

    var truthNumerator = Math.round(truth.scorePct * truth.metricN);
    var sumDailyScorePct = daily.sumN > 0 ? daily.sumNumerator / daily.sumN : null;

    var nDelta = truth.metricN - daily.sumN;
    var numDelta = truthNumerator - daily.sumNumerator;
    var scoreDelta = null;
    if (sumDailyScorePct !== null) {
      scoreDelta = truth.scorePct - sumDailyScorePct;
    }

    var parts = key.split('|||');

    reconcRows.push([
      monthStr,
      parts[0],             // store_id
      truth.storeName,
      parts[1],             // time_bucket
      parts[2],             // sales_channel
      parts[3],             // metric_name
      source,
      truth.scorePct,
      truth.metricN,
      truthNumerator,
      daily.sumN,
      daily.sumNumerator,
      sumDailyScorePct,
      nDelta,
      numDelta,
      scoreDelta,
      daily.rowCount,
      new Date().toISOString()
    ]);
  }

  if (reconcRows.length > 0) {
    var sheet = getOrCreateSheet(RECONCILIATION_SHEET, RECONCILIATION_HEADERS);
    clearMonthFromSheet(sheet, monthStr, 0);
    appendRows(RECONCILIATION_SHEET, reconcRows, RECONCILIATION_HEADERS);
  }

  var discrepancies = reconcRows.filter(function(row) {
    return row[13] !== 0 || row[14] !== 0;
  });

  Logger.log('Reconciliation for ' + monthStr + ' (source: ' + source + '): ' +
    reconcRows.length + ' dimension keys, ' + discrepancies.length + ' with deltas.');
}

/**
 * Filter rows where a date column starts with the given YYYY-MM prefix.
 */
function filterByMonth(rows, dateField, monthStr) {
  var filtered = [];
  for (var i = 0; i < rows.length; i++) {
    var d = formatDateStr(rows[i][dateField]);
    if (d && d.substring(0, 7) === monthStr) {
      filtered.push(rows[i]);
    }
  }
  return filtered;
}

/**
 * Build ground truth from raw_monthly data (monthly summary emails).
 * Keyed by store_id|||time_bucket|||sales_channel|||metric_name.
 */
function buildMonthlyGroundTruth(monthlyRows) {
  var truth = {};

  for (var i = 0; i < monthlyRows.length; i++) {
    var row = monthlyRows[i];
    var scorePct = parseFloat(row['score_pct']);
    var metricN = parseInt(row['metric_n'], 10);
    if (isNaN(scorePct) || isNaN(metricN)) continue;

    var dimKey = [
      row['store_id'],
      row['time_bucket'] || '_ALL',
      row['sales_channel'] || '_TOTAL',
      row['metric_name']
    ].join('|||');

    if (!truth[dimKey] || metricN > truth[dimKey].metricN) {
      truth[dimKey] = {
        storeName: row['store_name'],
        scorePct: scorePct,
        metricN: metricN
      };
    }
  }

  return truth;
}

/**
 * From raw cumulative rows for a month, find the LAST (highest date) row
 * per dimension key. This represents the final MTD cumulative snapshot.
 */
function buildFinalCumulativeSnapshot(rawRows) {
  var snapshot = {};

  for (var i = 0; i < rawRows.length; i++) {
    var row = rawRows[i];
    var dateStr = formatDateStr(row['business_date']);
    var scorePct = parseFloat(row['score_pct']);
    var metricN = parseInt(row['metric_n'], 10);
    if (isNaN(scorePct) || isNaN(metricN)) continue;

    var dimKey = [
      row['store_id'],
      row['time_bucket'],
      row['sales_channel'],
      row['metric_name']
    ].join('|||');

    if (!snapshot[dimKey] || dateStr > snapshot[dimKey].businessDate ||
        (dateStr === snapshot[dimKey].businessDate && metricN >= snapshot[dimKey].metricN)) {
      snapshot[dimKey] = {
        businessDate: dateStr,
        storeName: row['store_name'],
        reportEndDate: formatDateStr(row['date_range_end']),
        scorePct: scorePct,
        metricN: metricN
      };
    }
  }

  return snapshot;
}

/**
 * From fact_daily_metric rows for a month, sum daily_n and daily_numerator
 * per dimension key.
 */
function buildDailySums(factRows) {
  var sums = {};

  for (var i = 0; i < factRows.length; i++) {
    var row = factRows[i];
    var dailyN = parseInt(row['daily_n'], 10);
    var dailyNum = parseInt(row['daily_numerator'], 10);
    if (isNaN(dailyN) || isNaN(dailyNum)) continue;

    var dimKey = [
      row['store_id'],
      row['time_bucket'],
      row['sales_channel'],
      row['metric_name']
    ].join('|||');

    if (!sums[dimKey]) {
      sums[dimKey] = { sumN: 0, sumNumerator: 0, rowCount: 0 };
    }

    sums[dimKey].sumN += dailyN;
    sums[dimKey].sumNumerator += dailyNum;
    sums[dimKey].rowCount++;
  }

  return sums;
}

/**
 * Remove existing reconciliation rows for a given month before rewriting.
 */
function clearMonthFromSheet(sheet, monthStr, monthColIdx) {
  if (sheet.getLastRow() < 2) return;

  var data = sheet.getDataRange().getValues();
  var rowsToDelete = [];

  for (var r = 1; r < data.length; r++) {
    if (String(data[r][monthColIdx]).trim() === monthStr) {
      rowsToDelete.push(r + 1);
    }
  }

  for (var i = rowsToDelete.length - 1; i >= 0; i--) {
    sheet.deleteRow(rowsToDelete[i]);
  }
}

/**
 * Monthly trigger setup: run reconciliation on the 2nd of each month at 6 AM.
 * Gives a full day buffer for the last day's email to arrive and process.
 */
function setupMonthlyReconciliationTrigger() {
  clearMonthlyReconciliationTrigger();

  ScriptApp.newTrigger('runMonthlyReconciliation')
    .timeBased()
    .onMonthDay(2)
    .atHour(6)
    .create();

  Logger.log('Monthly reconciliation trigger set: 2nd of each month at 6 AM.');
}

function clearMonthlyReconciliationTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'runMonthlyReconciliation') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}
