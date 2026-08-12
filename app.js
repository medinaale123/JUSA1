import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import {
  $, $$, cellWith, createElement, csvCell, downloadFile, fieldNumber, fieldValue, formatPYG, formatUnits,
  hide, messageFrom, number, outputDigits, positive, roleLabel, setError, setOutput, setStatusText, show, toggleHidden
} from './utils.js';

const config = window.JUSA_CONFIG || {};
const ready = config.supabaseUrl && config.supabaseAnonKey && !config.supabaseUrl.includes('PEGAR_AQUI');
const inviteHash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
const inviteQuery = new URLSearchParams(window.location.search);
const state = { client: null, user: null, membership: null, business: null, settings: null, garments: [], registerMode: false, inviteFlow: inviteHash.get('type') === 'invite' || inviteQuery.get('type') === 'invite', settingsTimer: null, garmentTimers: new Map() };

const setStatus = (text = '', kind = '') => setStatusText('#app-status', text, kind);
const reportError = (error) => setStatus(messageFrom(error), 'error');
const garmentRows = () => $$('#garment-rows tr');
const settingField = (selector) => positive($(selector).value);
const authError = (text = '') => setError('#auth-error', text);

function showOnly(view) {
  ['#auth-view', '#onboarding-view', '#invite-accept-view', '#app-view'].forEach(hide);
  show(view);
}

function setAuthMode(registerMode) {
  state.registerMode = registerMode;
  $$('.register-only').forEach((el) => toggleHidden(el, !registerMode));
  $('#auth-title').textContent = registerMode ? 'Crear cuenta' : 'Calculadora compartida';
  $('#auth-subtitle').textContent = registerMode ? 'Usá el mismo correo al que te invitó la administradora.' : 'Ingresá con tu cuenta del equipo.';
  $('#auth-submit').textContent = registerMode ? 'Crear cuenta' : 'Ingresar';
  $('#auth-toggle').textContent = registerMode ? 'Ya tengo una cuenta' : 'Crear mi cuenta';
  $('#password').autocomplete = registerMode ? 'new-password' : 'current-password';
  authError();
}

async function refreshWorkspace() {
  if (!state.user) return;
  setStatus('Cargando inventario compartido…');
  const { data: membership, error: membershipError } = await state.client
    .from('memberships')
    .select('business_id, role, businesses(name)')
    .eq('user_id', state.user.id)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    reportError(membershipError);
    return;
  }
  if (!membership) {
    showOnly('#onboarding-view');
    return;
  }

  state.membership = membership;
  state.business = Array.isArray(membership.businesses) ? membership.businesses[0] : membership.businesses;
  const [settingsResult, garmentsResult] = await Promise.all([
    state.client.from('business_settings').select('*').eq('business_id', membership.business_id).single(),
    state.client.from('garments').select('*').eq('business_id', membership.business_id).order('created_at')
  ]);
  if (settingsResult.error || garmentsResult.error) {
    reportError(settingsResult.error || garmentsResult.error);
    return;
  }
  state.settings = settingsResult.data;
  state.garments = garmentsResult.data;
  showOnly('#app-view');
  $('#business-label').textContent = state.business?.name || 'Jusa Boutique';
  $('#user-label').textContent = state.user.email;
  $('#role-label').textContent = roleLabel(membership.role);
  toggleHidden('#team-card', membership.role !== 'admin');
  renderSettings();
  renderGarments();
  if (membership.role === 'admin') await loadInvitations();
  setStatus('Todo está sincronizado.', 'success');
}

function renderSettings() {
  const s = state.settings;
  $('#cotizacion').value = s.cotizacion;
  $('#pasajes').value = s.pasajes;
  $('#viaticos').value = s.viaticos;
  $('#flete').value = s.flete;
  $('#profit-mode').value = s.profit_mode;
  $('#allocation-method').value = s.allocation_method;
  updateProfitInputLimits();
  calculate();
}

