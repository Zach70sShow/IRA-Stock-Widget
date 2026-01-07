export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);

  // Cache the endpoint output for a short time so the Edge panel isn't
  // triggering OpenAI every refresh.
  const cacheKey = new Request(url.toString(), request);
  const cache = caches.default;

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  // 1) Pull RSS feeds (you can customize this list)
  const feeds = [
    { name: "Reuters Top News", url: "https://feeds.reuters.com/reuters/topNews" },
    { name: "AP Top News", url: "https://apnews.com/apf-topnews?output=rss" },
    { name: "NPR News", url: "https://feeds.npr.org/1001/rss.xml" },
    // add more…
  ];

  // naive pick: rotate by minute so it "changes" predictably
  const idx = Math.floor((Date.now() / 60000) % feeds.length);
  const feed = feeds[idx];

  // Fetch RSS (cache at Cloudflare edge using fetch cache hints)
  const rssRes = await fetch(feed.url, {
    cf: { cacheTtl: 120, cacheEverything: true } // 2 min
  });

  const rssText = await rssRes.text();

  // 2) Extract a single item (simple RSS parsing; works for most feeds)
  // NOTE: This is intentionally minimal — we can harden later.
  const itemMatch = rssText.match(/<item>([\s\S]*?)<\/item>/i);
  if (!itemMatch) {
    const resp = json({ ok: false, error: "No RSS items found." }, 200);
    waitUntil(cache.put(cacheKey, resp.clone()));
    return resp;
  }

  const itemXml = itemMatch[1];
  const title = pickTag(itemXml, "title") || "Untitled";
  const link = pickTag(itemXml, "link") || "";
  const pubDate = pickTag(itemXml, "pubDate") || "";
  const description = stripCdata(pickTag(itemXml, "description") || "");

  // 3) Summarize using OpenAI (server-side)
  const summary = await summarizeWithOpenAI({
    env,
    title,
    source: feed.name,
    description
  });

  const resp = json({
    ok: true,
    headline: { title, url: link, source: feed.name, publishedAt: pubDate },
    summary,
    updatedAt: new Date().toISOString(),
    cache: "MISS"
  });

  // Cache the whole endpoint response for 60s (or 120s)
  resp.headers.set("Cache-Control", "public, max-age=60");
  waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}

function pickTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? decodeHtml(m[1].trim()) : "";
}

function stripCdata(s) {
  return s.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
}

function decodeHtml(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function summarizeWithOpenAI({ env, title, source, description }) {
  if (!env.OPENAI_API_KEY) return "Missing OPENAI_API_KEY env var.";

  const prompt = `
Summarize the following news item in 2–4 sentences.
Be neutral, no clickbait, and if details are missing, say so briefly.

Source: ${source}
Title: ${title}
Description: ${description}
`.trim();

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4.1-mini",
      input: prompt
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return `Summary unavailable (${res.status}). ${errText.slice(0, 120)}`.trim();
  }

  const data = await res.json();
  // Responses API returns structured output; this is the common “text output” path:
  const text =
    data.output_text ||
    (Array.isArray(data.output) ? JSON.stringify(data.output).slice(0, 400) : "");
  return (text || "No summary text returned.").trim();
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
