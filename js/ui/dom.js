// Tiny DOM helpers. Never use innerHTML: all text goes through text nodes.
function apply(el, props) {
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
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
