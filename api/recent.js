// api/recent.js — EDGAR live feed + primary-document resolver + company profile (v2)
// GET /api/recent              -> { updated, entries: [{form, company, cik, acc, time}] }
// GET /api/recent?type=10-K    -> same, filtered to a form type by EDGAR
// GET /api/recent?resolve=CIK:ACC -> { url } primary document for a filing
// GET /api/recent?about=CIK    -> { name, industry, location, cik }

const UA = process.env.SEC_USER_AGENT || 'SEC Filing Analyzer admin@example.com';

async function secFetch(url, asText) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('SEC EDGAR responded with status ' + r.status);
  return asText ? r.text() : r.json();
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/* ---------- Live feed ---------- */
async function getFeed(type) {
  const url = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent' +
    '&type=' + encodeURIComponent(type || '') +
    '&company=&dateb=&owner=exclude&count=40&output=atom';
  const xml = await secFetch(url, true);
  const entries = [];
  const blocks = xml.split('<entry>').slice(1);
  for (const b of blocks) {
    const title = decodeEntities((b.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
    const href = (b.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '';
    const updated = (b.match(/<updated>([^<]+)<\/updated>/) || [])[1] || '';
    const term = (b.match(/<category[^>]*term="([^"]+)"/) || [])[1] || '';

    // title looks like: "10-Q - Company Name, Inc. (0001234567) (Filer)"
    const tm = title.match(/^(.*?) - (.*?) \((\d{10})\)/);
    const form = term || (tm ? tm[1] : '');
    const company = tm ? tm[2] : title;
    const cik = tm ? tm[3] : '';

    const pm = href.match(/\/Archives\/edgar\/data\/(\d+)\/(\d+)\//);
    if (!pm) continue;
    entries.push({
      form: form.trim(),
      company: company.trim(),
      cik: cik || pm[1],
      acc: pm[2],
      cikPath: pm[1],
      time: updated
    });
  }
  return { updated: new Date().toISOString(), entries: entries };
}

/* ---------- Primary document resolver ---------- */
async function resolvePrimary(spec) {
  const m = String(spec).match(/^(\d+):(\d+)$/);
  if (!m) throw new Error('Bad resolve format. Use CIK:ACCESSION digits.');
  const cik = m[1];
  const acc = m[2];
  const base = 'https://www.sec.gov/Archives/edgar/data/' + cik + '/' + acc + '/';
  const data = await secFetch(base + 'index.json');
  const items = (data.directory && data.directory.item) || [];

  function score(list) {
    let best = null;
    let bestSize = -1;
    for (const it of list) {
      const size = parseInt(it.size, 10) || 0;
      if (size > bestSize) { bestSize = size; best = it; }
    }
    return best;
  }

  const htms = items.filter(function (it) {
    const n = String(it.name || '').toLowerCase();
    return /\.htm$/.test(n) &&
      n.indexOf('-index') === -1 &&
      !/^r\d+\.htm$/.test(n) &&
      n.indexOf('filingsummary') === -1;
  });
  let pick = score(htms);
  if (!pick) {
    const txts = items.filter(function (it) {
      return /\.txt$/i.test(String(it.name || ''));
    });
    pick = score(txts);
  }
  if (!pick) throw new Error('Could not find a readable document in this filing.');
  return { url: base + pick.name };
}

/* ---------- Company profile ---------- */
async function aboutCompany(cikRaw) {
  const cik10 = String(cikRaw).replace(/\D/g, '').padStart(10, '0');
  const data = await secFetch('https://data.sec.gov/submissions/CIK' + cik10 + '.json');
  let location = '';
  if (data.addresses && data.addresses.business) {
    const a = data.addresses.business;
    location = [a.city, a.stateOrCountryDescription || a.stateOrCountry]
      .filter(Boolean).join(', ');
  }
  if (!location && data.stateOfIncorporationDescription) {
    location = data.stateOfIncorporationDescription;
  }
  return {
    name: data.name || '',
    industry: data.sicDescription || '',
    location: location,
    cik: cik10
  };
}

/* ---------- Handler ---------- */
module.exports = async function handler(req, res) {
  try {
    const q = req.query || {};
    if (q.resolve) {
      res.setHeader('Cache-Control', 's-maxage=86400');
      return res.status(200).json(await resolvePrimary(q.resolve));
    }
    if (q.about) {
      res.setHeader('Cache-Control', 's-maxage=86400');
      return res.status(200).json(await aboutCompany(q.about));
    }
    res.setHeader('Cache-Control', 's-maxage=30');
    return res.status(200).json(await getFeed(q.type));
  } catch (err) {
    return res.status(502).json({
      error: 'Could not reach SEC EDGAR right now. Please try again in a moment.',
      detail: String(err && err.message)
    });
  }
};
