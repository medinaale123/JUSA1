import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const config = window.JUSA_CONFIG || {};
const ready = config.supabaseUrl && config.supabaseAnonKey && !config.supabaseUrl.includes('PEGAR_AQUI');
const $ = (selector) => document.querySelector(selector);

const state = { 
  client: null, 
  user: null, 
  membership: null, 
  business: null, 
  settings: null, 
  trips: [], 
  currentTripId: null, 
  currentView: 'calc', // 'calc', 'inventory', 'sold'
  garments: [], 
  registerMode: false, 
  contextTripTarget: null,
  settingsTimer: null, 
  garmentTimers: new Map() 
};

const CATEGORIES = [
  'General', 'Remeras', 'Blusas', 'Jeans', 'Pantalones', 'Vestidos', 'Enterizos',
  'Faldas / Polleras', 'Abrigos / Sacos', 'Calzados', 'Accesorios', 'Otros'
];

const formatPYG = (value) => `${Math.round(Number(value) || 0).toLocaleString('es-PY')} PYG`;
const formatDate = (isoString) => isoString ? new Date(isoString).toLocaleDateString('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const setStatus = (text = '', kind = '') => { 
  const el = $('#app-status'); 
  el.textContent = text; 
  el.className = `status ${kind}`; 
};

const show = (selector) => $(selector).classList.remove('hidden');
const hide = (selector) => $(selector).classList.add('hidden');

function messageFrom(error, fallback = 'Ocurrió un error. Intentá nuevamente.') {
  console.error(error); return error?.message || fallback;
}

function authError(text = '') {
  const el = $('#auth-error'); el.textContent = text; el.classList.toggle('hidden', !text);
}

function showOnly(view) {
  ['#auth-view', '#onboarding-view', '#invite-accept-view', '#app-view'].forEach(hide); show(view);
}

function setAuthMode(registerMode) {
  state.registerMode = registerMode;
  document.querySelectorAll('.register-only').forEach((el) => el.classList.toggle('hidden', !registerMode));
  $('#auth-title').textContent = registerMode ? 'Crear cuenta' : 'Calculadora compartida';
  $('#auth-subtitle').textContent = registerMode ? 'Usá el mismo correo al que te invitó la administradora.' : 'Ingresá con tu cuenta del equipo.';
  $('#auth-submit').textContent = registerMode ? 'Crear cuenta' : 'Ingresar';
  $('#auth-toggle').textContent = registerMode ? 'Ya tengo una cuenta' : 'Crear mi cuenta';
  authError();
}

async function refreshWorkspace() {
  if (!state.user) return;
  setStatus('Cargando datos…');

  const { data: membership, error: membershipError } = await state.client
    .from('memberships')
    .select('business_id, role, businesses(name)')
    .eq('user_id', state.user.id)
    .limit(1)
    .maybeSingle();

  if (membershipError) { setStatus(messageFrom(membershipError), 'error'); return; }
  if (!membership) { showOnly('#onboarding-view'); return; }

  state.membership = membership;
  state.business = Array.isArray(membership.businesses) ? membership.businesses[0] : membership.businesses;

  const [settingsRes, tripsRes, garmentsRes] = await Promise.all([
    state.client.from('business_settings').select('*').eq('business_id', membership.business_id).single(),
    state.client.from('trips').select('*').eq('business_id', membership.business_id).order('created_at', { ascending: false }),
    state.client.from('garments').select('*').eq('business_id', membership.business_id).order('created_at', { ascending: false })
  ]);

  if (settingsRes.error) { setStatus(messageFrom(settingsRes.error), 'error'); return; }

  state.settings = settingsRes.data;
  state.trips = tripsRes.data || [];
  state.garments = garmentsRes.data || [];

  if (state.trips.length > 0 && !state.currentTripId) {
    state.currentTripId = state.trips[0].id;
  }

  showOnly('#app-view');
  $('#business-label').textContent = state.business?.name || 'Jusa Boutique';
  $('#user-label').textContent = state.user.email;
  $('#role-label').textContent = membership.role === 'admin' ? 'Administradora' : 'Vendedora';
  $('#team-card').classList.toggle('hidden', membership.role !== 'admin');

  renderSidebarNav();
  loadCurrentView();

  if (membership.role === 'admin') await loadInvitations();
  setStatus('Todo está sincronizado.', 'success');
}

