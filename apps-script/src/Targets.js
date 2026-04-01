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

function resolveMetricTarget(metricName, businessDate, storeId, timeBucket, salesChannel) {
  var rows = readSheetData(CONFIG.SHEET_NAMES.CONFIG_TARGETS);
  var targetDate = toDateYmd(businessDate);
  var best = null;
  var bestScore = -1;
  var bestStart = '';

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var rowMetric = String(row['metric_name'] || '').trim();
    if (!rowMetric) continue;
    if (rowMetric !== metricName && rowMetric !== '*') continue;

    var start = toDateYmd(row['effective_start_date']) || '1900-01-01';
    var end = toDateYmd(row['effective_end_date']) || '9999-12-31';
    if (targetDate < start || targetDate > end) continue;

    var score = 0;
    if (!dimensionMatches(row['store_id'], storeId)) continue;
    score += dimensionScore(row['store_id'], storeId);
    if (!dimensionMatches(row['time_bucket'], timeBucket)) continue;
    score += dimensionScore(row['time_bucket'], timeBucket);
    if (!dimensionMatches(row['sales_channel'], salesChannel)) continue;
    score += dimensionScore(row['sales_channel'], salesChannel);
    if (rowMetric === metricName) score += 3;

    if (score > bestScore || (score === bestScore && start > bestStart)) {
      best = row;
      bestScore = score;
      bestStart = start;
    }
  }

  if (!best) return null;

  return {
    greenMin: parsePercentValue(best['target_green_min']),
    yellowMin: parsePercentValue(best['target_yellow_min']),
    notes: String(best['notes'] || '')
  };
}

function dimensionMatches(ruleValue, actual) {
  var r = String(ruleValue || '*').trim();
  if (!r || r === '*') return true;
  return String(actual || '').trim() === r;
}

function dimensionScore(ruleValue, actual) {
  var r = String(ruleValue || '*').trim();
  if (!r || r === '*') return 1;
  return String(actual || '').trim() === r ? 2 : -99;
}

function statusForMetric(metricName, businessDate, metricPct) {
  var target = resolveMetricTarget(metricName, businessDate, '*', '*', '_TOTAL');
  if (!target || target.greenMin === null || target.yellowMin === null || metricPct === null) {
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
      round4(p65),
      round4(p45),
      round4(p50),
      round4(avg),
      vals.length,
      startYmd,
      endYmd,
      'Suggested from recent distribution: green=P65, yellow=P45'
    ]);
  }

  var headers = [
    'metric_name', 'metric_label', 'suggested_green_min', 'suggested_yellow_min',
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
