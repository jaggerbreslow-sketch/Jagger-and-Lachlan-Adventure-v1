// /api/analyze.js
// The heart of the app. It accepts ONE of:
//   { text }            -> already-extracted text (PDF text pulled out in the browser)
//   { url }             -> a filing URL; the server fetches it and extracts the text
//   { imageBase64, mimeType } -> an image (e.g. a PNG screenshot of a filing)
// plus { level, mode }. It then calls Gemini with your hidden API key and
// returns clean JSON for the frontend to render.

const pdfParse = require("pdf-parse/lib/pdf-parse.js");

// ---- Settings you might tweak ----
// Swap this for "gemini-2.5-pro" if you want higher quality at a higher price.
// If you ever get a "model not found" error, check the current model names at
// https://ai.google.dev/gemini-api/docs/models and update this string.
const GEMINI_MODEL = "gemini-2.5-flash";
// Cap how much text we send, to keep cost predictable. ~300k characters is a
// lot of a filing. Raise it if you want to feed more (costs more per run).
const MAX_TEXT_CHARS = 300000;
const UA = process.env.SEC_USER_AGENT || "SEC Filing Analyzer admin@example.com";
// ----------------------------------

function buildPrompt(level, mode) {
  const levels = {
    easy:
      "Explain everything as if the reader has ZERO knowledge of finance or investing. Use simple everyday analogies and avoid ALL financial jargon. If a technical term is unavoidable, explain it in plain words right away. Write conversationally, like explaining to a curious friend.",
    medium:
      "Write for someone with basic financial literacy. Use standard financial terms but briefly explain the more complex ones. Be clear and informative without oversimplifying.",
    expert:
      "Write for a sophisticated financial professional such as an investment banker or institutional investor. Use full financial and legal terminology without explanation. Include all relevant metrics, ratios, and technical nuances.",
  };
  const modeInstr =
    mode === "presentation"
      ? 'For each section write "content" as a narrative paragraph (a single string).'
      : 'For each section write "content" as a JSON array of concise bullet-point strings.';

  return (
    "You are analyzing a U.S. SEC filing. " +
    (levels[level] || levels.medium) +
    "\n\n" +
    modeInstr +
    "\n\nReturn ONLY valid JSON (no markdown, no backticks, no preamble) in exactly this shape:\n" +
    '{"company":"Company name","ticker":"Ticker or N/A","filingType":"e.g. S-1","filingDate":"Filing date or period",' +
    '"summary":"2-3 sentence executive overview",' +
    '"keyMetrics":[{"label":"Metric name","value":"Value","context":"Brief note"}],' +
    '"sections":[{"title":"Section title","content":"...","tag":"overview|financial|risk|growth|management|legal"}],' +
    '"highlights":["Key positive 1","Key positive 2","Key positive 3"],' +
    '"risks":["Risk 1","Risk 2","Risk 3"],' +
    '"verdict":"One punchy sentence with the overall take"}'
  );
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Fetch a filing URL on the server and pull out its text.
async function fetchAndExtract(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error("Could not fetch the filing (status " + res.status + ")");
  const contentType = (res.headers.get("content-type") || "").toLowerCase();

  if (contentType.includes("pdf") || url.toLowerCase().endsWith(".pdf")) {
    const buf = Buffer.from(await res.arrayBuffer());
    const data = await pdfParse(buf);
    return data.text || "";
  }
  // Otherwise treat it as HTML/text (most EDGAR primary documents are HTML).
  const html = await res.text();
  return stripHtml(html);
}

// Read JSON body whether or not the platform pre-parsed it.
async function getJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error("Invalid request body."));
      }
    });
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error:
        "The server is missing GEMINI_API_KEY. Add it under Settings > Environment Variables in your Vercel project, then redeploy.",
    });
    return;
  }

  try {
    const body = await getJsonBody(req);
    const { text, url, imageBase64, mimeType, level = "medium", mode = "presentation" } = body;
    const prompt = buildPrompt(level, mode);

    let parts;

    if (imageBase64) {
      // Image path (e.g. PNG screenshot): send the image straight to Gemini.
      parts = [
        { inline_data: { mime_type: mimeType || "image/png", data: imageBase64 } },
        { text: prompt },
      ];
    } else {
      // Text path: either text was sent directly, or we fetch+extract from a URL.
      let docText = text;
      if (url) docText = await fetchAndExtract(url);
      if (!docText || !docText.trim()) {
        throw new Error(
          "No readable text was found in the filing. If it is a scanned image PDF, try uploading a clearer copy."
        );
      }
      if (docText.length > MAX_TEXT_CHARS) docText = docText.slice(0, MAX_TEXT_CHARS);
      parts = [{ text: "FILING DOCUMENT CONTENT:\n" + docText + "\n\n" + prompt }];
    }

    const gRes = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" +
        GEMINI_MODEL +
        ":generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Pass the key as a header (works with both old AIza... and new AQ... keys)
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
        }),
      }
    );

    if (!gRes.ok) {
      const e = await gRes.json().catch(() => ({}));
      throw new Error((e.error && e.error.message) || "Gemini error " + gRes.status);
    }

    const data = await gRes.json();
    const out =
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text;

    if (!out) throw new Error("Gemini returned no content. Try again.");

    const clean = out.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      throw new Error("Could not parse the analysis output. Please try again.");
    }

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message || "Analysis failed." });
  }
};
