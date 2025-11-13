import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const PORT = process.env.PORT || 3000;

if (!CLAUDE_API_KEY) {
  console.error('MISSING CLAUDE_API_KEY in .env! Get one at https://console.anthropic.com/settings/keys');
  process.exit(1);
}

console.log('Claude API loaded - Key ready');

// Node 18+ provides global fetch. Ensure your local Node is >=18 (`node -v`).
// Simple Express server exposing 3 routes backed by free public APIs.

const app = express();

app.use(express.json());
// Allow cross-origin requests from local frontends
app.use(cors());

// Helper: parse JSONP-like responses (CarQuery returns JSONP)
function parseMaybeJSONP(text){
  text = text.trim();
  if(!text) return null;
  // If text already starts with { or [, parse directly
  if(text[0] === '{' || text[0] === '[') {
    return JSON.parse(text);
  }
  // Otherwise try to find the first '{' and last '}' and parse substring
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if(first !== -1 && last !== -1 && last > first){
    const sub = text.substring(first, last + 1);
    return JSON.parse(sub);
  }
  // As a fallback, try to extract first '[' ... ']'
  const fArr = text.indexOf('[');
  const lArr = text.lastIndexOf(']');
  if(fArr !== -1 && lArr !== -1 && lArr > fArr){
    const sub = text.substring(fArr, lArr + 1);
    return JSON.parse(sub);
  }
  throw new Error('Unable to parse JSON/JSONP response');
}

