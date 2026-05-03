var LOG_SHEET_NAME = 'Logs';
var DAILY_SHEET_NAME = 'Daily';
var TIMEZONE = 'Asia/Bangkok';
var MAX_CELL_CHARS = 50000;

var LOG_HEADERS = [
  'timestamp',
  'trace_id',
  'session_id',
  'student_id',
  'course_id',
  'nickname',
  'question',
  'answer',
  'response_time_ms',
  'kb_relevance',
  'confidence',
  'doc_id',
  'model',
  'escalated',
  'escalate_reason',
  'citation_parse_failed',
  'fallback_used',
  'primary_error',
  'feedback_type'
];

var DAILY_HEADERS = [
  'date',
  'total_rows',
  'chat_rows',
  'feedback_rows',
  'unique_sessions',
  'unique_students',
  'avg_response_time_ms',
  'avg_kb_relevance',
  'avg_confidence',
  'escalated_count',
  'citation_parse_failed_count',
  'low_kb_count',
  'report_wrong_count',
  'updated_at'
];

function doPost(e) {
  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(5000);

    var payload = parsePostPayload_(e);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = getOrCreateSheet_(ss, LOG_SHEET_NAME, LOG_HEADERS);
    var rowValues = buildLogRow_(payload);

    sheet.appendRow(rowValues);

    return jsonResponse_({
      ok: true,
      row: sheet.getLastRow()
    });
  } catch (error) {
    return jsonResponse_({
      ok: false,
      error: String(error && error.message ? error.message : error)
    });
  } finally {
    try {
      lock.releaseLock();
    } catch (releaseError) {
      // Lock may not have been acquired if waitLock failed.
    }
  }
}

function doGet() {
  return jsonResponse_({
    ok: true,
    service: 'LAS Foreman AI Tutor logging endpoint',
    time: new Date().toISOString()
  });
}

function dailyRollup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logsSheet = getOrCreateSheet_(ss, LOG_SHEET_NAME, LOG_HEADERS);
  var dailySheet = getOrCreateSheet_(ss, DAILY_SHEET_NAME, DAILY_HEADERS);
  var targetDate = formatBangkokDate_(new Date(Date.now() - 24 * 60 * 60 * 1000));
  var values = logsSheet.getDataRange().getValues();

  if (values.length < 2) {
    upsertDailyRow_(dailySheet, buildEmptyDailyRow_(targetDate));
    return;
  }

  var headerMap = buildHeaderMap_(values[0]);
  var stats = {
    date: targetDate,
    totalRows: 0,
    chatRows: 0,
    feedbackRows: 0,
    sessions: {},
    students: {},
    responseSum: 0,
    responseCount: 0,
    kbSum: 0,
    kbCount: 0,
    confidenceSum: 0,
    confidenceCount: 0,
    escalatedCount: 0,
    citationParseFailedCount: 0,
    lowKbCount: 0,
    reportWrongCount: 0
  };

  for (var i = 1; i < values.length; i += 1) {
    var row = values[i];
    var timestamp = getCell_(row, headerMap, 'timestamp');
    if (!timestamp || formatBangkokDate_(new Date(timestamp)) !== targetDate) {
      continue;
    }

    var sessionId = String(getCell_(row, headerMap, 'session_id') || '');
    var studentId = String(getCell_(row, headerMap, 'student_id') || '');
    var feedbackType = String(getCell_(row, headerMap, 'feedback_type') || '');
    var responseTime = toNumber_(getCell_(row, headerMap, 'response_time_ms'));
    var kbRelevance = toNumber_(getCell_(row, headerMap, 'kb_relevance'));
    var confidence = toNumber_(getCell_(row, headerMap, 'confidence'));

    stats.totalRows += 1;

    if (feedbackType) {
      stats.feedbackRows += 1;
    } else {
      stats.chatRows += 1;
    }

    if (sessionId) {
      stats.sessions[sessionId] = true;
    }

    if (studentId) {
      stats.students[studentId] = true;
    }

    if (responseTime !== null) {
      stats.responseSum += responseTime;
      stats.responseCount += 1;
    }

    if (kbRelevance !== null) {
      stats.kbSum += kbRelevance;
      stats.kbCount += 1;
      if (kbRelevance < 50) {
        stats.lowKbCount += 1;
      }
    }

    if (confidence !== null) {
      stats.confidenceSum += confidence;
      stats.confidenceCount += 1;
    }

    if (toBoolean_(getCell_(row, headerMap, 'escalated'))) {
      stats.escalatedCount += 1;
    }

    if (toBoolean_(getCell_(row, headerMap, 'citation_parse_failed'))) {
      stats.citationParseFailedCount += 1;
    }

    if (feedbackType === 'report_wrong') {
      stats.reportWrongCount += 1;
    }
  }

  upsertDailyRow_(dailySheet, buildDailyRow_(stats));
}

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  getOrCreateSheet_(ss, LOG_SHEET_NAME, LOG_HEADERS);
  getOrCreateSheet_(ss, DAILY_SHEET_NAME, DAILY_HEADERS);

  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i += 1) {
    if (triggers[i].getHandlerFunction() === 'dailyRollup') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger('dailyRollup')
    .timeBased()
    .atHour(1)
    .everyDays(1)
    .inTimezone(TIMEZONE)
    .create();

  return {
    ok: true,
    trigger: 'dailyRollup',
    hour: 1,
    timezone: TIMEZONE
  };
}

