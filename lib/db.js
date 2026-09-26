const { sql } = require('@vercel/postgres');

// Create tables if they don't exist. Safe to run on every cold start.
async function initDb() {
  await sql`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      channel TEXT NOT NULL,
      contact TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      channel TEXT NOT NULL,
      contact TEXT NOT NULL,
      note TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `;
}

async function logMessage(channel, contact, role, content) {
  await sql`
    INSERT INTO messages (channel, contact, role, content)
    VALUES (${channel}, ${contact}, ${role}, ${content})
  `;
}

// Returns last N messages for this contact, oldest first,
// as [{role, content}, ...] ready for the AI's messages array.
async function getHistory(channel, contact, limit = 10) {
  const { rows } = await sql`
    SELECT role, content FROM messages
    WHERE channel = ${channel} AND contact = ${contact}
    ORDER BY id DESC
    LIMIT ${limit}
  `;
  return rows.reverse();
}

async function saveLead(channel, contact, note) {
  await sql`
    INSERT INTO leads (channel, contact, note)
    VALUES (${channel}, ${contact}, ${note})
  `;
}

module.exports = { initDb, logMessage, getHistory, saveLead };