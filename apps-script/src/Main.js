/**
 * Main.js — Entry points, triggers, menu items.
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Eleanor CEM')
    .addItem('Initialize Sheets', 'initializeSheets')
    .addSeparator()
    .addItem('Run Daily Pipeline', 'runDailyPipeline')
    .addItem('Backfill March (Ingest Only)', 'backfillMarchIngest')
    .addSeparator()
    .addItem('Compute Daily Deltas', 'recomputeDeltas')
    .addItem('Compute March Deltas Only', 'computeMarchDeltas')
    .addToUi();
}

// ─────────────────────────────────────────────────────────
// DAILY PIPELINE
// ─────────────────────────────────────────────────────────

function runDailyPipeline() {
  var runId = 'run_' + new Date().getTime();
  var filesProcessed = 0;
  var rowsWritten = 0;
  var bucketsFound = [];
  var aliasIssues = [];

  try {
    initializeSheets();
    var processedIds = getProcessedMessageIds();

    var fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    var afterDate = Utilities.formatDate(fiveDaysAgo, Session.getScriptTimeZone(), 'yyyy/MM/dd');

    var messages = searchCemEmails(afterDate, null);
    var emailsFound = messages.length;

    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      var msgId = msg.getId();
      if (processedIds[msgId]) continue;

      var result = processOneMessage(msg, runId);
      if (result) {
        filesProcessed++;
        rowsWritten += result.rowCount;
        if (result.timeBucket) bucketsFound.push(result.timeBucket);
        aliasIssues = aliasIssues.concat(result.aliasIssues || []);
        markMessageProcessed(msgId, msg.getSubject(), msg.getDate().toISOString(), runId);
      }
    }

    computeDailyDeltas();

    var missingBuckets = findMissingBuckets(bucketsFound);
    logAliasIssues(aliasIssues, runId);
    logRun(runId, 'success', emailsFound, filesProcessed, rowsWritten, missingBuckets, [], '');

    Logger.log('Pipeline complete. ' + filesProcessed + ' files, ' + rowsWritten + ' rows.');

  } catch (e) {
    logRun(runId, 'error', 0, filesProcessed, rowsWritten, [], [], e.message + '\n' + e.stack);
    Logger.log('Pipeline FAILED: ' + e.message);
    throw e;
  }
}

// ─────────────────────────────────────────────────────────
// PROCESS ONE MESSAGE
// ─────────────────────────────────────────────────────────

function processOneMessage(message, runId) {
  var csv = extractCsvAttachment(message);
  if (!csv) return null;

  var parsed = parseCemCsv(csv.csvText, csv.fileName);
  if (!parsed.records || parsed.records.length === 0) return null;

  var businessDate = formatDateStr(parsed.meta.dateRangeEnd);
  var rawRows = [];

  for (var r = 0; r < parsed.records.length; r++) {
    var rec = parsed.records[r];
    if (!rec.metricName) continue;
    if (rec.scorePct === null && rec.metricN === null) continue;

    rawRows.push([
      businessDate,
      formatDateStr(parsed.meta.dateRangeStart),
      formatDateStr(parsed.meta.dateRangeEnd),
      parsed.meta.visitDateAsOf,
      parsed.meta.timeBucket,
      rec.storeId,
      rec.storeName,
      rec.salesChannel,
      rec.surveyCount,
      rec.metricName,
      rec.scorePct,
      rec.metricN,
      csv.fileName,
      message.getId(),
      runId,
      new Date().toISOString()
    ]);
  }

  if (rawRows.length > 0) {
    appendRows(CONFIG.SHEET_NAMES.RAW_CUMULATIVE, rawRows, CONFIG.RAW_HEADERS);
  }

  return {
    rowCount: rawRows.length,
    timeBucket: parsed.meta.timeBucket,
    aliasIssues: parsed.aliasIssues
  };
}

// ─────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────

function findMissingBuckets(foundBuckets) {
  var missing = [];
  for (var i = 0; i < CONFIG.EXPECTED_TIME_BUCKETS.length; i++) {
    var bucket = CONFIG.EXPECTED_TIME_BUCKETS[i];
    if (foundBuckets.indexOf(bucket) === -1) {
      missing.push(bucket);
    }
  }
  return missing;
}

function logAliasIssues(issues, runId) {
  if (!issues || issues.length === 0) return;
  var rows = [];
  for (var i = 0; i < issues.length; i++) {
    rows.push([
      runId, issues[i].fileName, issues[i].rawName,
      issues[i].timeBucket, issues[i].dateRange, new Date().toISOString()
    ]);
  }
  appendRows(CONFIG.SHEET_NAMES.ALIAS_REPORT, rows,
    ['run_id', 'file_name', 'raw_metric_name', 'time_bucket', 'date_range', 'detected_at']);
}

// ─────────────────────────────────────────────────────────
// STANDALONE DELTA COMPUTATION (no Gmail, no ingestion)
// ─────────────────────────────────────────────────────────

function recomputeDeltas() {
  Logger.log('Starting full delta recomputation...');
  computeDailyDeltas();
  Logger.log('Done.');
}

function computeMarchDeltas() {
  Logger.log('Starting March 2026 delta computation...');
  computeDailyDeltas('2026-03');
  Logger.log('Done.');
}

// ─────────────────────────────────────────────────────────
// BACKFILL: Ingest only (no delta computation)
// ─────────────────────────────────────────────────────────

function backfillMarchIngest() {
  var runId = 'backfill_march_' + new Date().getTime();
  var filesProcessed = 0;
  var rowsWritten = 0;
  var allBuckets = [];
  var allAliasIssues = [];
  var dateMetricLog = [];

  try {
    initializeSheets();
    var processedIds = getProcessedMessageIds();

    var messages = searchCemEmails('2026/03/01', '2026/04/01');
    var emailsFound = messages.length;
    Logger.log('Found ' + emailsFound + ' CEM emails for March 2026.');

    messages.sort(function(a, b) { return a.getDate() - b.getDate(); });

    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      var msgId = msg.getId();

      if (processedIds[msgId]) {
        Logger.log('Skipping already-processed: ' + msg.getSubject());
        continue;
      }

      var csv = extractCsvAttachment(msg);
      if (!csv) continue;

      var parsed = parseCemCsv(csv.csvText, csv.fileName);

      for (var b = 0; b < (parsed.aliasIssues || []).length; b++) {
        allAliasIssues.push(parsed.aliasIssues[b]);
      }

      var metricNamesInFile = [];
      for (var r = 0; r < parsed.records.length; r++) {
        var rawName = parsed.records[r].metricRawName;
        if (metricNamesInFile.indexOf(rawName) === -1) {
          metricNamesInFile.push(rawName);
        }
      }

      dateMetricLog.push({
        date: parsed.meta.dateRangeEnd,
        timeBucket: parsed.meta.timeBucket,
        subject: msg.getSubject(),
        rawMetrics: metricNamesInFile
      });

      var businessDate = formatDateStr(parsed.meta.dateRangeEnd);
      var rawRows = [];

      for (var r2 = 0; r2 < parsed.records.length; r2++) {
        var rec = parsed.records[r2];
        if (!rec.metricName) continue;
        if (rec.scorePct === null && rec.metricN === null) continue;

        rawRows.push([
          businessDate,
          formatDateStr(parsed.meta.dateRangeStart),
          formatDateStr(parsed.meta.dateRangeEnd),
          parsed.meta.visitDateAsOf,
          parsed.meta.timeBucket,
          rec.storeId,
          rec.storeName,
          rec.salesChannel,
          rec.surveyCount,
          rec.metricName,
          rec.scorePct,
          rec.metricN,
          csv.fileName,
          msg.getId(),
          runId,
          new Date().toISOString()
        ]);
      }

      if (rawRows.length > 0) {
        appendRows(CONFIG.SHEET_NAMES.RAW_CUMULATIVE, rawRows, CONFIG.RAW_HEADERS);
        rowsWritten += rawRows.length;
      }

      if (parsed.meta.timeBucket && allBuckets.indexOf(parsed.meta.timeBucket) === -1) {
        allBuckets.push(parsed.meta.timeBucket);
      }

      filesProcessed++;
      markMessageProcessed(msgId, msg.getSubject(), msg.getDate().toISOString(), runId);
    }

    logAliasIssues(allAliasIssues, runId);
    writeBackfillMetricReport(dateMetricLog, runId);
    logRun(runId, 'success', emailsFound, filesProcessed, rowsWritten, [], [], '');

    Logger.log('Ingest complete: ' + filesProcessed + ' new files, ' + rowsWritten + ' rows.');
    Logger.log('Time buckets: ' + allBuckets.join(', '));
    Logger.log('NOW RUN "Compute March Deltas Only" separately.');

  } catch (e) {
    logRun(runId, 'error', 0, filesProcessed, rowsWritten, [], [], e.message + '\n' + e.stack);
    Logger.log('Backfill ingest FAILED: ' + e.message);
    throw e;
  }
}

function writeBackfillMetricReport(dateMetricLog, runId) {
  var sheetName = 'backfill_metric_audit';
  var headers = ['run_id', 'report_end_date', 'time_bucket', 'subject', 'raw_metric_names'];
  var rows = [];
  for (var i = 0; i < dateMetricLog.length; i++) {
    var entry = dateMetricLog[i];
    rows.push([runId, entry.date, entry.timeBucket, entry.subject, entry.rawMetrics.join(' | ')]);
  }
  if (rows.length > 0) {
    getOrCreateSheet(sheetName, headers);
    appendRows(sheetName, rows, headers);
  }
}
