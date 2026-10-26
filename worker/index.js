const ALLOWED_ORIGINS = new Set(["https://xlee.uk", "https://www.xlee.uk"]);
const MAX_URL_LENGTH = 2048;
const MAX_HTML_BYTES = 1_500_000;
const TIMEOUT_MS = 12_000;
const MAX_REQUEST_BYTES = 4096;
const TURNSTILE_TIMEOUT_MS = 5000;

function json(data, status = 200, origin = "") {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "vary": "Origin" };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-methods"] = "POST, OPTIONS";
    headers["access-control-allow-headers"] = "Content-Type";
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function validatePublicUrl(raw) {
  if (typeof raw !== "string" || raw.length > MAX_URL_LENGTH) throw new Error("Enter a valid public URL.");
  let url;
  try { url = new URL(raw); } catch { throw new Error("Enter a valid URL."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only HTTP and HTTPS URLs are supported.");
  if (url.username || url.password) throw new Error("URLs containing credentials are not allowed.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host.includes(".") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".test") || host.endsWith(".invalid") || host.endsWith(".onion") || host.endsWith(".example")) throw new Error("Use a public website hostname.");
  // Reject IP literals, including IPv6 literals. Public-domain DNS resolution is still enforced by the Worker network.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || /^0x[0-9a-f]+$/i.test(host)) throw new Error("IP-address URLs are not allowed; use a public domain.");
  if (!/^[a-z0-9.-]+$/.test(host) || host.startsWith(".") || host.endsWith(".") || host.includes("..")) throw new Error("Use a valid public hostname.");
  url.hash = "";
  return url;
}

async function fetchPublicHtml(initialUrl, env) {
  // Fail closed: direct arbitrary-host fetches are disabled. The trusted egress proxy
  // must resolve DNS and block private/reserved IPs on every redirect hop.
  if (!env.SAFE_FETCH_PROXY_URL || !env.SAFE_FETCH_PROXY_TOKEN) {
    throw new Error("Secure page-fetch service is not configured yet.");
  }
  let proxyUrl;
  try { proxyUrl = new URL(env.SAFE_FETCH_PROXY_URL); } catch { throw new Error("Secure page-fetch service configuration is invalid."); }
  if (proxyUrl.protocol !== "https:" || proxyUrl.username || proxyUrl.password) {
    throw new Error("Secure page-fetch service must use HTTPS and contain no URL credentials.");
  }
  validatePublicUrl(initialUrl.href);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(proxyUrl.href, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer " + env.SAFE_FETCH_PROXY_TOKEN,
        "accept": "application/json"
      },
      body: JSON.stringify({ url: initialUrl.href, maxBytes: MAX_HTML_BYTES, maxRedirects: 3, timeoutMs: TIMEOUT_MS })
    });
    if (!response.ok) throw new Error("Secure page-fetch service returned HTTP " + response.status + ".");
    const type = (response.headers.get("content-type") || "").toLowerCase();
    if (type.split(";")[0].trim() !== "application/json") throw new Error("Secure page-fetch service returned an unexpected response type.");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Secure page-fetch service returned an empty response.");
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_HTML_BYTES + 8192) { await reader.cancel(); throw new Error("Secure page-fetch response is too large."); }
        chunks.push(value);
      }
    } finally { try { reader.releaseLock(); } catch {} }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let result;
    try { result = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("Secure page-fetch service returned invalid JSON."); }
    if (typeof result.html !== "string" || result.html.length > MAX_HTML_BYTES || typeof result.finalUrl !== "string" || !Number.isInteger(result.status)) {
      throw new Error("Secure page-fetch service returned an invalid page payload.");
    }
    const finalUrl = validatePublicUrl(result.finalUrl);
    if (result.status < 200 || result.status >= 300) throw new Error("The target page returned HTTP " + result.status + ".");
    return { html: result.html, finalUrl: finalUrl.href, status: result.status };
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(value) {
  const decodeCodePoint = raw => {
    const codePoint = Number(raw);
    return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff &&
      !(codePoint >= 0xd800 && codePoint <= 0xdfff)
      ? String.fromCodePoint(codePoint)
      : "\\uFFFD";
  };
  return value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(\\d+);/g, (_, n) => decodeCodePoint(n))
    .replace(/&#x([\\da-f]+);/gi, (_, n) => decodeCodePoint(parseInt(n, 16)));
}
function tagText(html, tag) {
  const match = html.match(new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)<\\/" + tag + "\\s*>", "i"));
  return match ? decodeEntities(match[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()) : "";
}
function metaContent(html, name) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const n = tag.match(/\bname\s*=\s*["']?([^\s"'/>]+)/i);
    const p = tag.match(/\bproperty\s*=\s*["']?([^\s"'/>]+)/i);
    const c = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (c && ((n && n[1].toLowerCase() === name.toLowerCase()) || (p && p[1].toLowerCase() === name.toLowerCase()))) return decodeEntities(c[1] ?? c[2] ?? c[3] ?? "").trim();
  }
  return "";
}
function inspectHtml(html, finalUrl) {
  const title = tagText(html, "title");
  const description = metaContent(html, "description");
  const viewport = metaContent(html, "viewport");
  const canonical = (html.match(/<link\b[^>]*\brel\s*=\s*["']?canonical["']?[^>]*>/i) || [""])[0];
  const canonicalHref = (canonical.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i) || []).slice(1).find(Boolean) || "";
  const h1s = (html.match(/<h1\b[^>]*>/gi) || []).length;
  const images = html.match(/<img\b[^>]*>/gi) || [];
  const missingAlt = images.filter(tag => !/\balt\s*=/.test(tag)).length;
  const jsonLd = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["']/i.test(html);
  const robots = metaContent(html, "robots");
  const issues = [];
  const add = (id, priority, status, titleAr, titleEn, detailAr, detailEn, nextAr, nextEn) => issues.push({ id, priority, status, title: { ar: titleAr, en: titleEn }, detail: { ar: detailAr, en: detailEn }, nextStep: { ar: nextAr, en: nextEn } });
  if (!title) add("title-missing", "high", "verified", "عنوان الصفحة غير موجود", "Page title is missing", "لم يتم العثور على عنصر title في HTML المسترجع.", "No title element was found in the retrieved HTML.", "أضف عنوانًا فريدًا يصف المنتج بدقة.", "Add a unique title that accurately describes the product.");
  else if (title.length < 20 || title.length > 65) add("title-length", "medium", "verified", "راجع طول عنوان الصفحة", "Review page title length", "طول العنوان " + title.length + " حرفًا؛ هذا تنبيه إرشادي وليس قاعدة ترتيب ثابتة.", "The title is " + title.length + " characters; this is guidance, not a fixed ranking rule.", "اجعل العنوان واضحًا ومميزًا، ثم راجع ظهوره في نتائج البحث.", "Make the title clear and distinct, then review how it appears in search.");
  if (!description) add("description-missing", "medium", "verified", "الوصف التعريفي غير موجود", "Meta description is missing", "لم يتم العثور على meta description في HTML المسترجع.", "No meta description was found in the retrieved HTML.", "اكتب وصفًا موجزًا وفريدًا يلخص المنتج وفائدته.", "Write a concise, unique description summarizing the product and its value.");
  if (!viewport) add("viewport-missing", "high", "verified", "إعداد عرض الجوال غير موجود", "Mobile viewport setting is missing", "لم يتم العثور على meta viewport.", "No meta viewport tag was found.", "أضف إعداد viewport المناسب واختبر الصفحة على شاشة صغيرة.", "Add an appropriate viewport tag and test on a small screen.");
  if (h1s === 0) add("h1-missing", "medium", "verified", "العنوان الرئيسي H1 غير موجود", "Main H1 heading is missing", "لم يتم العثور على عنوان H1 في HTML المسترجع.", "No H1 heading was found in the retrieved HTML.", "أضف عنوانًا رئيسيًا واضحًا للمنتج.", "Add a clear main heading for the product.");
  else if (h1s > 1) add("h1-multiple", "low", "verified", "توجد عدة عناوين H1", "Multiple H1 headings found", "تم العثور على " + h1s + " عناصر H1؛ قد يكون ذلك مقصودًا حسب بنية الصفحة.", h1s + " H1 elements were found; this may be intentional depending on page structure.", "راجع تسلسل العناوين للتأكد من أنه يعكس بنية المحتوى.", "Review heading hierarchy to ensure it reflects the content structure.");
  if (missingAlt > 0) add("image-alt", "medium", "verified", "صور بلا نص بديل", "Images missing alt attributes", "عدد الصور التي لا تحتوي على سمة alt: " + missingAlt + ".", "Images without an alt attribute: " + missingAlt + ".", "أضف نصًا بديلًا وصفيًا للصور المهمة، واستخدم alt فارغًا للصور الزخرفية.", "Add descriptive alt text to meaningful images and empty alt for decorative images.");
  if (!jsonLd) add("structured-data", "low", "verified", "لم يُعثر على بيانات منظمة JSON-LD", "No JSON-LD structured data found", "لم يتم العثور على script من نوع application/ld+json؛ قد توجد بيانات منظمة بصيغ أخرى.", "No application/ld+json script was found; structured data may exist in other formats.", "تحقق من أهلية بيانات Product المنظمة وصحتها باستخدام أداة اختبار مناسبة.", "Check Product structured data eligibility and validity with a suitable testing tool.");
  if (/\bnoindex\b/i.test(robots)) add("noindex", "high", "verified", "وسم robots يتضمن noindex", "Robots meta includes noindex", "قد يمنع هذا الوسم فهرسة الصفحة إذا لم يكن مقصودًا.", "This directive may prevent indexing if unintended.", "تأكد من أن توجيه noindex مقصود لهذه الصفحة.", "Confirm that the noindex directive is intentional for this page.");
  if (canonicalHref) { try { new URL(canonicalHref, finalUrl); } catch { add("canonical-invalid", "medium", "verified", "رابط canonical يبدو غير صالح", "Canonical URL appears invalid", "قيمة canonical لا تبدو كرابط صالح.", "The canonical value does not appear to be a valid URL.", "راجع رابط canonical وتأكد أنه يشير إلى النسخة المفضلة من الصفحة.", "Review the canonical URL and ensure it points to the preferred page version."); } }
  if (!issues.length) add("baseline", "low", "verified", "لم تظهر مشكلات أساسية في الفحص السريع", "No basic issues surfaced in this quick check", "هذا الفحص محدود ولا يثبت خلو الصفحة من المشكلات.", "This limited check does not prove the page is issue-free.", "أجرِ اختبار أداء وتجربة استخدام أعمق قبل اتخاذ قرارات نهائية.", "Run deeper performance and usability tests before making final decisions.");
  const rank = { high: 0, medium: 1, low: 2 };
  issues.sort((a,b)=>rank[a.priority]-rank[b.priority]);
  return { page: { url: finalUrl, title, description, h1Count: h1s, imageCount: images.length }, checks: { viewport: !!viewport, title: !!title, description: !!description, h1Count: h1s, imagesMissingAlt: missingAlt, jsonLdFound: jsonLd, noindex: /\bnoindex\b/i.test(robots) }, issues, note: { ar: "فحص HTML أولي فقط؛ لا يمثل تدقيقًا شاملًا أو ضمانًا لترتيب البحث أو المبيعات.", en: "Preliminary HTML check only; not a comprehensive audit or a guarantee of search rankings or sales." } };
}


async function verifyTurnstile(token, request, secret, expectedAction) {
  if (!secret || typeof expectedAction !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(expectedAction)) {
    throw new Error("Anti-bot verification is temporarily unavailable.");
  }
  if (typeof token !== "string" || token.length < 10 || token.length > 2048) throw new Error("Complete the anti-bot verification and try again.");
  const form = new FormData();
  form.set("secret", secret);
  form.set("response", token);
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.set("remoteip", ip);
  let response;
  try {
    response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", body: form, signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS)
    });
  } catch {
    throw new Error("Anti-bot verification is temporarily unavailable.");
  }
  if (!response.ok) throw new Error("Anti-bot verification is temporarily unavailable.");
  let result;
  try { result = await response.json(); }
  catch { throw new Error("Anti-bot verification is temporarily unavailable."); }
  if (!result || result.success !== true) throw new Error("Anti-bot verification failed. Refresh the challenge and try again.");
  if (typeof result.hostname !== "string" || !ALLOWED_ORIGINS.has("https://" + result.hostname.toLowerCase())) {
    throw new Error("Anti-bot verification failed. Refresh the challenge and try again.");
  }
  if (result.action !== expectedAction) {
    throw new Error("Anti-bot verification failed. Refresh the challenge and try again.");
  }
}
async function readJsonLimited(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_REQUEST_BYTES) throw new Error("Request body too large.");
  if (!request.body) throw new Error("Request body is empty.");
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) { await reader.cancel(); throw new Error("Request body too large."); }
      chunks.push(value);
    }
  } finally { try { reader.releaseLock(); } catch {} }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error("Invalid JSON body."); }
}

