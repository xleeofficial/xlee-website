// XLEE contact form backend — Cloudflare Worker (staging only).
// Required secrets: BREVO_API_KEY, TURNSTILE_SECRET_KEY.
// Required variables: TURNSTILE_SITE_HOSTNAME (e.g. staging hostname), CONTACT_TO_EMAIL.
// Never expose BREVO_API_KEY to browser code or logs.
const MAX_BYTES = 8192;
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin");
    const allowed = ["https://xlee.uk", "https://www.xlee.uk"];
    const cors = { "access-control-allow-origin": allowed.includes(origin) ? origin : "null", "vary": "Origin" };\n    const respond = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    if (request.method === "OPTIONS") return allowed.includes(origin) ? new Response(null, { status: 204, headers: { ...cors, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" } }) : json({ error: "forbidden" }, 403);
    if (request.method !== "POST" || new URL(request.url).pathname !== "/api/contact") return respond({ error: "not_found" }, 404);
    if (!allowed.includes(origin)) return respond({ error: "forbidden" }, 403);
    if (!env.BREVO_API_KEY || !env.TURNSTILE_SECRET_KEY || !env.CONTACT_TO_EMAIL || !env.TURNSTILE_SITE_HOSTNAME) return respond({ error: "unavailable" }, 503);
    if (!request.headers.get("content-type")?.startsWith("application/json")) return respond({ error: "invalid_request" }, 415);
    if (Number(request.headers.get("content-length")) > MAX_BYTES) return respond({ error: "too_large" }, 413);
    let raw;
    try { raw = await request.text(); if (new TextEncoder().encode(raw).length > MAX_BYTES) return respond({ error: "too_large" }, 413); }
    catch { return respond({ error: "invalid_request" }, 400); }
    let body;
    try { body = JSON.parse(raw); } catch { return respond({ error: "invalid_request" }, 400); }
    const { name, email, message, turnstileToken } = body || {};
    if (typeof name !== "string" || name.trim().length < 2 || name.length > 100 ||
        typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        typeof message !== "string" || message.trim().length < 10 || message.length > 3000 ||
        typeof turnstileToken !== "string" || turnstileToken.length > 2048) return respond({ error: "invalid_fields" }, 400);
    try {
      const form = new FormData();
      form.set("secret", env.TURNSTILE_SECRET_KEY);
      form.set("response", turnstileToken);
      const ip = request.headers.get("CF-Connecting-IP");
      if (ip) form.set("remoteip", ip);
      const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
      if (!verification.ok) return respond({ error: "verification_unavailable" }, 503);
      const verdict = await verification.json();
      if (!verdict.success || verdict.hostname !== env.TURNSTILE_SITE_HOSTNAME || verdict.action !== "contact") return respond({ error: "verification_failed" }, 403);
      const sent = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({
          sender: { name: "XLEE Website", email: "xlee@xlee.uk" },
          to: [{ email: env.CONTACT_TO_EMAIL }],
          replyTo: { email, name: name.trim() },
          subject: "New XLEE website contact",
          textContent: "Name: " + name.trim() + "\nEmail: " + email + "\n\n" + message.trim()
        })
      });
      return sent.ok ? json({ ok: true }) : json({ error: "send_failed" }, 502);
    } catch { return respond({ error: "unavailable" }, 503); }
  }
};
