const ALLOWED_ORIGINS = new Set(["https://xlee.uk", "https://www.xlee.uk"]);
const MAX_URL_LENGTH = 2048;
const MAX_HTML_BYTES = 1_500_000;
const TIMEOUT_MS = 12_000;

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
  if (!host.includes(".") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Use a public website hostname.");
  // Reject IP literals, including IPv6 literals. Public-domain DNS resolution is still enforced by the Worker network.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || /^0x[0-9a-f]+$/i.test(host)) throw new Error("IP-address URLs are not allowed; use a public domain.");
  if (!/^[a-z0-9.-]+$/.test(host) || host.startsWith(".") || host.endsWith(".") || host.includes("..")) throw new Error("Use a valid public hostname.");
  url.hash = "";
  return url;
}

async function fetchPublicHtml(initialUrl) {
  let url = initialUrl;
  for (let hop = 0; hop < 4; hop++) {
    validatePublicUrl(url.href);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await fetch(url.href, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "XLEE-Lens/0.1 (+https://xlee.uk)", "accept": "text/html,application/xhtml+xml;q=0.9" }
      });
    } finally { clearTimeout(timer); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || hop === 3) throw new Error("Too many redirects or invalid redirect target.");
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) throw new Error("The target page returned HTTP " + response.status + ".");
    const type = (response.headers.get("content-type") || "").toLowerCase();
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) throw new Error("The URL does not appear to return an HTML page.");
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_HTML_BYTES) throw new Error("The page is too large to inspect safely.");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("The page returned no readable content.");
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_HTML_BYTES) { await reader.cancel(); throw new Error("The page is too large to inspect safely."); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
    return { html: new TextDecoder("utf-8").decode(merged), finalUrl: url.href, status: response.status };
  }
  throw new Error("Could not safely follow the page redirects.");
}

function decodeEntities(value) {
  return value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
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

async function runPageSpeed(url, key) {
  if (!key) return { available: false, reason: "PAGESPEED_API_KEY is not configured" };
  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("strategy", "mobile");
  endpoint.searchParams.set("category", "performance");
  endpoint.searchParams.set("key", key);
  const response = await fetch(endpoint.href, { signal: AbortSignal.timeout(25_000) });
  if (!response.ok) return { available: false, reason: "PageSpeed API returned HTTP " + response.status };
  const data = await response.json();
  const audits = data.lighthouseResult?.audits || {};
  const score = data.lighthouseResult?.categories?.performance?.score;
  const pick = id => { const a = audits[id]; return a ? { title: a.title, displayValue: a.displayValue || "", score: a.score, numericValue: a.numericValue ?? null } : null; };
  return { available: true, strategy: "mobile", score: typeof score === "number" ? Math.round(score * 100) : null, metrics: { lcp: pick("largest-contentful-paint"), cls: pick("cumulative-layout-shift"), inp: pick("interaction-to-next-paint"), fcp: pick("first-contentful-paint"), tbt: pick("total-blocking-time"), speedIndex: pick("speed-index") }, fetchedAt: new Date().toISOString() };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": ALLOWED_ORIGINS.has(origin) ? origin : "null", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "Content-Type", "access-control-max-age": "86400", "vary": "Origin" } });
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET") return json({ ok: true, service: "xlee-lens-api", version: "0.1.0" }, 200, origin);
    if (path !== "/api/scan") return json({ error: "Not found" }, 404, origin);
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
    if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "Origin not allowed" }, 403);
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) return json({ error: "Content-Type must be application/json" }, 415, origin);
    const length = Number(request.headers.get("content-length") || 0);
    if (length > 4096) return json({ error: "Request body too large" }, 413, origin);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400, origin); }
    let url;
    try { url = validatePublicUrl(body.url); } catch (error) { return json({ error: error.message }, 400, origin); }
    try {
      const page = await fetchPublicHtml(url);
      const htmlReport = inspectHtml(page.html, page.finalUrl);
      let performance = { available: false, reason: "PAGESPEED_API_KEY is not configured" };
      try { performance = await runPageSpeed(page.finalUrl, env.PAGESPEED_API_KEY); } catch { performance = { available: false, reason: "PageSpeed service temporarily unavailable" }; }
      return json({ ok: true, generatedAt: new Date().toISOString(), source: "XLEE Lens preliminary scan", report: { ...htmlReport, performance } }, 200, origin);
    } catch (error) {
      const message = error?.name === "AbortError" || error?.name === "TimeoutError" ? "The target page took too long to respond." : error.message || "Scan failed.";
      return json({ error: message }, 422, origin);
    }
  }
};