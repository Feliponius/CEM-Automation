/**
 * Sheets.js — Read/write helpers for all sheets.
 */

/**
 * Get or create a sheet by name, optionally setting headers.
 */
function getOrCreateSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length > 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

/**
 * Append rows to a sheet (after the last row with data).
 */
function appendRows(sheetName, rows, headers) {
  if (!rows || rows.length === 0) return;
  var sheet = getOrCreateSheet(sheetName, headers);
  var lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, rows.length, rows[0].length).setValues(rows);
}

/**
 * Read all data from a sheet (excluding header row).
 * @returns {Object[]} Array of objects keyed by header names.
 */
function readSheetData(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var results = [];

  for (var r = 1; r < data.length; r++) {
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      obj[headers[c]] = data[r][c];
    }
    results.push(obj);
  }
  return results;
}

/**
 * Clear all data rows from a sheet (preserve headers).
 */
function clearSheetData(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
}

/**
 * Get set of already-processed message IDs.
 */
function getProcessedMessageIds() {
  var data = readSheetData(CONFIG.SHEET_NAMES.PROCESSED_MESSAGES);
  var ids = {};
  for (var i = 0; i < data.length; i++) {
    ids[data[i]['message_id']] = true;
  }
  return ids;
}

/**
 * Record a message as processed.
 */
function markMessageProcessed(messageId, subject, dateReceived, runId) {
  appendRows(CONFIG.SHEET_NAMES.PROCESSED_MESSAGES,
    [[messageId, subject, dateReceived, runId, new Date().toISOString()]],
    ['message_id', 'subject', 'date_received', 'run_id', 'processed_at']
  );
}

/**
 * Write a run log entry.
 */
function logRun(runId, status, emailsFound, filesParsed, rowsWritten, missingBuckets, qualityFlags, errorMessage) {
  appendRows(CONFIG.SHEET_NAMES.RUN_LOG,
    [[runId, new Date().toISOString(), status, emailsFound, filesParsed, rowsWritten,
      (missingBuckets || []).join('; '), (qualityFlags || []).join('; '), errorMessage || '']],
    ['run_id', 'run_at', 'status', 'emails_found', 'files_parsed', 'rows_written',
     'missing_buckets', 'quality_flags', 'error_message']
  );
}

/**
 * Initialize all config sheets with headers and optional seed data.
 */
function initializeSheets() {
  getOrCreateSheet(CONFIG.SHEET_NAMES.RAW_CUMULATIVE, CONFIG.RAW_HEADERS);
  getOrCreateSheet(CONFIG.SHEET_NAMES.FACT_DAILY, CONFIG.FACT_HEADERS);
  getOrCreateSheet(CONFIG.SHEET_NAMES.PROCESSED_MESSAGES,
    ['message_id', 'subject', 'date_received', 'run_id', 'processed_at']);
  getOrCreateSheet(CONFIG.SHEET_NAMES.RUN_LOG,
    ['run_id', 'run_at', 'status', 'emails_found', 'files_parsed', 'rows_written',
     'missing_buckets', 'quality_flags', 'error_message']);
  getOrCreateSheet(CONFIG.SHEET_NAMES.CONFIG_TARGETS,
    ['effective_start_date', 'effective_end_date', 'metric_name', 'store_id',
     'time_bucket', 'sales_channel', 'target_green_min', 'target_yellow_min', 'notes']);
  getOrCreateSheet(CONFIG.SHEET_NAMES.CONFIG_LOCATIONS,
    ['store_id', 'store_name', 'region', 'district', 'active',
     'slack_channel_id', 'timezone']);
  getOrCreateSheet(CONFIG.SHEET_NAMES.CONFIG_RUNTIME,
    ['key', 'value', 'description']);
  getOrCreateSheet(CONFIG.SHEET_NAMES.ALIAS_REPORT,
    ['run_id', 'file_name', 'raw_metric_name', 'time_bucket', 'date_range', 'detected_at']);
}
