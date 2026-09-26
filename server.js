require('dotenv').config();
const express = require('express');
const { generateReply } = require('./lib/ai');
const { sendWhatsAppMessage } = require('./lib/whatsapp');
const { logMessage, getHistory, saveLead } = require('./lib/db');

const app = express();
app.use(express.json());
app.use(express.static('public'));

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
    if (!message || message.type !== 'text') return; // ignore statuses, non-text, etc.

    const from = message.from; // customer's phone number
    const text = message.text.body;

    await handleIncoming({ channel: 'whatsapp', contact: from, text });
  } catch (err) {
    console.error('Webhook error:', err.response?.data || err.message);
  }
});

// ---------- Website widget chat ----------
// The widget sends { sessionId, message } and gets back { reply }
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
  logMessage(channel, contact, 'user', text);

  const history = getHistory(channel, contact, 10);
  const { reply, lead } = await generateReply(history, text);

  logMessage(channel, contact, 'assistant', reply);

  if (lead) {
    saveLead(channel, contact, lead);
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

  return reply; // used by the website widget response
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`tsh-bot listening on port ${PORT}`));
