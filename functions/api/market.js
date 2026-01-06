export async function onRequestGet() {
  // placeholder until Step 3 (real market data)
  return json({
    ok: true,
    spy: { price: "487.72", pct: 0.64 },
    vxx: { price: "26.36", pct: 1.17 },
    sectors: [
      { symbol:"XLE", pct: 2.73 },
      { symbol:"XLF", pct: 2.18 },
      { symbol:"XLY", pct: 1.62 },
      { symbol:"XLI", pct: 1.17 },
      { symbol:"XLK", pct: 0.21 },
      { symbol:"XLP", pct: -0.44 }
    ],
    headline: { title:"Corporate earnings season is almost over. Here’s a report card", source:"Marketplace" },
    updatedAt: new Date().toISOString()
  });
}
function json(obj, status=200){
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type":"application/json; charset=utf-8", "cache-control":"no-store" }
  });
}
