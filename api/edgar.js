// /api/edgar.js
// Resolves a stock ticker -> SEC CIK -> list of filings.
// Runs on the server, so there is no CORS problem and we can send the
// User-Agent header that SEC EDGAR requires.

// SEC asks that automated requests identify themselves with a contact.
// Set SEC_USER_AGENT in your Vercel environment variables to your own
// "Name email@example.com". The fallback below works but please replace it.
const UA = process.env.SEC_USER_AGENT || "SEC Filing Analyzer admin@example.com";

// Cache the big ticker->CIK file in memory so we do not re-download it every call.
let tickerCache = null;
let tickerCacheTime = 0;
const ONE_DAY = 24 * 60 * 60 * 1000;

module.exports = async (req, res) => {
  try {
    const ticker = String((req.query && req.query.ticker) || "").trim().toUpperCase();
    if (!ticker) {
      res.status(400).json({ error: "Please provide a ticker, e.g. /api/edgar?ticker=RDDT" });
      return;
    }

    // Step 1: ticker -> CIK using SEC's master ticker file
    if (!tickerCache || Date.now() - tickerCacheTime > ONE_DAY) {
      const r = await fetch("https://www.sec.gov/files/company_tickers.json", {
        headers: { "User-Agent": UA },
      });
      if (!r.ok) throw new Error("Could not reach SEC EDGAR (status " + r.status + ")");
      tickerCache = await r.json();
      tickerCacheTime = Date.now();
    }

    const match = Object.values(tickerCache).find(
      (c) => String(c.ticker).toUpperCase() === ticker
    );
    if (!match) {
      res.status(404).json({
        error: 'Ticker "' + ticker + '" was not found in EDGAR. It may be private, delisted, or use a different symbol.',
      });
      return;
    }

    const cik = String(match.cik_str);
    const cikPadded = cik.padStart(10, "0");

    // Step 2: CIK -> filings list
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
        // Direct URL to the primary document of this filing
        url: "https://www.sec.gov/Archives/edgar/data/" + cik + "/" + accPlain + "/" + doc,
      });
    }

    res.status(200).json({
      company: sub.name || match.title,
      cik,
      filings,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "EDGAR lookup failed." });
  }
};
