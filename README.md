# SEC Filing Analyzer — Setup & Deploy Guide

A website where you drop in an SEC filing (upload a file, paste a link, or search a ticker) and get a clean, AI-written summary — in **Presentation** or **List** mode, at **Easy / Medium / Expert** reading levels. Powered by Google Gemini.

This guide assumes **zero coding experience**. No command line needed.

---

## What's in this folder

```
sec-filing-analyzer/
├── api/
│   ├── analyze.js     ← reads the filing's text and asks Gemini to summarize it
│   └── edgar.js       ← turns a ticker into a list of SEC filings
├── public/
│   └── index.html     ← the website itself (what people see)
├── package.json       ← lists the one helper library (auto-installed)
├── vercel.json        ← gives the functions enough time/memory for big filings
└── README.md          ← this file
```

You don't need to edit any code to get started. You only set one secret value (your Gemini key).

---

## Step 1 — Get a free Gemini API key (2 minutes)

1. Go to **https://aistudio.google.com/app/apikey**
2. Sign in with a Google account.
3. Click **Create API key**.
4. Copy the key (it starts with `AIza...`). Keep it somewhere safe for Step 4.

> The free tier is generous. Even with regular use you'll likely pay little or nothing. See "Costs" at the bottom.

---

## Step 2 — Put the project on GitHub (5 minutes, no terminal)

GitHub is just free online storage for the project that Vercel can read from.

1. Make a free account at **https://github.com/signup**
2. Go to **https://github.com/new** to create a new repository.
   - **Repository name:** `sec-filing-analyzer`
   - Set it to **Public** (or Private — both work).
   - Click **Create repository**.
3. On the next page, click the link **"uploading an existing file"** (in the line "Get started by ... uploading an existing file").
4. **Drag the entire contents of this folder** into the upload box — the `api` folder, the `public` folder, `package.json`, `vercel.json`, and `README.md`. The web uploader keeps the folder structure.
5. Scroll down and click **Commit changes**.

> Tip: drag the *contents*, not the outer `sec-filing-analyzer` folder itself, so that `package.json` sits at the top level of the repo.

---

## Step 3 — Deploy on Vercel (3 minutes)

1. Make a free account at **https://vercel.com/signup** — choose **Continue with GitHub** so they're linked.
2. Click **Add New… → Project**.
3. Find `sec-filing-analyzer` in the list and click **Import**.
4. Leave all the build settings at their defaults (Vercel detects everything automatically — there's nothing to configure).
5. **Don't click Deploy yet** — first do Step 4 to add your key.

---

## Step 4 — Add your secret key (the important part)

Still on the import screen (or later under **Project → Settings → Environment Variables**):

1. Expand the **Environment Variables** section.
2. Add this one:
   - **Name:** `GEMINI_API_KEY`
   - **Value:** paste the `AIza...` key from Step 1
3. (Recommended) Add a second one so SEC knows who's calling their service:
   - **Name:** `SEC_USER_AGENT`
   - **Value:** `Your Name your-email@example.com` (use your real email)
4. Click **Deploy**.

Wait about a minute. When it finishes, Vercel gives you a live URL like `https://sec-filing-analyzer-xxxx.vercel.app`. **That's your website.** Open it and try a ticker like `RDDT` or paste a filing link.

> Your Gemini key lives only on Vercel's servers. It is never sent to the browser, so visitors can't see or steal it.

---

## Step 5 (optional) — Use your own domain

1. Buy a domain (~$10/year) at **Namecheap**, **Porkbun**, or similar.
2. In Vercel: **Project → Settings → Domains → Add**, type your domain.
3. Vercel shows you two small DNS settings to copy into your domain registrar's dashboard. Paste them in.
4. Give it a few minutes — your site is now at `yourdomain.com`.

---

## How the three input modes work

- **Upload** — Drop a PDF or PNG. For PDFs, the text is pulled out **right in your browser**, so even very large filings (your 86MB example included) work without hitting any upload limits. Only the extracted text is sent onward.
- **Link** — Paste a filing URL. The **server** fetches it and extracts the text (no browser security blocks, because it's server-side).
- **Search Ticker** — Type a ticker; the server asks SEC EDGAR for that company's filings and shows them in a list. Filter to **IPO / S-1**, **10-K**, etc., then click one to analyze.

---

## Things you might want to change later

All in `api/analyze.js`, near the top:

- **`GEMINI_MODEL`** — defaults to `gemini-2.5-flash` (cheap + fast). Change to `gemini-2.5-pro` for higher-quality analysis at higher cost. If you ever see a "model not found" error, the model names may have changed — check the current list at https://ai.google.dev/gemini-api/docs/models and update this line.
- **`MAX_TEXT_CHARS`** — how much of a filing gets sent to Gemini (default 300,000 characters). Raising it lets the AI see more of huge filings, but costs more per run.

After editing on GitHub (click any file → the pencil icon → make changes → Commit), Vercel automatically redeploys within a minute.

---

## Costs

- **Gemini Flash** is very cheap — most filings cost a fraction of a cent each. A few hundred analyses a month is typically a dollar or two.
- **Vercel Hobby** plan is free and is plenty for personal use and light traffic.
- The only guaranteed cost is a custom domain (~$10/year), and that's optional.

---

## Troubleshooting

- **"The server is missing GEMINI_API_KEY"** → You skipped Step 4, or added it after deploying. Add the variable, then **Deployments → … → Redeploy**.
- **"model not found" / 404 from Gemini** → Update `GEMINI_MODEL` in `api/analyze.js` to a current model name (see the link above).
- **Ticker search says not found** → That company may be private (e.g. SpaceX) or use a different symbol. Only companies that file with the SEC appear.
- **A scanned PDF gives a "no text found" error** → It's an image with no selectable text. This tool reads text, not pictures of text; a cleaner/native PDF will work.
- **Analysis is slow on a giant filing** → Large documents take longer to read and summarize. The functions are set to allow up to 60 seconds.

That's it — enjoy your analyzer!
