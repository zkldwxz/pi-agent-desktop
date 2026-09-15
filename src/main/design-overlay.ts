/**
 * Design-mode overlay, injected into the page as a plain string.
 *
 * Kept dependency-free and self-contained (no imports, no bundler help) because
 * it runs in the target page's world via `executeJavaScript`. It resolves a
 * single pick per invocation, which keeps the host loop trivial: call it, get a
 * pick, decide whether to call it again.
 */
export const DESIGN_OVERLAY_SCRIPT = String.raw`
(() => {
  const NS = "__pi_design__";
  if (window[NS] && window[NS].active) return Promise.resolve(window[NS].pending ?? null);
  window[NS] = { active: true };

  const MAX_TEXT = 240;
  const label = document.createElement("div");
  const box = document.createElement("div");
  const style = document.createElement("style");
  style.textContent = [
    ".pi-design-box{position:fixed;pointer-events:none;z-index:2147483646;border:1px solid #3b82f6;background:rgba(59,130,246,.12);transition:all 60ms linear}",
    ".pi-design-label{position:fixed;pointer-events:none;z-index:2147483647;background:#3b82f6;color:#fff;font:500 12px/1.3 ui-sans-serif,system-ui,sans-serif;padding:4px 8px;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.25);white-space:nowrap;max-width:70vw;overflow:hidden;text-overflow:ellipsis}",
    ".pi-design-label small{display:block;font-weight:400;opacity:.8;font-size:11px}",
    ".pi-design-region{position:fixed;pointer-events:none;z-index:2147483645;border:1px dashed #3b82f6;background:rgba(59,130,246,.08)}",
  ].join("");
  document.documentElement.appendChild(style);
  document.documentElement.appendChild(box);
  document.documentElement.appendChild(label);

  const region = document.createElement("div");
  region.className = "pi-design-region";
  region.style.display = "none";
  document.documentElement.appendChild(region);

  const prevCursor = document.documentElement.style.cursor;
  document.documentElement.style.cursor = "crosshair";

  const cssEscape = (value) => {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (c) => "\\" + c);
  };

  const componentName = (el) => {
    const key = Object.keys(el).find(
      (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"),
    );
    if (!key) return undefined;
    let fiber = el[key];
    let depth = 0;
    while (fiber && depth < 40) {
      const type = fiber.type;
      let name;
      if (typeof type === "function") name = type.displayName || type.name;
      else if (type && typeof type === "object") name = type.displayName || (type.render && type.render.name);
      if (name && /^[A-Z]/.test(name) && name !== "Fragment") return name;
      fiber = fiber.return;
      depth += 1;
    }
    return undefined;
  };

  const classesOf = (el) =>
    (el.getAttribute("class") || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4);

  const selectorFor = (el) => {
    if (el.id) return "#" + cssEscape(el.id);
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
      let part = node.tagName.toLowerCase();
      const testId = node.getAttribute("data-testid");
      if (testId) {
        parts.unshift(part + '[data-testid="' + testId + '"]');
        break;
      }
      const cls = (node.getAttribute("class") || "").split(/\s+/).filter(Boolean)[0];
      if (cls && !/^(css|sc|_)/.test(cls)) part += "." + cssEscape(cls);
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      node = parent;
      depth += 1;
      if (node && (node.id || node === document.body)) break;
    }
    if (node && node !== document.body && node.tagName) parts.unshift(node.tagName.toLowerCase());
    return parts.join(" > ");
  };

  const STYLE_KEYS = [
    "display", "position", "width", "height", "margin", "padding",
    "font-family", "font-size", "font-weight", "line-height", "letter-spacing",
    "color", "background-color", "background-image", "border", "border-radius",
    "box-shadow", "gap", "flex-direction", "align-items", "justify-content", "grid-template-columns", "z-index",
  ];

  const stylesFor = (el) => {
    const computed = getComputedStyle(el);
    const out = {};
    for (const key of STYLE_KEYS) {
      const value = computed.getPropertyValue(key);
      if (value && value !== "none" && value !== "auto" && value !== "normal" && value !== "0px") out[key] = value;
    }
    return out;
  };

  const ancestryFor = (el) => {
    const chain = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 8) {
      chain.unshift({
        tag: node.tagName.toLowerCase(),
        component: componentName(node),
        id: node.id || undefined,
        classes: classesOf(node),
      });
      node = node.parentElement;
      depth += 1;
    }
    return chain;
  };

  const describe = (el) => {
    const rect = el.getBoundingClientRect();
    const component = componentName(el);
    const tag = el.tagName.toLowerCase();
    return {
      selector: selectorFor(el),
      component,
      tag,
      text: (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT) || undefined,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      styles: stylesFor(el),
      ancestry: ancestryFor(el),
      mode: "element",
      page: { url: location.href, title: document.title },
      pickedAt: new Date().toISOString(),
      __label: (component ? component + " · " : "") + tag,
    };
  };

  return new Promise((resolve) => {
    const paint = (target) => {
      const rect = target.getBoundingClientRect();
      box.style.left = rect.left + "px";
      box.style.top = rect.top + "px";
      box.style.width = rect.width + "px";
      box.style.height = rect.height + "px";
      const component = componentName(target);
      const tag = target.tagName.toLowerCase();
      label.innerHTML = "";
      label.appendChild(document.createTextNode((component ? component + " · " : "") + tag));
      const hint = document.createElement("small");
      hint.textContent = "Click to select, drag to draw";
      label.appendChild(hint);
      const above = rect.top > 56;
      label.style.left = Math.max(6, Math.min(rect.left, window.innerWidth - 240)) + "px";
      label.style.top = (above ? rect.top - 46 : rect.bottom + 8) + "px";
    };

    let hovered = null;
    let dragging = false;
    let start = null;
    let finished = false;

    const cleanup = () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("mouseup", onUp, true);
      document.removeEventListener("keydown", onKey, true);
      document.documentElement.style.cursor = prevCursor;
      box.remove();
      label.remove();
      region.remove();
      style.remove();
      window[NS].active = false;
    };

    const onMove = (event) => {
      if (dragging && start) {
        const x = Math.min(start.x, event.clientX);
        const y = Math.min(start.y, event.clientY);
        const w = Math.abs(event.clientX - start.x);
        const h = Math.abs(event.clientY - start.y);
        region.style.display = "block";
        region.style.left = x + "px";
        region.style.top = y + "px";
        region.style.width = w + "px";
        region.style.height = h + "px";
        return;
      }
      const el = document.elementFromPoint(event.clientX, event.clientY);
      if (!el || el === box || el === label || el === region) return;
      hovered = el;
      paint(el);
    };

    const onDown = (event) => {
      if (event.button !== 0) return;
      dragging = true;
      start = { x: event.clientX, y: event.clientY };
      event.preventDefault();
      event.stopPropagation();
    };

    const onUp = (event) => {
      if (!dragging) return;
      dragging = false;
      const x = Math.min(start.x, event.clientX);
      const y = Math.min(start.y, event.clientY);
      const w = Math.abs(event.clientX - start.x);
      const h = Math.abs(event.clientY - start.y);
      event.preventDefault();
      event.stopPropagation();
      if (w < 8 || h < 8) {
        if (!hovered) return;
        const pick = describe(hovered);
        finished = true;
        cleanup();
        resolve(pick);
        return;
      }
      const el = document.elementFromPoint(x + w / 2, y + h / 2) || document.body;
      const pick = describe(el);
      pick.mode = "region";
      pick.rect = { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
      finished = true;
      cleanup();
      resolve(pick);
    };

    const onKey = (event) => {
      if (event.key !== "Escape") return;
      finished = true;
      cleanup();
      resolve(null);
    };

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("mouseup", onUp, true);
    document.addEventListener("keydown", onKey, true);
  });
})();
`;
