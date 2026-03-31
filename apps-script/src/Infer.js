/**
 * Infer.js — Compute daily deltas from cumulative data.
 * Optimized: O(n) hash-map approach instead of O(n²) linear scan.
 */

/**
 * Compute daily metrics from raw cumulative data.
 * Groups by dimension key, sorts each group by date, computes sequential deltas.
 *
 * @param {string} [onlyMonth] - Optional "YYYY-MM" to limit processing
 */
function computeDailyDeltas(onlyMonth) {
  var rawData = readSheetData(CONFIG.SHEET_NAMES.RAW_CUMULATIVE);
  if (rawData.length === 0) {
    Logger.log('No raw data to process.');
    return;
  }

  Logger.log('Computing deltas from ' + rawData.length + ' raw rows...');

  var dimGroups = {};

  for (var i = 0; i < rawData.length; i++) {
    var row = rawData[i];
    var dateStr = formatDateStr(row['business_date']);

    if (onlyMonth && dateStr.substring(0, 7) !== onlyMonth) continue;

    var scorePct = parseFloat(row['score_pct']);
    var metricN = parseInt(row['metric_n'], 10);
    if (isNaN(scorePct) || isNaN(metricN)) continue;

    var dimKey = [
      row['store_id'],
      row['time_bucket'],
      row['sales_channel'],
      row['metric_name']
    ].join('|||');

    if (!dimGroups[dimKey]) {
      dimGroups[dimKey] = {};
    }

    if (!dimGroups[dimKey][dateStr] || metricN >= parseInt(dimGroups[dimKey][dateStr]['metric_n'], 10)) {
      dimGroups[dimKey][dateStr] = row;
    }
  }

  var factRows = [];
  var dimKeys = Object.keys(dimGroups);

  for (var d = 0; d < dimKeys.length; d++) {
    var dateMap = dimGroups[dimKeys[d]];
    var dates = Object.keys(dateMap).sort();

    for (var di = 0; di < dates.length; di++) {
      var currentDate = dates[di];
      var current = dateMap[currentDate];

      var cumScorePct = parseFloat(current['score_pct']);
      var cumN = parseInt(current['metric_n'], 10);
      var cumNumerator = Math.round(cumScorePct * cumN);

      var dailyScorePct = null;
      var dailyN = null;
      var dailyNumerator = null;

      if (di > 0) {
        var prevDate = dates[di - 1];
        var prev = dateMap[prevDate];
        var prevScorePct = parseFloat(prev['score_pct']);
        var prevN = parseInt(prev['metric_n'], 10);
        var prevNumerator = Math.round(prevScorePct * prevN);

        dailyN = cumN - prevN;
        dailyNumerator = cumNumerator - prevNumerator;
        if (dailyN > 0) {
          dailyScorePct = dailyNumerator / dailyN;
        } else if (dailyN === 0) {
          dailyScorePct = null;
        }
      } else {
        dailyN = cumN;
        dailyNumerator = cumNumerator;
        if (dailyN > 0) {
          dailyScorePct = dailyNumerator / dailyN;
        }
      }

      factRows.push([
        currentDate,
        current['store_id'],
        current['store_name'],
        current['time_bucket'],
        current['sales_channel'],
        current['metric_name'],
        cumScorePct, cumN, cumNumerator,
        dailyScorePct, dailyN, dailyNumerator,
        current['source_file_name'],
        current['message_id'],
        current['run_id'],
        new Date().toISOString()
      ]);
    }
  }

  Logger.log('Computed ' + factRows.length + ' fact rows.');

  if (factRows.length > 0) {
    clearSheetData(CONFIG.SHEET_NAMES.FACT_DAILY);
    var sheet = getOrCreateSheet(CONFIG.SHEET_NAMES.FACT_DAILY, CONFIG.FACT_HEADERS);
    sheet.getRange(2, 1, factRows.length, factRows[0].length).setValues(factRows);
  }

  Logger.log('Daily deltas written to ' + CONFIG.SHEET_NAMES.FACT_DAILY);
}

/**
 * Normalize a date value to "YYYY-MM-DD" string.
 */
function formatDateStr(dateVal) {
  if (!dateVal) return '';
  if (dateVal instanceof Date) {
    return Utilities.formatDate(dateVal, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var str = String(dateVal).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.substring(0, 10);

  var parts = str.split('/');
  if (parts.length === 3) {
    var month = parts[0].length === 1 ? '0' + parts[0] : parts[0];
    var day = parts[1].length === 1 ? '0' + parts[1] : parts[1];
    var year = parts[2].length === 2 ? '20' + parts[2] : parts[2];
    return year + '-' + month + '-' + day;
  }
  return str;
}
