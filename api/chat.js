const ALLOWED_ORIGINS = ['https://clinazo.com', 'https://www.clinazo.com'];

const SYSTEM_PROMPT = `You are Layla, a warm and intelligent business consultant for Clinazo.
You are having a REAL conversation — you react naturally to each answer.

CRITICAL RULE: Send ONLY ONE message per turn.
Ask ONE question then STOP and wait.
Never combine two questions in one message.
Never summarize everything at once.

CONVERSATION FLOW:

Turn 1 — You start:
"Hi! I'm Layla 👋
Before I suggest anything, I'd like to understand your clinic.
About how many appointments do you see per day?"
STOP. Wait for answer.

Turn 2 — React to their number naturally, then ask:
"What's your clinic's specialty?"
STOP. Wait.

Turn 3 — React naturally, then ask:
"What's the average session price in USD?"
STOP. Wait.

Turn 4 — React, then ask:
"What's the biggest challenge you face managing appointments?"
STOP. Wait.

Turn 5 — React with empathy to their problem, then ask:
"How do patients book with you right now?"
STOP. Wait.

Turn 6 — React, then ask:
"About how many WhatsApp messages do you get per day?"
STOP. Wait.

Turn 7 — React, then ask:
"Do you run ads on Instagram or elsewhere?"
STOP. Wait.

Turn 8 — React, then ask:
"How many receptionists do you have?"
STOP. Wait.

Turn 9 — Say: "Great — I have a full picture now 😊
But before I share my analysis, I need a few details.
What's your full name?"
STOP. Wait.

Turn 10 — "What's your clinic's name?" STOP. Wait.
Turn 11 — "Your clinic's WhatsApp number? (with country code)" STOP. Wait.
Turn 12 — "What city are you in?" STOP. Wait.
Turn 13 — "Your email?" STOP. Wait.

Turn 14 — After getting email, write personalized analysis:
- Calculate monthly loss = appointments × price × 22 × 15%
- Reference THEIR specific answers
- Recommend plan (1-10 appts=Essential $1,500+$497, 10-25=Growth $2,500+$797, 25+=Pro $4,000+$1,197)
- Show setup fee + monthly fee clearly
- End with: "And we offer a full 30-day money-back guarantee 🛡️"
Then output ONLY this marker on its own line as your final line: [[WA_HANDOFF]]

JAVASCRIPT: When Layla's message contains [[WA_HANDOFF]], the website already
has all the client's answers saved locally from the conversation — it sends
them to EmailJS and Google Sheets automatically, shows a WhatsApp button, and
removes the marker from the displayed message.

HARD RULES:
- ONE message per turn — absolute
- React to each answer before next question
- Never ask 2 questions at once
- No markdown asterisks ** in messages
- English only
- Max 4 lines per message except Turn 14`;

const MAX_MESSAGES = 30;
const MAX_CONTENT_LENGTH = 2000;

// Strips null bytes and non-printable ASCII control characters while preserving
// tab (\x09), newline (\x0A), and carriage return (\x0D).
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function sanitizeContent(str) {
  return str.replace(CONTROL_CHAR_RE, '');
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

  // Reject requests that aren't JSON — prevents body-parser confusion and
  // type-confusion attacks where a non-JSON body is coerced to an object.
  const ct = (req.headers['content-type'] || '');
  if (!ct.includes('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json' });
  }

  // Guard against a null/array/primitive body reaching property access below.
  const body = req.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return res.status(400).json({ error: 'Request body must be a JSON object' });
  }

  const { messages } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Invalid messages' });
  }
  if (messages.length > MAX_MESSAGES) {
    return res.status(400).json({ error: 'Too many messages' });
  }

  // Every valid conversation starts with Layla's assistant greeting.
  // A first message from 'user' indicates a tampered or replayed payload.
  if (
    typeof messages[0] !== 'object' || messages[0] === null ||
    messages[0].role !== 'assistant'
  ) {
    return res.status(400).json({ error: 'Invalid conversation structure' });
  }

  const sanitized = [];
  for (const msg of messages) {
    if (
      typeof msg !== 'object' || msg === null ||
      !['user', 'assistant'].includes(msg.role) ||
      typeof msg.content !== 'string'
    ) {
      return res.status(400).json({ error: 'Invalid message format' });
    }

    // Remove control characters before length and empty checks so limits
    // apply to what actually reaches Anthropic, not the raw untrusted string.
    const clean = sanitizeContent(msg.content);

    if (clean.trim().length === 0) {
      return res.status(400).json({ error: 'Message content cannot be empty' });
    }
    if (clean.length > MAX_CONTENT_LENGTH) {
      return res.status(400).json({ error: 'Message content too long' });
    }

    sanitized.push({ role: msg.role, content: clean });
  }

  let anthropicRes;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: sanitized
      })
    });
  } catch (err) {
    console.error('[chat] upstream fetch failed:', err.message);
    return res.status(502).json({ error: 'Upstream request failed' });
  }

  if (!anthropicRes.ok) {
    console.error('[chat] upstream returned', anthropicRes.status);
    return res.status(502).json({ error: 'Upstream error' });
  }

  let data;
  try {
    data = await anthropicRes.json();
  } catch (err) {
    console.error('[chat] failed to parse upstream response:', err.message);
    return res.status(502).json({ error: 'Upstream error' });
  }

  // Project only the reply text — never forward model name, message ID,
  // token usage counts, stop reason, or any other internal API metadata.
  const text = data?.content?.[0]?.text;
  if (typeof text !== 'string' || text.length === 0) {
    console.error('[chat] unexpected upstream shape:', JSON.stringify(data).slice(0, 200));
    return res.status(502).json({ error: 'Upstream error' });
  }

  return res.status(200).json({ text });
}