function parsePostPayload_(e) {
  if (!e) {
    return {};
  }

  var contents = e.postData && e.postData.contents ? e.postData.contents : '';
  if (contents) {
    try {
      return JSON.parse(contents);
    } catch (jsonError) {
      if (e.parameter && e.parameter.payload) {
        return JSON.parse(e.parameter.payload);
      }
      throw new Error('Invalid JSON payload');
    }
  }

  if (e.parameter && e.parameter.payload) {
    return JSON.parse(e.parameter.payload);
  }

  return e.parameter || {};
}

function buildLogRow_(payload) {
  var normalized = {
    timestamp: firstValue_(payload.timestamp, new Date().toISOString()),
    trace_id: firstValue_(payload.trace_id, payload.traceId, ''),
    session_id: firstValue_(payload.session_id, payload.sessionId, ''),
    student_id: firstValue_(payload.student_id, payload.studentId, ''),
    course_id: firstValue_(payload.course_id, payload.courseId, ''),
    nickname: firstValue_(payload.nickname, ''),
    question: firstValue_(payload.question, payload.message, ''),
    answer: firstValue_(payload.answer, ''),
    response_time_ms: firstValue_(payload.response_time_ms, payload.responseTimeMs, ''),
    kb_relevance: firstValue_(payload.kb_relevance, payload.kbRelevance, ''),
    confidence: firstValue_(payload.confidence, ''),
    doc_id: firstValue_(payload.doc_id, payload.docId, ''),
    model: firstValue_(payload.model, ''),
    escalated: valueOrBlank_(payload.escalated),
    escalate_reason: firstValue_(payload.escalate_reason, payload.escalateReason, ''),
    citation_parse_failed: valueOrBlank_(payload.citation_parse_failed),
    fallback_used: valueOrBlank_(payload.fallback_used),
    primary_error: firstValue_(payload.primary_error, payload.primaryError, ''),
    feedback_type: firstValue_(payload.feedback_type, payload.feedbackType, '')
  };

  return LOG_HEADERS.map(function(header) {
    return trimCell_(normalized[header]);
  });
}

function getOrCreateSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }

  ensureHeaders_(sheet, headers);
  return sheet;
}

function ensureHeaders_(sheet, headers) {
  var lastColumn = Math.max(sheet.getLastColumn(), headers.length);
  var firstRow = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  var isEmpty = firstRow.every(function(value) {
    return value === '';
  });

  if (isEmpty) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return;
  }

  for (var i = 0; i < headers.length; i += 1) {
    if (firstRow[i] !== headers[i]) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      return;
    }
  }
}

function jsonResponse_(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

function trimCell_(value) {
  if (value === null || value === undefined) {
    return '';
  }

  var text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (text.length <= MAX_CELL_CHARS) {
    return text;
  }

  var marker = '...[trimmed]';
  return text.slice(0, MAX_CELL_CHARS - marker.length) + marker;
}

function valueOrBlank_(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return value;
}

function firstValue_() {
  for (var i = 0; i < arguments.length; i += 1) {
    var value = arguments[i];
    if (value !== null && value !== undefined && value !== '') {
      return value;
    }
  }
  return '';
}

function buildHeaderMap_(headers) {
  var map = {};
  for (var i = 0; i < headers.length; i += 1) {
    map[String(headers[i])] = i;
  }
  return map;
}

function getCell_(row, headerMap, header) {
  var index = headerMap[header];
  return index === undefined ? '' : row[index];
}

function toNumber_(value) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }

  var numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function toBoolean_(value) {
  if (value === true) {
    return true;
  }

  var text = String(value).toLowerCase();
  return text === 'true' || text === '1' || text === 'yes';
}

function formatBangkokDate_(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return '';
  }
  return Utilities.formatDate(date, TIMEZONE, 'yyyy-MM-dd');
}

function buildEmptyDailyRow_(dateString) {
  return [
    dateString,
    0,
    0,
    0,
    0,
    0,
    '',
    '',
    '',
    0,
    0,
    0,
    0,
    new Date().toISOString()
  ];
}

function buildDailyRow_(stats) {
  return [
    stats.date,
    stats.totalRows,
    stats.chatRows,
    stats.feedbackRows,
    Object.keys(stats.sessions).length,
    Object.keys(stats.students).length,
    averageOrBlank_(stats.responseSum, stats.responseCount),
    averageOrBlank_(stats.kbSum, stats.kbCount),
    averageOrBlank_(stats.confidenceSum, stats.confidenceCount),
    stats.escalatedCount,
    stats.citationParseFailedCount,
    stats.lowKbCount,
    stats.reportWrongCount,
    new Date().toISOString()
  ];
}

function averageOrBlank_(sum, count) {
  return count > 0 ? Math.round((sum / count) * 100) / 100 : '';
}

function upsertDailyRow_(sheet, rowValues) {
  ensureHeaders_(sheet, DAILY_HEADERS);

  var targetDate = rowValues[0];
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var dates = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < dates.length; i += 1) {
      if (String(dates[i][0]) === String(targetDate)) {
        sheet.getRange(i + 2, 1, 1, DAILY_HEADERS.length).setValues([rowValues]);
        return;
      }
    }
  }

  sheet.appendRow(rowValues);
}
