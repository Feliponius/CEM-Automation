/**
 * Diagnostics.js — Investigate why a business date is missing from fact_daily_metric.
 */

function runDateGapDiagnostics(targetDate) {
  initializeSheets();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(targetDate || ''))) {
    throw new Error('targetDate must be YYYY-MM-DD');
  }

  var diagRunId = 'diag_' + new Date().getTime();
  var runAt = new Date().toISOString();
  var reportRows = [];

  function addReport(section, key, value) {
    reportRows.push([diagRunId, runAt, targetDate, section, key, safeDiagnosticValue(value)]);
  }

  var timezone = getConfigValue('TIMEZONE', Session.getScriptTimeZone());
  var businessDateSource = getConfigValue('BUSINESS_DATE_SOURCE', 'start');
  var lookbackDays = getConfigNumber('GMAIL_LOOKBACK_DAYS', 5);
  var lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);
  var afterDate = Utilities.formatDate(lookbackDate, timezone, 'yyyy/MM/dd');
  var query = getGmailQuery(afterDate, null);
  var messages = searchCemEmails(afterDate, null);
  var processedIds = getProcessedMessageIds();

  addReport('gmail', 'timezone', timezone);
  addReport('gmail', 'business_date_source', businessDateSource);
  addReport('gmail', 'lookback_days', lookbackDays);
  addReport('gmail', 'after_date', afterDate);
  addReport('gmail', 'query', query);
  addReport('gmail', 'messages_found', messages.length);

  var csvCount = 0;
  var alreadyProcessedCount = 0;
  var parsedTargetDateCount = 0;

  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    var msgId = msg.getId();
    var alreadyProcessed = !!processedIds[msgId];
    if (alreadyProcessed) alreadyProcessedCount++;

    var attachments = msg.getAttachments();
    var attachmentNames = [];
    for (var a = 0; a < attachments.length; a++) {
      attachmentNames.push(attachments[a].getName());
    }

    var csv = extractCsvAttachment(msg);
    var hasCsv = !!csv;
    if (hasCsv) csvCount++;

    var parsedDateStart = '';
    var parsedDateEnd = '';
    var parsedBusinessDate = '';
    var parsedRecords = 0;
    var rawEligibleRecords = 0;

    if (hasCsv) {
      var parsed = parseCemCsv(csv.csvText, csv.fileName);
      parsedDateStart = parsed.meta ? parsed.meta.dateRangeStart : '';
      parsedDateEnd = parsed.meta ? parsed.meta.dateRangeEnd : '';
      parsedBusinessDate = resolveBusinessDate(parsed.meta);
      parsedRecords = parsed.records ? parsed.records.length : 0;
      if (parsedBusinessDate === targetDate) parsedTargetDateCount++;

      for (var r = 0; r < parsedRecords; r++) {
        var rec = parsed.records[r];
        if (!rec.metricName) continue;
        if (rec.scorePct === null && rec.metricN === null) continue;
        rawEligibleRecords++;
      }
    }

    addReport('message', msgId, diagStringify({
      received_at: msg.getDate().toISOString(),
      from: msg.getFrom(),
      subject: msg.getSubject(),
      already_processed: alreadyProcessed,
      has_csv: hasCsv,
      attachment_names: attachmentNames,
      parsed_date_range_start: parsedDateStart,
      parsed_date_range_end: parsedDateEnd,
      parsed_business_date: parsedBusinessDate,
      parsed_records: parsedRecords,
      raw_eligible_records: rawEligibleRecords
    }));
  }

  addReport('gmail', 'messages_with_csv', csvCount);
  addReport('gmail', 'messages_already_processed', alreadyProcessedCount);
  addReport('gmail', 'messages_parsed_to_target_date', parsedTargetDateCount);

  var rawRows = readSheetData(CONFIG.SHEET_NAMES.RAW_CUMULATIVE);
  var rawTargetRows = [];
  var rawTargetNumericEligible = 0;
  var rawTargetNumericInvalid = 0;
  var rawSampleKeys = [];
  var rawSampleSet = {};

  for (var j = 0; j < rawRows.length; j++) {
    var raw = rawRows[j];
    var rawDate = formatDateStr(raw['business_date']);
    if (rawDate !== targetDate) continue;
    rawTargetRows.push(raw);

    var scorePct = parseFloat(raw['score_pct']);
    var metricN = parseInt(raw['metric_n'], 10);
    if (isNaN(scorePct) || isNaN(metricN)) {
      rawTargetNumericInvalid++;
    } else {
      rawTargetNumericEligible++;
    }

    var dimKey = [
      String(raw['store_id'] || ''),
      String(raw['time_bucket'] || ''),
      String(raw['sales_channel'] || ''),
      String(raw['metric_name'] || '')
    ].join('|||');
    if (!rawSampleSet[dimKey] && rawSampleKeys.length < 10) {
      rawSampleSet[dimKey] = true;
      rawSampleKeys.push(dimKey);
    }
  }

  addReport('raw', 'total_rows', rawRows.length);
  addReport('raw', 'target_date_rows', rawTargetRows.length);
  addReport('raw', 'target_date_numeric_eligible', rawTargetNumericEligible);
  addReport('raw', 'target_date_numeric_invalid', rawTargetNumericInvalid);
  addReport('raw', 'target_date_sample_dim_keys', rawSampleKeys.join(' ; '));

  var factRows = readSheetData(CONFIG.SHEET_NAMES.FACT_DAILY);
  var factTargetRows = [];
  var factSampleKeys = [];
  var factSampleSet = {};

  for (var k = 0; k < factRows.length; k++) {
    var fact = factRows[k];
    var factDate = formatDateStr(fact['business_date']);
    if (factDate !== targetDate) continue;
    factTargetRows.push(fact);

    var factKey = [
      String(fact['store_id'] || ''),
      String(fact['time_bucket'] || ''),
      String(fact['sales_channel'] || ''),
      String(fact['metric_name'] || '')
    ].join('|||');
    if (!factSampleSet[factKey] && factSampleKeys.length < 10) {
      factSampleSet[factKey] = true;
      factSampleKeys.push(factKey);
    }
  }

  addReport('fact', 'total_rows', factRows.length);
  addReport('fact', 'target_date_rows', factTargetRows.length);
  addReport('fact', 'target_date_sample_dim_keys', factSampleKeys.join(' ; '));

  var slackTargetDate = getYesterdayDateStr();
  var slackDayRows = filterRowsByDate(factRows, slackTargetDate);
  var slackTotalsUnderscore = 0;
  var slackTotalsFsl = 0;

  for (var s = 0; s < slackDayRows.length; s++) {
    var channel = String(slackDayRows[s]['sales_channel'] || '');
    if (channel === '_TOTAL') slackTotalsUnderscore++;
    if (channel === 'FSL_TOTAL') slackTotalsFsl++;
  }

  addReport('slack', 'target_date_from_timezone', slackTargetDate);
  addReport('slack', 'day_rows_count', slackDayRows.length);
  addReport('slack', 'day_rows_channel__TOTAL', slackTotalsUnderscore);
  addReport('slack', 'day_rows_channel_FSL_TOTAL', slackTotalsFsl);

  var reason = '';
  if (rawTargetRows.length === 0) {
    reason = 'No raw rows for target date. Likely message date mapping/query mismatch or missing ingest for that business date.';
  } else if (rawTargetNumericEligible === 0) {
    reason = 'Raw rows exist, but all are numerically invalid for delta computation (score_pct/metric_n parsing).';
  } else if (factTargetRows.length === 0) {
    reason = 'Raw numeric rows exist for target date but fact rows are zero. Investigate delta recompute timing or transformation path.';
  } else {
    reason = 'Fact rows exist for target date. Slack/date targeting or presentation logic is likely the issue.';
  }

  addReport('summary', 'diagnosis', reason);
  addReport('summary', 'target_date', targetDate);
  addReport('summary', 'diag_run_id', diagRunId);

  appendRows(
    CONFIG.SHEET_NAMES.DIAGNOSTIC_REPORT,
    reportRows,
    ['diagnostic_run_id', 'run_at', 'target_date', 'section', 'key', 'value']
  );

  var summary = '[Diagnostics ' + diagRunId + '] target=' + targetDate +
    ' raw=' + rawTargetRows.length +
    ' fact=' + factTargetRows.length +
    ' slackTarget=' + slackTargetDate +
    ' => ' + reason;
  Logger.log(summary);

  return { diagnosticRunId: diagRunId, summary: summary };
}

