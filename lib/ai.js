const axios = require('axios');
const fs = require('fs');
const path = require('path');

const KB_PATH = path.join(__dirname, '..', 'data', 'knowledge-base.md');

function loadKnowledgeBase() {
  return fs.readFileSync(KB_PATH, 'utf-8');
}

function buildSystemPrompt() {
  const kb = loadKnowledgeBase();
  return `You are the WhatsApp/website assistant for Tech Services Hub.
Use ONLY the information below to answer. Keep replies short (2-4 sentences),
friendly, and direct - this is a chat conversation, not an essay.

If the customer gives their name, location, or clearly wants to move forward
with booking/buying, end your reply with a new line containing exactly:
[[LEAD: one-line summary of what they want]]
This tag is stripped before the customer sees it - it is only for our records.

--- BUSINESS KNOWLEDGE BASE ---
${kb}
--- END KNOWLEDGE BASE ---`;
}

// history: [{role: 'user'|'assistant', content: '...'}, ...]
// returns { reply: string, lead: string|null }
async function generateReply(history, userMessage) {
  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    ...history,
    { role: 'user', content: userMessage },
  ];

  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      messages,
      temperature: 0.4,
      max_tokens: 300,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );

  let text = response.data.choices[0].message.content.trim();

  let lead = null;
  const leadMatch = text.match(/\[\[LEAD:\s*(.+?)\]\]/i);
  if (leadMatch) {
    lead = leadMatch[1].trim();
    text = text.replace(/\[\[LEAD:.+?\]\]/i, '').trim();
  }

  return { reply: text, lead };
}

module.exports = { generateReply };
