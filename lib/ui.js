// Small DOM helpers shared by the demos: sliders with typed values, toggle groups, typed
// expressions with live previews and automatic parameter sliders, the experiments drawer, and
// state kept in the URL so that an instructor can link to a particular set-up.

import { tryParse, identifierMathML } from './expr.js';
import { renderMath } from './mathml.js';

/** document.createElement with properties, attributes ('data-*', 'aria-*') and children. */
export function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k.includes('-') || k === 'for' || k === 'role') e.setAttribute(k, v);
    else e[k] = v;
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Format a number compactly for a readout. */
export function fmt(v, digits = 3) {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) return v.toExponential(digits - 1).replace('e+', 'e');
  return String(+v.toPrecision(digits));
}

let sliderCount = 0;

/**
 * A slider with a label and a number box that stay in step.
 *   opts: label (text, or a MathML string when labelHTML is true), min, max, step, value,
 *         log (logarithmic track), onInput(value), title
 * Returns the element, with .value (get/set) and .setRange(min, max).
 */
export function slider(opts) {
  const id = `s${++sliderCount}`;
  const { min, max, log = false } = opts;
  let lo = min, hi = max;
  const STEPS = 1000;
  const range = el('input', { type: 'range', id, min: 0, max: STEPS, step: 1, title: opts.title });
  const box = el('input', { type: 'number', step: opts.step ?? 'any', 'aria-label': opts.label });
  const label = el('label', { for: id, title: opts.title });
  if (opts.labelHTML) label.innerHTML = opts.label; else label.textContent = opts.label;
  const wrap = el('div', { class: 'slider' }, label, range, box);
  let value = opts.value;

  const toPos = (v) => {
    if (log) return Math.round((Math.log(v / lo) / Math.log(hi / lo)) * STEPS);
    return Math.round(((v - lo) / (hi - lo)) * STEPS);
  };
  const fromPos = (p) => {
    let v = log ? lo * Math.pow(hi / lo, p / STEPS) : lo + ((hi - lo) * p) / STEPS;
    if (opts.step && !log) v = Math.round(v / opts.step) * opts.step;
    return +v.toPrecision(6);
  };
  const show = () => {
    range.value = Math.max(0, Math.min(STEPS, toPos(value)));
    box.value = +(+value).toPrecision(5);
  };
  range.addEventListener('input', () => {
    value = fromPos(+range.value);
    box.value = +value.toPrecision(5);
    opts.onInput?.(value);
  });
  box.addEventListener('change', () => {
    const v = parseFloat(box.value);
    if (!Number.isFinite(v) || (log && v <= 0)) { show(); return; }
    value = v;
    // Typed values may go outside the track: widen it.
    if (v < lo) lo = log ? v : v; if (v > hi) hi = v;
    show();
    opts.onInput?.(value);
  });
  show();
  Object.defineProperty(wrap, 'value', {
    get: () => value,
    set: (v) => { value = v; show(); },
  });
  wrap.setRange = (a, b) => { lo = a; hi = b; show(); };
  wrap.input = range;
  return wrap;
}

/**
 * A row of mutually exclusive buttons.  items: [{value, label, title, html}].
 * Returns the element with .value (get/set).
 */
export function segmented(items, value, onChange, opts = {}) {
  const wrap = el('div', { class: 'seg', role: 'group', 'aria-label': opts.label });
  const buttons = items.map((it) => {
    const b = el('button', { type: 'button', title: it.title || '', 'aria-pressed': String(it.value === value), class: it.class });
    if (it.html) b.innerHTML = it.html; else b.textContent = it.label;
    b.addEventListener('click', () => { set(it.value); onChange?.(it.value); });
    wrap.append(b);
    return b;
  });
  function set(v) {
    value = v;
    items.forEach((it, i) => buttons[i].setAttribute('aria-pressed', String(it.value === v)));
  }
  Object.defineProperty(wrap, 'value', { get: () => value, set });
  return wrap;
}

/** A toggle button (aria-pressed).  Returns the button with .on (get/set). */
export function toggle(label, on, onChange, title = '') {
  const b = el('button', { type: 'button', title, 'aria-pressed': String(!!on) });
  if (label.startsWith('<')) b.innerHTML = label; else b.textContent = label;
  b.addEventListener('click', () => { set(!on); onChange?.(on); });
  function set(v) { on = !!v; b.setAttribute('aria-pressed', String(on)); }
  Object.defineProperty(b, 'on', { get: () => on, set });
  return b;
}

/** Sensible slider ranges for a parameter, guessed from its name. */
export function guessRange(name, hints = {}) {
  if (hints[name]) return hints[name];
  const L = hints.L ?? 10;
  if (/^(x|y)0$/.test(name) || /^(x|y)c$/.test(name) || name === 'b') return { min: -L, max: L, value: 0 };
  if (/^(sigma|s|w|width|a|L|d|R|r0|b0)\d*$/.test(name)) return { min: 0.05 * L, max: L, value: 0.1 * L };
  if (/^(p|k|kx|ky|p0|k0)\d*$/.test(name)) return { min: -10, max: 10, value: 2 };
  if (/^(V|U|E|A|F|g|lambda|alpha|beta)\d*$/.test(name)) return { min: 0, max: 20, value: 5 };
  if (/^(omega|w0|f|nu)\d*$/.test(name)) return { min: 0, max: 5, value: 1 };
  if (/^(n|m)\d*$/.test(name)) return { min: 0, max: 10, value: 1, step: 1 };
  if (/^(phi|phase|theta|delta)\d*$/.test(name)) return { min: -Math.PI, max: Math.PI, value: 0 };
  return { min: -10, max: 10, value: 1 };
}

