require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { generateReply } = require('./lib/ai');
const { sendWhatsAppMessage } = require('./lib/whatsapp');
const {
  initDb, logMessage, getHistory, saveLead,
  getMode, setMode, listConversations, getMessages, markRead, getLastUserAt,
} = require('./lib/db');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Ensure tables exist. Runs on cold start; safe because of IF NOT EXISTS.
initDb().catch((err) => console.error('initDb failed:', err));

// ---------- WhatsApp webhook verification (Meta calls this once, on setup) ----------
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('Webhook verified.');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ---------- WhatsApp incoming messages ----------
app.post('/webhook', async (req, res) => {
  // Reply immediately so Meta doesn't retry/duplicate while the AI is thinking.
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];
    if (!message || message.type !== 'text') return;

    const from = message.from;
    const text = message.text.body;

    await handleIncoming({ channel: 'whatsapp', contact: from, text });
  } catch (err) {
    console.error('Webhook error:', err.response?.data || err.message);
  }
});

// ---------- Website widget chat ----------
app.post('/widget-chat', async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId || !message) {
      return res.status(400).json({ error: 'sessionId and message are required' });
    }
    const reply = await handleIncoming({ channel: 'website', contact: sessionId, text: message });
    res.json({ reply });
  } catch (err) {
    console.error('Widget chat error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------- Shared logic for both channels ----------
async function handleIncoming({ channel, contact, text }) {
  await logMessage(channel, contact, 'user', text);

  // NEW: if you've taken over this customer, save their message and stay quiet.
  const mode = await getMode(channel, contact);
  if (mode === 'human') {
    return channel === 'website'
      ? 'Thanks! A team member will reply to you shortly.'
      : null;
  }

  const history = await getHistory(channel, contact, 10);
  const { reply, lead } = await generateReply(history, text);

  await logMessage(channel, contact, 'assistant', reply);

  if (lead) {
    await saveLead(channel, contact, lead);
    console.log(`New lead [${channel}] ${contact}: ${lead}`);
    if (process.env.OWNER_WHATSAPP_NUMBER) {
      sendWhatsAppMessage(
        process.env.OWNER_WHATSAPP_NUMBER,
        `New lead (${channel}) from ${contact}: ${lead}`
      ).catch((e) => console.error('Owner notify failed:', e.response?.data || e.message));
    }
  }

  if (channel === 'whatsapp') {
    await sendWhatsAppMessage(contact, reply);
  }

  return reply;
}

// =====================================================================
//  ADMIN INBOX  (page: /admin   api: /admin/api/*)
//  Protected by ADMIN_PASSWORD (set it in your environment variables).
// =====================================================================
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

function adminAuth(req, res, next) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return res.status(503).json({ error: 'ADMIN_PASSWORD is not set on the server.' });
  const given = req.get('x-admin-key') || '';
  if (!crypto.timingSafeEqual(sha(given), sha(expected))) {
    return res.status(401).json({ error: 'Wrong password.' });
  }
  next();
}

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    console.error('Admin API error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
};

app.get('/admin/api/conversations', adminAuth, wrap(async (req, res) => {
  res.json(await listConversations());
}));

app.get('/admin/api/messages', adminAuth, wrap(async (req, res) => {
  const { channel, contact } = req.query;
  if (!channel || !contact) return res.status(400).json({ error: 'channel and contact required' });
  const after = Number(req.query.after) || 0;
  const [messages, mode, lastUserAt] = await Promise.all([
    getMessages(channel, contact, after),
    getMode(channel, contact),
    getLastUserAt(channel, contact),
  ]);
  await markRead(channel, contact);
  res.json({ messages, mode, lastUserAt });
}));

app.post('/admin/api/mode', adminAuth, wrap(async (req, res) => {
  const { channel, contact, mode } = req.body;
  if (!channel || !contact || !['ai', 'human'].includes(mode)) {
    return res.status(400).json({ error: 'channel, contact and mode (ai|human) required' });
  }
  await setMode(channel, contact, mode);
  res.json({ ok: true, mode });
}));

app.post('/admin/api/send', adminAuth, wrap(async (req, res) => {
  const { channel, contact } = req.body;
  const text = (req.body.text || '').trim();
  if (!channel || !contact || !text) {
    return res.status(400).json({ error: 'channel, contact and text required' });
  }
  if (channel !== 'whatsapp') {
    return res.status(400).json({ error: 'Replies from the dashboard work for WhatsApp chats only.' });
  }

  // WhatsApp only allows free-form replies within 24h of the customer's last message.
  const lastUserAt = await getLastUserAt(channel, contact);
  if (!lastUserAt || Date.now() - lastUserAt.getTime() > 24 * 60 * 60 * 1000) {
    return res.status(400).json({
      error: 'More than 24 hours since this customer last wrote. WhatsApp requires an approved template message to restart the chat.',
    });
  }

  await sendWhatsAppMessage(contact, text);
  await logMessage(channel, contact, 'human', text);
  await setMode(channel, contact, 'human'); // replying yourself pauses the AI for this customer
  await markRead(channel, contact);
  res.json({ ok: true });
}));

// ---------- Serverless-friendly export + local listen ----------
module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`tsh-bot listening on port ${PORT}`));
}