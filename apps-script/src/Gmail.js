/**
 * Gmail.js — Search Gmail for SMG CEM reports, extract CSV attachments.
 */

/**
 * Search Gmail for CEM report emails within a date window.
 * @param {string} afterDate - "YYYY/MM/DD" format
 * @param {string} beforeDate - "YYYY/MM/DD" format
 * @returns {GmailMessage[]}
 */
function searchCemEmails(afterDate, beforeDate) {
  var query = getGmailQuery(afterDate, beforeDate);
  var limit = getConfigNumber('GMAIL_SEARCH_LIMIT', 500);
  var threads = GmailApp.search(query, 0, limit);
  var messages = [];

  for (var t = 0; t < threads.length; t++) {
    var msgs = threads[t].getMessages();
    for (var m = 0; m < msgs.length; m++) {
      messages.push(msgs[m]);
    }
  }

  return messages;
}

/**
 * Extract the first CSV attachment from a Gmail message.
 * @param {GmailMessage} message
 * @returns {Object|null} { fileName, csvText } or null if no CSV found
 */
function extractCsvAttachment(message) {
  var attachments = message.getAttachments();
  for (var a = 0; a < attachments.length; a++) {
    var att = attachments[a];
    var name = att.getName().toLowerCase();
    if (name.indexOf('.csv') !== -1) {
      return {
        fileName: att.getName(),
        csvText: att.getDataAsString()
      };
    }
  }
  return null;
}

/**
 * Extract time bucket name from email subject.
 * Subject format: "SMG Reporting: Daily Sales Channel Breakout by Time - {Bucket}"
 * @param {string} subject
 * @returns {string|null} e.g., "Breakfast", "Lunch", etc.
 */
function extractBucketFromSubject(subject) {
  var match = subject.match(/Daily Sales Channel Breakout by Time\s*-\s*(.+)/i);
  if (match) {
    return match[1].trim();
  }
  return null;
}
