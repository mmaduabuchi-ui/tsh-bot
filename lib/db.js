const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'data', 'bot.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL,          -- 'whatsapp' or 'website'
    contact TEXT NOT NULL,          -- phone number or session id
    role TEXT NOT NULL,             -- 'user' or 'assistant'
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL,
    contact TEXT NOT NULL,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

function logMessage(channel, contact, role, content) {
  db.prepare(
    `INSERT INTO messages (channel, contact, role, content) VALUES (?, ?, ?, ?)`
  ).run(channel, contact, role, content);
}

// Returns the last N messages for this contact, oldest first, as
// [{role: 'user'|'assistant', content: '...'}, ...] ready for the AI's messages array.
function getHistory(channel, contact, limit = 10) {
  const rows = db.prepare(
    `SELECT role, content FROM messages
     WHERE channel = ? AND contact = ?
     ORDER BY id DESC LIMIT ?`
  ).all(channel, contact, limit);
  return rows.reverse();
}

function saveLead(channel, contact, note) {
  db.prepare(
    `INSERT INTO leads (channel, contact, note) VALUES (?, ?, ?)`
  ).run(channel, contact, note);
}

module.exports = { logMessage, getHistory, saveLead };
