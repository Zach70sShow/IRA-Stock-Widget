export async function onRequestGet(ctx) {
  const url = new URL(ctx.request.url);
  const cacheKey = new Request(url.origin + url.pathname + url.search);
  const cache = caches.default;

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const cloudflareMs = await ping("https://www.cloudflare.com/cdn-cgi/trace");
    const googleMs     = await ping("https://www.google.com/generate_204");

    const status = (cloudflareMs < 150 && googleMs < 250) ? "Healthy" : "Degraded";
    const detail = (status === "Healthy") ? "All good" : "Higher than usual latency";

    const res = json({ ok:true, cloudflareMs, googleMs, status, detail, updatedAt:new Date().toISOString() }, 200, { "Cache-Control":"public, max-age=0" });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;

  } catch (e) {
    return json({ ok:false, error:"Net check failed (" + (e?.message || e) + ")" }, 200, { "Cache-Control":"no-store" });
  }
}

async function ping(url){
  const t0 = Date.now();
  await fetch(url, { method:"GET", cf:{ cacheTtl: 0, cacheEverything:false } });
  return Date.now() - t0;
}

function json(obj, status=200, headers={}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type":"application/json; charset=utf-8", ...headers }
  });
}
