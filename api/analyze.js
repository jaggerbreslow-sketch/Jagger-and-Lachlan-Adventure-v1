// api/analyze.js — Gemini filing analysis + URL text extraction + quick definitions (v2)
// POST { mode: "analyze", level, source: {type:"text"|"url"|"image", ...}, meta? }
// POST { mode: "define", term, context }

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const MAX_CHARS = 300000;
const UA = process.env.SEC_USER_AGENT || 'SEC Filing Analyzer admin@example.com';

/* ---------- Gemini ---------- */

async function callGemini(parts, maxTokens) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('GEMINI_API_KEY is not set in Vercel environment variables.');
  }
  const r = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': key // header auth — never the ?key= URL param
    },
    body: JSON.stringify({
      contents: [{ parts: parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: maxTokens || 8192,
        temperature: 0.4,
        thinkingConfig: { thinkingBudget: 0 } // thinking tokens eat the output budget
      }
    })
  });
  const data = await r.json();
  if (!r.ok) {
    const msg = (data.error && data.error.message) || ('Gemini responded with status ' + r.status);
    if (r.status === 429) throw new Error('The AI is at its usage limit right now. Wait a minute and try again.');
    throw new Error(msg);
  }
  const cand = data.candidates && data.candidates[0];
  if (!cand || !cand.content || !cand.content.parts) {
    if (cand && cand.finishReason === 'SAFETY') {
      throw new Error('The AI declined to analyze this document.');
    }
    throw new Error('The AI returned an empty response. Try again.');
  }
  return cand.content.parts.map(function (p) { return p.text || ''; }).join('');
}

// Tolerant JSON parser: strips code fences, trims to outermost braces,
// and walks back through closing braces to salvage truncated output.
function parseJsonLoose(s) {
  if (!s) throw new Error('Empty AI response');
  s = s.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(s); } catch (e) { /* continue */ }
  const start = s.indexOf('{');
  if (start === -1) throw new Error('No JSON found in AI response');
  let end = s.lastIndexOf('}');
  let attempts = 0;
  while (end > start && attempts < 60) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch (e) { /* continue */ }
    // try closing one dangling array level before giving up on this cut
    try { return JSON.parse(s.slice(start, end + 1) + ']}'); } catch (e) { /* continue */ }
    try { return JSON.parse(s.slice(start, end + 1) + '}'); } catch (e) { /* continue */ }
    end = s.lastIndexOf('}', end - 1);
    attempts++;
  }
  throw new Error('Could not parse the AI response as JSON');
}

/* ---------- Document fetching / text extraction ---------- */

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

async function fetchDocumentText(url) {
  let parsed;
  try { parsed = new URL(url); } catch (e) { throw new Error('That does not look like a valid link.'); }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only http(s) links are supported.');
  }
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) {
    throw new Error('Could not fetch that document (the site responded with status ' + r.status + ').');
  }
  const ctype = (r.headers.get('content-type') || '').toLowerCase();
  const isPdf = ctype.includes('pdf') || parsed.pathname.toLowerCase().endsWith('.pdf');
  if (isPdf) {
    const buf = Buffer.from(await r.arrayBuffer());
    // lib path import avoids pdf-parse's debug-mode startup quirk;
    // v1.10.100 engine pinned; the engine can fail its very first parse
    // in a fresh process ("bad XRef entry"), so retry once before giving up
    const pdfParse = require('pdf-parse/lib/pdf-parse.js');
    let out;
    try {
      out = await pdfParse(buf, { version: 'v1.10.100' });
    } catch (firstErr) {
      try {
        out = await pdfParse(buf, { version: 'v1.10.100' });
      } catch (secondErr) {
        throw new Error('Could not read that PDF from the link. Try downloading it and using the Upload tab instead.');
      }
    }
    return (out.text || '').trim();
  }
  const body = await r.text();
  if (ctype.includes('html') || /<html|<body|<div|<p[ >]/i.test(body)) {
    return htmlToText(body);
  }
  return body.trim();
}

/* ---------- Prompts ---------- */

const LEVEL_RULES = {
  easy: 'Reading level: EASY. Write for someone with ZERO financial knowledge. No jargon at all — if a financial concept is unavoidable, explain it with an everyday analogy (allowance, grocery store, piggy bank). Short sentences. Friendly tone.',
  medium: 'Reading level: MEDIUM. Write for someone with basic financial literacy. Common terms like revenue, profit margin, and dividend are fine, but briefly clarify anything specialized.',
  expert: 'Reading level: EXPERT. Write for a professional analyst. Use full financial and regulatory terminology, exact figures, YoY/QoQ comparisons, and segment-level detail. Be dense and precise.'
};