function renderSidebarNav() {
  const container = $('#sidebar-trips-list');
  container.replaceChildren();

  $('#nav-inventory').classList.toggle('active', state.currentView === 'inventory');
  $('#nav-sold').classList.toggle('active', state.currentView === 'sold');

  state.trips.forEach((trip) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `sidebar-item trip-item-btn ${state.currentView === 'calc' && trip.id === state.currentTripId ? 'active' : ''}`;

    const titleSpan = document.createElement('span');
    titleSpan.textContent = `✈️ ${trip.name}`;

    const dateSpan = document.createElement('span');
    dateSpan.className = 'trip-item-date';
    dateSpan.textContent = formatDate(trip.created_at);

    btn.append(titleSpan, dateSpan);

    btn.addEventListener('click', () => {
      state.currentView = 'calc';
      state.currentTripId = trip.id;
      $('#sidebar').classList.remove('open');
      renderSidebarNav();
      loadCurrentView();
    });

    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      state.contextTripTarget = trip;
      const ctxMenu = $('#trip-context-menu');
      ctxMenu.style.top = `${e.clientY}px`;
      ctxMenu.style.left = `${e.clientX}px`;
      show('#trip-context-menu');
    });

    container.append(btn);
  });
}

function loadCurrentView() {
  hide('#view-calc');
  hide('#view-inv');
  hide('#view-sold');

  if (state.currentView === 'inventory') {
    show('#view-inv');
    renderAllInventory();
  } else if (state.currentView === 'sold') {
    show('#view-sold');
    renderSoldInventory();
  } else {
    show('#view-calc');
    renderSettings();
    renderGarments();
  }
}

function renderSettings() {
  const trip = state.trips.find((t) => t.id === state.currentTripId);
  if (!trip) return;

  $('#trip-title-display').textContent = trip.name;
  $('#trip-date-display').textContent = `Creado: ${formatDate(trip.created_at)}`;

  $('#cotizacion').value = trip.cotizacion;
  $('#pasajes').value = trip.pasajes;
  $('#viaticos').value = trip.viaticos;
  $('#flete').value = trip.flete;
  $('#profit-mode').value = state.settings.profit_mode;
  $('#allocation-method').value = state.settings.allocation_method;

  updateProfitInputLimits();
  calculate();
}

