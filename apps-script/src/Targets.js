/**
 * Targets.js — Target lookup and target suggestion helpers.
 */

var METRIC_LABELS = {
  overall_satisfaction: 'Overall Satisfaction',
  taste_of_food: 'Taste of Food',
  fast_service: 'Fast Service',
  attentive_friendly: 'Attentive/Friendly',
  cleanliness: 'Cleanliness',
  portion_size: 'Portion Size',
  order_accuracy: 'Order Accuracy'
};

var METRIC_ORDER = [
  'overall_satisfaction',
  'taste_of_food',
  'fast_service',
  'attentive_friendly',
  'cleanliness',
  'portion_size',
  'order_accuracy'
];

function metricLabel(metricName) {
  return METRIC_LABELS[metricName] || metricName;
}

function parsePercentValue(v) {
  if (v === null || typeof v === 'undefined' || v === '') return null;
  var raw = String(v).trim();
  if (!raw) return null;
  var hasPct = raw.indexOf('%') !== -1;
  var num = parseFloat(raw.replace('%', ''));
  if (isNaN(num)) return null;
  if (hasPct || num > 1) return num / 100;
  return num;
}

function toDateYmd(v) {
  if (!v) return null;
  var s = formatDateStr(v);
  return s ? s.substring(0, 10) : null;
}

function resolveMetricTarget(metricName) {
  var rows = readSheetData(CONFIG.SHEET_NAMES.CONFIG_TARGETS);
  var best = null;

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var rowMetric = String(row['metric_name'] || '').trim();
    if (!rowMetric || rowMetric !== metricName) continue;
    best = row;
    break;
  }

  if (!best) return null;

  var goal = parsePercentValue(best['target_goal']);
  var buffer = parsePercentValue(best['yellow_buffer_pct']);
  if (buffer === null) buffer = parsePercentValue(getConfigValue('TARGET_YELLOW_BUFFER_PCT', '0.05'));
  if (buffer === null) buffer = 0.05;
  if (goal === null) return null;

  var greenMin = goal;
  var yellowMin = goal * (1 - buffer);
  if (yellowMin < 0) yellowMin = 0;

  return {
    goal: goal,
    yellowBufferPct: buffer,
    greenMin: greenMin,
    yellowMin: yellowMin,
    notes: String(best['notes'] || '')
  };
}

function statusForMetric(metricName, metricPct) {
  var target = resolveMetricTarget(metricName);
  if (!target || metricPct === null) {
    return { emoji: '⚪', label: 'No target', target: target };
  }

  if (metricPct >= target.greenMin) return { emoji: '🟢', label: 'On target', target: target };
  if (metricPct >= target.yellowMin) return { emoji: '🟡', label: 'Watch', target: target };
  return { emoji: '🔴', label: 'Below target', target: target };
}

