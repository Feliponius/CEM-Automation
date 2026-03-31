/**
 * Infer.js — Compute daily deltas from cumulative data.
 */

/**
 * Compute daily metrics from raw cumulative data.
 * Reads raw_cumulative, groups by key, sorts by date, computes deltas.
 * Writes results to fact_daily_metric.
 *
 * @param {string} [onlyMonth] - Optional "YYYY-MM" to limit processing
 */
function computeDailyDeltas(onlyMonth) {
  var rawData = readSheetData(CONFIG.SHEET_NAMES.RAW_CUMULATIVE);
  if (rawData.length === 0) return;

  var grouped = {};

  for (var i = 0; i < rawData.length; i++) {
    var row = rawData[i];
    var date = row['business_date'];

    if (onlyMonth) {
      var dateStr = formatDateStr(date);
      if (dateStr.substring(0, 7) !== onlyMonth) continue;
    }

    var key = [
      formatDateStr(date),
      row['store_id'],
      row['time_bucket'],
      row['sales_channel'],
      row['metric_name']
    ].join('|||');

    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(row);
  }

  var factRows = [];

  var keys = Object.keys(grouped);
  for (var k = 0; k < keys.length; k++) {
    var entries = grouped[keys[k]];
    var latest = entries[entries.length - 1];

    var parts = keys[k].split('|||');
    var businessDate = parts[0];
    var storeId = parts[1];
    var timeBucket = parts[2];
    var salesChannel = parts[3];
    var metricName = parts[4];

    var cumScorePct = parseFloat(latest['score_pct']);
    var cumN = parseInt(latest['metric_n'], 10);

    if (isNaN(cumScorePct) || isNaN(cumN)) continue;

    var cumNumerator = Math.round(cumScorePct * cumN);

    var prevKey = findPreviousDayKey(rawData, businessDate, storeId, timeBucket, salesChannel, metricName);
    var dailyScorePct = null;
    var dailyN = null;
    var dailyNumerator = null;

    if (prevKey) {
      var prevCumScorePct = parseFloat(prevKey['score_pct']);
      var prevCumN = parseInt(prevKey['metric_n'], 10);
      if (!isNaN(prevCumScorePct) && !isNaN(prevCumN)) {
        var prevCumNumerator = Math.round(prevCumScorePct * prevCumN);
        dailyN = cumN - prevCumN;
        dailyNumerator = cumNumerator - prevCumNumerator;
        if (dailyN > 0) {
          dailyScorePct = dailyNumerator / dailyN;
        }
      }
    } else {
      dailyN = cumN;
      dailyNumerator = cumNumerator;
      if (dailyN > 0) {
        dailyScorePct = dailyNumerator / dailyN;
      }
    }

    factRows.push([
      businessDate, storeId, latest['store_name'], timeBucket, salesChannel,
      metricName, cumScorePct, cumN, cumNumerator,
      dailyScorePct, dailyN, dailyNumerator,
      latest['source_file_name'], latest['message_id'],
      latest['run_id'], new Date().toISOString()
    ]);
  }

  if (factRows.length > 0) {
    clearSheetData(CONFIG.SHEET_NAMES.FACT_DAILY);
    appendRows(CONFIG.SHEET_NAMES.FACT_DAILY, factRows, CONFIG.FACT_HEADERS);
  }
}

/**
 * Find the previous day's cumulative record for the same key.
 */
function findPreviousDayKey(allRaw, currentDateStr, storeId, timeBucket, salesChannel, metricName) {
  var currentDate = new Date(currentDateStr);
  var bestMatch = null;
  var bestDate = null;

  for (var i = 0; i < allRaw.length; i++) {
    var row = allRaw[i];
    var rowDateStr = formatDateStr(row['business_date']);
    var rowDate = new Date(rowDateStr);

    if (rowDate >= currentDate) continue;
    if (row['store_id'] != storeId) continue;
    if (row['time_bucket'] != timeBucket) continue;
    if (row['sales_channel'] != salesChannel) continue;
    if (row['metric_name'] != metricName) continue;

    if (!bestDate || rowDate > bestDate) {
      bestDate = rowDate;
      bestMatch = row;
    }
  }

  return bestMatch;
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
