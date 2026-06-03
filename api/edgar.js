// /api/edgar.js
// Two jobs, picked by query string:
//   ?search=apple        -> list of matching companies [{name, ticker, cik}]
//   ?ticker=AAPL  (or ?cik=320193) -> that company's filings [{form, date, url, ...}]
// Runs server-side, so no CORS issues and we can send SEC's required User-Agent.

const UA = process.env.SEC_USER_AGENT || "SEC Filing Analyzer admin@example.com";

// Cache the big ticker file in memory so we don't re-download it every call.
let tickerCache = null;
let tickerCacheTime = 0;
const ONE_DAY = 24 * 60 * 60 * 1000;

async function loadTickers() {
  if (!tickerCache || Date.now() - tickerCacheTime > ONE_DAY) {
    const r = await fetch("https://www.sec.gov/files/company_tickers.json", {
      headers: { "User-Agent": UA },
    });
    if (!r.ok) throw new Error("Could not reach SEC EDGAR (status " + r.status + ")");
    const json = await r.json();
    tickerCache = Object.values(json); // [{cik_str, ticker, title}, ...]
    tickerCacheTime = Date.now();
  }
  return tickerCache;
}

module.exports = async (req, res) => {
  try {
    const q = req.query || {};

    // ---- Mode 1: search by company name OR ticker ----
    if (q.search != null) {
      const term = String(q.search).trim();
      if (!term) {
        res.status(400).json({ error: "Type a company name or ticker." });
        return;
      }
      const all = await loadTickers();
      const lower = term.toLowerCase();
      const upper = term.toUpperCase();
      const scored = [];
      for (const c of all) {
        const ticker = String(c.ticker).toUpperCase();
        const name = String(c.title);
        const nameLower = name.toLowerCase();
        let score = -1;
        if (ticker === upper) score = 0; // exact ticker wins
        else if (nameLower === lower) score = 1; // exact name
        else if (ticker.startsWith(upper)) score = 2; // ticker starts with
        else if (nameLower.startsWith(lower)) score = 3; // name starts with
        else if (nameLower.includes(lower)) score = 4; // name contains
        else if (ticker.includes(upper)) score = 5; // ticker contains
        if (score >= 0) scored.push({ score, name, ticker: c.ticker, cik: String(c.cik_str) });
      }
      scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
      const matches = scored.slice(0, 12).map(({ name, ticker, cik }) => ({ name, ticker, cik }));
      res.status(200).json({ matches });
      return;
    }

    // ---- Mode 2: a company's filings (by cik or ticker) ----
    let cik = q.cik ? String(q.cik).replace(/\D/g, "") : null;
    if (!cik && q.ticker) {
      const all = await loadTickers();
      const t = String(q.ticker).toUpperCase();
      const m = all.find((c) => String(c.ticker).toUpperCase() === t);
      if (!m) {
        res.status(404).json({ error: 'Ticker "' + t + '" was not found in EDGAR.' });
        return;
      }
      cik = String(m.cik_str);
    }
    if (!cik) {
      res.status(400).json({ error: "Provide ?search=, ?ticker=, or ?cik=." });
      return;
    }

    const cikPadded = cik.padStart(10, "0");
    const r2 = await fetch("https://data.sec.gov/submissions/CIK" + cikPadded + ".json", {
      headers: { "User-Agent": UA },
    });
    if (!r2.ok) throw new Error("Could not load filings (status " + r2.status + ")");
    const sub = await r2.json();

    const recent = (sub.filings && sub.filings.recent) || {};
    const filings = [];
    const count = (recent.accessionNumber || []).length;
    for (let i = 0; i < count && i < 300; i++) {
      const accession = recent.accessionNumber[i];
      const doc = recent.primaryDocument[i] || "";
      const accPlain = accession.replace(/-/g, "");
      filings.push({
        accession,
        form: recent.form[i],
        date: recent.filingDate[i],
        doc,
        desc: recent.primaryDocDescription[i] || "",
        url: "https://www.sec.gov/Archives/edgar/data/" + cik + "/" + accPlain + "/" + doc,
      });
    }

    res.status(200).json({ company: sub.name, cik, filings });
  } catch (err) {
    res.status(500).json({ error: err.message || "EDGAR lookup failed." });
  }
};
