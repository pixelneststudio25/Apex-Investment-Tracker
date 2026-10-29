// Tiny DOM helpers. Never use innerHTML: all text goes through text nodes.
function apply(el, props) {
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') { for (const [p, val] of Object.entries(v)) el.style.setProperty(p, String(val)); } // CSSOM only: the site's security policy blocks style attributes
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
}
function append(el, kids) { for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid); }

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  apply(el, props); append(el, kids);
  return el;
}
// SVG elements need their own namespace.
export function svg(tag, props = {}, ...kids) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  apply(el, props); append(el, kids);
  return el;
}

/** Replace an element's children, skipping false and null so a `cond && h(...)` never prints the word "false". */
export function fill(el, ...kids) { el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false)); return el; }
