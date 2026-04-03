/**
 * WebApp.js — HTTP API for external tools (Cursor, scripts, etc.)
 *
 * Deploy as: Publish > Deploy as web app
 *   - Execute as: Me
 *   - Who has access: Anyone (or Anyone with Google account)
 *
 * After deployment, the URL can be called with query parameters to read
 * sheet data, query specific dimensions, or trigger functions.
 *
 * Authentication: Uses a simple shared secret stored in config_runtime
 * as WEB_APP_SECRET. All requests must include ?secret=<value>.
 */

/**
 * Handle GET requests — read data from sheets.
 *
 * Query parameters:
 *   secret   — Required. Must match WEB_APP_SECRET in config_runtime.
 *   action   — Required. One of: read_sheet, query_fact, query_raw, summary, run_info, list_sheets, reconcile
 *   sheet    — Sheet name (for read_sheet)
 *   month    — YYYY-MM filter (for query_fact, query_raw, reconcile)
 *   metric   — metric_name filter (for query_fact)
 *   bucket   — time_bucket filter (for query_fact)
 *   channel  — sales_channel filter (for query_fact)
 *   date     — business_date filter (for query_fact)
 *   limit    — Max rows to return (default 500)
 */
function doGet(e) {
  try {
    var params = e.parameter || {};
    var authResult = checkAuth(params);
    if (authResult) return authResult;

    var action = params.action || '';

    switch (action) {
      case 'read_sheet':
        return jsonResponse(handleReadSheet(params));

      case 'query_fact':
        return jsonResponse(handleQueryFact(params));

      case 'query_raw':
        return jsonResponse(handleQueryRaw(params));

      case 'summary':
        return jsonResponse(handleSummary(params));

      case 'run_info':
        return jsonResponse(handleRunInfo(params));

      case 'list_sheets':
        return jsonResponse(handleListSheets());

      case 'reconcile':
        return jsonResponse(handleReconcile(params));

      case 'query_monthly':
        return jsonResponse(handleQueryMonthly(params));

      case 'schema':
        return jsonResponse(handleSchema(params));

      default:
        return jsonResponse({
          error: 'Unknown action: ' + action,
          available_actions: [
            'read_sheet', 'query_fact', 'query_raw', 'query_monthly',
            'summary', 'run_info', 'list_sheets', 'reconcile', 'schema'
          ]
        }, 400);
    }

  } catch (err) {
    return jsonResponse({ error: err.message, stack: err.stack }, 500);
  }
}

/**
 * Handle POST requests — trigger actions.
 *
 * POST body (JSON):
 *   secret   — Required.
 *   action   — Required. One of: run_pipeline, recompute_deltas, reconcile_month
 *   month    — YYYY-MM (for reconcile_month, recompute with month filter)
 */
function doPost(e) {
  try {
    var body = {};
    if (e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }

    var authResult = checkAuth(body);
    if (authResult) return authResult;

    var action = body.action || '';

    switch (action) {
      case 'run_pipeline':
        runDailyPipeline();
        return jsonResponse({ status: 'ok', message: 'Daily pipeline completed.' });

      case 'recompute_deltas':
        var month = body.month || null;
        if (month) {
          computeDailyDeltas(month);
        } else {
          computeDailyDeltas();
        }
        return jsonResponse({ status: 'ok', message: 'Deltas recomputed.' + (month ? ' Month: ' + month : ' Full recompute.') });

      case 'reconcile_month':
        var reconMonth = body.month;
        if (!reconMonth) {
          return jsonResponse({ error: 'month parameter required for reconcile_month' }, 400);
        }
        reconcileMonth(reconMonth);
        return jsonResponse({ status: 'ok', message: 'Reconciliation complete for ' + reconMonth });

      default:
        return jsonResponse({
          error: 'Unknown POST action: ' + action,
          available_actions: ['run_pipeline', 'recompute_deltas', 'reconcile_month']
        }, 400);
    }

  } catch (err) {
    return jsonResponse({ error: err.message, stack: err.stack }, 500);
  }
}

// ─────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────

