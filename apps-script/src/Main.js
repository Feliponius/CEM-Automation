/**
 * Main.js — Entry points, triggers, menu items.
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Eleanor CEM')
    .addItem('Initialize Sheets', 'initializeSheets')
    .addItem('Setup Automation Triggers', 'setupAutomationTriggers')
    .addItem('Clear Automation Triggers', 'clearAutomationTriggers')
    .addSeparator()
    .addItem('Run Daily Pipeline', 'runDailyPipeline')
    .addItem('Backfill March (Ingest Only)', 'backfillMarchIngest')
    .addSeparator()
    .addItem('Compute Daily Deltas', 'recomputeDeltas')
    .addItem('Compute March Deltas Only', 'computeMarchDeltas')
    .addSeparator()
    .addItem('Generate Target Suggestions', 'generateTargetSuggestions')
    .addItem('Generate Simple Target Scaffold', 'generateSimpleTargetScaffold')
    .addItem('Publish Simple Targets to Config', 'publishSimpleTargetsToConfig')
    .addItem('Apply Suggested Targets to Config', 'applySuggestedTargetsToConfig')
    .addSeparator()
    .addItem('Run Diagnostics (Apr 1, 2026)', 'runDiagnosticsApr1')
    .addItem('Run Diagnostics (Prompt Date)', 'runDiagnosticsPromptDate')
    .addItem('Audit Date Mapping (March to Today)', 'auditDateMappingMarchToToday')
    .addItem('Send Slack Prototype (Yesterday)', 'sendSlackPrototypeForYesterday')
    .addSeparator()
    .addItem('Run Monthly Reconciliation (Previous Month)', 'runMonthlyReconciliation')
    .addItem('Run Monthly Reconciliation (Prompt Month)', 'runMonthlyReconciliationPrompt')
    .addItem('Setup Monthly Reconciliation Trigger', 'setupMonthlyReconciliationTrigger')
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

    var lookbackDays = getConfigNumber('GMAIL_LOOKBACK_DAYS', 5);
    var timezone = getConfigValue('TIMEZONE', Session.getScriptTimeZone());
    var lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);
    var afterDate = Utilities.formatDate(lookbackDate, timezone, 'yyyy/MM/dd');

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

    if (getConfigBoolean('SLACK_AUTO_POST', false)) {
      sendSlackPrototypeForYesterday();
    }

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

  var subject = message.getSubject();
  var monthlyFromSubject = isMonthlySubject(subject);
  var isMonthly = parsed.isMonthly || monthlyFromSubject;

  if (!parsed.meta.timeBucket) {
    var subjectBucket = resolveBucketFromSubject(subject);
    if (subjectBucket) parsed.meta.timeBucket = subjectBucket;
  }

  if (isMonthly) {
    return processMonthlyMessage(parsed, csv, message, runId);
  }

  var businessDate = resolveBusinessDate(parsed.meta);
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
    aliasIssues: parsed.aliasIssues,
    isMonthly: false
  };
}

/**
 * Process a monthly report email. Stores in raw_monthly instead of raw_cumulative.
 * Uses the end date of the comparison range as the month identifier (YYYY-MM).
 */
