// Utilidades compartidas de formato, DOM y CSV usadas por la aplicación.

export const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export const positive = (value) => Math.max(0, number(value));
export const digitsOnly = (text) => String(text ?? '').replace(/\D/g, '');
export const formatPYG = (value) => `${Math.round(number(value)).toLocaleString('es-PY')} PYG`;
export const formatUnits = (value) => `${number(value).toLocaleString('es-PY')} un.`;
export const roleLabel = (role) => role === 'admin' ? 'Administradora' : 'Vendedora';

export const $ = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const element = (target) => typeof target === 'string' ? $(target) : target;

export const show = (target) => element(target).classList.remove('hidden');
export const hide = (target) => element(target).classList.add('hidden');
export const toggleHidden = (target, hidden) => element(target).classList.toggle('hidden', hidden);

export function messageFrom(error, fallback = 'Ocurrió un error. Intentá nuevamente.') {
  console.error(error);
  return error?.message || fallback;
}

// Mensajes de error dentro de un formulario: se ocultan cuando el texto está vacío.
export function setError(target, text = '') {
  const el = element(target);
  el.textContent = text;
  el.classList.toggle('hidden', !text);
}

// Estados con estilo (`status`, `status success`, `status error`).
export function setStatusText(target, text = '', kind = '') {
  const el = element(target);
  el.textContent = text;
  el.className = `status ${kind}`.trim();
}

export function createElement(tag, { className = '', text = '', dataset = {}, attributes = {}, ariaLabel = '' } = {}) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  if (ariaLabel) el.setAttribute('aria-label', ariaLabel);
  Object.entries(dataset).forEach(([key, value]) => { el.dataset[key] = value; });
  Object.entries(attributes).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
}

export const cellWith = (...children) => {
  const cell = document.createElement('td');
  cell.append(...children);
  return cell;
};

export const fieldInput = (row, field) => $(`[data-field="${field}"]`, row);
export const fieldValue = (row, field) => fieldInput(row, field).value;
export const fieldNumber = (row, field) => positive(fieldValue(row, field));
export const outputCell = (row, name) => $(`[data-output="${name}"]`, row);
export const setOutput = (row, name, text) => { outputCell(row, name).textContent = text; };
export const outputDigits = (row, name) => digitsOnly(outputCell(row, name).textContent);

// Evita que Excel interprete el nombre de una prenda como fórmula.
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function downloadFile(filename, contents, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = createElement('a', { attributes: { href: url, download: filename } });
  link.click();
  URL.revokeObjectURL(url);
}