/**
 * A typed expression: an input, a MathML preview of what was understood, an error line, and a
 * slider for every free parameter (kept, with its value, as long as the name is used).
 *   opts: label (HTML), value, variables, onChange(expr, params) called on every valid change
 *         and every parameter move; hints: { name: {min, max, value, step} }; reserved: names
 *         that are supplied by the demo (no sliders).
 * Returns the element with .set(source, params), .params (current values), .expr.
 */
export function exprField(opts) {
  const input = el('input', { type: 'text', spellcheck: false, autocomplete: 'off', value: opts.value || '' });
  const label = el('label');
  label.innerHTML = opts.label;
  const preview = el('div', { class: 'preview', 'aria-live': 'polite' });
  const error = el('div', { class: 'error' });
  const paramsBox = el('div', { class: 'params' });
  const wrap = el('div', { class: 'expr' }, el('div', { class: 'line' }, label, input), preview, error, paramsBox);
  const sliders = new Map();
  const values = { ...(opts.params || {}) };
  let current = null;

  function sync(fire = true) {
    const r = tryParse(input.value, { variables: opts.variables || ['x'] });
    if (r.error) {
      input.classList.add('bad');
      error.textContent = r.error + (r.pos !== undefined ? ` (at character ${r.pos + 1})` : '');
      return;
    }
    input.classList.remove('bad');
    error.textContent = '';
    current = r.expr;
    preview.innerHTML = (opts.prefix || '') + current.mathml();
    const wanted = current.parameters.filter((p) => !(opts.reserved || []).includes(p));
    for (const [name, s] of sliders) if (!wanted.includes(name)) { s.remove(); sliders.delete(name); }
    for (const name of wanted) {
      if (sliders.has(name)) continue;
      const g = guessRange(name, opts.hints || {});
      if (values[name] === undefined) values[name] = g.value;
      const lo = Math.min(g.min, values[name]), hi = Math.max(g.max, values[name]);
      const s = slider({
        label: `<math>${identifierMathML(name)}</math>`, labelHTML: true, min: lo, max: hi,
        step: g.step, value: values[name],
        onInput: (v) => { values[name] = v; opts.onChange?.(current, paramValues()); },
      });
      sliders.set(name, s);
    }
    // Keep the sliders in the order the names appear.
    for (const name of wanted) paramsBox.append(sliders.get(name));
    if (fire) opts.onChange?.(current, paramValues());
  }
  function paramValues() {
    const out = {};
    for (const name of sliders.keys()) out[name] = values[name];
    return out;
  }
  let timer = 0;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(sync, 150); });
  input.addEventListener('change', () => { clearTimeout(timer); sync(); });

  wrap.set = (source, params = {}, fire = true) => {
    input.value = source;
    for (const [k, v] of Object.entries(params)) {
      values[k] = v;
      if (sliders.has(k)) { sliders.get(k).remove(); sliders.delete(k); }
    }
    sync(fire);
  };
  wrap.setParam = (name, v, fire = true) => {
    values[name] = v;
    if (sliders.has(name)) sliders.get(name).value = v;
    if (fire && current) opts.onChange?.(current, paramValues());
  };
  Object.defineProperty(wrap, 'expr', { get: () => current });
  Object.defineProperty(wrap, 'params', { get: paramValues });
  Object.defineProperty(wrap, 'source', { get: () => input.value });
  wrap.input = input;
  sync(false);
  return wrap;
}

/**
 * The experiments drawer.  Every <article class="exp" data-setup="name"> inside it gets a
 * "Set it up" button that calls setups[name]().  Math in $...$ is rendered.
 */
export function drawer(drawerEl, openButton, setups = {}) {
  renderMath(drawerEl);
  const close = el('button', { type: 'button', class: 'icon', title: 'Close', 'aria-label': 'Close' }, '✕');
  const header = drawerEl.querySelector('header');
  header?.append(close);
  const setOpen = (open) => {
    drawerEl.classList.toggle('open', open);
    openButton?.setAttribute('aria-expanded', String(open));
  };
  close.addEventListener('click', () => setOpen(false));
  openButton?.addEventListener('click', () => setOpen(!drawerEl.classList.contains('open')));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
  for (const art of drawerEl.querySelectorAll('.exp[data-setup]')) {
    const name = art.dataset.setup;
    const b = el('button', { type: 'button', class: 'primary setup' }, 'Set it up');
    b.addEventListener('click', () => {
      setups[name]?.();
      if (window.matchMedia('(max-width: 900px)').matches) setOpen(false);
    });
    const h = art.querySelector('h3');
    (h ? h.nextSibling : art.firstChild) ? art.insertBefore(b, h ? h.nextSibling : art.firstChild) : art.append(b);
  }
  return { open: () => setOpen(true), close: () => setOpen(false) };
}

let toastTimer = 0;
/** A short message at the bottom of the window. */
export function toast(text, ms = 2500) {
  let t = $('.toast');
  if (!t) { t = el('div', { class: 'toast', role: 'status' }); document.body.append(t); }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ------------------------------------------------------------------- state in the URL

/** Read the URL hash as a plain object of strings: #a=1&b=x%5E2 -> {a: '1', b: 'x^2'}. */
export function readHash() {
  const out = {};
  const h = location.hash.replace(/^#/, '');
  if (!h) return out;
  for (const [k, v] of new URLSearchParams(h)) out[k] = v;
  return out;
}

/** Write an object into the hash without adding a history entry. */
export function writeHash(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  history.replaceState(null, '', s ? `#${s}` : location.pathname + location.search);
}

/** Copy text to the clipboard, falling back to a prompt. */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { window.prompt('Copy this:', text); return false; }
}
