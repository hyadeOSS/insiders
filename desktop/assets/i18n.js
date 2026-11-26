// hyadeOS translations for system apps. See TRANSLATING.md.
//
// Load it at the top of <head>, after the server-made language data:
//   <script src="/desktop/assets/i18n-data.js"></script>
//   <script src="/desktop/assets/i18n.js"></script>
// Then the translations are ready before any other script runs.
//
// English stays written in the pages and is the fallback; other languages live in
// /desktop/assets/locales/<lang>.json as { "key": "translation" }, and are listed in
// /desktop/assets/locales/languages.json ({ "<lang>": "Native name" }).
//  - HTML: data-i18n="key" (text), data-i18n-placeholder / -title / -aria-label (attributes).
//    Elements added later (innerHTML, templates) are translated automatically.
//  - Scripts: hyadeOSI18n.t("key", "English text") or, with values,
//    hyadeOSI18n.t("key", "Hello {name}", { name }).
//  - Dates and numbers: pass hyadeOSI18n.locale to toLocaleString / Intl.
// The language is Settings › General › Language (default English; "auto" follows the computer).

// Rebrand migration (mariowOS -> hyadeOS): this file loads first on every page, so it moves
// browser storage keys saved under the old name (e.g. mariowos_recent_files@<user>) once.
(function () {
  try {
    for (const key of Object.keys(localStorage)) {
      if (!/mariowos/i.test(key)) continue;
      const renamed = key.replace(/mariowos/gi, m => m === m.toUpperCase() ? "HYADEOS" : (m[0] === "M" ? "Hyade" : "hyade") + m.slice(6));
      if (localStorage.getItem(renamed) === null) localStorage.setItem(renamed, localStorage.getItem(key));
      localStorage.removeItem(key);
    }
  } catch (e) { /* storage unavailable: nothing to migrate */ }
})();

// Accessibility (Settings → Accessibility). This file loads first on every hyadeOS page (the desktop,
// every app, Settings, setup), so the choices apply everywhere before anything is drawn, and change
// live in every open window when they are changed (the "storage" event).
// Saved in localStorage "hyadeosA11y": { reduceMotion, reduceTransparency, contrast, colorFilter
// ("none" | "grayscale" | "invert"), textSize (100 | 115 | 130), focusRing, underlineLinks }.
(function () {
  const KEY = "hyadeosA11y";
  const isShell = window.top === window; // the desktop itself (filters go there once, not in every app again)
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; } };
  const CSS = `
    html.a11y-motion *, html.a11y-motion *::before, html.a11y-motion *::after {
      animation-duration: .001ms !important; animation-delay: 0s !important; animation-iteration-count: 1 !important;
      transition-duration: .001ms !important; transition-delay: 0s !important; scroll-behavior: auto !important; }
    html.a11y-solid *, html.a11y-solid *::before, html.a11y-solid *::after { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }
    /* Outranks the desktop's own glass rules (one of them uses an #id), hence the repeated class and the #id in :is(). */
    html.a11y-solid.a11y-solid.a11y-solid.a11y-solid body :is(.popup, .dropdown, .status-bar-bg, .toast, .spotlight-box-wrapper, .browser-menu, .bsb-popover, #a11y-solid) { background-color: rgba(20, 24, 32, 0.97) !important; }
    html.a11y-solid #popup2 { background: var(--bs-solid, #17191e) !important; }
    html.a11y-focus *:focus-visible { outline: 3px solid #ffd60a !important; outline-offset: 2px !important; }
    html.a11y-links a { text-decoration: underline !important; }
  `;
  let style = null;
  function apply() {
    const s = read(), root = document.documentElement;
    if (!style) { style = document.createElement("style"); style.id = "hyadeos-a11y"; style.textContent = CSS; (document.head || root).appendChild(style); }
    root.classList.toggle("a11y-motion", !!s.reduceMotion);
    root.classList.toggle("a11y-solid", !!s.reduceTransparency);
    root.classList.toggle("a11y-focus", !!s.focusRing);
    root.classList.toggle("a11y-links", !!s.underlineLinks);
    // Larger text: apps and pages scale; the desktop shell keeps its own size (window positions are in pixels).
    const size = [115, 130].includes(Number(s.textSize)) ? Number(s.textSize) : 100;
    if (!isShell) root.style.zoom = size === 100 ? "" : String(size / 100);
    // Contrast and colour filters on the desktop only: apps are drawn inside it, so they get them too.
    if (isShell) {
      const filters = [];
      if (s.contrast) filters.push("contrast(1.25)");
      if (s.colorFilter === "grayscale") filters.push("grayscale(1)");
      if (s.colorFilter === "invert") filters.push("invert(1) hue-rotate(180deg)");
      root.style.filter = filters.join(" ");
    }
    pauseMovingWallpapers(!!s.reduceMotion);
  }
  // Reduce motion also tells the page's own scripts (window effects, credits, animations started from
  // code) that motion is reduced: they all ask matchMedia("(prefers-reduced-motion: reduce)").
  const realMatchMedia = window.matchMedia.bind(window);
  window.matchMedia = query => {
    const result = realMatchMedia(query);
    if (!/prefers-reduced-motion:\s*reduce/.test(query) || !read().reduceMotion) return result;
    // MediaQueryList's "matches" can't be overridden, so answer with a stand-in that says "reduce".
    const noop = () => {};
    return { matches: true, media: result.media, onchange: null, addListener: noop, removeListener: noop,
      addEventListener: noop, removeEventListener: noop, dispatchEvent: () => false };
  };
  // Live wallpapers (videos) stop moving while Reduce motion is on.
  function pauseMovingWallpapers(paused) {
    if (!isShell || !document.body) return;
    document.querySelectorAll("#desktop-wallpaper video, .wallpaper video, video.live-wallpaper").forEach(v => {
      if (paused && !v.paused) { v.dataset.a11yPaused = "1"; v.pause(); }
      else if (!paused && v.dataset.a11yPaused) { delete v.dataset.a11yPaused; v.play().catch(() => {}); }
    });
  }
  try { apply(); } catch (e) {}
  document.addEventListener("DOMContentLoaded", () => { try { apply(); } catch (e) {} });
  window.addEventListener("storage", event => { if (event.key === KEY) try { apply(); } catch (e) {} });
  window.hyadeOSA11y = { read, apply, KEY };
})();

