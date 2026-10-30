const translations = {
  ar: {
    pageTitle: "XLEE — اصنع شيئًا مختلفًا", description: "XLEE — مساحة رقمية للأفكار الإبداعية والتجارب المستقبلية.",
    navAbout:"عن XLEE",navWork:"ماذا نصنع",navContact:"تواصل",navStart:"لنتحدث",
    eyebrow:"استوديو أفكار من المستقبل",heroTitle:"أفكار جريئة.<br><span class=\"gradient-text\">أثر لا يُنسى.</span>",
    heroDesc:"نحوّل الخيال إلى تجارب رقمية نابضة بالحياة. مساحة تبدأ فيها الأفكار غير العادية رحلتها.",
    explore:"اكتشف عالمنا",more:"تعرّف علينا",proof:"فضول بلا حدود. إمكانيات بلا سقف.",cardIdea:"فكرة جديدة",cardStatus:"الإبداع قيد التشغيل",artCaption:"تخيّل ما هو أبعد",scroll:"تابع الاستكشاف",
    aboutLabel:"الفكرة وراء XLEE",aboutTitle:"لسنا هنا لنكرر<br>المألوف<span class=\"accent\">.</span>",aboutDesc:"نؤمن أن أفضل الأشياء تبدأ بسؤال مختلف. XLEE مساحة مفتوحة للتجربة، والتصميم، وصناعة حضور رقمي له شخصية واضحة.",aboutLink:"هل لديك فكرة؟ لنبدأ منها",
    principle1Title:"فضول دائم",principle1Desc:"نطرح الأسئلة ونبحث عن زوايا لم تُكتشف بعد.",principle2Title:"خيال جريء",principle2Desc:"نمنح الأفكار مساحة لتكبر وتتجاوز المتوقع.",principle3Title:"أثر حقيقي",principle3Desc:"نصنع تجارب جميلة، واضحة، وقريبة من الناس.",
    workLabel:"ما الذي نصنعه؟",workTitle:"من شرارة صغيرة<br>إلى <span class=\"gradient-text\">عالم كامل.</span>",workDesc:"كل رحلة مختلفة، لكن البداية دائمًا فكرة تستحق أن ترى النور.",
    work1Title:"تجارب رقمية",work1Desc:"مواقع وواجهات تجمع بين الفكرة والتفاصيل.",work2Title:"أفكار وهوية",work2Desc:"شخصية واضحة تترك انطباعًا.",work3Title:"حركة وتفاعل",work3Desc:"تفاصيل صغيرة تجعل التجربة حيّة.",
    manifestoSmall:"تذكير صغير",manifestoTitle:"المستقبل لا يُنتظر.<br><span class=\"gradient-text\">بل نصنعه.</span>",contactLabel:"لنبدأ شيئًا جديدًا",contactTitle:"لديك فكرة<br>تستحق الانطلاق؟",contactDesc:"أرسل لنا رسالة، ودعنا نرى إلى أين يمكن أن تصل.",footerNote:"صُنع بفضول وقليل من السحر.",backTop:"العودة للأعلى ↑",menuLabel:"فتح القائمة",formName:"الاسم",formEmail:"البريد الإلكتروني",formMessage:"رسالتك",formSend:"إرسال الرسالة",formUnavailable:"النموذج قيد التجهيز؛ يمكنك مراسلتنا عبر البريد أدناه."
  },
  en: {
    pageTitle:"XLEE — Make Something Different",description:"XLEE — a digital space for creative ideas and future-facing experiences.",
    navAbout:"About XLEE",navWork:"What we make",navContact:"Contact",navStart:"Let's talk",
    eyebrow:"A studio for future-minded ideas",heroTitle:"Bold ideas.<br><span class=\"gradient-text\">Lasting impact.</span>",
    heroDesc:"We turn imagination into living digital experiences. A space where unconventional ideas begin their journey.",
    explore:"Explore our world",more:"Get to know us",proof:"Limitless curiosity. Boundless possibility.",cardIdea:"New idea",cardStatus:"Creativity is online",artCaption:"Imagine beyond",scroll:"Keep exploring",
    aboutLabel:"The idea behind XLEE",aboutTitle:"We're not here to<br>repeat the ordinary<span class=\"accent\">.</span>",aboutDesc:"We believe the best things begin with a different question. XLEE is an open space for experimentation, design, and building a digital presence with a distinct personality.",aboutLink:"Have an idea? Let's start there",
    principle1Title:"Always curious",principle1Desc:"We ask questions and look for undiscovered angles.",principle2Title:"Bold imagination",principle2Desc:"We give ideas room to grow beyond expectations.",principle3Title:"Real impact",principle3Desc:"We create beautiful, clear experiences made for people.",
    workLabel:"What do we make?",workTitle:"From a tiny spark<br>to a <span class=\"gradient-text\">whole world.</span>",workDesc:"Every journey is different, but it always begins with an idea worth bringing to life.",
    work1Title:"Digital experiences",work1Desc:"Websites and interfaces where ideas meet detail.",work2Title:"Ideas & identity",work2Desc:"A distinct personality that leaves an impression.",work3Title:"Motion & interaction",work3Desc:"Small details that make an experience feel alive.",
    manifestoSmall:"A little reminder",manifestoTitle:"The future isn't waited for.<br><span class=\"gradient-text\">It's made.</span>",contactLabel:"Let's start something new",contactTitle:"Have an idea<br>ready to take off?",contactDesc:"Send a message and let's see where it could go.",footerNote:"Made with curiosity and a little magic.",backTop:"Back to top ↑",menuLabel:"Open menu",formName:"Name",formEmail:"Email",formMessage:"Message",formSend:"Send message",formUnavailable:"The form is being prepared; please email us below."
  }
};

