export async function onRequestGet({ request, env, context }) {
  const u = new URL(request.url);
  const target = u.searchParams.get("url");
  const title = u.searchParams.get("title") || "";
  const source = u.searchParams.get("source") || "";

  if (!target) return json({ ok: false, error: "Missing ?url=" }, 400);
  if (!env.OPENAI_API_KEY) return json({ ok: false, error: "Missing OPENAI_API_KEY env var" }, 500);

  // --- Edge cache (Cloudflare Cache API) ---
  // Cache key must be a Request. We include title/source so summaries vary when headline text changes.
  const cacheKeyUrl = new URL(request.url);
  cacheKeyUrl.pathname = "/__edge_cache__/summarize";
  cacheKeyUrl.search = ""; // normalize; we'll set our own stable params

  cacheKeyUrl.searchParams.set("url", normalizeUrl(target));
  cacheKeyUrl.searchParams.set("title", title.slice(0, 180));
  cacheKeyUrl.searchParams.set("source", source.slice(0, 80));

  const cacheKeyReq = new Request(cacheKeyUrl.toString(), { method: "GET" });

  // If caller passes ?refresh=1 we bypass cache and force a new OpenAI call
  const forceRefresh = u.searchParams.get("refresh") === "1";

  if (!forceRefresh) {
    const cached = await caches.default.match(cacheKeyReq);
    if (cached) return cached;
  }

  // Fetch article (best-effort; some sites block)
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
    return await summarizeAndCache({
      env,
      cacheKeyReq,
      title,
      source,
      text: ""
    });
  }

  const text = extractText(html).slice(0, 6500);
  return await summarizeAndCache({ env, cacheKeyReq, title, source, text });
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

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    // Strip most tracking params to improve cache hits
    const drop = new Set([
      "utm_source","utm_medium","utm_campaign","utm_term","utm_content",
      "gclid","fbclid","mc_cid","mc_eid","ref","ref_src","src"
    ]);
    [...u.searchParams.keys()].forEach(k => {
      if (drop.has(k)) u.searchParams.delete(k);
    });
    // Don’t keep URL fragments
    u.hash = "";
    return u.toString();
  } catch {
    return String(url || "");
  }
}

async function summarizeAndCache({ env, cacheKeyReq, title, source, text }) {
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

  // We’ll try OpenAI, but 429 is common if you refresh frequently.
  let r;
  try {
    r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-4.1-mini",
        input: prompt
      })
    });
  } catch {
    return json({ ok: false, error: "OpenAI request failed" }, 502);
  }

  // If rate-limited, try to serve any cached version anyway (even if caller forced refresh)
  if (r.status === 429) {
    const cached = await caches.default.match(cacheKeyReq);
    if (cached) return cached;

    return json({
      ok: false,
      error: "OpenAI rate limited (429)",
      summary: "Summary temporarily unavailable (rate limit). Try again in a minute."
    }, 429, {
      "cache-control": "no-store"
    });
  }

  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    return json(
      { ok: false, error: `OpenAI error ${r.status}`, detail: errText.slice(0, 900) },
      502,
      { "cache-control": "no-store" }
    );
  }

  const data = await r.json();

  const summary =
    data.output_text ||
    data?.output?.[0]?.content?.map(c => c.text).filter(Boolean).join("\n") ||
    "";

  const body = {
    ok: true,
    summary: String(summary || "").trim() || "No summary returned."
  };

  // Cache it at the edge so repeated refreshes don’t hammer OpenAI
  const res = json(body, 200, {
    // Browser should not cache aggressively; Cloudflare edge SHOULD
    "cache-control": "public, max-age=0, s-maxage=21600, stale-while-revalidate=86400"
  });

  // Put into Cloudflare edge cache
  await caches.default.put(cacheKeyReq, res.clone());

  return res;
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });
}
