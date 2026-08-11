import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const config = window.JUSA_CONFIG || {};
const ready = config.supabaseUrl && config.supabaseAnonKey && !config.supabaseUrl.includes('PEGAR_AQUI');
const $ = (selector) => document.querySelector(selector);
const state = { client: null, user: null, membership: null, business: null, settings: null, garments: [], registerMode: false, settingsTimer: null, garmentTimers: new Map() };

const formatPYG = (value) => `${Math.round(Number(value) || 0).toLocaleString('es-PY')} PYG`;
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const setStatus = (text = '', kind = '') => { const el = $('#app-status'); el.textContent = text; el.className = `status ${kind}`; };
const show = (selector) => $(selector).classList.remove('hidden');
const hide = (selector) => $(selector).classList.add('hidden');

function messageFrom(error, fallback = 'Ocurrió un error. Intentá nuevamente.') {
  console.error(error);
  return error?.message || fallback;
}

function authError(text = '') {
  const el = $('#auth-error');
  el.textContent = text;
  el.classList.toggle('hidden', !text);
}

function showOnly(view) {
  ['#auth-view', '#onboarding-view', '#app-view'].forEach(hide);
  show(view);
}

function setAuthMode(registerMode) {
  state.registerMode = registerMode;
  document.querySelectorAll('.register-only').forEach((el) => el.classList.toggle('hidden', !registerMode));
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
    setStatus(messageFrom(membershipError), 'error');
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
    setStatus(messageFrom(settingsResult.error || garmentsResult.error), 'error');
    return;
  }
  state.settings = settingsResult.data;
  state.garments = garmentsResult.data;
  showOnly('#app-view');
  $('#business-label').textContent = state.business?.name || 'Jusa Boutique';
  $('#user-label').textContent = state.user.email;
  $('#role-label').textContent = membership.role === 'admin' ? 'Administradora' : 'Vendedora';
  $('#team-card').classList.toggle('hidden', membership.role !== 'admin');
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
  const rate = Math.max(0, number($('#cotizacion').value));
  const travel = Math.max(0, number($('#pasajes').value)) + Math.max(0, number($('#viaticos').value)) + Math.max(0, number($('#flete').value));
  const garmentData = [...document.querySelectorAll('#garment-rows tr')].map((row) => ({
    row,
    quantity: Math.max(0, number(row.querySelector('[data-field="quantity"]').value)),
    price: Math.max(0, number(row.querySelector('[data-field="price_brl"]').value)),
    profit: Math.max(0, number(row.querySelector('[data-field="profit_percentage"]').value))
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
    item.row.querySelector('[data-output="purchase"]').textContent = formatPYG(purchase);
    item.row.querySelector('[data-output="travel"]').textContent = formatPYG(travelPerItem);
    item.row.querySelector('[data-output="real"]').textContent = formatPYG(realCost);
    item.row.querySelector('[data-output="sale"]').textContent = formatPYG(sale);
  });
  $('#total-expenses').textContent = formatPYG(travel);
  $('#total-units').textContent = `${totalUnits.toLocaleString('es-PY')} un.`;
  $('#total-purchase').textContent = formatPYG(totalPurchase);
  $('#total-profit').textContent = formatPYG(totalProfit);
}

function inputFor(field, value, attributes = '') {
  const input = document.createElement('input');
  input.dataset.field = field;
  input.value = value;
  input.setAttribute('aria-label', field);
  Object.entries(attributes).forEach(([key, attrValue]) => input.setAttribute(key, attrValue));
  return input;
}