let currentLang = "ar";
const languageToggle = document.getElementById("languageToggle");
const menuToggle = document.getElementById("menuToggle");
const nav = document.querySelector(".desktop-nav");

function setLanguage(lang) {
  currentLang = lang;
  const isArabic = lang === "ar";
  document.documentElement.lang = lang;
  document.documentElement.dir = isArabic ? "rtl" : "ltr";
  document.body.classList.toggle("lang-en", !isArabic);
  document.title = translations[lang].pageTitle;
  const metaDescription = document.querySelector('meta[name="description"]');
  if (metaDescription) metaDescription.content = translations[lang].description;

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n;
    if (translations[lang][key]) element.textContent = translations[lang][key];
  });
  document.querySelectorAll("[data-i18n-html]").forEach((element) => {
    const key = element.dataset.i18nHtml;
    if (translations[lang][key]) element.innerHTML = translations[lang][key];
  });
  languageToggle.innerHTML = isArabic ? 'EN <span>↗</span>' : 'ع <span>↗</span>';
  languageToggle.setAttribute("aria-label", isArabic ? "Switch to English" : "التبديل إلى العربية");
  menuToggle.setAttribute("aria-label", translations[lang].menuLabel);
  localStorage.setItem("xlee-language", lang);
}

languageToggle.addEventListener("click", () => {
  setLanguage(currentLang === "ar" ? "en" : "ar");
});

menuToggle.addEventListener("click", () => {
  const isOpen = nav.classList.toggle("open");
  menuToggle.setAttribute("aria-expanded", String(isOpen));
});
nav.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    nav.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
  });
});

document.getElementById("year").textContent = new Date().getFullYear();

const revealItems = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver((entries, currentObserver) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        currentObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  revealItems.forEach((item) => observer.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}

try {
  const savedLanguage = localStorage.getItem("xlee-language");
  if (savedLanguage === "en" || savedLanguage === "ar") setLanguage(savedLanguage);
} catch (_) {
  // The site works without local storage; Arabic is the default.
}

// Contact form stays disabled until staging API and Turnstile are configured.
// Configure these PUBLIC values only after backend review; never put secrets here.
const CONTACT_API_URL = "https://xlee-contact-staging.temoswager.workers.dev/api/contact";
const CONTACT_TURNSTILE_SITE_KEY = "0x4AAAAAAFrs1vW4ept7k2EN";
const contactForm = document.getElementById("contactForm");
function initializeContactForm() {
if (!contactForm || !CONTACT_API_URL || !CONTACT_TURNSTILE_SITE_KEY || !window.turnstile) return;
  let token = "";
  window.turnstile.render("#contactTurnstile", {
    sitekey: CONTACT_TURNSTILE_SITE_KEY, action: "contact",
    callback: (value) => { token = value; document.getElementById("contactSubmit").disabled = false; },
    "expired-callback": () => { token = ""; document.getElementById("contactSubmit").disabled = true; }
  });
  contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!contactForm.reportValidity() || !token) return;
    const submit = document.getElementById("contactSubmit");
    const status = document.getElementById("contactStatus");
    submit.disabled = true;
    try {
      const response = await fetch(CONTACT_API_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        name: contactForm.elements.name.value, email: contactForm.elements.email.value,
        message: contactForm.elements.message.value, turnstileToken: token
      }) });
      if (!response.ok) throw new Error("send_failed");
status.textContent = currentLang === "ar" ? "✓ تم إرسال رسالتك بنجاح! شكرًا لتواصلك مع XLEE." : "✓ Your message was sent successfully! Thank you for contacting XLEE.";      contactForm.reset();
    } catch { status.textContent = currentLang === "ar" ? "تعذر الإرسال. استخدم البريد أدناه." : "Could not send. Please use the email below."; }
    finally { token = ""; window.turnstile.reset("#contactTurnstile"); }
  });
}
if (document.readyState === "complete") initializeContactForm();
else window.addEventListener("load", initializeContactForm, { once: true });
