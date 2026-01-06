export async function onRequestGet({ request }) {
  try {
    const url = new URL(request.url);
    const name = url.searchParams.get("name") || "Phoenix";
    // placeholder values until we wire weather/aqi in step 2
    return json({
      ok: true,
      location: name,
      tempF: 67,
      windMph: 3,
      aqiValue: 64,
      aqiLabel: "Moderate",
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return json({ ok:false, error: String(e?.message ?? e) });
  }
}
function json(obj, status=200){
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type":"application/json; charset=utf-8", "cache-control":"no-store" }
  });
}