function calculate() {
  if (!state.settings) return;
  const rate = settingField('#cotizacion');
  const travel = settingField('#pasajes') + settingField('#viaticos') + settingField('#flete');
  const garmentData = garmentRows().map((row) => ({
    row,
    quantity: fieldNumber(row, 'quantity'),
    price: fieldNumber(row, 'price_brl'),
    profit: fieldNumber(row, 'profit_percentage')
  }));
  const totalUnits = garmentData.reduce((sum, item) => sum + item.quantity, 0);
  const totalPurchase = garmentData.reduce((sum, item) => sum + item.quantity * item.price * rate, 0);
  const useMargin = $('#profit-mode').value === 'margin';
  const useValue = $('#allocation-method').value === 'value';
  let totalProfit = 0;

  garmentData.forEach((item) => {
    const purchase = item.price * rate;
    const travelPerItem = useValue && totalPurchase > 0
      ? purchase * (travel / totalPurchase)
      : totalUnits > 0 ? travel / totalUnits : 0;
    const realCost = purchase + travelPerItem;
    const safeProfit = useMargin ? Math.min(item.profit, 99.99) : item.profit;
    const sale = useMargin ? realCost / (1 - safeProfit / 100) : realCost * (1 + safeProfit / 100);
    totalProfit += (sale - realCost) * item.quantity;
    setOutput(item.row, 'purchase', formatPYG(purchase));
    setOutput(item.row, 'travel', formatPYG(travelPerItem));
    setOutput(item.row, 'real', formatPYG(realCost));
    setOutput(item.row, 'sale', formatPYG(sale));
  });
  $('#total-expenses').textContent = formatPYG(travel);
  $('#total-units').textContent = formatUnits(totalUnits);
  $('#total-purchase').textContent = formatPYG(totalPurchase);
  $('#total-profit').textContent = formatPYG(totalProfit);
}

const inputFor = (field, value, attributes = {}) =>
  createElement('input', { dataset: { field }, attributes: { ...attributes, value }, ariaLabel: field });

const outputFor = (name) => createElement('span', { className: 'money', dataset: { output: name } });

function renderGarments() {
  const body = $('#garment-rows');
  body.replaceChildren();
  state.garments.forEach((garment) => {
    const row = createElement('tr', { dataset: { id: garment.id } });
    const del = createElement('button', { className: 'delete', text: '×', attributes: { type: 'button' }, ariaLabel: `Eliminar ${garment.name}` });
    del.addEventListener('click', () => deleteGarment(garment.id));
    row.append(
      cellWith(inputFor('name', garment.name, { type: 'text', maxlength: '160' })),
      cellWith(inputFor('quantity', garment.quantity, { type: 'number', min: '0.01', step: '0.01' })),
      cellWith(inputFor('price_brl', garment.price_brl, { type: 'number', min: '0', step: '0.01' })),
      ...['purchase', 'travel', 'real'].map((output) => cellWith(outputFor(output))),
      cellWith(inputFor('profit_percentage', garment.profit_percentage, { type: 'number', min: '0', step: '0.01' })),
      cellWith(outputFor('sale')),
      cellWith(del)
    );
    $$('input', row).forEach((input) => input.addEventListener('input', () => queueGarmentSave(garment.id)));
    body.append(row);
  });
  updateProfitInputLimits();
  calculate();
}

function updateProfitInputLimits() {
  const max = $('#profit-mode').value === 'margin' ? '99.99' : '999.99';
  $$('[data-field="profit_percentage"]').forEach((input) => input.max = max);
}

function currentSettings() {
  return {
    cotizacion: settingField('#cotizacion'),
    pasajes: settingField('#pasajes'),
    viaticos: settingField('#viaticos'),
    flete: settingField('#flete'),
    profit_mode: $('#profit-mode').value,
    allocation_method: $('#allocation-method').value
  };
}

function queueSettingsSave() {
  calculate();
  clearTimeout(state.settingsTimer);
  state.settingsTimer = setTimeout(saveSettings, 550);
}