function checkAuth(params) {
  var secret = getConfigValue('WEB_APP_SECRET', '');
  if (!secret) {
    return jsonResponse({
      error: 'WEB_APP_SECRET not configured in config_runtime. Add a row with key=WEB_APP_SECRET and a strong random value.'
    }, 403);
  }
  if (params.secret !== secret) {
    return jsonResponse({ error: 'Invalid or missing secret.' }, 403);
  }
  return null;
}

// ─────────────────────────────────────────────────────────
// GET HANDLERS
// ─────────────────────────────────────────────────────────

function handleReadSheet(params) {
  var sheetName = params.sheet;
  if (!sheetName) return { error: 'sheet parameter required' };

  var data = readSheetData(sheetName);
  var limit = parseInt(params.limit || '500', 10);
  if (data.length > limit) data = data.slice(data.length - limit);

  return { sheet: sheetName, row_count: data.length, rows: data };
}

function handleQueryFact(params) {
  var data = readSheetData(CONFIG.SHEET_NAMES.FACT_DAILY);
  data = applyFactFilters(data, params);

  var limit = parseInt(params.limit || '500', 10);
  if (data.length > limit) data = data.slice(data.length - limit);

  return { sheet: CONFIG.SHEET_NAMES.FACT_DAILY, row_count: data.length, filters_applied: describeFilters(params), rows: data };
}

function handleQueryRaw(params) {
  var data = readSheetData(CONFIG.SHEET_NAMES.RAW_CUMULATIVE);

  if (params.month) {
    data = data.filter(function(r) {
      return formatDateStr(r['business_date']).substring(0, 7) === params.month;
    });
  }
  if (params.date) {
    data = data.filter(function(r) {
      return formatDateStr(r['business_date']) === params.date;
    });
  }

  var limit = parseInt(params.limit || '500', 10);
  if (data.length > limit) data = data.slice(data.length - limit);

  return { sheet: CONFIG.SHEET_NAMES.RAW_CUMULATIVE, row_count: data.length, rows: data };
}

function handleSummary(params) {
  var factData = readSheetData(CONFIG.SHEET_NAMES.FACT_DAILY);
  if (factData.length === 0) return { message: 'No fact data available.' };

  var month = params.month;
  if (month) {
    factData = factData.filter(function(r) {
      return formatDateStr(r['business_date']).substring(0, 7) === month;
    });
  }

  var dates = {};
  var metrics = {};
  var buckets = {};
  var channels = {};

  for (var i = 0; i < factData.length; i++) {
    var row = factData[i];
    var d = formatDateStr(row['business_date']);
    dates[d] = true;
    metrics[row['metric_name']] = true;
    buckets[row['time_bucket']] = true;
    channels[row['sales_channel']] = true;
  }

  var sortedDates = Object.keys(dates).sort();

  var latestDate = sortedDates[sortedDates.length - 1];
  var latestRows = factData.filter(function(r) {
    return formatDateStr(r['business_date']) === latestDate;
  });

  var latestSummary = {};
  for (var j = 0; j < latestRows.length; j++) {
    var lr = latestRows[j];
    var mk = lr['metric_name'];
    if (!latestSummary[mk]) {
      latestSummary[mk] = { total_daily_n: 0, total_daily_numerator: 0, total_cum_n: 0 };
    }
    var dn = parseInt(lr['daily_n'], 10);
    var dnum = parseInt(lr['daily_numerator'], 10);
    var cn = parseInt(lr['cum_n'], 10);
    if (!isNaN(dn)) latestSummary[mk].total_daily_n += dn;
    if (!isNaN(dnum)) latestSummary[mk].total_daily_numerator += dnum;
    if (!isNaN(cn)) latestSummary[mk].total_cum_n += cn;
  }

  for (var metricKey in latestSummary) {
    var ms = latestSummary[metricKey];
    ms.daily_score_pct = ms.total_daily_n > 0 ? ms.total_daily_numerator / ms.total_daily_n : null;
  }

  return {
    month_filter: month || '(all)',
    total_fact_rows: factData.length,
    date_range: sortedDates[0] + ' to ' + latestDate,
    unique_dates: sortedDates.length,
    metrics: Object.keys(metrics),
    time_buckets: Object.keys(buckets),
    sales_channels: Object.keys(channels),
    latest_date: latestDate,
    latest_date_summary: latestSummary
  };
}