function processMonthlyMessage(parsed, csv, message, runId) {
  var endDate = formatDateStr(parsed.meta.dateRangeEnd);
  var monthStr = endDate ? endDate.substring(0, 7) : '';

  var rawRows = [];

  for (var r = 0; r < parsed.records.length; r++) {
    var rec = parsed.records[r];
    if (!rec.metricName) continue;
    if (rec.scorePct === null && rec.metricN === null) continue;

    rawRows.push([
      monthStr,
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
    appendRows(CONFIG.SHEET_NAMES.RAW_MONTHLY, rawRows, CONFIG.MONTHLY_RAW_HEADERS);
  }

  Logger.log('Monthly report processed: ' + monthStr + ' / ' + parsed.meta.timeBucket + ' — ' + rawRows.length + ' rows.');

  return {
    rowCount: rawRows.length,
    timeBucket: parsed.meta.timeBucket,
    aliasIssues: parsed.aliasIssues,
    isMonthly: true
  };
}

// ─────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────

function findMissingBuckets(foundBuckets) {
  var expectedBuckets = getExpectedTimeBuckets();
  var missing = [];
  for (var i = 0; i < expectedBuckets.length; i++) {
    var bucket = expectedBuckets[i];
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

function sendSlackPrototypeForYesterday() {
  sendSlackPrototypeDaily(null);
}

function runDiagnosticsApr1() {
  runDateGapDiagnostics('2026-04-01');
}

function runDiagnosticsPromptDate() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt(
    'Run date diagnostics',
    'Enter target business date (YYYY-MM-DD), e.g. 2026-04-01',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;

  var targetDate = String(response.getResponseText() || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    ui.alert('Invalid date format. Use YYYY-MM-DD.');
    return;
  }

  var report = runDateGapDiagnostics(targetDate);
  ui.alert('Diagnostics complete', report.summary, ui.ButtonSet.OK);
}

function runRetryPipeline() {
  Logger.log('Retry pipeline trigger fired.');
  runDailyPipeline();
}

function setupAutomationTriggers() {
  initializeSheets();
  clearAutomationTriggers();

  var hour = getConfigNumber('TRIGGER_HOUR', 2);
  var minute = getConfigNumber('TRIGGER_MINUTE', 30);

  ScriptApp.newTrigger('runDailyPipeline')
    .timeBased()
    .everyDays(1)
    .atHour(hour)
    .nearMinute(minute)
    .create();

  if (getConfigBoolean('RETRY_ENABLED', true)) {
    var retry1Hour = getConfigNumber('RETRY1_HOUR', 3);
    var retry1Min = getConfigNumber('RETRY1_MINUTE', 15);
    var retry2Hour = getConfigNumber('RETRY2_HOUR', 3);
    var retry2Min = getConfigNumber('RETRY2_MINUTE', 50);

    ScriptApp.newTrigger('runRetryPipeline')
      .timeBased()
      .everyDays(1)
      .atHour(retry1Hour)
      .nearMinute(retry1Min)
      .create();

    ScriptApp.newTrigger('runRetryPipeline')
      .timeBased()
      .everyDays(1)
      .atHour(retry2Hour)
      .nearMinute(retry2Min)
      .create();
  }

  Logger.log('Automation triggers set up from config_runtime.');
}

function clearAutomationTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var handler = triggers[i].getHandlerFunction();
    if (handler === 'runDailyPipeline' || handler === 'runRetryPipeline') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  Logger.log('Automation triggers cleared.');
}

// ─────────────────────────────────────────────────────────
// BACKFILL: Ingest only (no delta computation)
// ─────────────────────────────────────────────────────────

function backfillMarchIngest() {
  backfillIngestRange('2026/03/01', '2026/04/01', 'backfill_march');
}

function backfillMarchToTodayIngest() {
  backfillIngestRange('2026/03/01', null, 'backfill_march_to_today');
}

function backfillIngestRange(afterDate, beforeDate, runPrefix) {
  var runId = 'backfill_march_' + new Date().getTime();
  var filesProcessed = 0;
  var rowsWritten = 0;
  var allBuckets = [];
  var allAliasIssues = [];
  var dateMetricLog = [];

  try {
    initializeSheets();
    var processedIds = getProcessedMessageIds();

    var prefix = runPrefix || 'backfill';
    runId = prefix + '_' + new Date().getTime();
    var messages = searchCemEmails(afterDate, beforeDate);
    var emailsFound = messages.length;
    Logger.log('Found ' + emailsFound + ' CEM emails for range after=' + afterDate + ' before=' + (beforeDate || '(none)') + '.');

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

      var businessDate = resolveBusinessDate(parsed.meta);
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
    Logger.log('NOW RUN delta recomputation separately.');

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
