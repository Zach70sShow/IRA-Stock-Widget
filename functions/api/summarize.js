export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const target = u.searchParams.get("url");
  const title  = u.searchParams.get("title") || "";
  const source = u.searchParams.get("source") || "";

  if (!target) return json({ ok:false, error:"Missing ?url=" }, 400);
  if (!env.OPENAI_API_KEY) return json({ ok:false, error:"Missing OPENAI_API_KEY env var" }, 500);

  // Fetch article (best-effort; some sites block)
  let html = "";
  try {
    const r = await fetch(target, {
      headers: {
        "User-Agent": "EdgeHeadlines/1.0 (+Cloudflare Pages)",
        "Accept": "text/html,application/xhtml+xml",
      }
    });
    if (!r.ok) throw new Error(String(r.status));
    html = await r.text();
  } catch {
    // fall back: summarize only title/source if fetch fails
    return summarizeOpenAI(env, {
      title, source,
      text: ""
    });
  }

  const text = extractText(html).slice(0, 6500);

  return summarizeOpenAI(env, { title, source, text });
}

function extractText(html) {
  return String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|br|li|h1|h2|h3|h4)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function summarizeOpenAI(env, { title, source, text }) {
  const prompt = [
    "Summarize this news item in 2–4 sentences.",
    "Neutral tone. Concrete details only. No hype.",
    "If the full article text is missing/blocked, say so briefly and summarize from the title.",
    "",
    `Source: ${source}`,
    `Title: ${title}`,
    "",
    text ? `Article text:\n${text}` : "Article text: (not available)"
  ].join("\n");

  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-5",
        input: prompt
      })
    });

    if (!r.ok) return json({ ok:false, error:`OpenAI error ${r.status}` }, 502);

    const data = await r.json();
    const summary =
      data.output_text ||
      data?.output?.[0]?.content?.map(c => c.text).filter(Boolean).join("\n") ||
      "";

    return json({
      ok: true,
      summary: String(summary || "").trim() || "No summary returned."
    }, 200, {
      // Cache summaries for 6 hours at the edge
      "cache-control": "s-maxage=21600, stale-while-revalidate=86400"
    });
  } catch {
    return json({ ok:false, error:"OpenAI request failed" }, 502);
  }
}

function json(obj, status=200, extraHeaders={}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });
}
