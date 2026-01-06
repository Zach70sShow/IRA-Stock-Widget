export async function onRequestGet(ctx) {
  const url = new URL(ctx.request.url);
  const cacheKey = new Request(url.origin + url.pathname + url.search);
  const cache = caches.default;

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    // Google News RSS - Business (US)
    const rss = "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en";
    const xml = await fetch(rss, { cf:{ cacheTtl: 600, cacheEverything:true } }).then(r => r.text());

    const items = parseRSS(xml).slice(0, 8).map(it => ({
      title: it.title,
      source: it.source || it.domain || ""
    }));

    const res = json({ ok:true, items, updatedAt:new Date().toISOString() }, 200, { "Cache-Control":"public, max-age=0" });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;

  } catch (e) {
    return json({ ok:false, error:"News fetch failed (" + (e?.message || e) + ")" }, 200, { "Cache-Control":"no-store" });
  }
}

// Tiny RSS parser (good enough for Google News RSS)
function parseRSS(xml){
  const out = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const title = pick(block, "title");
    const source = pick(block, "source");
    const link = pick(block, "link");
    const domain = safeDomain(link);
    if (title) out.push({ title: decode(title), source: decode(source), domain });
  }
  return out;
}

function pick(block, tag){
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = re.exec(block);
  return m ? m[1].trim() : "";
}

function safeDomain(u){
  try { return new URL(u).hostname.replace(/^www\./,""); } catch { return ""; }
}

function decode(s){
  return (s||"")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'");
}

function json(obj, status=200, headers={}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type":"application/json; charset=utf-8", ...headers }
  });
}