/**
 * Dry-run: scan all emails in a date window, parse CSV headers only,
 * and output what business_date each file would get under current rules.
 * Writes to a dedicated sheet. Does NOT ingest or modify any pipeline data.
 */
function auditDateMapping(afterYmd, beforeYmd) {
  initializeSheets();

  var auditId = 'audit_' + new Date().getTime();
  var runAt = new Date().toISOString();
  var afterQuery = afterYmd.replace(/-/g, '/');
  var beforeQuery = beforeYmd ? beforeYmd.replace(/-/g, '/') : null;
  var query = getGmailQuery(afterQuery, beforeQuery);
  var messages = searchCemEmails(afterQuery, beforeQuery);

  messages.sort(function(a, b) { return a.getDate() - b.getDate(); });

  var sheetName = 'date_mapping_audit';
  var headers = [
    'audit_id', 'run_at', 'received_at', 'subject', 'time_bucket',
    'date_range_start', 'date_range_end',
    'old_business_date_end', 'new_business_date_end_minus_1',
    'message_id', 'file_name', 'record_count'
  ];

  var rows = [];

  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    var csv = extractCsvAttachment(msg);
    if (!csv) continue;

    var lines = csv.csvText.split(/\r?\n/);
    var meta = parseHeaderMetadata(lines);

    var startDate = formatDateStr(meta.dateRangeStart);
    var endDate = formatDateStr(meta.dateRangeEnd);
    var oldBizDate = endDate;
    var newBizDate = shiftYmdByDays(endDate, -1);

    var blocks = detectBlocks(lines.map(function(l) { return l.split(','); }));
    var recordCount = 0;
    for (var b = 0; b < blocks.length; b++) {
      recordCount += blocks[b].metricNames.length;
    }

    rows.push([
      auditId,
      runAt,
      msg.getDate().toISOString(),
      msg.getSubject(),
      meta.timeBucket || '',
      startDate,
      endDate,
      oldBizDate,
      newBizDate,
      msg.getId(),
      csv.fileName,
      recordCount
    ]);
  }

  var sheet = getOrCreateSheet(sheetName, headers);
  if (rows.length > 0) {
    appendRows(sheetName, rows, headers);
  }

  var summary = '[Date Mapping Audit ' + auditId + '] query=' + query +
    ' emails=' + messages.length + ' csv_files=' + rows.length;
  Logger.log(summary);
  Logger.log('Results written to sheet: ' + sheetName);

  return { auditId: auditId, fileCount: rows.length, summary: summary };
}

function auditDateMappingMarchToToday() {
  return auditDateMapping('2026-03-01', null);
}

function safeDiagnosticValue(value) {
  if (value === null || typeof value === 'undefined') return '';
  var str = String(value);
  if (str.length <= 5000) return str;
  return str.substring(0, 5000) + '...';
}

function diagStringify(obj) {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    return String(obj);
  }
}
