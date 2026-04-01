/**
 * Config.js — Constants, sheet names, metric aliases, and runtime config.
 */

var CONFIG = {
  SHEET_NAMES: {
    RAW_CUMULATIVE: 'raw_cumulative',
    FACT_DAILY: 'fact_daily_metric',
    CONFIG_TARGETS: 'config_targets',
    CONFIG_LOCATIONS: 'config_locations',
    CONFIG_RUNTIME: 'config_runtime',
    PROCESSED_MESSAGES: 'processed_messages',
    RUN_LOG: 'run_log',
    ALIAS_REPORT: 'alias_report'
  },

  RAW_HEADERS: [
    'business_date', 'date_range_start', 'date_range_end', 'visit_date_as_of',
    'time_bucket', 'store_id', 'store_name', 'sales_channel', 'survey_count',
    'metric_name', 'score_pct', 'metric_n',
    'source_file_name', 'message_id', 'run_id', 'loaded_at'
  ],

  FACT_HEADERS: [
    'business_date', 'store_id', 'store_name', 'time_bucket', 'sales_channel',
    'metric_name', 'cum_score_pct', 'cum_n', 'cum_numerator',
    'daily_score_pct', 'daily_n', 'daily_numerator',
    'source_file_name', 'message_id', 'run_id', 'loaded_at'
  ]
};

var DEFAULT_RUNTIME_CONFIG = [
  { key: 'GMAIL_FROM', value: 'SMGMailMgr@whysmg.com', description: 'Sender for SMG CEM emails' },
  { key: 'GMAIL_SUBJECT_INCLUDE', value: 'SMG Reporting: Daily Sales Channel Breakout by Time', description: 'Required subject phrase' },
  { key: 'GMAIL_SUBJECT_EXCLUDE', value: 'Daily Comparison', description: 'Excluded subject phrase' },
  { key: 'GMAIL_LOOKBACK_DAYS', value: '5', description: 'Daily run lookback window in days' },
  { key: 'GMAIL_SEARCH_LIMIT', value: '500', description: 'Max number of threads to scan per run' },
  { key: 'EXPECTED_TIME_BUCKETS', value: 'Before 10:30 AM|10:30 AM to 2 PM|2 PM to 5 PM|5PM to 7 PM|After 7 PM', description: 'Pipe-separated expected buckets' },
  { key: 'TRAILING_REPROCESS_DAYS', value: '3', description: 'Trailing days to recompute on each run' },
  { key: 'TIMEZONE', value: 'America/Chicago', description: 'Business timezone' },
  { key: 'TRIGGER_HOUR', value: '2', description: 'Primary daily trigger hour (0-23)' },
  { key: 'TRIGGER_MINUTE', value: '30', description: 'Primary daily trigger minute (0-59)' },
  { key: 'RETRY_ENABLED', value: 'true', description: 'Whether to schedule retry triggers' },
  { key: 'RETRY1_HOUR', value: '3', description: 'Retry #1 hour' },
  { key: 'RETRY1_MINUTE', value: '15', description: 'Retry #1 minute' },
  { key: 'RETRY2_HOUR', value: '3', description: 'Retry #2 hour' },
  { key: 'RETRY2_MINUTE', value: '50', description: 'Retry #2 minute' },
  { key: 'SLACK_ENABLED', value: 'false', description: 'Master Slack send switch' },
  { key: 'SLACK_AUTO_POST', value: 'false', description: 'Post Slack after daily run' },
  { key: 'SLACK_BOT_TOKEN', value: '', description: 'Slack bot token (xoxb-...)' },
  { key: 'SLACK_DEFAULT_CHANNEL', value: '', description: 'Production channel ID (e.g., C123...)' },
  { key: 'SLACK_TEST_CHANNEL', value: '', description: 'Test channel ID (e.g., C123...)' },
  { key: 'SLACK_USE_TEST_CHANNEL', value: 'true', description: 'If true, post to test channel' },
  { key: 'SLACK_VERBOSITY', value: 'detailed', description: 'Slack format: brief|detailed' },
  { key: 'SLACK_INCLUDE_SECONDARY', value: 'true', description: 'Include secondary metrics in Slack message' },
  { key: 'TARGET_LOOKBACK_DAYS', value: '30', description: 'Days to analyze for target suggestions' },
  { key: 'TARGET_MIN_SAMPLE', value: '5', description: 'Minimum daily sample to include in target suggestions' }
];

