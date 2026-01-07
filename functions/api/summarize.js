export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const target = u.searchParams.get("url");
  const title  = u.searchParams.get("title") || "";
  const source = u.searchParams.get("source") || "";

  if (!target) return json({ ok:false, error:"Missing ?url=" }, 400);
  if (!env.OPENAI_API_KEY) return json({ ok:false, error:"Missing OPENAI_API_KEY env var" }, 500);

  // ---- tiny in-memory cache (per instance) ----
  const key = `sum:${target}`;
  const now = Date.now();
  const hit = memGet(key);
  if (hit && hit.expiresAt > now) {
    return json({ ok:true, summary: hit.value, cached:true }, 200, {
      "cache-control": "public, s-maxage=21600, stale-while-revalidate=86400"
    });
  }

  // Fetch article (best-effort)
  let html = "";
  try {
    const r = await fetch(target, {
      headers: {
        "User-Agent": "EdgeHeadlines/1.0 (+Cloudflare Pages)",
        "Accept": "text/html,application/xhtml+xml",
      }
    });
    if (!r.ok) throw new Error(String(r.status));
    html = await r.text();
  } catch {
    // fall back: summarize only title/source if fetch fails
    return summarizeOpenAI(env, { title, source, text: "" }, key);
  }

  const text = extractText(html).slice(0, 6500);
  return summarizeOpenAI(env, { title, source, text }, key);
}

function extractText(html) {
  return String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|br|li|h1|h2|h3|h4)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function summarizeOpenAI(env, { title, source, text }, cacheKey) {
  const prompt = [
    "Summarize this news item in 2–4 sentences.",
    "Neutral tone. Concrete details only. No hype.",
    "If the full article text is missing/blocked, say so briefly and summarize from the title.",
    "",
    `Source: ${source}`,
    `Title: ${title}`,
    "",
    text ? `Article text:\n${text}` : "Article text: (not available)"
  ].join("\n");

  let r;
  try {
    r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-5",
        input: prompt
      })
    });
  } catch {
    return json(
      { ok:false, error:"OpenAI request failed (network)" },
      502
    );
  }

  // Try to parse error body for helpful debugging
  let bodyText = "";
  try { bodyText = await r.text(); } catch {}
  let bodyJson = null;
  try { bodyJson = bodyText ? JSON.parse(bodyText) : null; } catch {}

  // Handle rate limit nicely so the client doesn't DDoS your own endpoint
  if (r.status === 429) {
    const retryAfter = r.headers.get("retry-after");
    const msg = "Summary temporarily unavailable (rate limit). Try again in a minute.";

    // short cache so repeated client calls back off automatically
    return json(
      {
        ok: false,
        error: "OpenAI rate limited (429)",
        retryAfter: retryAfter ? String(retryAfter) : null,
        openai: bodyJson || bodyText || null,
        summary: msg
      },
      200,
      { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" }
    );
  }

  if (!r.ok) {
    return json(
      {
        ok: false,
        error: `OpenAI error ${r.status}`,
        openai: bodyJson || bodyText || null
      },
      502
    );
  }

  // Parse success body (we already consumed text above)
  const data = bodyJson || {};
  const summary =
    data.output_text ||
    data?.output?.[0]?.content?.map(c => c.text).filter(Boolean).join("\n") ||
    "";

  const finalSummary = String(summary || "").trim() || "No summary returned.";

  // Cache in memory for 6 hours to reduce repeat calls inside the edge runtime
  memSet(cacheKey, finalSummary, 6 * 60 * 60 * 1000);

  return json(
    { ok: true, summary: finalSummary },
    200,
    { "cache-control": "public, s-maxage=21600, stale-while-revalidate=86400" }
  );
}

// ---- super tiny in-memory cache helpers ----
const __MEM = globalThis.__EDGE_MEM__ || (globalThis.__EDGE_MEM__ = new Map());
function memGet(k) { return __MEM.get(k); }
function memSet(k, v, ttlMs) { __MEM.set(k, { value: v, expiresAt: Date.now() + ttlMs }); }

function json(obj, status=200, extraHeaders={}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });
}
