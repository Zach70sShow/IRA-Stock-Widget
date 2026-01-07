export async function onRequestGet({ request, env, ctx }) {
  const u = new URL(request.url);

  // How many items to return (client will still cycle 1 at a time)
  const limit = clampInt(u.searchParams.get("limit"), 1, 80, 40);

  // If you ever want to temporarily disable Reddit (rate limits / preferences)
  const includeReddit = (u.searchParams.get("reddit") ?? "1") !== "0";

  // --- FEEDS (add/remove freely) ---
  const feeds = [
    // ===== Local AZ (you provided) =====
    { category: "AZ",    source: "AZFamily • News",     url: "https://www.azfamily.com/arc/outboundfeeds/rss/category/news/?outputType=xml&size=50&sort=display_date:desc&summary=true" },
    { category: "AZ",    source: "AZFamily • Politics",  url: "https://www.azfamily.com/arc/outboundfeeds/rss/category/politics/?outputType=xml&size=20&sort=display_date:desc&summary=true" },
    { category: "AZWX",  source: "AZFamily • Forecast",  url: "https://www.azfamily.com/arc/outboundfeeds/rss/category/weather/forecast/?outputType=xml&size=3&sort=display_date:desc&summary=true" },
    { category: "AZWX",  source: "AZFamily • Weather",   url: "https://www.azfamily.com/arc/outboundfeeds/rss/category/weather/coverage/?outputType=xml&size=3&sort=display_date:desc&summary=true" },

    // ===== Markets / Business =====
    { category: "Markets", source: "CNBC • Top News", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html" },
    { category: "Markets", source: "MarketWatch • Top", url: "https://feeds.marketwatch.com/marketwatch/topstories/" },

    // ===== Tech =====
    { category: "Tech", source: "The Verge", url: "https://www.theverge.com/rss/frontpage" },
    { category: "Tech", source: "TechCrunch", url: "https://feeds.feedburner.com/TechCrunch/" },
    { category: "Tech", source: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index" },

    // ===== US / Politics / World =====
    { category: "US",      source: "NPR • News", url: "https://feeds.npr.org/1001/rss.xml" },
    { category: "Politics",source: "Politico",   url: "https://www.politico.com/rss/politicopicks.xml" },
    { category: "Global",  source: "BBC • World",url: "http://feeds.bbci.co.uk/news/world/rss.xml" },

    // ===== Gaming =====
    { category: "Gaming", source: "IGN", url: "https://feeds.ign.com/ign/all" },
    { category: "Gaming", source: "PC Gamer", url: "https://www.pcgamer.com/rss/" },

    // ===== Video Editing / Creator =====
    { category: "Editing", source: "No Film School", url: "https://nofilmschool.com/rss.xml" },
    { category: "Editing", source: "Frame.io Blog",  url: "https://blog.frame.io/feed/" },

    // ===== NFL =====
    // NFL league news RSS is inconsistent across providers; this is “good enough” without auth.
    { category: "NFL", source: "Yahoo Sports • NFL", url: "https://sports.yahoo.com/nfl/rss.xml" },
  ];

  // Reddit JSON feeds (free) – these are “hot” posts, not RSS.
  const reddits = [
    { category: "Markets", source: "Reddit r/investing", url: "https://www.reddit.com/r/investing/hot.json?limit=15" },
    { category: "Tech",    source: "Reddit r/technology", url: "https://www.reddit.com/r/technology/hot.json?limit=15" },
    { category: "Gaming",  source: "Reddit r/gaming", url: "https://www.reddit.com/r/gaming/hot.json?limit=15" },
    { category: "NFL",     source: "Reddit r/nfl", url: "https://www.reddit.com/r/nfl/hot.json?limit=15" },
    { category: "Politics",source: "Reddit r/politics", url: "https://www.reddit.com/r/politics/hot.json?limit=15" },
    { category: "AZ",      source: "Reddit r/arizona", url: "https://www.reddit.com/r/arizona/hot.json?limit=15" },
    { category: "AZ",      source: "Reddit r/phoenix", url: "https://www.reddit.com/r/phoenix/hot.json?limit=15" },
  ];

  // Simple edge cache (so your page isn’t slamming feeds every refresh)
  const cacheKey = new Request(u.origin + "/api/headlines?limit=" + limit + "&reddit=" + (includeReddit ? "1" : "0"));
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const items = [];

  // Fetch RSS feeds concurrently (with timeouts)
  const rssResults = await Promise.allSettled(
    feeds.map(f => fetchRssItems(f, { timeoutMs: 9000 }))
  );
  for (const r of rssResults) {
    if (r.status === "fulfilled" && Array.isArray(r.value)) items.push(...r.value);
  }

  // Fetch Reddit concurrently (optional)
  if (includeReddit) {
    const redditResults = await Promise.allSettled(
      reddits.map(r => fetchRedditItems(r, { timeoutMs: 9000 }))
    );
    for (const r of redditResults) {
      if (r.status === "fulfilled" && Array.isArray(r.value)) items.push(...r.value);
    }
  }

  // Dedupe by canonical URL
  const deduped = dedupeByUrl(items);

  // Sort by published date desc (fallback: now-ness)
  deduped.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  // Trim + shape
  const out = deduped.slice(0, limit).map(x => ({
    id: x.id,
    category: x.category,
    source: x.source,
    title: x.title,
    url: x.url,
    published: x.published || null,
    summary: x.summary || "Summary unavailable.",
  }));

  const res = json({ ok: true, count: out.length, items: out }, 200, {
    "cache-control": "s-maxage=120, stale-while-revalidate=600"
  });

  // Store in CF cache
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

/* ---------------- helpers ---------------- */

function clampInt(v, min, max, dflt) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

async function fetchRssItems(feed, { timeoutMs = 9000 } = {}) {
  const { category, source, url } = feed;
  const xml = await fetchWithTimeout(url, {
    headers: { "User-Agent": "EdgeHeadlines/1.0 (+Cloudflare Pages)", "Accept": "application/xml,text/xml,*/*" }
  }, timeoutMs).then(r => r.ok ? r.text() : "");

  if (!xml) return [];

  const channelTitle = pickFirst(xml, /<channel>[\s\S]*?<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)
                    || pickFirst(xml, /<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/i)
                    || source;

  // Split items
  const rawItems = xml.split(/<item\b/i).slice(1);
  const items = [];

  for (const chunk of rawItems) {
    const title = decodeHtml(
      pickFirst(chunk, /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i) ||
      pickFirst(chunk, /<title>([\s\S]*?)<\/title>/i) ||
      ""
    ).trim();

    let link = decodeHtml(
      pickFirst(chunk, /<link>([\s\S]*?)<\/link>/i) ||
      pickFirst(chunk, /<guid[^>]*>([\s\S]*?)<\/guid>/i) ||
      ""
    ).trim();

    // Some feeds put link as <link><![CDATA[...]]></link>
    link = link.replace(/^<!\[CDATA\[|\]\]>$/g, "").trim();

    const pubDate = decodeHtml(
      pickFirst(chunk, /<pubDate>([\s\S]*?)<\/pubDate>/i) ||
      pickFirst(chunk, /<dc:date>([\s\S]*?)<\/dc:date>/i) ||
      ""
    ).trim();

    const desc = decodeHtml(
      pickFirst(chunk, /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i) ||
      pickFirst(chunk, /<description>([\s\S]*?)<\/description>/i) ||
      pickFirst(chunk, /<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/i) ||
      ""
    );

    const summary = cleanSummary(desc);

    if (!title || !link) continue;

    items.push({
      id: hash(`${channelTitle}|${title}|${link}`),
      category,
      source: source || channelTitle,
      title: trimTitle(title),
      url: link,
      published: pubDate || null,
      ts: parseDate(pubDate),
      summary
    });
  }

  return items;
}

async function fetchRedditItems(cfg, { timeoutMs = 9000 } = {}) {
  const { category, source, url } = cfg;
  const r = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": "EdgeHeadlines/1.0 (+Cloudflare Pages)",
      "Accept": "application/json"
    }
  }, timeoutMs);

  if (!r.ok) return [];
  const data = await r.json();

  const children = data?.data?.children || [];
  const out = [];

  for (const c of children) {
    const p = c?.data;
    if (!p) continue;
    if (p.stickied) continue;

    // Prefer external URLs; for self posts use reddit permalink
    const link = p.url || ("https://www.reddit.com" + p.permalink);
    const title = String(p.title || "").trim();
    if (!title || !link) continue;

    const summary =
      p.selftext
        ? cleanSummary(p.selftext)
        : (p.domain ? `From ${p.domain}.` : "Summary unavailable.");

    out.push({
      id: hash(`reddit|${source}|${p.id}`),
      category,
      source,
      title: trimTitle(title),
      url: link,
      published: p.created_utc ? new Date(p.created_utc * 1000).toISOString() : null,
      ts: p.created_utc ? Math.floor(p.created_utc * 1000) : Date.now(),
      summary
    });
  }

  return out;
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort("timeout"), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

function dedupeByUrl(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = canonicalUrl(it.url);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function canonicalUrl(u) {
  try {
    const x = new URL(u);
    // drop common tracking
    ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","fbclid","gclid"].forEach(k => x.searchParams.delete(k));
    x.hash = "";
    return x.toString();
  } catch {
    return String(u || "").trim();
  }
}

function parseDate(s) {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function trimTitle(s) {
  return String(s || "").replace(/\s+/g, " ").trim().slice(0, 140);
}

function cleanSummary(s) {
  const raw = String(s || "");
  // Strip HTML
  const text = raw
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "Summary unavailable.";
  // “2–4 sentences” style without AI: take first ~240 chars, cut at sentence boundary if possible
  const clipped = text.slice(0, 260);
  const cut = clipped.lastIndexOf(". ");
  return (cut > 80 ? clipped.slice(0, cut + 1) : clipped).trim();
}

function pickFirst(str, re) {
  const m = re.exec(str);
  return m ? m[1] : "";
}

function decodeHtml(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/");
}

function hash(s) {
  // Tiny stable hash (FNV-1a-ish)
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    }
  });
}