function analysisPrompt(level, meta) {
  const metaLine = meta && (meta.company || meta.form)
    ? 'Known context: company=' + (meta.company || '?') + ', ticker=' + (meta.ticker || '?') + ', form=' + (meta.form || '?') + ', filed=' + (meta.date || '?') + '. '
    : '';
  return 'You are an expert SEC filing analyst for a public website that makes filings understandable. ' +
    metaLine +
    'Analyze the SEC filing content provided and respond with ONLY valid JSON (no markdown, no preamble) matching exactly this schema:\n' +
    '{\n' +
    ' "company": "company name",\n' +
    ' "ticker": "ticker or empty string",\n' +
    ' "form": "filing type e.g. 10-K",\n' +
    ' "period": "the period or event the filing covers, short",\n' +
    ' "briefing": "summary paragraph, max 110 words",\n' +
    ' "metrics": [ { "label": "SHORT UPPERCASE LABEL", "value": "headline figure or fact", "direction": "up|down|flat", "note": "short comparison or context, uppercase" } ],\n' +
    ' "sections": [ { "tag": "THE BASICS|MONEY|GOOD NEWS|WATCH OUT|RISKS|WHAT\'S NEW", "tone": "positive|negative|neutral", "title": "short title", "body": "1-3 sentences" } ],\n' +
    ' "listSummary": [ "concise bullet point" ]\n' +
    '}\n' +
    'Rules: 3-6 metrics using the document\'s own numbers (direction "flat" with context note if no comparison exists; for non-financial filings use the key facts instead of finances). 3-6 sections, each tag from the allowed list, tone reflecting the content. listSummary: 6-10 bullets covering the whole filing concisely. ' +
    LEVEL_RULES[level] + '\n' +
    'If the content does not appear to be an SEC filing or financial document, still summarize it honestly with the same schema and say what it actually is in the briefing.';
}

function definePrompt(term, context) {
  return 'Explain the term below in 1-2 plain-English sentences for someone with zero financial knowledge. Use the surrounding sentence for context if helpful. Respond with ONLY valid JSON: {"definition": "..."}\n' +
    'Term: "' + term + '"\n' +
    (context ? 'Surrounding sentence: "' + context + '"' : '');
}

/* ---------- Handler ---------- */

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST.' });
  }
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  try {
    /* ----- Quick definitions ----- */
    if (body.mode === 'define') {
      const term = String(body.term || '').slice(0, 200);
      if (!term) return res.status(400).json({ error: 'No term provided.' });
      const context = String(body.context || '').slice(0, 500);
      const raw = await callGemini([{ text: definePrompt(term, context) }], 512);
      const parsed = parseJsonLoose(raw);
      return res.status(200).json({ definition: String(parsed.definition || '').trim() });
    }

    /* ----- Full analysis ----- */
    if (body.mode === 'analyze') {
      const level = ['easy', 'medium', 'expert'].indexOf(body.level) >= 0 ? body.level : 'easy';
      const source = body.source || {};
      const meta = body.meta || {};
      let parts;

      if (source.type === 'image') {
        const data = String(source.data || '');
        if (!data) return res.status(400).json({ error: 'No image data received.' });
        if (data.length > 5000000) {
          return res.status(400).json({ error: 'That image is too large. Please use an image under ~3 MB.' });
        }
        parts = [
          { inline_data: { mime_type: source.mimeType || 'image/png', data: data } },
          { text: analysisPrompt(level, meta) + '\nThe filing is provided as the attached image. Read it carefully, including small print.' }
        ];
      } else {
        let text = '';
        if (source.type === 'url') {
          text = await fetchDocumentText(String(source.url || ''));
        } else if (source.type === 'text') {
          text = String(source.text || '');
        } else {
          return res.status(400).json({ error: 'Unknown source type.' });
        }
        text = text.slice(0, MAX_CHARS);
        if (text.length < 200) {
          return res.status(400).json({ error: 'Could not extract enough readable text from that document.' });
        }
        parts = [{ text: analysisPrompt(level, meta) + '\n\nFILING CONTENT:\n' + text }];
      }

      const raw = await callGemini(parts, 8192);
      const result = parseJsonLoose(raw);
      result.level = level;
      return res.status(200).json(result);
    }

    return res.status(400).json({ error: 'Unknown mode. Use "analyze" or "define".' });
  } catch (err) {
    const msg = String((err && err.message) || 'Something went wrong.');
    return res.status(500).json({ error: msg });
  }
};