function percentile(values, p) {
  if (!values || values.length === 0) return null;
  var sorted = values.slice().sort(function(a, b) { return a - b; });
  var idx = (sorted.length - 1) * p;
  var lo = Math.floor(idx);
  var hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  var frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

function generateTargetSuggestions() {
  initializeSheets();

  var lookbackDays = getConfigNumber('TARGET_LOOKBACK_DAYS', 30);
  var minSample = getConfigNumber('TARGET_MIN_SAMPLE', 5);
  var tz = getConfigValue('TIMEZONE', Session.getScriptTimeZone());

  var endDate = new Date();
  var startDate = new Date();
  startDate.setDate(startDate.getDate() - lookbackDays);
  var startYmd = Utilities.formatDate(startDate, tz, 'yyyy-MM-dd');
  var endYmd = Utilities.formatDate(endDate, tz, 'yyyy-MM-dd');

  var rows = readSheetData(CONFIG.SHEET_NAMES.FACT_DAILY);
  var byMetric = {};

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var date = toDateYmd(r['business_date']);
    if (!date || date < startYmd || date > endYmd) continue;
    if (String(r['sales_channel']) !== '_TOTAL') continue;
    var metric = String(r['metric_name'] || '');
    var pct = parseFloat(r['daily_score_pct']);
    var n = parseFloat(r['daily_n']);
    if (!metric || isNaN(pct) || isNaN(n) || n < minSample) continue;

    if (!byMetric[metric]) byMetric[metric] = [];
    byMetric[metric].push(pct);
  }

  var output = [];
  for (var m = 0; m < METRIC_ORDER.length; m++) {
    var metricName = METRIC_ORDER[m];
    var vals = byMetric[metricName] || [];
    if (vals.length === 0) continue;

    var p45 = percentile(vals, 0.45);
    var p65 = percentile(vals, 0.65);
    var p50 = percentile(vals, 0.50);
    var avg = vals.reduce(function(a, b) { return a + b; }, 0) / vals.length;

    output.push([
      metricName,
      metricLabel(metricName),
      round4(p65),                               // suggested_goal
      round4(Math.max(0, 1 - (p45 / p65))),     // suggested yellow buffer based on P45
      round4(p65 * (1 - Math.max(0, 1 - (p45 / p65)))), // implied yellow threshold
      round4(p50),
      round4(avg),
      vals.length,
      startYmd,
      endYmd,
      'Suggested from recent distribution: green=P65, yellow=P45'
    ]);
  }

  var headers = [
    'metric_name', 'metric_label', 'suggested_goal', 'suggested_yellow_buffer_pct', 'implied_yellow_min',
    'median', 'average', 'sample_days', 'lookback_start', 'lookback_end', 'notes'
  ];
  var sheet = getOrCreateSheet('target_suggestions', headers);
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).clearContent();
  }
  if (output.length > 0) {
    sheet.getRange(2, 1, output.length, headers.length).setValues(output);
  }

  Logger.log('Target suggestions generated in target_suggestions sheet.');
}

function round4(v) {
  return Math.round(v * 10000) / 10000;
}

/**
 * Create a simple manual target scaffold with one row per metric.
 * This intentionally avoids time-bucket/channel/store permutations.
 */
function generateSimpleTargetScaffold() {
  initializeSheets();

  var defaultBuffer = parsePercentValue(getConfigValue('TARGET_YELLOW_BUFFER_PCT', '0.05'));
  if (defaultBuffer === null) defaultBuffer = 0.05;

  var rows = [];
  for (var i = 0; i < METRIC_ORDER.length; i++) {
    var metric = METRIC_ORDER[i];
    rows.push([
      metric,
      metricLabel(metric),
      '',             // target_goal (user input)
      defaultBuffer,  // yellow buffer
      '',             // computed yellow min (formula preview)
      'Set goal and buffer. Green=goal, Yellow=goal*(1-buffer), Red<Yellow.'
    ]);
  }

  var headers = [
    'metric_name',
    'metric_label',
    'target_goal',
    'yellow_buffer_pct',
    'computed_yellow_min',
    'notes'
  ];
  var sheet = getOrCreateSheet('target_scaffold_simple', headers);
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).clearContent();
  }
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  Logger.log('Generated target_scaffold_simple. Fill target_goal and optional yellow_buffer_pct, then run publishSimpleTargetsToConfig().');
}

/**
 * Publish simple metric-only targets into config_targets.
 * Scope is fixed to totals-only to avoid permutations:
 *   store_id=*, time_bucket=*, sales_channel=_TOTAL
 */
