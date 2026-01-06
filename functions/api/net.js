async function ping(url) {
  const start = Date.now();
  try {
    const r = await fetch(url, { cf: { cacheTtl: 0 }, headers: { "user-agent": "Mozilla/5.0" } });
    const ms = Date.now() - start;
    return { ok: r.ok, ms };
  } catch {
    return { ok: false, ms: null };
  }
}

export async function onRequestGet() {
  const cf = await ping("https://www.cloudflare.com/cdn-cgi/trace");
  const gg = await ping("https://www.google.com/generate_204");

  const note = (!cf.ok && !gg.ok) ? "Network looks down" :
               (!cf.ok || !gg.ok) ? "One endpoint failing" : "All good";

  return Response.json({
    cloudflareOk: cf.ok,
    cloudflareMs: cf.ms,
    googleOk: gg.ok,
    googleMs: gg.ms,
    note
  });
}
