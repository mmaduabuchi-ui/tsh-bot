const axios = require('axios');

async function sendWhatsAppMessage(to, text) {
  const version = process.env.GRAPH_API_VERSION || 'v20.0';
  const url = `https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_ID}/messages`;

  await axios.post(
    url,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

module.exports = { sendWhatsAppMessage };