function renderGarments() {
  const body = $('#garment-rows');
  body.replaceChildren();
  state.garments.forEach((garment) => {
    const row = document.createElement('tr');
    row.dataset.id = garment.id;
    const cells = [document.createElement('td'), document.createElement('td'), document.createElement('td')];
    cells[0].append(inputFor('name', garment.name, { type: 'text', maxlength: '160' }));
    cells[1].append(inputFor('quantity', garment.quantity, { type: 'number', min: '0.01', step: '0.01' }));
    cells[2].append(inputFor('price_brl', garment.price_brl, { type: 'number', min: '0', step: '0.01' }));
    cells.forEach((cell) => row.append(cell));
    ['purchase', 'travel', 'real'].forEach((output) => { const cell = document.createElement('td'); const span = document.createElement('span'); span.dataset.output = output; span.className = 'money'; cell.append(span); row.append(cell); });
    const profitCell = document.createElement('td');
    profitCell.append(inputFor('profit_percentage', garment.profit_percentage, { type: 'number', min: '0', step: '0.01' }));
    row.append(profitCell);
    const saleCell = document.createElement('td'); const sale = document.createElement('span'); sale.dataset.output = 'sale'; sale.className = 'money'; saleCell.append(sale); row.append(saleCell);
    const deleteCell = document.createElement('td'); const del = document.createElement('button'); del.type = 'button'; del.className = 'delete'; del.textContent = '×'; del.ariaLabel = `Eliminar ${garment.name}`; del.addEventListener('click', () => deleteGarment(garment.id)); deleteCell.append(del); row.append(deleteCell);
    row.querySelectorAll('input').forEach((input) => input.addEventListener('input', () => queueGarmentSave(garment.id)));
    body.append(row);
  });
  updateProfitInputLimits();
  calculate();
}

function updateProfitInputLimits() {
  const max = $('#profit-mode').value === 'margin' ? '99.99' : '999.99';
  document.querySelectorAll('[data-field="profit_percentage"]').forEach((input) => input.max = max);
}

