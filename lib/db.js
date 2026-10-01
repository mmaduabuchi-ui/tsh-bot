const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

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
  // NEW: per-customer mode ('ai' or 'human') and how far you've read.
  await sql`
    CREATE TABLE IF NOT EXISTS conversations (
      channel TEXT NOT NULL,
      contact TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'ai',
      last_read_id INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (channel, contact)
    );
  `;
}

// role: 'user' (customer) | 'assistant' (AI) | 'human' (you, from the dashboard)
async function logMessage(channel, contact, role, content) {
  await sql`
    INSERT INTO messages (channel, contact, role, content)
    VALUES (${channel}, ${contact}, ${role}, ${content})
  `;
}

// The AI sees your manual replies as its own earlier replies.
async function getHistory(channel, contact, limit = 10) {
  const rows = await sql`
    SELECT role, content FROM messages
    WHERE channel = ${channel} AND contact = ${contact}
    ORDER BY id DESC
    LIMIT ${limit}
  `;
  return rows.reverse().map((r) => ({
    role: r.role === 'human' ? 'assistant' : r.role,
    content: r.content,
  }));
}

async function saveLead(channel, contact, note) {
  await sql`
    INSERT INTO leads (channel, contact, note)
    VALUES (${channel}, ${contact}, ${note})
  `;
}

// ---------- Admin inbox helpers ----------

async function getMode(channel, contact) {
  const rows = await sql`
    SELECT mode FROM conversations WHERE channel = ${channel} AND contact = ${contact}
  `;
  return rows[0]?.mode || 'ai';
}

async function setMode(channel, contact, mode) {
  await sql`
    INSERT INTO conversations (channel, contact, mode)
    VALUES (${channel}, ${contact}, ${mode})
    ON CONFLICT (channel, contact) DO UPDATE SET mode = EXCLUDED.mode
  `;
}

async function listConversations(limit = 100) {
  const rows = await sql`
    SELECT
      m.channel,
      m.contact,
      MAX(m.id) AS last_id,
      (SELECT content FROM messages x
         WHERE x.channel = m.channel AND x.contact = m.contact
         ORDER BY x.id DESC LIMIT 1) AS last_message,
      (SELECT role FROM messages x
         WHERE x.channel = m.channel AND x.contact = m.contact
         ORDER BY x.id DESC LIMIT 1) AS last_role,
      MAX(m.created_at AT TIME ZONE 'UTC') AS last_at,
      MAX(m.created_at AT TIME ZONE 'UTC') FILTER (WHERE m.role = 'user') AS last_user_at,
      COALESCE(c.mode, 'ai') AS mode,
      COUNT(*) FILTER (WHERE m.role = 'user' AND m.id > COALESCE(c.last_read_id, 0)) AS unread,
      EXISTS (SELECT 1 FROM leads l WHERE l.channel = m.channel AND l.contact = m.contact) AS is_lead
    FROM messages m
    LEFT JOIN conversations c ON c.channel = m.channel AND c.contact = m.contact
    GROUP BY m.channel, m.contact, c.mode, c.last_read_id
    ORDER BY last_id DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    ...r,
    last_id: Number(r.last_id),
    unread: Number(r.unread),
  }));
}

async function getMessages(channel, contact, afterId = 0) {
  return sql`
    SELECT id, role, content, (created_at AT TIME ZONE 'UTC') AS created_at
    FROM messages
    WHERE channel = ${channel} AND contact = ${contact} AND id > ${afterId}
    ORDER BY id ASC
    LIMIT 500
  `;
}

async function markRead(channel, contact) {
  await sql`
    INSERT INTO conversations (channel, contact, last_read_id)
    VALUES (${channel}, ${contact},
      COALESCE((SELECT MAX(id) FROM messages WHERE channel = ${channel} AND contact = ${contact}), 0))
    ON CONFLICT (channel, contact) DO UPDATE SET last_read_id = EXCLUDED.last_read_id
  `;
}

// When did the customer last write? Used for WhatsApp's 24-hour reply window.
async function getLastUserAt(channel, contact) {
  const rows = await sql`
    SELECT MAX(created_at AT TIME ZONE 'UTC') AS at
    FROM messages
    WHERE channel = ${channel} AND contact = ${contact} AND role = 'user'
  `;
  return rows[0]?.at ? new Date(rows[0].at) : null;
}

module.exports = {
  initDb,
  logMessage,
  getHistory,
  saveLead,
  getMode,
  setMode,
  listConversations,
  getMessages,
  markRead,
  getLastUserAt,
};