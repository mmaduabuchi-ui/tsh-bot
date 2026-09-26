# Tech Services Hub bot - setup guide

## 1. Get this onto your server
Upload this whole `tsh-bot` folder to your Oracle Cloud VM (e.g. via `scp -r`),
or `git clone` it if you push it to a repo first.

## 2. Install dependencies
```bash
cd tsh-bot
npm install
```

## 3. Fill in your real keys
```bash
cp .env.example .env
nano .env
```
You need:
- **WHATSAPP_TOKEN** and **WHATSAPP_PHONE_ID** - from your Meta Developer app
  (WhatsApp > API Setup page)
- **WHATSAPP_VERIFY_TOKEN** - make up any random string yourself, you'll enter
  the same string in Meta's webhook config
- **GROQ_API_KEY** - free, from console.groq.com

## 4. Get HTTPS working (Meta requires it)
```bash
sudo certbot --nginx -d yourdomain.com
```
Point your Nginx config to proxy port 80/443 to `localhost:3000` (where this app runs).

## 5. Start the bot (and keep it running forever)
```bash
pm2 start server.js --name tsh-bot
pm2 save
pm2 startup   # follow the printed instructions once, so it survives a server reboot
```

## 6. Connect Meta's webhook to your server
In your Meta Developer app > WhatsApp > Configuration:
- Callback URL: `https://yourdomain.com/webhook`
- Verify token: the same string you put in WHATSAPP_VERIFY_TOKEN
- Subscribe to the `messages` field

## 7. Test it
Message your WhatsApp test number from your phone. Watch the logs:
```bash
pm2 logs tsh-bot
```

## 8. Add the website widget
Copy the contents of `public/widget.html` into your website, just before `</body>`.
Update `BOT_URL` inside it to `https://yourdomain.com/widget-chat`.

## Editing the bot's knowledge
Everything the bot knows is in `data/knowledge-base.md`. Edit that file any time -
no code changes or restart needed for content changes... actually, `nano data/knowledge-base.md`
then `pm2 restart tsh-bot` to pick up changes (it's read fresh on the next message either way,
so a restart is only needed if you want to force-clear anything cached).

## Checking captured leads
```bash
sqlite3 data/bot.db "SELECT * FROM leads ORDER BY id DESC;"
```
(Install sqlite3 CLI with `sudo apt install sqlite3` if it's not already there.)