function currentSettings() {
  return {
    cotizacion: Math.max(0, number($('#cotizacion').value)),
    pasajes: Math.max(0, number($('#pasajes').value)),
    viaticos: Math.max(0, number($('#viaticos').value)),
    flete: Math.max(0, number($('#flete').value)),
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
  if (error) setStatus(messageFrom(error), 'error');
  else { state.settings = { ...state.settings, ...values }; setStatus('Cambios guardados.', 'success'); }
}

function queueGarmentSave(id) {
  calculate();
  clearTimeout(state.garmentTimers.get(id));
  state.garmentTimers.set(id, setTimeout(() => saveGarment(id), 550));
}

async function saveGarment(id) {
  const row = document.querySelector(`#garment-rows tr[data-id="${id}"]`);
  if (!row) return;
  const payload = {};
  row.querySelectorAll('[data-field]').forEach((input) => { payload[input.dataset.field] = input.dataset.field === 'name' ? input.value.trim() : number(input.value); });
  if (!payload.name) { setStatus('Cada prenda necesita un nombre.', 'error'); return; }
  if (payload.quantity <= 0 || payload.price_brl < 0 || payload.profit_percentage < 0 || ($('#profit-mode').value === 'margin' && payload.profit_percentage >= 100)) {
    setStatus('Revisá cantidad, costos y porcentaje de ganancia.', 'error'); return;
  }
  const { data, error } = await state.client.from('garments').update(payload).eq('id', id).select().single();
  if (error) { setStatus(messageFrom(error), 'error'); return; }
  state.garments = state.garments.map((item) => item.id === id ? data : item);
  setStatus('Prenda actualizada.', 'success');
}

async function addGarment() {
  const { data, error } = await state.client.from('garments').insert({
    business_id: state.membership.business_id, name: 'Nueva prenda', quantity: 1, price_brl: 0, profit_percentage: 100, updated_by: state.user.id
  }).select().single();
  if (error) { setStatus(messageFrom(error), 'error'); return; }
  state.garments.push(data);
  renderGarments();
  document.querySelector(`#garment-rows tr[data-id="${data.id}"] [data-field="name"]`)?.focus();
  setStatus('Prenda agregada.', 'success');
}

async function deleteGarment(id) {
  if (!window.confirm('¿Eliminar esta prenda del inventario compartido?')) return;
  const { error } = await state.client.from('garments').delete().eq('id', id);
  if (error) { setStatus(messageFrom(error), 'error'); return; }
  state.garments = state.garments.filter((item) => item.id !== id);
  renderGarments();
  setStatus('Prenda eliminada.', 'success');
}

async function createBusiness(event) {
  event.preventDefault();
  const name = $('#business-name').value.trim();
  const errorEl = $('#business-error');
  errorEl.classList.add('hidden');
  const { error } = await state.client.rpc('create_business', { business_name: name });
  if (error) { errorEl.textContent = messageFrom(error); errorEl.classList.remove('hidden'); return; }
  await refreshWorkspace();
}

async function loadInvitations() {
  const { data, error } = await state.client.from('invitations').select('id, email, role, created_at').eq('business_id', state.membership.business_id).order('created_at');
  if (error) { $('#invite-status').textContent = messageFrom(error); return; }
  const list = $('#invite-list'); list.replaceChildren();
  data.forEach((invite) => { const item = document.createElement('li'); item.textContent = `${invite.email} · ${invite.role === 'admin' ? 'Administradora' : 'Vendedora'} (pendiente)`; list.append(item); });
}

async function createInvitation(event) {
  event.preventDefault();
  const email = $('#invite-email').value.trim().toLowerCase();
  const role = $('#invite-role').value;
  const status = $('#invite-status'); status.className = 'status'; status.textContent = '';
  const { error } = await state.client.from('invitations').insert({ business_id: state.membership.business_id, email, role, created_by: state.user.id });
  if (error) { status.textContent = messageFrom(error); status.classList.add('error'); return; }
  $('#invite-form').reset();
  status.textContent = `Invitación preparada para ${email}. Avisale que cree su cuenta con ese correo.`;
  status.classList.add('success');
  await loadInvitations();
}

function exportCsv() {
  const rows = [...document.querySelectorAll('#garment-rows tr')];
  const escape = (value) => {
    let text = String(value ?? '');
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const lines = [
    'sep=;', 'JUSA BOUTIQUE - REPORTE DE CALCULADORA',
    `Fecha;${new Date().toLocaleDateString('es-PY')}`,
    `Cotización BRL/PYG;${$('#cotizacion').value}`, `Pasajes;${$('#pasajes').value}`, `Viáticos;${$('#viaticos').value}`, `Fletes;${$('#flete').value}`, '',
    'Prenda;Cantidad;Precio BRL;Compra PYG;Viaje PYG;Costo Real;Ganancia %;Precio Venta'
  ];
  rows.forEach((row) => lines.push([
    escape(row.querySelector('[data-field="name"]').value), row.querySelector('[data-field="quantity"]').value, row.querySelector('[data-field="price_brl"]').value,
    row.querySelector('[data-output="purchase"]').textContent.replace(/\D/g, ''), row.querySelector('[data-output="travel"]').textContent.replace(/\D/g, ''), row.querySelector('[data-output="real"]').textContent.replace(/\D/g, ''), row.querySelector('[data-field="profit_percentage"]').value, row.querySelector('[data-output="sale"]').textContent.replace(/\D/g, '')
  ].join(';')));
  const url = URL.createObjectURL(new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `JusaBoutique_${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
}

async function handleAuth(event) {
  event.preventDefault(); authError();
  const email = $('#email').value.trim(); const password = $('#password').value;
  let result;
  if (state.registerMode) {
    const fullName = $('#full-name').value.trim();
    result = await state.client.auth.signUp({ email, password, options: { data: { full_name: fullName }, emailRedirectTo: window.location.origin } });
    if (!result.error && !result.data.session) authError('Revisá tu correo para confirmar la cuenta antes de ingresar.');
  } else result = await state.client.auth.signInWithPassword({ email, password });
  if (result.error) authError(messageFrom(result.error));
}

async function initialize() {
  if (!ready) { show('#setup-warning'); return; }
  state.client = createClient(config.supabaseUrl, config.supabaseAnonKey);
  $('#auth-form').addEventListener('submit', handleAuth);
  $('#auth-toggle').addEventListener('click', () => setAuthMode(!state.registerMode));
  $('#business-form').addEventListener('submit', createBusiness);
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
  state.client.auth.onAuthStateChange((_event, session) => {
    state.user = session?.user || null;
    if (state.user) refreshWorkspace(); else showOnly('#auth-view');
  });
  const { data: { session } } = await state.client.auth.getSession();
  state.user = session?.user || null;
  if (state.user) await refreshWorkspace(); else { showOnly('#auth-view'); setAuthMode(false); }
}

initialize();
