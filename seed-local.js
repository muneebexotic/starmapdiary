const API_BASE = "http://localhost:3000/api";
const EMAIL = process.env.SEED_EMAIL;
const PASSWORD = process.env.SEED_PASSWORD;
const COUNT = 50;

if (!EMAIL || !PASSWORD) {
  console.error("Set SEED_EMAIL and SEED_PASSWORD first.");
  process.exit(1);
}

const thoughts = [
  "Today I felt grounded after a long walk and I want to keep this calm energy.",
  "I keep overthinking one conversation and I am not sure why it still bothers me.",
  "Small win: I finished a task I had postponed for weeks.",
  "I felt anxious before the meeting but it went better than expected.",
  "I am grateful for how supportive my friends have been this month.",
  "Why do I judge myself so harshly when I am learning something new?",
  "I miss home more than usual tonight.",
  "I noticed I focus better when I plan only three priorities.",
  "I am excited about the direction this project is taking.",
  "I felt drained all afternoon and could not explain it.",
  "I learned that saying no can also be a form of self-respect.",
  "I am proud that I stayed consistent even when motivation dropped.",
  "I felt lonely in a crowded room today.",
  "What if progress is just repeating small actions on hard days?",
  "I had a genuinely peaceful morning with no rush.",
  "I keep worrying about outcomes I cannot control.",
  "I am thankful for a quiet evening and a clear mind.",
  "I snapped at someone and regret it now.",
  "I realized I need better boundaries with my time.",
  "Today felt bright and full of momentum.",
  "I am carrying stress in my body and should slow down.",
  "I found joy in a tiny routine: tea, notes, and music.",
  "I wonder what version of me this season is shaping.",
  "I felt stuck but still showed up, and that counts.",
  "I am hopeful after seeing steady improvements this week.",
  "I felt overwhelmed by how many decisions needed my attention.",
  "I noticed comparison steals energy from my own progress.",
  "I laughed a lot today and it felt like a reset.",
  "I am afraid of failing publicly, even when I prepare well.",
  "I learned that rest is productive when used intentionally.",
  "I felt calm after writing everything down.",
  "I keep questioning whether I am moving fast enough.",
  "I am grateful for the mentor who gave me honest feedback.",
  "I felt disconnected and scrolled too much to avoid thinking.",
  "I realized I do better when I define done before I start.",
  "Today I felt genuinely confident in my decisions.",
  "I am carrying frustration from things that are not urgent.",
  "I noticed how much better I feel after a short workout.",
  "I am excited to share this build with people.",
  "I felt uncertain, but I kept moving anyway.",
  "I wonder how future me will view this current challenge.",
  "I am proud of handling a difficult conversation with respect.",
  "I felt tired and negative by evening.",
  "I learned I need deeper focus blocks and fewer context switches.",
  "Today felt meaningful even though nothing dramatic happened.",
  "I felt pressure to be perfect and it slowed me down.",
  "I noticed gratitude shifts my mood faster than I expect.",
  "I am hopeful that consistency will beat intensity over time.",
  "I felt heavy this morning but lighter after talking it out.",
  "What am I avoiding that would actually help me grow?"
];

function mood(t) {
  const s = t.toLowerCase();
  if (/(grateful|proud|joy|hopeful|excited|peaceful|thankful)/.test(s)) return "positive";
  if (/(why|wonder|learned|realized|question)/.test(s)) return "reflective";
  if (/(anxious|worry|lonely|overwhelmed|afraid|tired|frustration|pressure)/.test(s)) return "negative";
  return "neutral";
}

const rand = (a, b) => Math.random() * (b - a) + a;

function position(sentiment, i) {
  const band = {
    positive: { y: [20, 60], r: [45, 120] },
    neutral: { y: [-10, 20], r: [35, 100] },
    negative: { y: [-65, -15], r: [55, 130] },
    reflective: { y: [10, 50], r: [90, 170] }
  }[sentiment];

  const angle = (i / COUNT) * Math.PI * 4 + rand(-0.2, 0.2);
  const radius = rand(band.r[0], band.r[1]);

  return {
    x: Math.cos(angle) * radius,
    y: rand(band.y[0], band.y[1]),
    z: Math.sin(angle) * radius
  };
}

function createdAt(i) {
  const now = Date.now();
  const daysBack = Math.floor(((COUNT - i) / COUNT) * 90);
  return new Date(now - daysBack * 86400000 - rand(0, 18) * 3600000).toISOString();
}

async function post(path, body, token) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed ${path}`);
  return data;
}

(async () => {
  const login = await post("/auth/login", { email: EMAIL, password: PASSWORD });
  const token = login.session.access_token;

  for (let i = 0; i < COUNT; i += 1) {
    const text = thoughts[i % thoughts.length];
    const sentiment = mood(text);
    await post("/entries", {
      text,
      sentiment,
      createdAt: createdAt(i),
      position: position(sentiment, i)
    }, token);
  }

  console.log(`Seeded ${COUNT} entries for ${EMAIL}`);
})().catch((e) => {
  console.error("Seed failed:", e.message);
  process.exit(1);
});
