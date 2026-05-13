/**
 * DAUGHTER QUIZ BACKEND
 * Sheet naming: Q_<class>_<subject>_<topic>
 *   e.g. Q_6_Math_Fractions, Q_7_Science_Living_Things
 * Config sheet: key-value pairs (col A = key, col B = value)
 * Columns in question sheets: Question | A | B | C | D | CorrectAnswer
 */

const DQ_SS_ID = "1rsCpxqaKIgtN2W5j4HniCbuQJhBWY2Dkw3ArYj_jeP8";
const DQ_PREFIX = "dq_session_";
const DQ_TTL    = 3 * 60 * 60; // 3 hours

// ── Entry points ──────────────────────────────────────────────────────────────

// GET — returns config + categories (no preflight, no CORS issue)
function doGet(e) {
  try {
    const ss     = SpreadsheetApp.openById(DQ_SS_ID);
    const config = readConfig_(ss);
    const cats   = getCategories_(ss);
    return json({ status: "ok", config: config, categories: cats });
  } catch (err) {
    return json({ status: "error", message: err.message || String(err) });
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json({ status: "error", message: "No request body" });
    }
    const data   = JSON.parse(e.postData.contents);
    const action = String(data.action || "").trim();
    const ss     = SpreadsheetApp.openById(DQ_SS_ID);

    if (action === "startQuiz")  return handleStartQuiz_(ss, data);
    if (action === "submitQuiz") return handleSubmitQuiz_(ss, data);

    return json({ status: "error", message: "Unknown action" });
  } catch (err) {
    return json({ status: "error", message: err.message || String(err) });
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

function readConfig_(ss) {
  const sheet = ss.getSheetByName("Config");
  if (!sheet) return defaultConfig_();

  const rows = sheet.getDataRange().getValues();
  const raw  = {};
  rows.forEach(function(row) {
    const key = String(row[0] || "").trim();
    if (key) raw[key] = row[1];
  });

  return {
    quizName:        String(raw["quiz_name"]   || "Quiz").trim(),
    status:          String(raw["status"]       || "CLOSED").trim().toUpperCase(),
    deadline:        raw["login_deadline"]      || null,
    showAnswers:     isYes_(raw["show_answers"]),
    showSummary:     isYes_(raw["show_summary"]),
    multipleAttempts:isYes_(raw["multiple_attempts"]),
    feedback:        isYes_(raw["feedback"]),
    correctMarks:    toNum_(raw["correct"],   4),
    incorrectMarks:  toNum_(raw["incorrect"], 0),
    shuffleQuestions:isYes_(raw["shuffle_questions"]),
    shuffleOptions:  isYes_(raw["shuffle_options"]),
    classPassword:   String(raw["classPassword"] || "").trim()
  };
}

function defaultConfig_() {
  return {
    quizName: "Quiz", status: "OPEN", deadline: null,
    showAnswers: true, showSummary: true, multipleAttempts: true,
    feedback: false, correctMarks: 4, incorrectMarks: 0,
    shuffleQuestions: true, shuffleOptions: true, classPassword: ""
  };
}

// ── Categories ────────────────────────────────────────────────────────────────

function getCategories_(ss) {
  const categories = {};
  ss.getSheets().forEach(function(sheet) {
    const parts = sheet.getName().split("_");
    if (parts[0] !== "Q" || parts.length < 4) return;

    const cls   = parts[1];
    const subj  = parts[2];
    const topic = parts.slice(3).join(" ");

    if (!categories[cls])        categories[cls]       = {};
    if (!categories[cls][subj])  categories[cls][subj] = [];
    if (categories[cls][subj].indexOf(topic) === -1) {
      categories[cls][subj].push(topic);
    }
  });
  return categories;
}

// ── Start Quiz ────────────────────────────────────────────────────────────────

function handleStartQuiz_(ss, data) {
  const config = readConfig_(ss);

  // Check quiz is open
  if (config.status !== "OPEN") return json({ status: "closed" });
  if (config.deadline) {
    const due = new Date(config.deadline).getTime();
    if (!isNaN(due) && Date.now() > due) return json({ status: "expired" });
  }

  // Password check (only if classPassword is set in Config)
  if (config.classPassword) {
    const submitted = String(data.password || "").trim();
    if (submitted !== config.classPassword) return json({ status: "wrongPassword" });
  }

  const cls   = String(data.className || "").trim();
  const subj  = String(data.subject   || "").trim();
  const topic = String(data.topic     || "").trim();
  const name  = String(data.name      || "").trim();
  const count = Math.max(1, Math.min(100, Number(data.count) || 10));

  if (!cls || !subj || !topic || !name) {
    return json({ status: "error", message: "Missing fields" });
  }

  const sheetName = "Q_" + cls + "_" + subj + "_" + topic.replace(/ /g, "_");
  const sheet     = ss.getSheetByName(sheetName);
  if (!sheet) return json({ status: "error", message: 'Sheet not found: "' + sheetName + '"' });

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return json({ status: "error", message: "No questions in sheet" });

  let rows = sheet.getRange(2, 1, lastRow - 1, 7).getValues()
    .filter(function(r) { return String(r[0] || "").trim() !== ""; });

  if (rows.length === 0) return json({ status: "error", message: "No valid questions" });

  // Shuffle questions
  if (config.shuffleQuestions) rows = shuffle_(rows);
  rows = rows.slice(0, Math.min(count, rows.length));

  const letters = ["A", "B", "C", "D"];
  const sessionAnswers = [];

  const questions = rows.map(function(row, i) {
    const correctLetter = String(row[5] || "").trim().toUpperCase();
    let options = [
      String(row[1] || "").trim(),
      String(row[2] || "").trim(),
      String(row[3] || "").trim(),
      String(row[4] || "").trim()
    ].filter(function(o) { return o !== ""; });

    if (config.shuffleOptions && options.length > 1) {
      const correctText = options[letters.indexOf(correctLetter)];
      options = shuffle_(options);
      // re-map correct answer letter after shuffle
      sessionAnswers.push(letters[options.indexOf(correctText)]);
    } else {
      sessionAnswers.push(correctLetter);
    }

    return {
      id: i,
      question: String(row[0] || "").trim(),
      options: options,
      time: toNum_(row[6], 30)   // seconds per question, default 30
    };
  });

  const token = Utilities.getUuid();
  CacheService.getScriptCache().put(
    DQ_PREFIX + token,
    JSON.stringify({
      name:          name,
      className:     cls,
      subject:       subj,
      topic:         topic,
      answers:       sessionAnswers,
      total:         rows.length,
      correctMarks:  config.correctMarks,
      incorrectMarks:config.incorrectMarks
    }),
    DQ_TTL
  );

  return json({ status: "ok", token: token, questions: questions, total: rows.length });
}

// ── Submit Quiz ───────────────────────────────────────────────────────────────

function handleSubmitQuiz_(ss, data) {
  const raw = CacheService.getScriptCache().get(DQ_PREFIX + String(data.token || ""));
  if (!raw) return json({ status: "expired" });

  const session   = JSON.parse(raw);
  const responses = data.responses || [];
  const letters   = ["A", "B", "C", "D"];

  let correct = 0, incorrect = 0, skipped = 0, marks = 0;

  const review = session.answers.map(function(correctLetter, i) {
    const sel      = (responses[i] !== undefined) ? Number(responses[i]) : -1;
    const attempted = sel >= 0 && sel <= 3;
    const isCorrect = attempted && letters[sel] === correctLetter;

    if (!attempted) {
      skipped++;
    } else if (isCorrect) {
      correct++;
      marks += session.correctMarks;
    } else {
      incorrect++;
      marks += session.incorrectMarks;
    }

    return {
      isCorrect:  attempted ? isCorrect : null,
      correctIdx: letters.indexOf(correctLetter)
    };
  });

  CacheService.getScriptCache().remove(DQ_PREFIX + data.token);

  const total      = session.answers.length;
  const maxMarks   = total * session.correctMarks;
  const percentage = maxMarks > 0 ? ((marks / maxMarks) * 100).toFixed(1) : "0.0";

  // Write to Responses sheet
  try {
    const respSheet = getOrCreateResponsesSheet_(ss);
    respSheet.appendRow([
      new Date(),
      session.name,
      "Class " + session.className,
      session.subject,
      session.topic,
      marks,
      maxMarks,
      total,
      correct,
      incorrect,
      skipped,
      percentage + "%",
      JSON.stringify(data.responses || [])
    ]);
  } catch (logErr) {
    // Don't fail the quiz if logging fails
    Logger.log("Responses write error: " + logErr.message);
  }

  return json({
    status:     "submitted",
    name:       session.name,
    correct:    correct,
    incorrect:  incorrect,
    skipped:    skipped,
    total:      total,
    marks:      marks,
    maxMarks:   maxMarks,
    percentage: percentage,
    review:     review
  });
}

// ── Responses sheet ───────────────────────────────────────────────────────────

function getOrCreateResponsesSheet_(ss) {
  let sheet = ss.getSheetByName("Responses");
  if (!sheet) {
    sheet = ss.insertSheet("Responses");
    sheet.appendRow([
      "Timestamp", "Name", "Class", "Subject", "Topic",
      "Marks", "MaxMarks", "TotalQuestions",
      "Correct", "Incorrect", "Skipped",
      "Percentage", "ResponsesJSON"
    ]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function shuffle_(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function isYes_(val) {
  return String(val || "").trim().toLowerCase() === "yes";
}

function toNum_(val, fallback) {
  const n = Number(val);
  return isNaN(n) ? fallback : n;
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