(function () {
  const ATTRIBUTES = [["placeholder", "placeholder"], ["title", "title"], ["aria-label", "aria-label"]];
  let languages = { en: "English" };
  let dictionary = {};
  let language = "en";

  // English unless the user picked a language; "auto" (opt-in) follows the computer.
  function resolve(preference) {
    if (preference !== "auto") return Object.hasOwn(languages, preference) ? preference : "en";
    const fromSystem = String(navigator.language || "en").toLowerCase();
    if (Object.hasOwn(languages, fromSystem)) return fromSystem;
    const base = fromSystem.split("-")[0];
    return Object.hasOwn(languages, base) ? base : "en";
  }

  function t(key, fallback, params) {
    let text = dictionary[key] !== undefined ? dictionary[key] : (fallback !== undefined ? fallback : key);
    if (params) text = String(text).replace(/\{(\w+)\}/g, (match, name) => (params[name] !== undefined ? params[name] : match));
    return text;
  }

  function translateElement(element) {
    if (element.dataset.i18n !== undefined) {
      if (element.dataset.i18nSource === undefined) element.dataset.i18nSource = element.textContent;
      const text = t(element.dataset.i18n, element.dataset.i18nSource);
      if (element.textContent !== text) element.textContent = text;
    }
    for (const [name, property] of ATTRIBUTES) {
      const key = element.getAttribute(`data-i18n-${name}`);
      if (key === null) continue;
      const sourceAttribute = `data-i18n-source-${name}`;
      if (!element.hasAttribute(sourceAttribute)) element.setAttribute(sourceAttribute, element.getAttribute(property) || "");
      const text = t(key, element.getAttribute(sourceAttribute));
      if (element.getAttribute(property) !== text) element.setAttribute(property, text);
    }
  }

  const SELECTOR = ["[data-i18n]", ...ATTRIBUTES.map(([name]) => `[data-i18n-${name}]`)].join(",");
  function apply(root = document) {
    if (root.nodeType === 1 && root.matches(SELECTOR)) translateElement(root);
    root.querySelectorAll(SELECTOR).forEach(translateElement);
  }

  function useData(data) {
    languages = { en: "English", ...(data.languages || {}) };
    language = Object.hasOwn(languages, data.language) ? data.language : "en";
    dictionary = language === "en" ? {} : (data.dictionary || {});
    document.documentElement.lang = language;
  }

  // Normally the data is already on the page (i18n-data.js); otherwise fetch it.
  async function fetchData() {
    const data = { preference: "en" };
    try { data.languages = await (await fetch("/desktop/assets/locales/languages.json")).json(); } catch (e) {}
    try { data.preference = (await (await fetch("/get-settings")).json()).language || "en"; } catch (e) {}
    languages = { en: "English", ...(data.languages || {}) };
    data.language = resolve(data.preference);
    if (data.language !== "en") {
      try { data.dictionary = await (await fetch(`/desktop/assets/locales/${data.language}.json`)).json(); } catch (e) {}
    }
    useData(data);
  }

  function start() {
    apply(document);
    // Translate whatever the page adds later.
    new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) if (node.nodeType === 1) apply(node);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  const preloaded = window.__hyadeOSI18nData;
  if (preloaded) useData(preloaded);
  const ready = (preloaded ? Promise.resolve() : fetchData()).then(() => {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
    return language;
  });

  window.hyadeOSI18n = Object.freeze({
    ready,
    t,
    apply,
    get languages() { return { ...languages }; },
    get language() { return language; },
    // For toLocaleString / Intl: the chosen language; undefined in English, so dates and
    // numbers keep the computer's own format as before.
    get locale() { return language === "en" ? undefined : language; }
  });
})();
