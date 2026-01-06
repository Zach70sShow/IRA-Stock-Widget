export async function onRequestGet(ctx) {
  // Just reuse /api/weather so we don't hit upstream twice.
  const url = new URL(ctx.request.url);
  const weatherUrl = new URL(url.origin + "/api/weather");
  const r = await fetch(weatherUrl.toString(), { cf: { cacheTtl: 60, cacheEverything: true } });
  const data = await r.json().catch(() => null);

  if (!data?.ok) {
    return json({ ok:false, error: data?.error || "Weather unavailable" }, 200, { "Cache-Control":"no-store" });
  }

  return json({
    ok: true,
    city: "Phoenix",
    tempF: data.now?.tempF ?? null,
    windMph: data.now?.windMph ?? null,
    aqi: data.aqi?.value ?? null,
    aqiLabel: data.aqi?.label ?? null,
    updatedAt: data.updatedAt
  }, 200, { "Cache-Control":"public, max-age=0" });
}

function json(obj, status=200, headers={}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type":"application/json; charset=utf-8", ...headers }
  });
}
