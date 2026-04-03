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
  getOrCreateSheet(CONFIG.SHEET_NAMES.RAW_MONTHLY, CONFIG.MONTHLY_RAW_HEADERS);
  getOrCreateSheet(CONFIG.SHEET_NAMES.FACT_DAILY, CONFIG.FACT_HEADERS);
  getOrCreateSheet(CONFIG.SHEET_NAMES.PROCESSED_MESSAGES,
    ['message_id', 'subject', 'date_received', 'run_id', 'processed_at']);
  getOrCreateSheet(CONFIG.SHEET_NAMES.RUN_LOG,
    ['run_id', 'run_at', 'status', 'emails_found', 'files_parsed', 'rows_written',
     'missing_buckets', 'quality_flags', 'error_message']);
  getOrCreateSheet(CONFIG.SHEET_NAMES.CONFIG_TARGETS,
    ['metric_name', 'target_goal', 'yellow_buffer_pct', 'notes']);
  getOrCreateSheet(CONFIG.SHEET_NAMES.CONFIG_LOCATIONS,
    ['store_id', 'store_name', 'region', 'district', 'active',
     'slack_channel_id', 'timezone']);
  getOrCreateSheet(CONFIG.SHEET_NAMES.CONFIG_RUNTIME,
    ['key', 'value', 'description']);
  getOrCreateSheet(CONFIG.SHEET_NAMES.ALIAS_REPORT,
    ['run_id', 'file_name', 'raw_metric_name', 'time_bucket', 'date_range', 'detected_at']);
  getOrCreateSheet(CONFIG.SHEET_NAMES.DIAGNOSTIC_REPORT,
    ['diagnostic_run_id', 'run_at', 'target_date', 'section', 'key', 'value']);

  ensureSimpleConfigTargetsSchema();
  ensureRuntimeConfigDefaults();
  migrateRuntimeConfigValues();
}

/**
 * Ensure config_targets uses simple schema:
 * metric_name, target_goal, yellow_buffer_pct, notes
 * If old schema exists, migrate best-effort values.
 */
function ensureSimpleConfigTargetsSchema() {
  var sheet = getOrCreateSheet(CONFIG.SHEET_NAMES.CONFIG_TARGETS, ['metric_name', 'target_goal', 'yellow_buffer_pct', 'notes']);
  if (sheet.getLastRow() < 1) return;

  var data = sheet.getDataRange().getValues();
  if (!data || data.length === 0) return;
  var header = data[0];
  var simpleHeader = ['metric_name', 'target_goal', 'yellow_buffer_pct', 'notes'];

  var isSimple = header.length >= 4 &&
    String(header[0]) === 'metric_name' &&
    String(header[1]) === 'target_goal' &&
    String(header[2]) === 'yellow_buffer_pct';
  if (isSimple) return;

  var migrated = {};
  var oldMetricIdx = header.indexOf('metric_name');
  var oldGreenIdx = header.indexOf('target_green_min');
  var oldYellowIdx = header.indexOf('target_yellow_min');
  var oldNotesIdx = header.indexOf('notes');

  if (oldMetricIdx >= 0) {
    for (var r = 1; r < data.length; r++) {
      var metric = String(data[r][oldMetricIdx] || '').trim();
      if (!metric) continue;

      var greenRaw = oldGreenIdx >= 0 ? data[r][oldGreenIdx] : '';
      var yellowRaw = oldYellowIdx >= 0 ? data[r][oldYellowIdx] : '';
      var notesRaw = oldNotesIdx >= 0 ? data[r][oldNotesIdx] : '';

      var green = parsePercentValue(greenRaw);
      var yellow = parsePercentValue(yellowRaw);
      var buffer = parsePercentValue(getConfigValue('TARGET_YELLOW_BUFFER_PCT', '0.05'));
      if (buffer === null) buffer = 0.05;
      if (green !== null && yellow !== null && green > 0) {
        buffer = 1 - (yellow / green);
      }

      if (green !== null) {
        migrated[metric] = [metric, green, round4(buffer), notesRaw || 'Migrated from old config_targets schema'];
      }
    }
  }

  var outRows = [simpleHeader];
  var keys = Object.keys(migrated);
  for (var i = 0; i < keys.length; i++) {
    outRows.push(migrated[keys[i]]);
  }

  if (outRows.length === 1) {
    outRows.push(['overall_satisfaction', '', getConfigValue('TARGET_YELLOW_BUFFER_PCT', '0.05'), 'Fill in goals per metric']);
  }

  sheet.clearContents();
  sheet.getRange(1, 1, outRows.length, simpleHeader.length).setValues(outRows);
  sheet.getRange(1, 1, 1, simpleHeader.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

/**
 * Seed config_runtime with defaults if missing.
 * Leaves existing values untouched so users can edit safely.
 */
function ensureRuntimeConfigDefaults() {
  var sheet = getOrCreateSheet(CONFIG.SHEET_NAMES.CONFIG_RUNTIME, ['key', 'value', 'description']);
  var data = sheet.getDataRange().getValues();
  var existing = {};

  for (var i = 1; i < data.length; i++) {
    var key = String(data[i][0] || '').trim();
    if (key) existing[key] = true;
  }

  var toAppend = [];
  for (var d = 0; d < DEFAULT_RUNTIME_CONFIG.length; d++) {
    var def = DEFAULT_RUNTIME_CONFIG[d];
    if (!existing[def.key]) {
      toAppend.push([def.key, def.value, def.description]);
    }
  }

  if (toAppend.length > 0) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, toAppend.length, 3).setValues(toAppend);
  }

  refreshRuntimeConfigCache();
}

/**
 * One-time migrations for config_runtime values that changed defaults.
 * Safe to call repeatedly — only updates if old value is still present.
 */
function migrateRuntimeConfigValues() {
  var migrations = [
    { key: 'BUSINESS_DATE_SOURCE', oldValue: 'start', newValue: 'end_minus_1' }
  ];

  var sheet = getOrCreateSheet(CONFIG.SHEET_NAMES.CONFIG_RUNTIME, ['key', 'value', 'description']);
  var data = sheet.getDataRange().getValues();

  for (var m = 0; m < migrations.length; m++) {
    var mig = migrations[m];
    for (var r = 1; r < data.length; r++) {
      var key = String(data[r][0] || '').trim();
      var val = String(data[r][1] || '').trim();
      if (key === mig.key && val === mig.oldValue) {
        sheet.getRange(r + 1, 2).setValue(mig.newValue);
        Logger.log('Migrated config ' + mig.key + ': ' + mig.oldValue + ' -> ' + mig.newValue);
      }
    }
  }

  refreshRuntimeConfigCache();
}
