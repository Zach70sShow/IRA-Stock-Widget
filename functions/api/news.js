export async function onRequestGet() {
  // placeholder until Step 4 (real Google/Marketplace pull)
  return json({
    ok: true,
    items: [
      { title: "Top US headline goes here (placeholder)", source: "—" },
      { title: "Top World headline goes here (placeholder)", source: "—" },
      { title: "Top Business headline goes here (placeholder)", source: "—" },
      { title: "Another headline (placeholder)", source: "—" },
      { title: "Another headline (placeholder)", source: "—" }
    ],
    updatedAt: new Date().toISOString()
  });
}
function json(obj, status=200){
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type":"application/json; charset=utf-8", "cache-control":"no-store" }
  });
}