function handleRunInfo(params) {
  var runs = readSheetData(CONFIG.SHEET_NAMES.RUN_LOG);
  var limit = parseInt(params.limit || '20', 10);
  if (runs.length > limit) runs = runs.slice(runs.length - limit);
  return { total_runs: runs.length, recent_runs: runs };
}

function handleListSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var list = [];
  for (var i = 0; i < sheets.length; i++) {
    list.push({
      name: sheets[i].getName(),
      rows: sheets[i].getLastRow(),
      cols: sheets[i].getLastColumn()
    });
  }
  return { sheets: list };
}

function handleQueryMonthly(params) {
  var data = readSheetData(CONFIG.SHEET_NAMES.RAW_MONTHLY);
  if (params.month) {
    data = data.filter(function(r) {
      return String(r['month'] || '').substring(0, 7) === params.month;
    });
  }
  var limit = parseInt(params.limit || '500', 10);
  if (data.length > limit) data = data.slice(data.length - limit);
  return { sheet: CONFIG.SHEET_NAMES.RAW_MONTHLY, row_count: data.length, rows: data };
}

function handleReconcile(params) {
  var data = readSheetData(RECONCILIATION_SHEET);
  if (params.month) {
    data = data.filter(function(r) { return r['month'] === params.month; });
  }
  var limit = parseInt(params.limit || '500', 10);
  if (data.length > limit) data = data.slice(data.length - limit);
  return { sheet: RECONCILIATION_SHEET, row_count: data.length, rows: data };
}

function handleSchema(params) {
  var sheetName = params.sheet;
  if (!sheetName) {
    return {
      available_sheets: Object.keys(CONFIG.SHEET_NAMES).map(function(k) { return CONFIG.SHEET_NAMES[k]; }),
      raw_headers: CONFIG.RAW_HEADERS,
      fact_headers: CONFIG.FACT_HEADERS,
      reconciliation_headers: RECONCILIATION_HEADERS
    };
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { error: 'Sheet not found: ' + sheetName };

  var headers = [];
  if (sheet.getLastRow() >= 1 && sheet.getLastColumn() >= 1) {
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  }

  return {
    sheet: sheetName,
    headers: headers,
    row_count: Math.max(0, sheet.getLastRow() - 1),
    col_count: sheet.getLastColumn()
  };
}

// ─────────────────────────────────────────────────────────
// FILTER HELPERS
// ─────────────────────────────────────────────────────────

function applyFactFilters(data, params) {
  if (params.month) {
    data = data.filter(function(r) {
      return formatDateStr(r['business_date']).substring(0, 7) === params.month;
    });
  }
  if (params.date) {
    data = data.filter(function(r) {
      return formatDateStr(r['business_date']) === params.date;
    });
  }
  if (params.metric) {
    data = data.filter(function(r) {
      return r['metric_name'] === params.metric;
    });
  }
  if (params.bucket) {
    data = data.filter(function(r) {
      return r['time_bucket'] === params.bucket;
    });
  }
  if (params.channel) {
    data = data.filter(function(r) {
      return r['sales_channel'] === params.channel;
    });
  }
  return data;
}

function describeFilters(params) {
  var filters = [];
  if (params.month) filters.push('month=' + params.month);
  if (params.date) filters.push('date=' + params.date);
  if (params.metric) filters.push('metric=' + params.metric);
  if (params.bucket) filters.push('bucket=' + params.bucket);
  if (params.channel) filters.push('channel=' + params.channel);
  return filters.length > 0 ? filters.join(', ') : 'none';
}

// ─────────────────────────────────────────────────────────
// RESPONSE HELPERS
// ─────────────────────────────────────────────────────────

function jsonResponse(data, statusCode) {
  var output = ContentService.createTextOutput(JSON.stringify(data, null, 2));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