var METRIC_ALIASES = {
  'overall satisfaction': 'overall_satisfaction',
  'taste of food': 'taste_of_food',
  'fast service': 'fast_service',
  'speed of service': 'fast_service',
  'attentive/friendly': 'attentive_friendly',
  'attentive / friendly': 'attentive_friendly',
  'attentive friendly': 'attentive_friendly',
  'attentive & courteous': 'attentive_friendly',
  'cleanliness': 'cleanliness',
  'portion size of food': 'portion_size',
  'portion size': 'portion_size',
  'order accuracy y/n': 'order_accuracy',
  'order accuracy': 'order_accuracy'
};

var CANONICAL_METRICS_BLOCK1 = ['overall_satisfaction', 'taste_of_food', 'fast_service', 'attentive_friendly'];
var CANONICAL_METRICS_BLOCK2 = ['cleanliness', 'portion_size', 'order_accuracy'];

/**
 * Normalize a raw metric header string to its canonical name.
 * Returns null if not recognized — caller should log this as an alias discovery.
 */
function normalizeMetricName(raw) {
  var key = raw.toLowerCase().replace(/^\s+|\s+$/g, '').replace(/\s+/g, ' ');
  return METRIC_ALIASES[key] || null;
}

/**
 * Map email subject suffix to expected time bucket string in CSV.
 */
var SUBJECT_TO_BUCKET = {
  'breakfast': 'Before 10:30 AM',
  'lunch': '10:30 AM to 2 PM',
  '10:30 - 2:0': '10:30 AM to 2 PM',
  'afternoon': '2 PM to 5 PM',
  'dinner rush': '5PM to 7 PM',
  'closing': 'After 7 PM'
};

/**
 * Normalize time bucket strings.
 * Handles slight variations like "5 PM to 7 PM" vs "5PM to 7 PM".
 */
var TIME_BUCKET_ALIASES = {
  'before 10:30 am': 'Before 10:30 AM',
  '10:30 am to 2 pm': '10:30 AM to 2 PM',
  '10:30 - 2:0': '10:30 AM to 2 PM',
  '2 pm to 5 pm': '2 PM to 5 PM',
  '5pm to 7 pm': '5PM to 7 PM',
  '5 pm to 7 pm': '5PM to 7 PM',
  'after 7 pm': 'After 7 PM'
};

function normalizeTimeBucket(raw) {
  if (!raw) return raw;
  var key = raw.toLowerCase().replace(/^\s+|\s+$/g, '');
  return TIME_BUCKET_ALIASES[key] || raw;
}

var _runtimeConfigCache = null;

function refreshRuntimeConfigCache() {
  _runtimeConfigCache = null;
}

function getRuntimeConfigMap() {
  if (_runtimeConfigCache) return _runtimeConfigCache;

  var map = {};
  var rows = readSheetData(CONFIG.SHEET_NAMES.CONFIG_RUNTIME);
  for (var i = 0; i < rows.length; i++) {
    var key = String(rows[i]['key'] || '').trim();
    if (!key) continue;
    map[key] = String(rows[i]['value'] || '').trim();
  }

  _runtimeConfigCache = map;
  return map;
}

function getConfigValue(key, fallback) {
  var map = getRuntimeConfigMap();
  if (map.hasOwnProperty(key) && map[key] !== '') return map[key];
  return fallback;
}

function getConfigNumber(key, fallback) {
  var raw = getConfigValue(key, String(fallback));
  var num = parseInt(raw, 10);
  return isNaN(num) ? fallback : num;
}

function getConfigBoolean(key, fallback) {
  var raw = String(getConfigValue(key, fallback ? 'true' : 'false')).toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function getConfigList(key, fallbackList) {
  var fallback = (fallbackList || []).join('|');
  var raw = getConfigValue(key, fallback);
  if (!raw) return fallbackList || [];
  var pieces = raw.split('|');
  var out = [];
  for (var i = 0; i < pieces.length; i++) {
    var val = pieces[i].trim();
    if (val) out.push(val);
  }
  return out;
}

function getExpectedTimeBuckets() {
  return getConfigList('EXPECTED_TIME_BUCKETS', [
    'Before 10:30 AM',
    '10:30 AM to 2 PM',
    '2 PM to 5 PM',
    '5PM to 7 PM',
    'After 7 PM'
  ]);
}

function getGmailQuery(afterDate, beforeDate) {
  var from = getConfigValue('GMAIL_FROM', 'SMGMailMgr@whysmg.com');
  var include = getConfigValue('GMAIL_SUBJECT_INCLUDE', 'SMG Reporting: Daily Sales Channel Breakout by Time');
  var exclude = getConfigValue('GMAIL_SUBJECT_EXCLUDE', 'Daily Comparison');

  var query = 'from:' + from + ' subject:\"' + include + '\" has:attachment filename:csv';
  if (exclude) query += ' -subject:\"' + exclude + '\"';
  if (afterDate) query += ' after:' + afterDate;
  if (beforeDate) query += ' before:' + beforeDate;
  return query;
}
