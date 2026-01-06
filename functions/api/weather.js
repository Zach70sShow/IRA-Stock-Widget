export async function onRequestGet() {
  // placeholder until Step 2 (real weather + aqi)
  return json({
    ok: true,
    now: {
      tempF: 61,
      windMph: 3,
      rainChancePct: 0,
      sunrise: "07:32 AM",
      sunset: "05:34 PM"
    },
    tomorrow: {
      highF: 70,
      lowF: 48,
      summary: "Clear"
    },
    aqi: { value: 64, label: "Moderate" },
    updatedAt: new Date().toISOString()
  });
}
function json(obj, status=200){
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type":"application/json; charset=utf-8", "cache-control":"no-store" }
  });
}