async function runPageSpeed(url, key) {
  if (!key) return { available: false, reason: "PAGESPEED_API_KEY is not configured" };
  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("strategy", "mobile");
  endpoint.searchParams.set("category", "performance");
  endpoint.searchParams.set("key", key);
  let response;
  try { response = await fetch(endpoint.href, { signal: AbortSignal.timeout(25_000) }); }
  catch { return { available: false, reason: "PageSpeed service temporarily unavailable" }; }
  if (!response.ok) return { available: false, reason: "PageSpeed service temporarily unavailable" };
  let text;
  try {
    const reader = response.body?.getReader();
    if (!reader) return { available: false, reason: "PageSpeed service returned an invalid response" };
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 1_000_000) { await reader.cancel(); return { available: false, reason: "PageSpeed response exceeded the size limit" }; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    text = new TextDecoder().decode(bytes);
  } catch { return { available: false, reason: "PageSpeed service returned an invalid response" }; }
  let data;
  try { data = JSON.parse(text); } catch { return { available: false, reason: "PageSpeed service returned an invalid response" }; }
  const audits = data?.lighthouseResult?.audits || {};
  const score = data?.lighthouseResult?.categories?.performance?.score;
  const boundedText = (value, max) => typeof value === "string" ? value.slice(0, max) : "";
  const pick = id => {
    const audit = audits[id];
    if (!audit || typeof audit !== "object") return null;
    return {
      title: boundedText(audit.title, 160),
      displayValue: boundedText(audit.displayValue, 120),
      score: Number.isFinite(audit.score) ? audit.score : null,
      numericValue: Number.isFinite(audit.numericValue) ? audit.numericValue : null
    };
  };
  return { available: true, strategy: "mobile", score: typeof score === "number" ? Math.round(score * 100) : null, metrics: { lcp: pick("largest-contentful-paint"), cls: pick("cumulative-layout-shift"), inp: pick("interaction-to-next-paint"), fcp: pick("first-contentful-paint"), tbt: pick("total-blocking-time"), speedIndex: pick("speed-index") }, fetchedAt: new Date().toISOString() };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      if (!ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403, headers: { "vary": "Origin" } });
      return new Response(null, { status: 204, headers: {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "Content-Type",
        "access-control-max-age": "86400",
        "vary": "Origin"
      } });
    }
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET") return json({ ok: true, service: "xlee-lens-api", version: "0.1.0" }, 200, origin);
    if (path !== "/api/scan") return json({ error: "Not found" }, 404, origin);
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
    if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "Origin not allowed" }, 403);
    const contentType = request.headers.get("content-type") || "";
    if (contentType.split(";")[0].trim().toLowerCase() !== "application/json") return json({ error: "Content-Type must be application/json" }, 415, origin);
    let body;
    try { body = await readJsonLimited(request); }
    catch (error) { return json({ error: error.message }, /too large/i.test(error.message) ? 413 : 400, origin); }
    try { await verifyTurnstile(body.turnstileToken, request, env.TURNSTILE_SECRET_KEY, env.TURNSTILE_EXPECTED_ACTION); }
    catch (error) { return json({ error: error.message }, 403, origin); }
    let url;
    try { url = validatePublicUrl(body.url); } catch (error) { return json({ error: error.message }, 400, origin); }
    try {
      const page = await fetchPublicHtml(url, env);
      const htmlReport = inspectHtml(page.html, page.finalUrl);
      let performance = { available: false, reason: "PAGESPEED_API_KEY is not configured" };
      try { performance = await runPageSpeed(page.finalUrl, env.PAGESPEED_API_KEY); } catch { performance = { available: false, reason: "PageSpeed service temporarily unavailable" }; }
      return json({ ok: true, generatedAt: new Date().toISOString(), source: "XLEE Lens preliminary scan", report: { ...htmlReport, performance } }, 200, origin);
    } catch (error) {
      // Never return raw upstream/proxy exceptions to callers. Keep user-correctable
      // input errors above this boundary; failures here may contain infrastructure data.
      const timedOut = error?.name === "AbortError" || error?.name === "TimeoutError";
      return json({
        error: timedOut
          ? "The scan timed out. Please try again."
          : "The scan could not be completed. Please try again later."
      }, 422, origin);
    }
  }
};