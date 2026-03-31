/**
 * Config.js — Constants, sheet names, metric aliases, and runtime config.
 */

var CONFIG = {
  GMAIL_QUERY_BASE: 'from:SMGMailMgr@whysmg.com subject:"SMG Reporting: Daily Sales Channel Breakout by Time" has:attachment filename:csv',
  GMAIL_EXCLUDE: '-subject:"Daily Comparison"',

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

  EXPECTED_TIME_BUCKETS: [
    'Before 10:30 AM',
    '10:30 AM to 2 PM',
    '2 PM to 5 PM',
    '5PM to 7 PM',
    'After 7 PM'
  ],

  TRAILING_REPROCESS_DAYS: 3,

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
