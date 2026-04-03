/**
 * Parser.js — Parse SMG CSV header metadata and both metric blocks.
 */

/**
 * Parse header metadata from CSV lines.
 * @param {string[]} lines - All lines of the CSV
 * @returns {Object} { dateRangeStart, dateRangeEnd, visitDateAsOf, timeBucket }
 */
function parseHeaderMetadata(lines) {
  var meta = {
    dateRangeStart: null,
    dateRangeEnd: null,
    visitDateAsOf: null,
    timeBucket: null
  };

  for (var i = 0; i < Math.min(lines.length, 10); i++) {
    var line = lines[i];

    if (line.indexOf('Comparison:') === 0) {
      var rangePart = line.replace('Comparison:', '').split(',')[0].trim();
      var parts = rangePart.split(' - ');
      if (parts.length === 2) {
        meta.dateRangeStart = parts[0].trim();
        meta.dateRangeEnd = parts[1].trim();
      }
    }

    if (line.indexOf('Visit Date as of:') !== -1) {
      var afterPrefix = line.split('Visit Date as of:')[1].split(',')[0].trim();
      meta.visitDateAsOf = afterPrefix;
    }

    if (line.indexOf('Time of Day:') !== -1) {
      var match = line.match(/'([^']+)'/);
      if (match) {
        meta.timeBucket = normalizeTimeBucket(match[1]);
      }
    }
  }

  return meta;
}

/**
 * Resolve business date from parsed report metadata.
 * Configurable via BUSINESS_DATE_SOURCE=end_minus_1|start|end.
 */
function resolveBusinessDate(meta) {
  var source = String(getConfigValue('BUSINESS_DATE_SOURCE', 'end_minus_1')).toLowerCase();
  var startDate = formatDateStr(meta && meta.dateRangeStart);
  var endDate = formatDateStr(meta && meta.dateRangeEnd);

  if (source === 'end_minus_1') {
    var prev = shiftYmdByDays(endDate, -1);
    return prev || startDate || endDate || '';
  }
  if (source === 'end') return endDate || startDate || '';
  return startDate || endDate || '';
}

function shiftYmdByDays(ymd, dayDelta) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))) return '';
  var parts = ymd.split('-');
  var year = parseInt(parts[0], 10);
  var month = parseInt(parts[1], 10) - 1;
  var day = parseInt(parts[2], 10);
  var d = new Date(year, month, day);
  d.setDate(d.getDate() + dayDelta);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/**
 * Parse store string like "04465 - West Lufkin FSU" into { id, name }.
 */
function parseStoreId(storeStr) {
  if (!storeStr) return { id: '', name: '' };
  var dashIdx = storeStr.indexOf(' - ');
  if (dashIdx === -1) return { id: storeStr.trim(), name: storeStr.trim() };
  return {
    id: storeStr.substring(0, dashIdx).trim(),
    name: storeStr.substring(dashIdx + 3).trim()
  };
}

/**
 * Parse a score value, handling "%", "**", and empty strings.
 * @returns {number|null}
 */
function parseScore(val) {
  if (!val || val.trim() === '' || val.trim() === '**') return null;
  var cleaned = val.replace('%', '').trim();
  var num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return num / 100;
}

/**
 * Parse an integer n value, handling "**" and empty strings.
 * @returns {number|null}
 */
function parseN(val) {
  if (!val || val.trim() === '' || val.trim() === '**') return null;
  var num = parseInt(val, 10);
  return isNaN(num) ? null : num;
}

/**
 * Detect block boundaries by finding header rows.
 * A header row contains "Store" in column 0 and "Score" somewhere after.
 * @param {string[][]} rows - Parsed CSV rows (arrays of strings)
 * @returns {Object[]} Array of { headerRowIdx, metricNames, dataStartIdx }
 */
function detectBlocks(rows) {
  var blocks = [];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (row.length < 3) continue;
    if (row[0] && row[0].trim() === 'Store' &&
        row[1] && row[1].trim() === 'Sales Channel Breakout') {

      var metricNames = [];
      var rawMetricNames = [];
      for (var c = 3; c < row.length; c++) {
        var cell = (row[c] || '').trim();
        if (cell && cell !== '' && cell !== 'Score' && cell !== 'n') {
          metricNames.push({ colIdx: c, rawName: cell, canonical: normalizeMetricName(cell) });
          rawMetricNames.push(cell);
        }
      }

      blocks.push({
        headerRowIdx: i,
        metricNames: metricNames,
        rawMetricNames: rawMetricNames,
        dataStartIdx: i + 2
      });
    }
  }

  return blocks;
}

/**
 * Parse data rows from a block.
 * Each metric occupies two columns: Score (offset 0), n (offset 1) from the metric's colIdx.
 * @param {string[][]} rows - All CSV rows
 * @param {Object} block - Block descriptor from detectBlocks
 * @param {number} nextBlockStart - Row index where next block starts (or rows.length)
 * @returns {Object[]} Array of parsed records
 */
function parseBlockData(rows, block, nextBlockStart) {
  var records = [];

  for (var r = block.dataStartIdx; r < nextBlockStart; r++) {
    var row = rows[r];
    if (!row || !row[0] || row[0].trim() === '') continue;

    var store = parseStoreId(row[0]);
    var channel = (row[1] || '').trim() || '_TOTAL';
    var surveyCount = parseN(row[2]);

    for (var m = 0; m < block.metricNames.length; m++) {
      var metric = block.metricNames[m];
      var scorePct = parseScore(row[metric.colIdx]);
      var metricN = parseN(row[metric.colIdx + 1]);

      records.push({
        storeId: store.id,
        storeName: store.name,
        salesChannel: channel,
        surveyCount: surveyCount,
        metricRawName: metric.rawName,
        metricName: metric.canonical,
        scorePct: scorePct,
        metricN: metricN
      });
    }
  }

  return records;
}

/**
 * Parse a full CSV string into structured records.
 * @param {string} csvText - Raw CSV text
 * @param {string} fileName - Source filename (for logging)
 * @returns {Object} { meta, records, aliasIssues }
 */
function parseCemCsv(csvText, fileName) {
  var lines = csvText.split(/\r?\n/);
  var meta = parseHeaderMetadata(lines);

  var rows = [];
  for (var i = 0; i < lines.length; i++) {
    rows.push(lines[i].split(','));
  }

  var blocks = detectBlocks(rows);
  var allRecords = [];
  var aliasIssues = [];

  for (var b = 0; b < blocks.length; b++) {
    var block = blocks[b];
    var nextStart = (b + 1 < blocks.length) ? blocks[b + 1].headerRowIdx : rows.length;

    for (var m = 0; m < block.metricNames.length; m++) {
      if (!block.metricNames[m].canonical) {
        aliasIssues.push({
          fileName: fileName,
          rawName: block.metricNames[m].rawName,
          timeBucket: meta.timeBucket,
          dateRange: meta.dateRangeStart + ' - ' + meta.dateRangeEnd
        });
      }
    }

    var records = parseBlockData(rows, block, nextStart);
    allRecords = allRecords.concat(records);
  }

  return {
    meta: meta,
    records: allRecords,
    aliasIssues: aliasIssues
  };
}
