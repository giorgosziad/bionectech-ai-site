// Bionectech AI Lab - chat backend for the three minds (Karam, Nicolle, Galen).
// Holds ANTHROPIC_API_KEY server-side; the public site calls /ask. Rate-limited.
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const app = express();
app.set('trust proxy', 1);                 // behind Render's proxy -> correct client IP
app.use(express.json({ limit: '16kb' }));
// Only these origins may call the API (your site). Add your domain once it's live.
const ALLOWED = [
  'https://bionectech.ai',
  'https://www.bionectech.ai',
  'https://bionectech-ai-site.onrender.com'
];
app.use(cors({
  origin: function (origin, cb) {
    if (!origin) return cb(null, true);                 // health checks / curl
    return cb(null, ALLOWED.indexOf(origin) !== -1);
  }
}));
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL   = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const MAX_TOKENS = parseInt(process.env.ASK_MAX_TOKENS || '400', 10);  // demo answers are short

// Per-IP abuse guard: N questions / 10 min / IP (env-tunable).
const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: parseInt(process.env.ASK_RATE_MAX || '10', 10),
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'rate_limited' }
});

// GLOBAL circuit breaker: hard ceiling on total demo calls per UTC day, across
// all IPs. Caps worst-case spend from a distributed flood or a viral moment.
// In-memory (single Render instance); resets on restart and at UTC midnight.
const MAX_DAILY = parseInt(process.env.ASK_MAX_DAILY || '1000', 10);
let _day = new Date().toISOString().slice(0, 10);
let _count = 0;
function underDailyCap() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== _day) { _day = today; _count = 0; }
  if (_count >= MAX_DAILY) return false;
  _count++;
  return true;
}

const PERSONAS = {
  KARAM: "You are Karam, the AI Engineer of the Bionectech AI Lab. You reason through hard technical and product problems step by step - design, architecture, code, trade-offs - cleanly and rigorously. You know clinical workflows, FHIR, and HIPAA, and keep clinical decision support a tool that informs rather than dictates. This is a public demo on the Bionectech marketing site: be helpful and brief (a few short paragraphs at most). Do not give medical advice.",
  NICOLLE: "You are Nicolle, the Researcher of the Bionectech AI Lab. You analyze and synthesize: weigh evidence, compare options, surface the pattern that matters, and land on a clear takeaway. You are fluent in the healthcare market and regulatory landscape. In this demo you cannot browse the live web, so reason from general knowledge and note when live data would be needed. Be helpful and brief. Do not give medical advice.",
  GALEN: "You are Galen, the Clinical Colleague of the Bionectech AI Lab. You carry deep clinical knowledge across inpatient and outpatient care, health systems in the US, Europe, and the Middle East, coding, and quality measures. Non-negotiable rule: you INFORM and EDUCATE and always point beyond yourself to the treating clinician and current guidelines. You NEVER diagnose a specific person, never prescribe, and never replace a clinician. If a user describes their own symptoms, gently decline to advise and direct them to their own clinician. Be helpful and brief."
};
app.get('/', (req, res) => res.json({ ok: true, service: 'bionectech-ai-chat', model: MODEL, keyConfigured: !!API_KEY }));
app.post('/ask', limiter, async (req, res) => {
  try {
    if (!API_KEY) return res.status(200).json({ error: 'ANTHROPIC_API_KEY not configured' });
    const q = (req.body && typeof req.body.question === 'string') ? req.body.question.trim() : '';
    const agent = (req.body && typeof req.body.agent === 'string') ? req.body.agent.toUpperCase() : '';
    const system = PERSONAS[agent];
    if (!q || !system) return res.status(400).json({ error: 'bad_request' });
    if (q.length > 600) return res.status(400).json({ error: 'too_long' });
    // Global daily ceiling (checked after validation so bad requests don't burn budget).
    if (!underDailyCap()) return res.status(200).json({ error: 'demo_busy', answer: 'The live demo is very busy right now. Please try again later, or enter the Lab to talk with the full team.' });
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL, max_tokens: MAX_TOKENS, system,
        messages: [{ role: 'user', content: q }]
      })
    });
    const data = await r.json();
    if (!r.ok) return res.status(200).json({ error: (data && data.error && data.error.message) || 'upstream_error' });
    const answer = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    return res.json({ answer: answer || "I do not have a response for that right now." });
  } catch (e) {
    return res.status(200).json({ error: 'server_error' });
  }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('bionectech-ai-chat listening on ' + PORT + ' | model ' + MODEL + ' | max_tokens ' + MAX_TOKENS + ' | daily cap ' + MAX_DAILY));