// Route 1: /vin/:vin -> decode a VIN via NHTSA VPIC
app.get('/vin/:vin', async (req, res) => {
  try {
    const { vin } = req.params;
    if(!vin || vin.length < 11){
      return res.status(400).json({ error: 'VIN appears too short' });
    }

    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvaluesextended/${encodeURIComponent(vin)}?format=json`;
    const r = await fetch(url);
    if(!r.ok) return res.status(502).json({ error: 'NHTSA API error', status: r.status });
    const data = await r.json();

    // Return the VPIC payload (Results array usually contains single object)
    return res.json({ source: 'NHTSA VPIC', vin: vin.toUpperCase(), data });
  } catch (err) {
    console.error('VIN decode error', err);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Route 2: /vehicle/:year/:make -> list trims from CarQuery
// CarQuery API (free) returns JSONP; we'll fetch it and parse safely
app.get('/vehicle/:year/:make', async (req, res) => {
  try {
    const year = Number(req.params.year) || null;
    const make = String(req.params.make || '').trim();
    if(!year || !make) return res.status(400).json({ error: 'Provide year and make' });

    // CarQuery endpoint
    const url = `https://www.carqueryapi.com/api/0.3/?cmd=getTrims&make=${encodeURIComponent(make)}&year=${encodeURIComponent(year)}`;
    const r = await fetch(url);
    if(!r.ok) return res.status(502).json({ error: 'CarQuery API error', status: r.status });
    const txt = await r.text();

    const parsed = parseMaybeJSONP(txt);

    // CarQuery returns an object with 'Trims' array
    const trims = parsed?.Trims || parsed?.trims || [];
    return res.json({ source: 'CarQuery', make, year, count: trims.length, trims });
  } catch (err) {
    console.error('CarQuery error', err);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Route 3: /parts/:make/:model -> return CarQuery trims for that model (sample real data)
// Note: CarAPI.app endpoints sometimes require keys. To avoid requiring keys, we use CarQuery here which is public.
app.get('/parts/:make/:model', async (req, res) => {
  try {
    const make = String(req.params.make || '').trim();
    const model = String(req.params.model || '').trim();
    if(!make || !model) return res.status(400).json({ error: 'Provide make and model' });

    // Use CarQuery to fetch trims for the make and filter by model name
    const url = `https://www.carqueryapi.com/api/0.3/?cmd=getTrims&make=${encodeURIComponent(make)}`;
    const r = await fetch(url);
    if(!r.ok) return res.status(502).json({ error: 'CarQuery API error', status: r.status });
    const txt = await r.text();
    const parsed = parseMaybeJSONP(txt);
    const trims = parsed?.Trims || [];

    // Filter trims by model name (case-insensitive contains)
    const matches = trims.filter(t => (t.model_name || '').toLowerCase().includes(model.toLowerCase()));

    // Return the matched trims as 'parts-like' data (real trims data can be used to map parts downstream)
    return res.json({ source: 'CarQuery (as parts/trim sample)', make, model, matchesCount: matches.length, matches });
  } catch (err) {
    console.error('Parts endpoint error', err);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Route 3.5: /search-parts -> For parts-test.html compatibility (mock for now)
app.post('/search-parts', async (req, res) => {
  // Mock response for testing
  const items = [
    {
      url: "https://autozone.com/part123",
      title: "Duralast Gold Front Brake Pads DG1243",
      source_domain: "AutoZone",
      estimated_price: "$54.99",
      snippet: "Confirmed Fit - In stock",
      part_number: "DG1243",
      confidence: 0.95
    },
    {
      url: "https://oreillyauto.com/part456",
      title: "ACDelco Professional Front Brake Pads 17D1234M",
      source_domain: "O'Reilly",
      estimated_price: "$49.99",
      snippet: "Confirmed Fit - In stock",
      part_number: "17D1234M",
      confidence: 0.9
    }
  ];
  return res.json({ items });
});

// Tavily + Claude route: /api/grok-parts (REAL search with live links)
app.post('/api/grok-parts', async (req, res) => {
  try {
    const { zipcode, vehicle, query, vin } = req.body;
    if (!zipcode || !vehicle || !query) return res.status(400).json({ error: 'Missing data' });

    const vinPart = vin ? ` VIN:${vin}` : '';
    const tavilyQuery = `${query} ${vehicle}${vinPart} near ${zipcode} (site:autozone.com OR site:advanceautoparts.com OR site:oreillyauto.com OR site:napaonline.com OR site:rockauto.com)`;

    // 1. Real search
    const tavily = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: tavilyQuery,
        search_depth: "advanced",
        max_results: 20
      })
    });

    if (!tavily.ok) throw new Error('Tavily failed');
    const results = await tavily.json();

    const snippets = results.results
      .map(r => `STORE: ${r.title}\nPART: ${r.content}\nPRICE: ${extractPrice(r.content)}\nURL: ${r.url}`)
      .join('\n\n');

    // 2. Claude formats perfectly
    const claude = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 4000,
        temperature: 0,
        system: `Take these LIVE search results and return ONLY valid JSON. CRITICAL: All HTML must be on ONE LINE with NO newlines inside the string.

{
  "resultsHtml": "<div class='grid cols-1 gap-8'>[6-8 cards all on this same line]</div>",
  "noteText": "7 parts found. Cheapest: $28.79 at RockAuto"
}

IMPORTANT: The entire resultsHtml value must be a single line with no \\n or \\r characters. Use single quotes in HTML. Use ONLY data from snippets below. NO hallucinations.

Card format (all one line): <div class='card parts-card' data-link='URL'><div class='row' style='align-items:center'><div style='flex:1'><b>Part Name</b><br><span class='tag success'>Confirmed Fit</span></div><div style='text-align:right'><b>$XX.XX</b><br><small>Store</small></div></div><div class='toolbar' style='margin-top:8px'><button class='btn small primary add-part'>Add to Job</button><a href='URL' target='_blank' class='btn small'>View</a></div></div>`,
        messages: [{ role: "user", content: snippets.slice(0, 12000) }]
      })
    });

    if (!claude.ok) throw new Error('Claude failed');
    const data = await claude.json();
    let json = data.content[0].text;
    json = json.replace(/```json/g, '').replace(/```/g, '').trim();
    res.json(JSON.parse(json));

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Search failed', details: err.message });
  }
});

function extractPrice(text) {
  const match = text.match(/\$([0-9]+\.?[0-9]*)/);
  return match ? '$' + match[1] : '??';
}

app.get('/', (req, res) => {
  res.json({ message: 'Claude Parts API LIVE. Test: POST /api/grok-parts with {zipcode:"90210",vehicle:"2014 BMW 335i",query:"brake pads"}' });
});

// Serve static files AFTER all API routes (so they don't intercept API calls)
// But exclude /api/* routes
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next(); // Skip static middleware for API routes
  }
  express.static('.')(req, res, next);
});

app.listen(PORT, () => {
  console.log(`Claude Parts API on http://localhost:${PORT} (Model: claude-3-5-haiku-20241022)`);
});
