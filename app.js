import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const config = window.JUSA_CONFIG || {};
const ready = config.supabaseUrl && config.supabaseAnonKey && !config.supabaseUrl.includes('PEGAR_AQUI');
const $ = (selector) => document.querySelector(selector);
const inviteHash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
const inviteQuery = new URLSearchParams(window.location.search);
const state = { client: null, user: null, membership: null, business: null, settings: null, garments: [], registerMode: false, inviteFlow: inviteHash.get('type') === 'invite' || inviteQuery.get('type') === 'invite', settingsTimer: null, garmentTimers: new Map() };

const GENERIC_ERROR = 'Ocurrió un error. Intentá nuevamente.';
const NETWORK_ERROR = 'No pudimos conectar con el servidor. Revisá tu conexión e intentá de nuevo.';

const formatPYG = (value) => `${Math.round(Number(value) || 0).toLocaleString('es-PY')} PYG`;
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const setStatus = (text = '', kind = '') => { const el = $('#app-status'); if (!el) return; el.textContent = text; el.className = `status ${kind}`; };
const show = (selector) => $(selector).classList.remove('hidden');
const hide = (selector) => $(selector).classList.add('hidden');

function messageFrom(error, fallback = GENERIC_ERROR) {
  console.error(error);
  if (error instanceof TypeError || /fetch/i.test(error?.message || '')) return NETWORK_ERROR;
  return error?.message || fallback;
}

function formError(selector, text = '') {
  const el = $(selector);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('hidden', !text);
}

function authError(text = '') {
  formError('#auth-error', text);
}

function fatalError(text) {
  const el = $('#fatal-error');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('hidden');
}

function showOnly(view) {
  ['#auth-view', '#onboarding-view', '#invite-accept-view', '#app-view'].forEach(hide);
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
  try {
    const { data: membership, error: membershipError } = await state.client
      .from('memberships')
      .select('business_id, role, businesses(name)')
      .eq('user_id', state.user.id)
      .limit(1)
      .maybeSingle();

    if (membershipError) throw membershipError;
    if (!membership) {
      showOnly('#onboarding-view');
      setStatus();
      return;
    }

    const [settingsResult, garmentsResult] = await Promise.all([
      state.client.from('business_settings').select('*').eq('business_id', membership.business_id).single(),
      state.client.from('garments').select('*').eq('business_id', membership.business_id).order('created_at')
    ]);
    if (settingsResult.error) throw settingsResult.error;
    if (garmentsResult.error) throw garmentsResult.error;
    if (!settingsResult.data) throw new Error('No encontramos la configuración de la boutique.');

    state.membership = membership;
    state.business = Array.isArray(membership.businesses) ? membership.businesses[0] : membership.businesses;
    state.settings = settingsResult.data;
    state.garments = garmentsResult.data || [];
    showOnly('#app-view');
    $('#business-label').textContent = state.business?.name || 'Jusa Boutique';
    $('#user-label').textContent = state.user.email;
    $('#role-label').textContent = membership.role === 'admin' ? 'Administradora' : 'Vendedora';
    $('#team-card').classList.toggle('hidden', membership.role !== 'admin');
    renderSettings();
    renderGarments();
    if (membership.role === 'admin') await loadInvitations();
    setStatus('Todo está sincronizado.', 'success');
  } catch (error) {
    setStatus(messageFrom(error, 'No pudimos cargar el inventario compartido.'), 'error');
  }
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
  state.settingsTimer = setTimeout(() => { void saveSettings(); }, 550);
}

async function saveSettings() {
  const values = currentSettings();
  try {
    const { error } = await state.client.from('business_settings').update(values).eq('business_id', state.membership.business_id);
    if (error) throw error;
    state.settings = { ...state.settings, ...values };
    setStatus('Cambios guardados.', 'success');
  } catch (error) {
    setStatus(messageFrom(error, 'No pudimos guardar los cambios.'), 'error');
  }
}

function queueGarmentSave(id) {
  calculate();
  clearTimeout(state.garmentTimers.get(id));
  state.garmentTimers.set(id, setTimeout(() => { void saveGarment(id); }, 550));
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
  try {
    const { data, error } = await state.client.from('garments').update(payload).eq('id', id).select().single();
    if (error) throw error;
    state.garments = state.garments.map((item) => item.id === id ? data : item);
    setStatus('Prenda actualizada.', 'success');
  } catch (error) {
    setStatus(messageFrom(error, 'No pudimos guardar la prenda.'), 'error');
  }
}

async function addGarment() {
  try {
    const { data, error } = await state.client.from('garments').insert({
      business_id: state.membership.business_id, name: 'Nueva prenda', quantity: 1, price_brl: 0, profit_percentage: 100, updated_by: state.user.id
    }).select().single();
    if (error) throw error;
    state.garments.push(data);
    renderGarments();
    document.querySelector(`#garment-rows tr[data-id="${data.id}"] [data-field="name"]`)?.focus();
    setStatus('Prenda agregada.', 'success');
  } catch (error) {
    setStatus(messageFrom(error, 'No pudimos agregar la prenda.'), 'error');
  }
}

async function deleteGarment(id) {
  if (!window.confirm('¿Eliminar esta prenda del inventario compartido?')) return;
  try {
    const { error } = await state.client.from('garments').delete().eq('id', id);
    if (error) throw error;
    state.garments = state.garments.filter((item) => item.id !== id);
    renderGarments();
    setStatus('Prenda eliminada.', 'success');
  } catch (error) {
    setStatus(messageFrom(error, 'No pudimos eliminar la prenda.'), 'error');
  }
}

