function parseRss(xml, max=10) {
  const out = [];
  const itemMatches = xml.split("<item>").slice(1);
  for (const chunk of itemMatches) {
    const t = chunk.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/i);
    const titleRaw = (t?.[1] || t?.[2] || "").trim();
    if (!titleRaw) continue;

    let title = titleRaw, source = "Google News";
    const parts = titleRaw.split(" - ");
    if (parts.length >= 2) {
      title = parts.slice(0, -1).join(" - ").trim();
      source = parts[parts.length - 1].trim() || source;
    }

    out.push({ title, source, when: "" });
    if (out.length >= max) break;
  }
  return out;
}

export async function onRequestGet() {
  const feeds = [
    // US headlines
    "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en",
    // World headlines
    "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en&topic=WORLD",
    // Business/markets-ish
    "https://news.google.com/rss/search?q=" + encodeURIComponent("marketplace business marketing music") + "&hl=en-US&gl=US&ceid=US:en"
  ];

  const results = await Promise.all(feeds.map(u => fetch(u, { headers: { "user-agent": "Mozilla/5.0" } }).then(r => r.ok ? r.text() : "")));
  const items = results.flatMap(txt => txt ? parseRss(txt, 6) : []);

  // De-dupe by title
  const seen = new Set();
  const uniq = [];
  for (const it of items) {
    const key = it.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(it);
    if (uniq.length >= 5) break;
  }

  return Response.json({ items: uniq });
}
