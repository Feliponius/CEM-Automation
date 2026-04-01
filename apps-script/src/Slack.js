/**
 * Slack.js — Prototype Slack delivery using config_runtime key:value settings.
 */

function sendSlackPrototypeDaily(dateStr) {
  initializeSheets();

  if (!getConfigBoolean('SLACK_ENABLED', false)) {
    Logger.log('Slack is disabled. Set SLACK_ENABLED=true in config_runtime.');
    return;
  }

  var token = getConfigValue('SLACK_BOT_TOKEN', '');
  if (!token) {
    throw new Error('Missing SLACK_BOT_TOKEN in config_runtime.');
  }

  var useTest = getConfigBoolean('SLACK_USE_TEST_CHANNEL', true);
  var channel = useTest
    ? getConfigValue('SLACK_TEST_CHANNEL', '')
    : getConfigValue('SLACK_DEFAULT_CHANNEL', '');

  if (!channel) {
    throw new Error('Missing Slack channel config. Set SLACK_TEST_CHANNEL or SLACK_DEFAULT_CHANNEL.');
  }

  var targetDate = dateStr || getYesterdayDateStr();
  var summary = buildDailySummary(targetDate);
  postSlackMessage(token, channel, summary.text, summary.blocks, summary.attachmentColor);
}

function buildDailySummary(targetDate) {
  var rows = readSheetData(CONFIG.SHEET_NAMES.FACT_DAILY);
  var dayRows = filterRowsByDate(rows, targetDate);
  var previousDate = findPreviousDate(rows, targetDate);
  var prevRows = previousDate ? filterRowsByDate(rows, previousDate) : [];

  if (dayRows.length === 0) {
    return {
      text: 'CEM Daily: no rows found for ' + targetDate,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: '*CEM Daily* | ' + targetDate } },
        { type: 'section', text: { type: 'mrkdwn', text: 'No data found for this date in `fact_daily_metric`.' } }
      ]
    };
  }

  var metrics = aggregateTotalsForDate(dayRows);
  var prevMetrics = aggregateTotalsForDate(prevRows);
  var overall = metrics['overall_satisfaction'] || null;
  var prevOverall = prevMetrics['overall_satisfaction'] || null;
  var mtd = aggregateMtdByMetric(dayRows);
  var mtdOverall = mtd['overall_satisfaction'] || null;

  var overallStatus = statusForMetric(
    'overall_satisfaction',
    targetDate,
    overall ? overall.dailyPct : null
  );
  var overallDelta = calcDelta(overall, prevOverall);
  var overallLine = overall
    ? (overallStatus.emoji + ' *Overall Satisfaction:* ' + fmtPct(overall.dailyPct) +
       ' ' + fmtDelta(overallDelta) + ' (' + overall.dailyN + ' responses)')
    : '⚪ *Overall Satisfaction:* n/a';

  var targetText = 'n/a';
  if (overallStatus.target && overallStatus.target.greenMin !== null) {
    targetText = '🟢>=' + fmtPct(overallStatus.target.greenMin) + ' | 🟡>=' + fmtPct(overallStatus.target.yellowMin);
  }

  var mtdLine = mtdOverall
    ? ('*MTD Overall:* ' + fmtPct(mtdOverall.pct) + ' (' + mtdOverall.n + ' responses) | *Targets:* ' + targetText)
    : ('*MTD Overall:* n/a | *Targets:* ' + targetText);

  var secondaryLines = [];
  for (var k = 0; k < METRIC_ORDER.length; k++) {
    var metricName = METRIC_ORDER[k];
    if (metricName === 'overall_satisfaction') continue;
    var metric = metrics[metricName];
    if (!metric) continue;

    var prevMetric = prevMetrics[metricName] || null;
    var delta = calcDelta(metric, prevMetric);
    var status = statusForMetric(metricName, targetDate, metric.dailyPct);
    secondaryLines.push(
      status.emoji + ' ' +
      metricLabel(metricName) + ': ' +
      fmtPct(metric.dailyPct) + ' ' +
      fmtDelta(delta) + ' | n=' + metric.dailyN
    );
  }

  var verbosity = String(getConfigValue('SLACK_VERBOSITY', 'detailed')).toLowerCase();
  var includeSecondary = getConfigBoolean('SLACK_INCLUDE_SECONDARY', true);

  var text = 'CEM Daily ' + targetDate + ' | Overall ' +
    (overall ? fmtPct(overall.dailyPct) : 'n/a') +
    ' | MTD ' + (mtdOverall ? fmtPct(mtdOverall.pct) : 'n/a') +
    ' | Δ ' + fmtDelta(overallDelta);

  var blocks = [
    { type: 'header', text: { type: 'plain_text', text: 'CEM Daily | ' + targetDate } },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: overallLine + '\n' + mtdLine }
    }
  ];

  if (verbosity !== 'brief' && includeSecondary && secondaryLines.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Secondary Metrics (Yesterday)*\n' + secondaryLines.join('\n')
      }
    });
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: 'Config-driven prototype. Edit channel/verbosity/targets in config sheets.' }]
  });

  return { text: text, blocks: blocks, attachmentColor: overallStatusToColor(overallStatus.emoji) };
}

