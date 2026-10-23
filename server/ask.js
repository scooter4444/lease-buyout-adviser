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
