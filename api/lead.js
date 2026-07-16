const ALLOWED_ORIGINS = ['https://clinazo.com', 'https://www.clinazo.com'];

// All credentials live in Vercel environment variables — never in source.
// Required env vars:
//   EMAILJS_PUBLIC_KEY   — from EmailJS dashboard → Account → General
//   EMAILJS_PRIVATE_KEY  — from EmailJS dashboard → Account → API Keys (private key)
//   EMAILJS_SERVICE_ID   — EmailJS service identifier
//   EMAILJS_TEMPLATE_ID  — EmailJS template identifier
//   SHEETS_URL           — Google Apps Script web app execution URL
const EMAILJS_PUBLIC_KEY  = process.env.EMAILJS_PUBLIC_KEY;
const EMAILJS_PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY;
const EMAILJS_SERVICE_ID  = process.env.EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID;
const SHEETS_URL          = process.env.SHEETS_URL;

const EXPECTED_FIELDS = [
  'client_name', 'clinic_name', 'client_whatsapp', 'client_city', 'client_email',
  'plan_name', 'setup_fee', 'monthly_fee', 'appointments', 'specialty',
  'session_price', 'main_problem', 'booking_method', 'whatsapp_messages',
  'runs_ads', 'receptionist_count'
];
const MAX_FIELD_LENGTH = 500;
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function sanitize(value) {
  return String(value ?? '').replace(CONTROL_CHAR_RE, '').slice(0, MAX_FIELD_LENGTH);
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ct = req.headers['content-type'] || '';
  if (!ct.includes('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json' });
  }

  const body = req.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  // Server-side mirror of the client's validateContactField checks.
  // These fields are never seen by /api/chat, so this is the only server
  // validation they receive.
  const name      = sanitize(body.client_name);
  const clinic    = sanitize(body.clinic_name);
  const whatsapp  = sanitize(body.client_whatsapp);
  const city      = sanitize(body.client_city);
  const email     = sanitize(body.client_email);

  if (!name || /^\d+$/.test(name.trim())) {
    return res.status(400).json({ error: 'Invalid name' });
  }
  if (clinic.trim().length < 2) {
    return res.status(400).json({ error: 'Invalid clinic name' });
  }
  if (whatsapp.replace(/\D/g, '').length < 8) {
    return res.status(400).json({ error: 'Invalid WhatsApp number' });
  }
  if (!city.trim() || /^\d+$/.test(city.trim())) {
    return res.status(400).json({ error: 'Invalid city' });
  }
  if (!email.includes('@') || email.trim().length < 5) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  // Build sanitized params from the allow-listed field set only.
  // Any extra keys the client sends are silently dropped.
  const params = {};
  for (const field of EXPECTED_FIELDS) {
    params[field] = sanitize(body[field]);
  }

  // Send email via EmailJS REST API (server-to-server — key never leaves server).
  if (EMAILJS_PUBLIC_KEY && EMAILJS_SERVICE_ID && EMAILJS_TEMPLATE_ID) {
    try {
      const emailPayload = {
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        user_id: EMAILJS_PUBLIC_KEY,
        template_params: params
      };
      if (EMAILJS_PRIVATE_KEY) {
        emailPayload.accessToken = EMAILJS_PRIVATE_KEY;
      }
      await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'origin': 'https://clinazo.com'
        },
        body: JSON.stringify(emailPayload)
      });
    } catch (_) {
      // Email failure is non-fatal — lead is still logged to Sheets.
    }
  }

  // Log to Google Sheets via Apps Script web app.
  if (SHEETS_URL) {
    try {
      await fetch(SHEETS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
    } catch (_) {
      // Sheets failure is non-fatal.
    }
  }

  return res.status(200).json({ ok: true });
}
