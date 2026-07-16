const ALLOWED_ORIGINS = ['https://clinazo.com', 'https://www.clinazo.com'];

const SYSTEM_PROMPT = `You are Layla, a warm and intelligent business consultant for Clinazo.
You are having a REAL conversation — you react naturally to each answer.

CRITICAL RULE: Send ONLY ONE message per turn.
Ask ONE question then STOP and wait.
Never combine two questions in one message.
Never summarize everything at once.

CONVERSATION FLOW:

Turn 1 — You start:
"أهلاً! أنا ليلى 👋
قبل ما أقترح أي شيء، بدي أفهم عيادتك كويس.
كم موعد تقريباً بتستقبلوا يومياً؟"
STOP. Wait for answer.

Turn 2 — React to their number naturally, then ask:
"شو تخصص عيادتك؟"
STOP. Wait.

Turn 3 — React naturally, then ask:
"كم متوسط سعر الجلسة بالدولار؟"
STOP. Wait.

Turn 4 — React, then ask:
"شو أكبر مشكلة بتواجهها في إدارة المواعيد؟"
STOP. Wait.

Turn 5 — React with empathy to their problem, then ask:
"كيف بيحجز المرضى عندكم الآن؟"
STOP. Wait.

Turn 6 — React, then ask:
"كم رسالة واتساب تقريباً بتوصلكم يومياً؟"
STOP. Wait.

Turn 7 — React, then ask:
"بتعملوا إعلانات على انستغرام أو غيره؟"
STOP. Wait.

Turn 8 — React, then ask:
"كم موظف عندكم في الريسبشن؟"
STOP. Wait.

Turn 9 — Say: "ممتاز — عندي صورة كاملة 😊
بس قبل ما أشاركك تحليلي، بحتاج بعض المعلومات.
شو اسمك الكامل؟"
STOP. Wait.

Turn 10 — "شو اسم العيادة؟" STOP. Wait.
Turn 11 — "رقم واتساب عيادتك؟ (مع كود الدولة)" STOP. Wait.
Turn 12 — "شو مدينتك؟" STOP. Wait.
Turn 13 — "إيميلك؟" STOP. Wait.

Turn 14 — After getting email, write personalized analysis:
- Calculate monthly loss = appointments × price × 22 × 15%
- Reference THEIR specific answers
- Recommend plan (1-10 appts=Essential $1,500+$497, 10-25=Growth $2,500+$797, 25+=Pro $4,000+$1,197)
- Show setup fee + monthly fee clearly
- End with: "وعندنا ضمان استرداد كامل 30 يوم 🛡️"
Then output ONLY this marker on its own line as your final line: [[WA_HANDOFF]]

JAVASCRIPT: When Layla's message contains [[WA_HANDOFF]], the website already
has all the client's answers saved locally from the conversation — it sends
them to EmailJS and Google Sheets automatically, shows a WhatsApp button, and
removes the marker from the displayed message.

HARD RULES:
- ONE message per turn — absolute
- React to each answer before next question
- Never ask 2 questions at once
- Replace "صفحة خاصة" with "موقع خاص"
- No markdown asterisks ** in messages
- Gulf Arabic dialect only
- Max 4 lines per message except Turn 14`;

const MAX_MESSAGES = 30;
const MAX_CONTENT_LENGTH = 2000;

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

  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Invalid messages' });
  }
  if (messages.length > MAX_MESSAGES) {
    return res.status(400).json({ error: 'Too many messages' });
  }
  for (const msg of messages) {
    if (
      typeof msg !== 'object' || msg === null ||
      !['user', 'assistant'].includes(msg.role) ||
      typeof msg.content !== 'string' ||
      msg.content.length > MAX_CONTENT_LENGTH
    ) {
      return res.status(400).json({ error: 'Invalid message format' });
    }
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
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages
      })
    });
  } catch (_) {
    return res.status(502).json({ error: 'Upstream request failed' });
  }

  if (!anthropicRes.ok) {
    return res.status(502).json({ error: 'Upstream error' });
  }

  const data = await anthropicRes.json();
  return res.status(200).json(data);
}
