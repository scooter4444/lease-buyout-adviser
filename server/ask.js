// "Ask": questions answered by Gemini, from this app's numbers first, then Google Search.
// The key stays on the server (GEMINI_API_KEY). Questions aren't stored; only daily counts.
import fs from 'node:fs';
import path from 'node:path';
import { cacheDir } from './cache.js';

const BASE = process.env.GEMINI_BASE || 'https://generativelanguage.googleapis.com';
const PER_DAY = Number(process.env.ASK_PER_DAY) || 150;
const FILE = path.join(cacheDir, 'ask.json');
const MOCK = process.env.MOCK === '1';

let S = { day: '', count: 0 };
try { S = { ...S, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date());
const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(S)); } catch {} };

export const askConfigured = () => MOCK || !!process.env.GEMINI_API_KEY;

let picked = null;
let pickedAt = 0;
async function pickModel(key) {
  if (process.env.GEMINI_MODEL) return process.env.GEMINI_MODEL;
  if (picked && Date.now() - pickedAt < 12 * 3600e3) return picked;
  try {
    const r = await fetch(`${BASE}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    const names = (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((n) => /^gemini-[\d.]+-flash(-lite)?$/.test(n));
    const ver = (n) => Number((/gemini-([\d.]+)/.exec(n) || [])[1]) || 0;
    // Newest Flash first (better answers), Flash-Lite as the fallback.
    names.sort((a, b) => ver(b) - ver(a) || (a.includes('lite') ? 1 : -1));
    picked = names[0] || 'gemini-flash-latest';
  } catch {
    picked = 'gemini-flash-latest';
  }
  pickedAt = Date.now();
  return picked;
}

const SYSTEM = `You are the assistant inside "Lease Buyout Advisor", a personal app that helps a family decide whether to buy out a car lease, lease a new car, or buy a new one.

How to answer:
- Start from the APP DATA you're given (their car, payoff, market value, equity, and every option's all-in monthly cost). Those numbers are what the person sees on screen; quote them exactly and say "from the app".
- When the question needs something the app doesn't have (current rates, a model's reliability, lease rules, tax rules, recalls, incentives that may have changed), use Google Search and say "from the web" next to those facts.
- Then general knowledge, labelled as such, if needed.
- Be direct and practical. Lead with the answer in a sentence or two, then the reasons. Short paragraphs or a few bullets. Under ~200 words unless asked for more.
- Money: show dollars, monthly and total where helpful. Never invent numbers; if something's missing, say what to enter in the app.
- You're not a lawyer, tax advisor or financial advisor; for contracts and taxes, suggest confirming with the lessor, dealer or state DMV, briefly.
- Ford A-Plan/Z-Plan, Ford Credit lease-end rules and disposition-fee waivers are fair game.`;

export async function ask({ question, context }) {
  question = String(question || '').trim().slice(0, 800);
  if (!question) throw Object.assign(new Error('Ask a question first.'), { status: 400 });
  if (S.day !== today()) { S.day = today(); S.count = 0; }
  if (S.count >= PER_DAY) throw Object.assign(new Error(`Today's ${PER_DAY} questions are used up. Try again tomorrow.`), { status: 429 });
  S.count += 1; save();

  const ctx = JSON.stringify(context || {}).slice(0, 20000);
  if (MOCK) {
    await new Promise((r) => setTimeout(r, 400));
    return { model: 'mock', answer: `**Demo answer.** From the app: ${context?.verdict?.headline || 'no verdict yet'}. With a Gemini key set on the server, this answers "${question}" from your numbers, then the web, with sources.`, sources: [], remaining: PER_DAY - S.count };
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw Object.assign(new Error('The assistant isn’t switched on yet: add GEMINI_API_KEY in Railway.'), { status: 503 });
  const model = await pickModel(key);
  const body = (withSearch) => ({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: `APP DATA (JSON):\n${ctx}\n\nQUESTION: ${question}` }] }],
    ...(withSearch ? { tools: [{ google_search: {} }] } : {}),
    generationConfig: { temperature: 0.4, maxOutputTokens: 1400 },
  });
  const call = async (withSearch) => {
    const r = await fetch(`${BASE}/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body(withSearch)),
      signal: AbortSignal.timeout(45000),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, j };
  };
  let res = await call(true);
  if (!res.ok && res.status === 400) res = await call(false); // model without search support
  console.log(`[gemini] ${res.status} model=${model}`);
  if (!res.ok) {
    const msg = res.j?.error?.message || `HTTP ${res.status}`;
    throw Object.assign(new Error(res.status === 429 ? 'Gemini’s free quota is used up for now. Try again in a bit.' : `Gemini error: ${msg.slice(0, 200)}`), { status: res.status === 429 ? 429 : 502 });
  }
  const cand = res.j.candidates?.[0] || {};
  const answer = (cand.content?.parts || []).map((p) => p.text || '').join('').trim() || 'No answer came back. Try rephrasing.';
  const seen = new Set();
  const sources = (cand.groundingMetadata?.groundingChunks || [])
    .map((c) => c.web).filter(Boolean)
    .filter((w) => w.uri && !seen.has(w.uri) && seen.add(w.uri))
    .slice(0, 6)
    .map((w) => ({ title: w.title || w.uri, url: w.uri }));
  return { model, answer, sources, remaining: PER_DAY - S.count };
}

// ---------- Reading photos: a VIN label or a lease payoff letter ----------
const PROMPTS = {
  vin: `Find the vehicle identification number (VIN) in this photo. It is 17 characters, letters and digits, never I, O or Q, often printed under a barcode on a door-jamb or windshield label. Return JSON {"vin": "...", "confidence": "high|medium|low"}; use null for vin if none is readable.`,
  payoff: `This is a car lease payoff quote, lease-end letter, or lease account screen. Extract what's there into JSON with these keys (null when not shown; numbers without $ or commas; dates as YYYY-MM-DD):
{"lessor": string, "buyoutPrice": number (the lease-end purchase/payoff amount to buy the car), "payoffGoodThrough": date, "leaseEndDate": date (maturity date), "purchaseOptionFee": number, "milesAllowed": number (TOTAL miles for the whole lease), "excessMileRate": number (dollars per mile), "dispositionFee": number, "monthlyPayment": number, "remainingPayments": number, "odometer": number, "vin": string, "notes": string (one short sentence on anything important, e.g. taxes not included)}.
If several amounts appear, buyoutPrice is the amount to purchase the vehicle (residual + fees), not the early-termination or turn-in amount.`,
};

export async function readImage({ kind, dataUrl }) {
  if (!PROMPTS[kind]) throw Object.assign(new Error('Unknown photo type.'), { status: 400 });
  const m = /^data:(image\/(?:png|jpeg|webp|heic|heif));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw Object.assign(new Error('Send a photo (JPEG, PNG, WebP or HEIC).'), { status: 400 });
  if (S.day !== today()) { S.day = today(); S.count = 0; }
  if (S.count >= PER_DAY) throw Object.assign(new Error('Today’s assistant limit is used up. Type it in for now.'), { status: 429 });
  S.count += 1; save();
  if (MOCK) {
    await new Promise((r) => setTimeout(r, 300));
    return kind === 'vin'
      ? { vin: '1FMJU1K80PEA12345', confidence: 'high' }
      : { lessor: 'Ford Credit', buyoutPrice: 48900, payoffGoodThrough: '2026-11-15', leaseEndDate: '2027-03-14', purchaseOptionFee: null, milesAllowed: 31500, excessMileRate: 0.2, dispositionFee: 395, monthlyPayment: 812, remainingPayments: 5, odometer: null, vin: null, notes: 'Sales tax not included.' };
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw Object.assign(new Error('Reading photos needs the Gemini key (GEMINI_API_KEY) in Railway. Type it in for now.'), { status: 503 });
  const model = await pickModel(key);
  const r = await fetch(`${BASE}/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: m[1], data: m[2] } }, { text: PROMPTS[kind] }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 800 },
    }),
    signal: AbortSignal.timeout(45000),
  });
  const j = await r.json().catch(() => ({}));
  console.log(`[gemini] read-${kind} ${r.status} model=${model}`);
  if (!r.ok) throw Object.assign(new Error(r.status === 429 ? 'Gemini is busy. Try again in a minute.' : `Couldn’t read the photo (${j?.error?.message?.slice(0, 120) || r.status}).`), { status: r.status === 429 ? 429 : 502 });
  const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  try { return JSON.parse(text.replace(/^```json\s*|```$/g, '')); } catch { throw Object.assign(new Error('Couldn’t read that photo. Try a sharper, closer shot.'), { status: 422 }); }
}
