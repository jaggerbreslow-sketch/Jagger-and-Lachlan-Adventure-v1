// api/edgar.js — SEC EDGAR company search + filings lookup (v2)
// GET /api/edgar?q=apple        -> { matches: [{cik, ticker, name}, ...] }
// GET /api/edgar?cik=0000320193 -> { name, ticker, cik, total, filings: [...] }

const UA = process.env.SEC_USER_AGENT || 'SEC Filing Analyzer admin@example.com';

let tickerCache = null;
let tickerCacheTime = 0;

async function secFetch(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' }
  });
  if (!r.ok) {
    throw new Error('SEC EDGAR responded with status ' + r.status);
  }
  return r.json();
}

async function getTickers() {
  const now = Date.now();
  if (tickerCache && now - tickerCacheTime < 6 * 3600 * 1000) {
    return tickerCache;
  }
  const data = await secFetch('https://www.sec.gov/files/company_tickers.json');
  tickerCache = Object.values(data);
  tickerCacheTime = now;
  return tickerCache;
}

function padCik(cik) {
  return String(cik).replace(/\D/g, '').padStart(10, '0');
}

async function searchCompanies(q) {
  const list = await getTickers();
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const scored = [];
  for (const t of list) {
    const ticker = String(t.ticker || '').toLowerCase();
    const name = String(t.title || '').toLowerCase();
    let score = -1;
    if (ticker === needle) score = 100;
    else if (name === needle) score = 95;
    else if (name.startsWith(needle)) score = 80;
    else if (ticker.startsWith(needle)) score = 70;
    else if (name.includes(' ' + needle)) score = 50;
    else if (name.includes(needle)) score = 40;
    if (score >= 0) {
      scored.push({
        score: score,
        cik: padCik(t.cik_str),
        ticker: t.ticker,
        name: t.title
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 8).map(function (m) {
    return { cik: m.cik, ticker: m.ticker, name: m.name };
  });
}

async function getFilings(cikRaw) {
  const cik10 = padCik(cikRaw);
  const data = await secFetch('https://data.sec.gov/submissions/CIK' + cik10 + '.json');
  const recent = (data.filings && data.filings.recent) || {};
  const forms = recent.form || [];
  const dates = recent.filingDate || [];
  const accessions = recent.accessionNumber || [];
  const docs = recent.primaryDocument || [];
  const descs = recent.primaryDocDescription || [];
  const cikNum = String(parseInt(cik10, 10));

  const filings = [];
  for (let i = 0; i < forms.length && filings.length < 150; i++) {
    const acc = String(accessions[i] || '').replace(/-/g, '');
    const doc = docs[i] || '';
    filings.push({
      form: forms[i] || '',
      date: dates[i] || '',
      description: descs[i] || '',
      url: doc && acc
        ? 'https://www.sec.gov/Archives/edgar/data/' + cikNum + '/' + acc + '/' + doc
        : ''
    });
  }

  return {
    name: data.name || '',
    ticker: (Array.isArray(data.tickers) && data.tickers[0]) || '',
    cik: cik10,
    total: forms.length,
    filings: filings
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
  try {
    const q = req.query.q;
    const cik = req.query.cik;

    if (cik) {
      const result = await getFilings(cik);
      return res.status(200).json(result);
    }
    if (q) {
      const matches = await searchCompanies(String(q));
      return res.status(200).json({ matches: matches });
    }
    return res.status(400).json({
      error: 'Provide ?q=company-or-ticker to search, or ?cik=########## for filings.'
    });
  } catch (err) {
    return res.status(502).json({
      error: 'Could not reach SEC EDGAR right now. Please try again in a moment.',
      detail: String(err && err.message)
    });
  }
};