function aggregateTotalsForDate(dayRows) {
  var out = {};

  for (var i = 0; i < dayRows.length; i++) {
    var r = dayRows[i];
    if (String(r['sales_channel']) !== '_TOTAL') continue;

    var metric = String(r['metric_name']);
    if (!out[metric]) {
      out[metric] = { dailyNum: 0, dailyN: 0, dailyPct: null };
    }

    var dailyNum = parseFloat(r['daily_numerator']);
    var dailyN = parseFloat(r['daily_n']);
    if (!isNaN(dailyNum)) out[metric].dailyNum += dailyNum;
    if (!isNaN(dailyN)) out[metric].dailyN += dailyN;
  }

  var keys = Object.keys(out);
  for (var k = 0; k < keys.length; k++) {
    var m = out[keys[k]];
    if (m.dailyN > 0) m.dailyPct = m.dailyNum / m.dailyN;
  }

  return out;
}

function aggregateMtdByMetric(dayRows) {
  var out = {};

  for (var i = 0; i < dayRows.length; i++) {
    var r = dayRows[i];
    if (String(r['sales_channel']) !== '_TOTAL') continue;
    var metric = String(r['metric_name']);
    if (!out[metric]) out[metric] = { num: 0, n: 0, pct: null };

    var cumNum = parseFloat(r['cum_numerator']);
    var cumN = parseFloat(r['cum_n']);
    if (!isNaN(cumNum)) out[metric].num += cumNum;
    if (!isNaN(cumN)) out[metric].n += cumN;
  }

  var keys = Object.keys(out);
  for (var k = 0; k < keys.length; k++) {
    var m = out[keys[k]];
    if (m.n > 0) m.pct = m.num / m.n;
  }
  return out;
}

function postSlackMessage(token, channel, text, blocks, attachmentColor) {
  var payload = {
    channel: channel,
    text: text,
    blocks: blocks
  };

  if (attachmentColor) {
    payload.attachments = [{ color: attachmentColor, text: ' ' }];
  }

  var response = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var body = response.getContentText();
  var parsed = {};
  try { parsed = JSON.parse(body); } catch (e) {}

  if (!parsed.ok) {
    throw new Error('Slack post failed: ' + body);
  }

  Logger.log('Slack post succeeded to channel ' + channel);
}

function calcDelta(metric, prevMetric) {
  if (!metric || metric.dailyPct === null || !prevMetric || prevMetric.dailyPct === null) return null;
  return metric.dailyPct - prevMetric.dailyPct;
}

function fmtDelta(delta) {
  if (delta === null || typeof delta === 'undefined' || isNaN(delta)) return '(vs prior: n/a)';
  var pp = delta * 100;
  var sign = pp > 0 ? '+' : '';
  var arrow = pp > 0 ? '↑' : (pp < 0 ? '↓' : '→');
  return '(' + arrow + ' ' + sign + pp.toFixed(1) + 'pp vs prior)';
}

function filterRowsByDate(rows, ymd) {
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (formatDateStr(rows[i]['business_date']) === ymd) out.push(rows[i]);
  }
  return out;
}

function findPreviousDate(rows, targetDate) {
  var prev = null;
  for (var i = 0; i < rows.length; i++) {
    var d = formatDateStr(rows[i]['business_date']);
    if (!d || d >= targetDate) continue;
    if (!prev || d > prev) prev = d;
  }
  return prev;
}

function overallStatusToColor(emoji) {
  if (emoji === '🟢') return '#2EB67D';
  if (emoji === '🟡') return '#ECB22E';
  if (emoji === '🔴') return '#E01E5A';
  return '#6B7280';
}

function getYesterdayDateStr() {
  var tz = getConfigValue('TIMEZONE', Session.getScriptTimeZone());
  var d = new Date();
  d.setDate(d.getDate() - 1);
  return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
}

function fmtPct(v) {
  if (v === null || typeof v === 'undefined' || isNaN(v)) return 'n/a';
  return (Math.round(v * 1000) / 10).toFixed(1) + '%';
}