function calculate() {
  const trip = state.trips.find((t) => t.id === state.currentTripId);
  if (!trip || !state.settings) return;

  const rate = Math.max(0, number($('#cotizacion').value));
  const travel = Math.max(0, number($('#pasajes').value)) + Math.max(0, number($('#viaticos').value)) + Math.max(0, number($('#flete').value));
  
  const garmentRows = [...document.querySelectorAll('#garment-rows tr')].map((row) => ({
    row,
    quantity: Math.max(0, number(row.querySelector('[data-field="quantity"]').value)),
    price: Math.max(0, number(row.querySelector('[data-field="price_brl"]').value)),
    profit: Math.max(0, number(row.querySelector('[data-field="profit_percentage"]').value))
  }));

  const totalUnits = garmentRows.reduce((sum, item) => sum + item.quantity, 0);
  const totalPurchase = garmentRows.reduce((sum, item) => sum + item.quantity * item.price * rate, 0);
  const useMargin = $('#profit-mode').value === 'margin';
  const useValue = $('#allocation-method').value === 'value';
  let totalProfit = 0;

  garmentRows.forEach((item) => {
    const purchase = item.price * rate;
    const travelPerItem = useValue && totalPurchase > 0 ? purchase * (travel / totalPurchase) : totalUnits > 0 ? travel / totalUnits : 0;
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

function renderGarments() {
  const body = $('#garment-rows');
  body.replaceChildren();

  const query = $('#search-input').value.toLowerCase().trim();
  const selectedCat = $('#filter-category').value;
  const sortBy = $('#sort-select').value;

  let filtered = state.garments.filter((g) => g.trip_id === state.currentTripId);

  if (query) filtered = filtered.filter((g) => g.name.toLowerCase().includes(query));
  if (selectedCat !== 'ALL') filtered = filtered.filter((g) => (g.category || 'General') === selectedCat);

  filtered.sort((a, b) => {
    if (sortBy === 'NAME_ASC') return a.name.localeCompare(b.name);
    if (sortBy === 'PRICE_DESC') return b.price_brl - a.price_brl;
    if (sortBy === 'PRICE_ASC') return a.price_brl - b.price_brl;
    return new Date(b.created_at) - new Date(a.created_at);
  });

  filtered.forEach((garment) => {
    const row = document.createElement('tr');
    row.dataset.id = garment.id;
    if (garment.is_sold) row.classList.add('sold-row');

    // 1. Casilla Vendido
    const soldCell = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'sold-checkbox';
    checkbox.checked = Boolean(garment.is_sold);
    checkbox.addEventListener('change', (e) => {
      toggleSoldStatus(garment.id, e.target.checked);
    });
    soldCell.append(checkbox);

    // 2. Nombre
    const nameCell = document.createElement('td');
    nameCell.append(inputFor('name', garment.name, { type: 'text', maxlength: '160' }));

    // 3. Categoría
    const catCell = document.createElement('td');
    catCell.append(selectForCategory(garment.category || 'General', (newCat) => {
      saveGarmentField(garment.id, 'category', newCat);
    }));

    // 4. Cantidad
    const qtyCell = document.createElement('td');
    qtyCell.append(inputFor('quantity', garment.quantity, { type: 'number', min: '0.01', step: '0.01' }));

    // 5. Costo BRL
    const priceCell = document.createElement('td');
    priceCell.append(inputFor('price_brl', garment.price_brl, { type: 'number', min: '0', step: '0.01' }));

    row.append(soldCell, nameCell, catCell, qtyCell, priceCell);

    ['purchase', 'travel', 'real'].forEach((output) => {
      const cell = document.createElement('td');
      const span = document.createElement('span');
      span.dataset.output = output;
      span.className = 'money';
      cell.append(span);
      row.append(cell);
    });

    const profitCell = document.createElement('td');
    profitCell.append(inputFor('profit_percentage', garment.profit_percentage, { type: 'number', min: '0', step: '0.01' }));
    row.append(profitCell);

    const saleCell = document.createElement('td');
    const saleSpan = document.createElement('span');
    saleSpan.dataset.output = 'sale';
    saleSpan.className = 'money';
    saleCell.append(saleSpan);
    row.append(saleCell);

    const deleteCell = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'delete';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', () => deleteGarment(garment.id));
    deleteCell.append(delBtn);
    row.append(deleteCell);

    row.querySelectorAll('input:not([type="checkbox"])').forEach((input) => input.addEventListener('input', () => queueGarmentSave(garment.id)));
    body.append(row);
  });

  updateProfitInputLimits();
  calculate();
}

async function toggleSoldStatus(id, isSold) {
  const { error } = await state.client.from('garments').update({ is_sold: isSold }).eq('id', id);
  if (error) { setStatus(messageFrom(error), 'error'); return; }

  const idx = state.garments.findIndex((g) => g.id === id);
  if (idx > -1) state.garments[idx].is_sold = isSold;

  renderGarments();
  setStatus(isSold ? 'Prenda marcada como VENDIDA.' : 'Prenda devuelta al stock.', 'success');
}

function selectForCategory(currentCat, onChange) {
  const select = document.createElement('select');
  CATEGORIES.forEach((cat) => {
    const opt = document.createElement('option');
    opt.value = cat; opt.textContent = cat;
    if (cat === currentCat) opt.selected = true;
    select.append(opt);
  });
  select.addEventListener('change', (e) => onChange(e.target.value));
  return select;
}

async function saveGarmentField(id, field, value) {
  const { error } = await state.client.from('garments').update({ [field]: value }).eq('id', id);
  if (error) setStatus(messageFrom(error), 'error');
  else {
    const idx = state.garments.findIndex((g) => g.id === id);
    if (idx > -1) state.garments[idx][field] = value;
    setStatus('Cambio guardado.', 'success');
  }
}

// INVENTARIO COMPLETO (Solo muestra prendas NO vendidas)
function renderAllInventory() {
  const body = $('#all-garments-rows');
  body.replaceChildren();

  const query = $('#inv-search-input').value.toLowerCase().trim();
  const selectedCat = $('#inv-filter-category').value;
  const useMargin = state.settings.profit_mode === 'margin';
  const useValue = state.settings.allocation_method === 'value';

  const tripTotals = {};
  state.trips.forEach((trip) => {
    const tripGarments = state.garments.filter((g) => g.trip_id === trip.id);
    const travel = Number(trip.pasajes) + Number(trip.viaticos) + Number(trip.flete);
    const totalUnits = tripGarments.reduce((sum, item) => sum + Number(item.quantity), 0);
    const totalPurchase = tripGarments.reduce((sum, item) => sum + Number(item.quantity) * Number(item.price_brl) * Number(trip.cotizacion), 0);
    tripTotals[trip.id] = { travel, totalUnits, totalPurchase, rate: Number(trip.cotizacion) };
  });

  // Filtrar solo las que NO están vendidas
  let filtered = state.garments.filter((g) => !g.is_sold);
  if (query) filtered = filtered.filter((g) => g.name.toLowerCase().includes(query));
  if (selectedCat !== 'ALL') filtered = filtered.filter((g) => (g.category || 'General') === selectedCat);

  $('#stock-count-badge').textContent = `${filtered.length} prendas en stock`;

  filtered.forEach((garment) => {
    const trip = state.trips.find((t) => t.id === garment.trip_id);
    if (!trip) return;

    const totals = tripTotals[trip.id];
    const purchase = garment.price_brl * totals.rate;
    const travelPerItem = useValue && totals.totalPurchase > 0 ? purchase * (totals.travel / totals.totalPurchase) : totals.totalUnits > 0 ? totals.travel / totals.totalUnits : 0;
    const realCost = purchase + travelPerItem;
    const safeProfit = useMargin ? Math.min(garment.profit_percentage, 99.99) : garment.profit_percentage;
    const sale = useMargin ? realCost / (1 - safeProfit / 100) : realCost * (1 + safeProfit / 100);

    const row = document.createElement('tr');
    row.innerHTML = `
      <td style="text-align:left; font-weight:600;">${garment.name}</td>
      <td><span class="role">${garment.category || 'General'}</span></td>
      <td class="money" style="font-size:14px;">${formatPYG(sale)}</td>
      <td style="text-align:right; color:var(--muted); font-size:12px;">${trip.name} (${formatDate(trip.created_at)})</td>
    `;
    body.append(row);
  });
}

// VISTA DE PRENDAS VENDIDAS
function renderSoldInventory() {
  const body = $('#sold-garments-rows');
  body.replaceChildren();

  const useMargin = state.settings.profit_mode === 'margin';
  const useValue = state.settings.allocation_method === 'value';

  const tripTotals = {};
  state.trips.forEach((trip) => {
    const tripGarments = state.garments.filter((g) => g.trip_id === trip.id);
    const travel = Number(trip.pasajes) + Number(trip.viaticos) + Number(trip.flete);
    const totalUnits = tripGarments.reduce((sum, item) => sum + Number(item.quantity), 0);
    const totalPurchase = tripGarments.reduce((sum, item) => sum + Number(item.quantity) * Number(item.price_brl) * Number(trip.cotizacion), 0);
    tripTotals[trip.id] = { travel, totalUnits, totalPurchase, rate: Number(trip.cotizacion) };
  });

  const soldItems = state.garments.filter((g) => g.is_sold);
  $('#sold-count-badge').textContent = `${soldItems.length} prendas vendidas`;

  let totalRecaudado = 0;
  let totalGanancia = 0;

  soldItems.forEach((garment) => {
    const trip = state.trips.find((t) => t.id === garment.trip_id);
    if (!trip) return;

    const totals = tripTotals[trip.id];
    const purchase = garment.price_brl * totals.rate;
    const travelPerItem = useValue && totals.totalPurchase > 0 ? purchase * (totals.travel / totals.totalPurchase) : totals.totalUnits > 0 ? totals.travel / totals.totalUnits : 0;
    const realCost = purchase + travelPerItem;
    const safeProfit = useMargin ? Math.min(garment.profit_percentage, 99.99) : garment.profit_percentage;
    const sale = useMargin ? realCost / (1 - safeProfit / 100) : realCost * (1 + safeProfit / 100);

    totalRecaudado += sale * garment.quantity;
    totalGanancia += (sale - realCost) * garment.quantity;

    const row = document.createElement('tr');
    row.innerHTML = `
      <td style="text-align:left; font-weight:600;">${garment.name}</td>
      <td><span class="role">${garment.category || 'General'}</span></td>
      <td class="money" style="font-size:14px;">${formatPYG(sale)}</td>
      <td style="color:var(--muted); font-size:12px;">${trip.name}</td>
      <td>
        <button type="button" class="small-button" style="padding:4px 8px; font-size:11px;">Restaurar</button>
      </td>
    `;

    row.querySelector('button').addEventListener('click', () => {
      toggleSoldStatus(garment.id, false);
      renderSoldInventory();
    });

    body.append(row);
  });

  $('#sold-total-amount').textContent = formatPYG(totalRecaudado);
  $('#sold-total-profit').textContent = formatPYG(totalGanancia);
}

function handleExcelUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = window.XLSX.read(data, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = window.XLSX.utils.sheet_to_json(firstSheet);

      if (!rows || rows.length === 0) {
        setStatus('El archivo Excel está vacío.', 'error'); return;
      }

      setStatus('Importando prendas desde Excel…');

      const itemsToInsert = rows.map((r) => {
        const rawCat = String(r.Categoria || r.Categoría || r.categoria || r.categoría || '').trim();
        const matchedCat = CATEGORIES.find((c) => c.toLowerCase() === rawCat.toLowerCase()) || 'General';

        return {
          business_id: state.membership.business_id,
          trip_id: state.currentTripId,
          name: String(r.Prenda || r.Nombre || r.prenda || r.nombre || 'Prenda Excel').trim(),
          quantity: Math.max(0.01, number(r.Cantidad || r.cantidad || r.Cant || 1)),
          price_brl: Math.max(0, number(r['Costo BRL'] || r['Costo (BRL)'] || r.costo || r.Costo || 0)),
          profit_percentage: Math.max(0, number(r['Ganancia %'] || r.Ganancia || 100)),
          category: matchedCat,
          is_sold: false,
          updated_by: state.user.id
        };
      });

      const { data: inserted, error } = await state.client.from('garments').insert(itemsToInsert).select();
      if (error) { setStatus(messageFrom(error), 'error'); return; }

      state.garments.unshift(...inserted);
      renderGarments();
      setStatus(`¡Se importaron ${inserted.length} prendas con éxito!`, 'success');
    } catch (err) {
      setStatus('Error al procesar la planilla de Excel.', 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function inputFor(field, value, attributes = {}) {
  const input = document.createElement('input');
  input.dataset.field = field;
  input.value = value;
  input.setAttribute('aria-label', field);
  Object.entries(attributes).forEach(([key, attrValue]) => input.setAttribute(key, attrValue));
  return input;
}

function updateProfitInputLimits() {
  const max = $('#profit-mode').value === 'margin' ? '99.99' : '999.99';
  document.querySelectorAll('[data-field="profit_percentage"]').forEach((input) => input.max = max);
}

function queueSettingsSave() {
  calculate(); clearTimeout(state.settingsTimer); state.settingsTimer = setTimeout(saveSettings, 550);
}

async function saveSettings() {
  const tripValues = {
    cotizacion: Math.max(0, number($('#cotizacion').value)),
    pasajes: Math.max(0, number($('#pasajes').value)),
    viaticos: Math.max(0, number($('#viaticos').value)),
    flete: Math.max(0, number($('#flete').value))
  };
  const settingValues = { profit_mode: $('#profit-mode').value, allocation_method: $('#allocation-method').value };

  const [tripRes, setRes] = await Promise.all([
    state.client.from('trips').update(tripValues).eq('id', state.currentTripId),
    state.client.from('business_settings').update(settingValues).eq('business_id', state.membership.business_id)
  ]);

  if (tripRes.error || setRes.error) setStatus(messageFrom(tripRes.error || setRes.error), 'error');
  else {
    const idx = state.trips.findIndex((t) => t.id === state.currentTripId);
    if (idx > -1) state.trips[idx] = { ...state.trips[idx], ...tripValues };
    state.settings = { ...state.settings, ...settingValues };
    setStatus('Cambios guardados.', 'success');
  }
}

function queueGarmentSave(id) {
  calculate(); clearTimeout(state.garmentTimers.get(id));
  state.garmentTimers.set(id, setTimeout(() => saveGarment(id), 550));
}

async function saveGarment(id) {
  const row = document.querySelector(`#garment-rows tr[data-id="${id}"]`); if (!row) return;
  const payload = {};
  row.querySelectorAll('[data-field]').forEach((input) => {
    payload[input.dataset.field] = input.dataset.field === 'name' ? input.value.trim() : number(input.value);
  });

  if (!payload.name) { setStatus('Ingresá un nombre para la prenda.', 'error'); return; }

  const { data, error } = await state.client.from('garments').update(payload).eq('id', id).select().single();
  if (error) { setStatus(messageFrom(error), 'error'); return; }

  state.garments = state.garments.map((item) => item.id === id ? data : item);
  setStatus('Prenda guardada.', 'success');
}

async function addGarment() {
  const { data, error } = await state.client.from('garments').insert({
    business_id: state.membership.business_id, trip_id: state.currentTripId, name: 'Nueva prenda', category: 'General', quantity: 1, price_brl: 0, profit_percentage: 100, is_sold: false, updated_by: state.user.id
  }).select().single();

  if (error) { setStatus(messageFrom(error), 'error'); return; }
  state.garments.unshift(data);
  renderGarments();
  document.querySelector(`#garment-rows tr[data-id="${data.id}"] [data-field="name"]`)?.focus();
  setStatus('Prenda agregada.', 'success');
}

async function deleteGarment(id) {
  if (!window.confirm('¿Eliminar esta prenda?')) return;
  const { error } = await state.client.from('garments').delete().eq('id', id);
  if (error) { setStatus(messageFrom(error), 'error'); return; }
  state.garments = state.garments.filter((item) => item.id !== id);
  renderGarments();
  setStatus('Prenda eliminada.', 'success');
}

async function createBusiness(event) {
  event.preventDefault(); const name = $('#business-name').value.trim();
  const { error } = await state.client.rpc('create_business', { business_name: name });
  if (error) setStatus(messageFrom(error), 'error'); else await refreshWorkspace();
}

async function loadInvitations() {
  const { data, error } = await state.client.from('invitations').select('id, email, role, created_at').eq('business_id', state.membership.business_id);
  if (error) return;
  const list = $('#invite-list'); list.replaceChildren();
  data.forEach((invite) => { const item = document.createElement('li'); item.textContent = `${invite.email} (${invite.role})`; list.append(item); });
}

async function createInvitation(event) {
  event.preventDefault();
  const email = $('#invite-email').value.trim().toLowerCase();
  const role = $('#invite-role').value;
  const { data, error } = await state.client.rpc('invite_member', { target_business_id: state.membership.business_id, target_email: email, target_role: role });
  if (error) setStatus(messageFrom(error), 'error');
  else { $('#invite-form').reset(); setStatus(data === 'joined' ? 'Usuario agregado.' : 'Invitación enviada.', 'success'); await loadInvitations(); }
}

function exportCsv() {
  const rows = [...document.querySelectorAll('#garment-rows tr')];
  const escape = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;
  const trip = state.trips.find((t) => t.id === state.currentTripId);

  const lines = [
    'sep=;', `JUSA BOUTIQUE - VIAJE: ${trip?.name || ''}`, `Fecha;${formatDate(trip?.created_at)}`,
    `Cotización;${$('#cotizacion').value}`, `Pasajes;${$('#pasajes').value}`, `Viáticos;${$('#viaticos').value}`, `Flete;${$('#flete').value}`, '',
    'Vendido;Prenda;Categoría;Cantidad;Precio BRL;Compra PYG;Viaje PYG;Costo Real PYG;Ganancia %;Precio Venta PYG'
  ];

  rows.forEach((row) => {
    lines.push([
      row.querySelector('.sold-checkbox')?.checked ? 'SI' : 'NO',
      escape(row.querySelector('[data-field="name"]').value),
      escape(row.querySelector('select')?.value || 'General'),
      row.querySelector('[data-field="quantity"]').value,
      row.querySelector('[data-field="price_brl"]').value,
      row.querySelector('[data-output="purchase"]').textContent.replace(/\D/g, ''),
      row.querySelector('[data-output="travel"]').textContent.replace(/\D/g, ''),
      row.querySelector('[data-output="real"]').textContent.replace(/\D/g, ''),
      row.querySelector('[data-field="profit_percentage"]').value,
      row.querySelector('[data-output="sale"]').textContent.replace(/\D/g, '')
    ].join(';'));
  });

  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `Jusa_${trip?.name}_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
}

async function handleAuth(event) {
  event.preventDefault(); authError();
  const email = $('#email').value.trim(); const password = $('#password').value;
  let result;
  if (state.registerMode) {
    const fullName = $('#full-name').value.trim();
    result = await state.client.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
  } else result = await state.client.auth.signInWithPassword({ email, password });
  if (result.error) authError(messageFrom(result.error));
}

async function initialize() {
  if (!ready) { show('#setup-warning'); return; }
  state.client = createClient(config.supabaseUrl, config.supabaseAnonKey);

  $('#auth-form').addEventListener('submit', handleAuth);
  $('#auth-toggle').addEventListener('click', () => setAuthMode(!state.registerMode));
  $('#business-form').addEventListener('submit', createBusiness);
  $('#logout-button').addEventListener('click', () => state.client.auth.signOut());
  $('#add-garment').addEventListener('click', addGarment);
  $('#export-button').addEventListener('click', exportCsv);
  $('#print-button').addEventListener('click', () => window.print());
  $('#invite-form').addEventListener('submit', createInvitation);

  $('#search-input').addEventListener('input', renderGarments);
  $('#filter-category').addEventListener('change', renderGarments);
  $('#sort-select').addEventListener('change', renderGarments);
  $('#inv-search-input').addEventListener('input', renderAllInventory);
  $('#inv-filter-category').addEventListener('change', renderAllInventory);

  $('#excel-file-input').addEventListener('change', handleExcelUpload);

  ['#cotizacion', '#pasajes', '#viaticos', '#flete', '#profit-mode', '#allocation-method'].forEach((selector) => {
    $(selector).addEventListener('input', queueSettingsSave);$(selector).addEventListener('change', queueSettingsSave);
  });

  document.addEventListener('click', () => hide('#trip-context-menu'));

  $('#ctx-rename-trip').addEventListener('click', async () => {
    if (!state.contextTripTarget) return;
    const newName = prompt('Nuevo nombre del viaje:', state.contextTripTarget.name);
    if (!newName) return;

    const { error } = await state.client.from('trips').update({ name: newName.trim() }).eq('id', state.contextTripTarget.id);
    if (error) { setStatus(messageFrom(error), 'error'); return; }

    const idx = state.trips.findIndex((t) => t.id === state.contextTripTarget.id);
    if (idx > -1) state.trips[idx].name = newName.trim();

    renderSidebarNav();
    if (state.currentTripId === state.contextTripTarget.id) renderSettings();
    setStatus('Nombre de viaje actualizado.', 'success');
  });

  $('#ctx-delete-trip').addEventListener('click', async () => {
    if (!state.contextTripTarget) return;
    if (!window.confirm(`¿Seguro que querés eliminar "${state.contextTripTarget.name}"? Se borrarán sus prendas.`)) return;

    const { error } = await state.client.from('trips').delete().eq('id', state.contextTripTarget.id);
    if (error) { setStatus(messageFrom(error), 'error'); return; }

    state.trips = state.trips.filter((t) => t.id !== state.contextTripTarget.id);
    if (state.trips.length > 0) state.currentTripId = state.trips[0].id;

    renderSidebarNav();
    loadCurrentView();
    setStatus('Viaje eliminado.', 'success');
  });

  // Navegación Pestañas
  $('#nav-inventory').addEventListener('click', () => {
    state.currentView = 'inventory';
    $('#sidebar').classList.remove('open');
    renderSidebarNav();
    loadCurrentView();
  });

  $('#nav-sold').addEventListener('click', () => {
    state.currentView = 'sold';
    $('#sidebar').classList.remove('open');
    renderSidebarNav();
    loadCurrentView();
  });

  $('#toggle-sidebar').addEventListener('click', () => $('#sidebar').classList.add('open'));
  $('#close-sidebar-mobile').addEventListener('click', () => $('#sidebar').classList.remove('open'));

  $('#new-trip-btn').addEventListener('click', async () => {
    const defaultName = `Viaje ${new Date().toLocaleDateString('es-PY')}`;
    const name = prompt('Nombre del nuevo viaje:', defaultName);
    if (!name) return;

    const { data, error } = await state.client.from('trips').insert({
      business_id: state.membership.business_id, name: name.trim(), cotizacion: state.trips[0]?.cotizacion || 1420, pasajes: 0, viaticos: 0, flete: 0
    }).select().single();

    if (error) { setStatus(messageFrom(error), 'error'); return; }

    state.trips.unshift(data);
    state.currentView = 'calc';
    state.currentTripId = data.id;

    $('#sidebar').classList.remove('open');
    renderSidebarNav();
    loadCurrentView();
    setStatus('Viaje creado.', 'success');
  });

  state.client.auth.onAuthStateChange((_event, session) => {
    state.user = session?.user || null;
    if (state.user) refreshWorkspace();
    else showOnly('#auth-view');
  });

  const { data: { session } } = await state.client.auth.getSession();
  state.user = session?.user || null;
  if (state.user) await refreshWorkspace();
  else { showOnly('#auth-view'); setAuthMode(false); }
}

initialize();