async function saveSettings() {
  const values = currentSettings();
  const { error } = await state.client.from('business_settings').update(values).eq('business_id', state.membership.business_id);
  if (error) reportError(error);
  else { state.settings = { ...state.settings, ...values }; setStatus('Cambios guardados.', 'success'); }
}

function queueGarmentSave(id) {
  calculate();
  clearTimeout(state.garmentTimers.get(id));
  state.garmentTimers.set(id, setTimeout(() => saveGarment(id), 550));
}

async function saveGarment(id) {
  const row = $(`#garment-rows tr[data-id="${id}"]`);
  if (!row) return;
  const payload = {};
  $$('[data-field]', row).forEach((input) => { payload[input.dataset.field] = input.dataset.field === 'name' ? input.value.trim() : number(input.value); });
  if (!payload.name) { setStatus('Cada prenda necesita un nombre.', 'error'); return; }
  if (payload.quantity <= 0 || payload.price_brl < 0 || payload.profit_percentage < 0 || ($('#profit-mode').value === 'margin' && payload.profit_percentage >= 100)) {
    setStatus('Revisá cantidad, costos y porcentaje de ganancia.', 'error'); return;
  }
  const { data, error } = await state.client.from('garments').update(payload).eq('id', id).select().single();
  if (error) { reportError(error); return; }
  state.garments = state.garments.map((item) => item.id === id ? data : item);
  setStatus('Prenda actualizada.', 'success');
}

async function addGarment() {
  const { data, error } = await state.client.from('garments').insert({
    business_id: state.membership.business_id, name: 'Nueva prenda', quantity: 1, price_brl: 0, profit_percentage: 100, updated_by: state.user.id
  }).select().single();
  if (error) { reportError(error); return; }
  state.garments.push(data);
  renderGarments();
  $(`#garment-rows tr[data-id="${data.id}"] [data-field="name"]`)?.focus();
  setStatus('Prenda agregada.', 'success');
}

async function deleteGarment(id) {
  if (!window.confirm('¿Eliminar esta prenda del inventario compartido?')) return;
  const { error } = await state.client.from('garments').delete().eq('id', id);
  if (error) { reportError(error); return; }
  state.garments = state.garments.filter((item) => item.id !== id);
  renderGarments();
  setStatus('Prenda eliminada.', 'success');
}

async function createBusiness(event) {
  event.preventDefault();
  const name = $('#business-name').value.trim();
  setError('#business-error');
  const { error } = await state.client.rpc('create_business', { business_name: name });
  if (error) { setError('#business-error', messageFrom(error)); return; }
  await refreshWorkspace();
}

async function loadInvitations() {
  const { data, error } = await state.client.from('invitations').select('id, email, role, created_at').eq('business_id', state.membership.business_id).order('created_at');
  if (error) { setStatusText('#invite-status', messageFrom(error), 'error'); return; }
  const list = $('#invite-list'); list.replaceChildren();
  list.append(...data.map((invite) => createElement('li', { text: `${invite.email} · ${roleLabel(invite.role)} (pendiente)` })));
}

async function createInvitation(event) {
  event.preventDefault();
  const email = $('#invite-email').value.trim().toLowerCase();
  const role = $('#invite-role').value;
  setStatusText('#invite-status');
  const { data, error } = await state.client.rpc('invite_member', { target_business_id: state.membership.business_id, target_email: email, target_role: role });
  if (error) { setStatusText('#invite-status', messageFrom(error), 'error'); return; }
  $('#invite-form').reset();
  setStatusText('#invite-status', data === 'joined'
    ? `${email} ya tenía una cuenta y ahora tiene acceso al inventario.`
    : `Invitación preparada para ${email}. Avisale que cree su cuenta con ese correo.`, 'success');
  await loadInvitations();
}