async function createBusiness(event) {
  event.preventDefault();
  const name = $('#business-name').value.trim();
  formError('#business-error');
  try {
    const { error } = await state.client.rpc('create_business', { business_name: name });
    if (error) throw error;
  } catch (error) {
    formError('#business-error', messageFrom(error, 'No pudimos crear la boutique.'));
    return;
  }
  await refreshWorkspace();
}

function setInviteStatus(text = '', kind = '') {
  const status = $('#invite-status');
  if (!status) return;
  status.textContent = text;
  status.className = `status ${kind}`;
}

async function loadInvitations() {
  try {
    const { data, error } = await state.client.from('invitations').select('id, email, role, created_at').eq('business_id', state.membership.business_id).order('created_at');
    if (error) throw error;
    const list = $('#invite-list'); list.replaceChildren();
    (data || []).forEach((invite) => { const item = document.createElement('li'); item.textContent = `${invite.email} · ${invite.role === 'admin' ? 'Administradora' : 'Vendedora'} (pendiente)`; list.append(item); });
  } catch (error) {
    setInviteStatus(messageFrom(error, 'No pudimos cargar las invitaciones.'), 'error');
  }
}

async function createInvitation(event) {
  event.preventDefault();
  const email = $('#invite-email').value.trim().toLowerCase();
  const role = $('#invite-role').value;
  setInviteStatus();
  let outcome;
  try {
    const { data, error } = await state.client.rpc('invite_member', { target_business_id: state.membership.business_id, target_email: email, target_role: role });
    if (error) throw error;
    outcome = data;
  } catch (error) {
    setInviteStatus(messageFrom(error, 'No pudimos preparar la invitación.'), 'error');
    return;
  }
  $('#invite-form').reset();
  setInviteStatus(outcome === 'joined'
    ? `${email} ya tenía una cuenta y ahora tiene acceso al inventario.`
    : `Invitación preparada para ${email}. Avisale que cree su cuenta con ese correo.`, 'success');
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
  let url;
  try {
    url = URL.createObjectURL(new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `JusaBoutique_${new Date().toISOString().slice(0, 10)}.csv`; link.click();
  } catch (error) {
    setStatus(messageFrom(error, 'No pudimos generar el archivo CSV.'), 'error');
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

async function handleAuth(event) {
  event.preventDefault(); authError();
  const email = $('#email').value.trim(); const password = $('#password').value;
  try {
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
  } catch (error) {
    authError(messageFrom(error, 'No pudimos completar el acceso.'));
  }
}

async function signOut() {
  try {
    const { error } = await state.client.auth.signOut();
    if (error) throw error;
  } catch (error) {
    setStatus(messageFrom(error, 'No pudimos cerrar la sesión.'), 'error');
  }
}

async function completeInvitation(event) {
  event.preventDefault();
  const password = $('#invite-password').value;
  const confirmation = $('#invite-password-confirm').value;
  formError('#invite-accept-error');
  if (password.length < 8) { formError('#invite-accept-error', 'La contraseña debe tener al menos 8 caracteres.'); return; }
  if (password !== confirmation) { formError('#invite-accept-error', 'Las contraseñas no coinciden.'); return; }
  try {
    const { error } = await state.client.auth.updateUser({ password });
    if (error) throw error;
  } catch (error) {
    formError('#invite-accept-error', messageFrom(error, 'No pudimos guardar la contraseña.'));
    return;
  }
  state.inviteFlow = false;
  history.replaceState({}, document.title, window.location.pathname);
  await refreshWorkspace();
}

async function initialize() {
  if (!ready) { show('#setup-warning'); return; }
  state.client = createClient(config.supabaseUrl, config.supabaseAnonKey);
  $('#auth-form').addEventListener('submit', (event) => { void handleAuth(event); });
  $('#auth-toggle').addEventListener('click', () => setAuthMode(!state.registerMode));
  $('#business-form').addEventListener('submit', (event) => { void createBusiness(event); });
  $('#invite-accept-form').addEventListener('submit', (event) => { void completeInvitation(event); });
  $('#onboarding-password').addEventListener('click', () => showOnly('#invite-accept-view'));
  $('#onboarding-logout').addEventListener('click', () => { void signOut(); });
  $('#logout-button').addEventListener('click', () => { void signOut(); });
  $('#add-garment').addEventListener('click', () => { void addGarment(); });
  $('#export-button').addEventListener('click', exportCsv);
  $('#print-button').addEventListener('click', () => window.print());
  $('#invite-form').addEventListener('submit', (event) => { void createInvitation(event); });
  ['#cotizacion', '#pasajes', '#viaticos', '#flete', '#profit-mode', '#allocation-method'].forEach((selector) => {
    $(selector).addEventListener('input', queueSettingsSave);
    $(selector).addEventListener('change', queueSettingsSave);
  });
  $('#profit-mode').addEventListener('change', updateProfitInputLimits);
  state.client.auth.onAuthStateChange((_event, session) => {
    state.user = session?.user || null;
    if (state.user && state.inviteFlow) showOnly('#invite-accept-view');
    else if (state.user) void refreshWorkspace();
    else showOnly('#auth-view');
  });
  const { data, error: sessionError } = await state.client.auth.getSession();
  if (sessionError) throw sessionError;
  const session = data?.session;
  state.user = session?.user || null;
  if (state.user && state.inviteFlow) showOnly('#invite-accept-view');
  else if (state.user) await refreshWorkspace();
  else { showOnly('#auth-view'); setAuthMode(false); }
}

window.addEventListener('unhandledrejection', (event) => {
  setStatus(messageFrom(event.reason, GENERIC_ERROR), 'error');
});

initialize().catch((error) => {
  fatalError(messageFrom(error, 'No pudimos iniciar la aplicación. Recargá la página e intentá de nuevo.'));
});