function publishSimpleTargetsToConfig() {
  initializeSheets();

  var scaffold = readSheetData('target_scaffold_simple');
  if (!scaffold || scaffold.length === 0) {
    throw new Error('target_scaffold_simple is empty. Run generateSimpleTargetScaffold() first.');
  }

  var defaultBuffer = parsePercentValue(getConfigValue('TARGET_YELLOW_BUFFER_PCT', '0.05'));
  if (defaultBuffer === null) defaultBuffer = 0.05;

  var payloadRows = [];
  for (var i = 0; i < scaffold.length; i++) {
    var s = scaffold[i];
    var metricName = String(s['metric_name'] || '').trim();
    if (!metricName) continue;

    var goal = parsePercentValue(s['target_goal']);
    var buffer = parsePercentValue(s['yellow_buffer_pct']);
    if (buffer === null) buffer = defaultBuffer;
    if (goal === null) continue;
    if (buffer < 0) buffer = 0;
    if (buffer > 0.99) buffer = 0.99;

    var note = String(s['notes'] || '').trim();
    note = (note ? note + ' | ' : '') + 'goal=' + round4(goal) + ',buffer=' + round4(buffer);

    payloadRows.push([
      metricName,
      goal,
      buffer,
      note || 'Published from target_scaffold_simple'
    ]);
  }

  if (payloadRows.length === 0) {
    throw new Error('No valid rows in target_scaffold_simple. Fill target_goal values.');
  }

  var sheet = getOrCreateSheet(CONFIG.SHEET_NAMES.CONFIG_TARGETS, [
    'metric_name', 'target_goal', 'yellow_buffer_pct', 'notes'
  ]);

  var dedup = {};
  for (var p = 0; p < payloadRows.length; p++) {
    dedup[payloadRows[p][0]] = payloadRows[p];
  }
  var finalRows = [['metric_name', 'target_goal', 'yellow_buffer_pct', 'notes']];
  var keys = Object.keys(dedup);
  for (var k = 0; k < keys.length; k++) {
    finalRows.push(dedup[keys[k]]);
  }
  sheet.clearContents();
  sheet.getRange(1, 1, finalRows.length, 4).setValues(finalRows);
  sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
  sheet.setFrozenRows(1);

  Logger.log('Published ' + (finalRows.length - 1) + ' simple metric targets to config_targets.');
}

/**
 * Apply rows from target_suggestions into config_targets as baseline targets.
 * Replaces existing open-ended baseline rows for the same scope+metric.
 */
function applySuggestedTargetsToConfig() {
  initializeSheets();
  var defaultBuffer = parsePercentValue(getConfigValue('TARGET_YELLOW_BUFFER_PCT', '0.05'));
  if (defaultBuffer === null) defaultBuffer = 0.05;

  var suggestions = readSheetData('target_suggestions');
  if (!suggestions || suggestions.length === 0) {
    throw new Error('No rows found in target_suggestions. Run generateTargetSuggestions() first.');
  }

  var payloadRows = [];
  for (var i = 0; i < suggestions.length; i++) {
    var s = suggestions[i];
    var metricName = String(s['metric_name'] || '').trim();
    var goal = parsePercentValue(s['suggested_goal']);
    var buffer = parsePercentValue(s['suggested_yellow_buffer_pct']);
    if (buffer === null) buffer = defaultBuffer;
    if (!metricName) continue;
    if (goal === null) continue;

    payloadRows.push([
      metricName,
      goal,
      buffer,
      'Auto-seeded from target_suggestions'
    ]);
  }

  if (payloadRows.length === 0) {
    throw new Error('No valid target rows to apply.');
  }

  var sheet = getOrCreateSheet(CONFIG.SHEET_NAMES.CONFIG_TARGETS, [
    'metric_name', 'target_goal', 'yellow_buffer_pct', 'notes'
  ]);
  var dedup = {};
  for (var p = 0; p < payloadRows.length; p++) {
    dedup[payloadRows[p][0]] = payloadRows[p];
  }
  var finalRows = [['metric_name', 'target_goal', 'yellow_buffer_pct', 'notes']];
  var keys = Object.keys(dedup);
  for (var k = 0; k < keys.length; k++) {
    finalRows.push(dedup[keys[k]]);
  }
  sheet.clearContents();
  sheet.getRange(1, 1, finalRows.length, 4).setValues(finalRows);
  sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
  sheet.setFrozenRows(1);

  Logger.log('Applied ' + (finalRows.length - 1) + ' suggested targets to simple config_targets.');
}