function exportCsv() {
  const lines = [
    'sep=;', 'JUSA BOUTIQUE - REPORTE DE CALCULADORA',
    `Fecha;${new Date().toLocaleDateString('es-PY')}`,
    `Cotización BRL/PYG;${$('#cotizacion').value}`, `Pasajes;${$('#pasajes').value}`, `Viáticos;${$('#viaticos').value}`, `Fletes;${$('#flete').value}`, '',
    'Prenda;Cantidad;Precio BRL;Compra PYG;Viaje PYG;Costo Real;Ganancia %;Precio Venta'
  ];
  garmentRows().forEach((row) => lines.push([
    csvCell(fieldValue(row, 'name')), fieldValue(row, 'quantity'), fieldValue(row, 'price_brl'),
    outputDigits(row, 'purchase'), outputDigits(row, 'travel'), outputDigits(row, 'real'),
    fieldValue(row, 'profit_percentage'), outputDigits(row, 'sale')
  ].join(';')));
  downloadFile(`JusaBoutique_${new Date().toISOString().slice(0, 10)}.csv`, `\uFEFF${lines.join('\n')}`);
}

async function handleAuth(event) {
  event.preventDefault(); authError();
  const email = $('#email').value.trim(); const password = $('#password').value;
  let result;
  if (state.registerMode) {
    const fullName = $('#full-name').value.trim();
    // Supabase solo admite URLs http(s) aprobadas. Al abrir index.html con
    // doble clic, location.origin es "null" y no debe enviarse como redirect.
    const isWebUrl = ['http:', 'https:'].includes(window.location.protocol);
    const options = { data: { full_name: fullName } };
    if (isWebUrl) options.emailRedirectTo = window.location.origin;
    result = await state.client.auth.signUp({ email, password, options });
    if (!result.error && !result.data.session) authError('Revisá tu correo para confirmar la cuenta antes de ingresar.');
  } else result = await state.client.auth.signInWithPassword({ email, password });
  if (result.error) authError(messageFrom(result.error));
}

async function completeInvitation(event) {
  event.preventDefault();
  const password = $('#invite-password').value;
  const confirmation = $('#invite-password-confirm').value;
  setError('#invite-accept-error');
  if (password.length < 8) { setError('#invite-accept-error', 'La contraseña debe tener al menos 8 caracteres.'); return; }
  if (password !== confirmation) { setError('#invite-accept-error', 'Las contraseñas no coinciden.'); return; }
  const { error } = await state.client.auth.updateUser({ password });
  if (error) { setError('#invite-accept-error', messageFrom(error)); return; }
  state.inviteFlow = false;
  history.replaceState({}, document.title, window.location.pathname);
  await refreshWorkspace();
}

async function applySession(session) {
  state.user = session?.user || null;
  if (state.user && state.inviteFlow) showOnly('#invite-accept-view');
  else if (state.user) await refreshWorkspace();
  else { showOnly('#auth-view'); setAuthMode(false); }
}

async function initialize() {
  if (!ready) { show('#setup-warning'); return; }
  state.client = createClient(config.supabaseUrl, config.supabaseAnonKey);
  $('#auth-form').addEventListener('submit', handleAuth);
  $('#auth-toggle').addEventListener('click', () => setAuthMode(!state.registerMode));
  $('#business-form').addEventListener('submit', createBusiness);
  $('#invite-accept-form').addEventListener('submit', completeInvitation);
  $('#onboarding-password').addEventListener('click', () => showOnly('#invite-accept-view'));
  $('#onboarding-logout').addEventListener('click', () => state.client.auth.signOut());
  $('#logout-button').addEventListener('click', () => state.client.auth.signOut());
  $('#add-garment').addEventListener('click', addGarment);
  $('#export-button').addEventListener('click', exportCsv);
  $('#print-button').addEventListener('click', () => window.print());
  $('#invite-form').addEventListener('submit', createInvitation);
  ['#cotizacion', '#pasajes', '#viaticos', '#flete', '#profit-mode', '#allocation-method'].forEach((selector) => {
    $(selector).addEventListener('input', queueSettingsSave);
    $(selector).addEventListener('change', queueSettingsSave);
  });
  $('#profit-mode').addEventListener('change', updateProfitInputLimits);
  state.client.auth.onAuthStateChange((_event, session) => { applySession(session); });
  const { data: { session } } = await state.client.auth.getSession();
  await applySession(session);
}

initialize();
