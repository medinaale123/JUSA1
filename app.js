import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const config = window.JUSA_CONFIG || {};
const ready = config.supabaseUrl && config.supabaseAnonKey && !config.supabaseUrl.includes('PEGAR_AQUI');
const $ = (selector) => document.querySelector(selector);

const ALEX_WHATSAPP_URL = 'https://wa.me/595986235713?text=Hola%20Alex,%20necesito%20renovar%20mi%20suscripci%C3%B3n%20mensual%20de%20TUBOUTIQUE';
const ALEX_SUPPORT_URL = 'https://wa.me/595986176114?text=Hola%20Equipo%20de%20Soporte%20TUBOUTIQUE,%20necesito%20ayuda%20con%20mi%20sistema.';

const state = { 
  client: null, 
  user: null, 
  profile: null,
  membership: null, 
  business: null, 
  settings: null, 
  trips: [], 
  currentTripId: null, 
  currentView: 'dashboard',
  garments: [], 
  customers: [],
  customerPurchases: [],
  registerMode: false, 
  sidebarOpen: true,
  contextTripTarget: null,
  pendingExcelItems: [],
  liveRates: { brlToPyg: 0, usdToPyg: 0 },
  posCustomer: null,
  posCart: [],
  paymentCustomer: null,
  paymentPurchases: [],
  paymentTotalDebt: 0,
  settingsTimer: null, 
  garmentTimers: new Map() 
};

const CATEGORIES = [
  'General', 'Remeras', 'Blusas', 'Jeans', 'Pantalones', 'Vestidos', 'Enterizos',
  'Faldas / Polleras', 'Abrigos / Sacos', 'Calzados', 'Accesorios', 'Otros'
];

const formatPYG = (value) => `${Math.round(Number(value) || 0).toLocaleString('es-PY')} PYG`;
const formatUSD = (valueInPyg) => {
  const rate = state.liveRates.usdToPyg || 7500;
  const usd = Number(valueInPyg || 0) / rate;
  return `$${usd.toFixed(2)} USD`;
};

const formatDate = (isoString) => isoString ? new Date(isoString).toLocaleDateString('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const setStatus = (text = '', kind = '') => { 
  const el = $('#app-status'); 
  if (el) { el.textContent = text; el.className = `status ${kind}`; }
};

const show = (selector) => $(selector)?.classList.remove('hidden');
const hide = (selector) => $(selector)?.classList.add('hidden');

function messageFrom(error, fallback = 'Ocurrió un error. Intentá nuevamente.') {
  console.error(error); return error?.message || fallback;
}

function authError(text = '') {
  const el = $('#auth-error');
  if (el) { el.textContent = text; el.classList.toggle('hidden', !text); }
}

function showOnly(view) {
  ['#auth-view', '#onboarding-view', '#invite-accept-view', '#app-view'].forEach(hide); 
  show(view);
}

function setAuthMode(registerMode) {
  state.registerMode = false;
  if ($('#auth-title')) $('#auth-title').textContent = 'TUBOUTIQUE';
  if ($('#auth-subtitle')) $('#auth-subtitle').textContent = 'Ingresá con las credenciales asignadas a tu boutique.';
  authError();
}

let confirmCallback = null;
function openConfirmModal(title, text, actionBtnText, isDanger, callback) {
  $('#confirm-modal-title').textContent = title;
  $('#confirm-modal-text').textContent = text;
  $('#confirm-modal-btn').textContent = actionBtnText;
  
  if(isDanger) {
    $('#confirm-modal-btn').style.background = 'var(--danger)';
  } else {
    $('#confirm-modal-btn').style.background = 'var(--accent)';
  }
  
  confirmCallback = callback;
  show('#custom-confirm-modal');
}

let promptCallback = null;
function openPromptModal(title, label, defaultValue, btnText, callback) {
  $('#prompt-modal-title').textContent = title;
  $('#prompt-modal-label').textContent = label;
  $('#prompt-modal-input').value = defaultValue;
  $('#prompt-modal-btn').textContent = btnText;
  promptCallback = callback;
  show('#custom-prompt-modal');
  $('#prompt-modal-input').focus();
}

function getEffectivePlan() {
  if (!state.business) return { plan: 'emprendedora', isTrial: false, daysLeft: 0, isExpired: false, monthlyDaysLeft: 0, isMonthlyExpired: false };

  const rawPlan = state.business.subscription_plan || 'pro';
  const status = state.business.subscription_status || 'trialing';
  const now = new Date();
  
  const trialEnds = state.business.trial_ends_at ? new Date(state.business.trial_ends_at) : null;
  const subEnds = state.business.subscription_ends_at ? new Date(state.business.subscription_ends_at) : null;

  const isTrial = status === 'trialing';
  const isTrialExpired = isTrial && trialEnds && now > trialEnds;

  const monthlyDiff = subEnds ? subEnds - now : 0;
  const monthlyDaysLeft = Math.max(0, Math.ceil(monthlyDiff / (1000 * 60 * 60 * 24)));
  const isMonthlyExpired = status === 'active' && subEnds && now > subEnds;

  let effectivePlan = rawPlan;

  if (isTrialExpired || isMonthlyExpired || status === 'expired') {
    effectivePlan = 'emprendedora';
  }

  const trialDiff = trialEnds ? trialEnds - now : 0;
  const trialDaysLeft = Math.max(0, Math.ceil(trialDiff / (1000 * 60 * 60 * 24)));

  return { plan: effectivePlan, isTrial: isTrial && !isTrialExpired, daysLeft: trialDaysLeft, isExpired: isTrialExpired, monthlyDaysLeft, isMonthlyExpired };
}

function checkMonthlySubscriptionAlert() {
  const planInfo = getEffectivePlan();
  
  if (planInfo.isExpired || planInfo.isMonthlyExpired || state.business?.subscription_status === 'expired') {
    show('#plan-expired-modal');
    return;
  }

  const banner = $('#payment-alert-banner');
  const msg = $('#payment-alert-message');
  const icon = $('#payment-alert-icon');
  if (!banner || !msg) return;
  const status = state.business?.subscription_status;

  if (status === 'active' && planInfo.monthlyDaysLeft <= 5) {
    msg.textContent = `Tu suscripción mensual vence en ${planInfo.monthlyDaysLeft} día(s). Evitá cortes de servicio pagando vía WhatsApp a Alex.`;
    if (icon) icon.textContent = '⚠️';
    banner.className = 'payment-alert-banner warning';
    show('#payment-alert-banner');
    return;
  }

  if (planInfo.isTrial && planInfo.daysLeft <= 2) {
    msg.textContent = `Tu prueba gratuita finaliza en ${planInfo.daysLeft} día(s). Contactá a Alex para mantener tu plan.`;
    if (icon) icon.textContent = '⏳';
    banner.className = 'payment-alert-banner warning';
    show('#payment-alert-banner');
    return;
  }
  hide('#payment-alert-banner');
}

function updatePlanUIBadge() {
  const planInfo = getEffectivePlan();
  const badgeTitle = $('#plan-badge-title');
  const badgeStatus = $('#plan-badge-status');

  if (!badgeTitle || !badgeStatus) return;

  const planNames = { emprendedora: 'Plan Emprendedora', pro: 'Plan Boutique Pro', vip: 'Plan Agencia VIP 360°' };
  badgeTitle.textContent = planNames[planInfo.plan] || 'Plan Boutique Pro';

  if (planInfo.isTrial) {
    badgeStatus.textContent = `Trial: ${planInfo.daysLeft} día(s) restante(s)`;
    badgeStatus.style.color = 'var(--accent-dark)';
  } else if (planInfo.isExpired || planInfo.isMonthlyExpired) {
    badgeStatus.textContent = 'Suscripción Vencida (Plan Base)';
    badgeStatus.style.color = 'var(--danger)';
  } else {
    badgeStatus.textContent = `Vence en ${planInfo.monthlyDaysLeft} días`;
    badgeStatus.style.color = 'var(--success)';
  }

  const isProOrVip = ['pro', 'vip'].includes(planInfo.plan);
  document.querySelectorAll('.pro-tag').forEach((el) => { el.classList.toggle('hidden', isProOrVip); });

  const maxUsers = planInfo.plan === 'emprendedora' ? 2 : 5;
  const teamCount = $('#invite-list')?.children?.length || 1;
  if ($('#user-limit-msg')) {
    $('#user-limit-msg').textContent = `Límite de usuarias: ${teamCount} actuales / ${maxUsers} permitidas por tu ${planNames[planInfo.plan]}.`;
  }
}

function checkFeatureAccess(feature) {
  const planInfo = getEffectivePlan();
  const isProOrVip = ['pro', 'vip'].includes(planInfo.plan);

  if (!isProOrVip) {
    if ($('#upgrade-modal-text')) {
      const msgs = {
        customers: 'El Control de Ventas a Crédito (CRM) es una función del Plan Boutique Pro.',
        whatsapp: 'La emisión de Comprobantes Digitales y Catálogo requiere el Plan Boutique Pro.',
        branding: 'La Personalización de Identidad Visual (Logo y Colores) requiere el Plan Boutique Pro.'
      };
      $('#upgrade-modal-text').textContent = msgs[feature] || 'Esta herramienta requiere el Plan Boutique Pro.';
    }
    show('#plan-upgrade-modal');
    return false;
  }
  return true;
}

function triggerWelcomeSplash(userName) {
  const savedName = localStorage.getItem('tuboutique_user_name');
  const nameToDisplay = userName || savedName || state.user?.user_metadata?.full_name || state.user?.email?.split('@')[0] || 'Vendedora';
  
  if ($('#welcome-user-name')) $('#welcome-user-name').textContent = `¡Bienvenido/a, ${nameToDisplay}!`;
  if ($('#dashboard-greeting-title')) $('#dashboard-greeting-title').textContent = `¡Hola, ${nameToDisplay}!`;

  const overlay = $('#welcome-overlay');
  if (!overlay) return;

  overlay.classList.remove('hidden', 'fade-out');
  setTimeout(() => {
    overlay.classList.add('fade-out');
    setTimeout(() => { overlay.classList.add('hidden'); }, 800);
  }, 1800);
}

function toggleSidebar(forceState = null) {
  state.sidebarOpen = forceState !== null ? forceState : !state.sidebarOpen;
  const layout = $('.app-layout');
  const icon = $('#toggle-sidebar-icon');
  if (layout) layout.classList.toggle('sidebar-closed', !state.sidebarOpen);
  if (icon) icon.textContent = state.sidebarOpen ? '◀' : '▶';
}

async function fetchLiveExchangeRates() {
  try {
    setStatus('Obteniendo cotización en vivo…');
    const response = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!response.ok) throw new Error('Error de conexión a er-api.com');

    const data = await response.json();
    if (data && data.rates) {
      const usdPyg = data.rates.PYG || 7500;
      const usdBrl = data.rates.BRL || 5;
      const brlPyg = usdBrl > 0 ? usdPyg / usdBrl : 1420;

      state.liveRates = { brlToPyg: brlPyg, usdToPyg: usdPyg };

      if ($('#fx-brl-pyg')) $('#fx-brl-pyg').textContent = `${Math.round(brlPyg).toLocaleString('es-PY')} PYG`;
      if ($('#fx-usd-pyg')) $('#fx-usd-pyg').textContent = `${Math.round(usdPyg).toLocaleString('es-PY')} PYG`;

      setStatus('Cotizaciones mundiales actualizadas.', 'success');
      calculate();
    }
  } catch (err) {
    if ($('#fx-brl-pyg')) $('#fx-brl-pyg').textContent = 'Error';
    if ($('#fx-usd-pyg')) $('#fx-usd-pyg').textContent = 'Error';
  }
}

function applyLiveBrlRate() {
  if (state.liveRates.brlToPyg > 0) {
    const rateInput = $('#cotizacion');
    if (rateInput) { rateInput.value = Math.round(state.liveRates.brlToPyg); queueSettingsSave(); setStatus(`Cotización fijada a ${Math.round(state.liveRates.brlToPyg)} PYG/BRL.`, 'success'); }
  }
}

function applyLiveUsdRate() {
  if (state.liveRates.usdToPyg > 0) {
    const rateInput = $('#cotizacion');
    if (rateInput) { rateInput.value = Math.round(state.liveRates.usdToPyg); queueSettingsSave(); setStatus(`Cotización fijada a ${Math.round(state.liveRates.usdToPyg)} PYG/USD.`, 'success'); }
  }
}

function applyLivePygRate() {
  const rateInput = $('#cotizacion');
  if (rateInput) { 
    rateInput.value = 1; 
    queueSettingsSave(); 
    setStatus('Cotización fijada a 1 PYG (Compra Local).', 'success'); 
  }
}

function applyDynamicBranding() {
  if (!state.business) return;

  const bName = state.business.name || 'TUBOUTIQUE';
  const bLogo = state.business.logo_url || 'Logo.png';
  const pColor = state.business.primary_color || '#b87a70';
  const bgColor = state.business.bg_color || '#f8f3f0';
  const dColor = state.business.accent_dark || '#8c4c43';

  document.querySelectorAll('.app-title-target').forEach((el) => el.textContent = bName);
  document.querySelectorAll('.app-logo-target').forEach((img) => { img.src = bLogo; img.onerror = () => { img.src = 'Logo.png'; }; });

  document.documentElement.style.setProperty('--accent', pColor);
  document.documentElement.style.setProperty('--bg', bgColor);
  document.documentElement.style.setProperty('--accent-dark', dColor);

  if ($('#brand-name-input')) $('#brand-name-input').value = bName;
  if ($('#brand-logo-input')) $('#brand-logo-input').value = bLogo;
  if ($('#brand-primary-color')) $('#brand-primary-color').value = pColor;
  if ($('#brand-bg-color')) $('#brand-bg-color').value = bgColor;
  if ($('#brand-dark-color')) $('#brand-dark-color').value = dColor;
  if ($('#brand-logo-preview')) $('#brand-logo-preview').src = bLogo;
}

async function saveBranding(event) {
  event.preventDefault();
  if (!checkFeatureAccess('branding')) return;

  const newName = $('#brand-name-input')?.value.trim();
  const newLogo = $('#brand-logo-input')?.value.trim();
  const pColor = $('#brand-primary-color')?.value;
  const bgColor = $('#brand-bg-color')?.value;
  const dColor = $('#brand-dark-color')?.value;

  if (!newName || !newLogo) return;

  setStatus('Guardando personalización de marca…');
  const { error } = await state.client.from('businesses').update({ name: newName, logo_url: newLogo, primary_color: pColor, bg_color: bgColor, accent_dark: dColor }).eq('id', state.membership.business_id);

  if (error) { setStatus(messageFrom(error), 'error'); return; }

  state.business.name = newName; state.business.logo_url = newLogo; state.business.primary_color = pColor; state.business.bg_color = bgColor; state.business.accent_dark = dColor;

  applyDynamicBranding();
  setStatus('¡Marca y colores actualizados en toda la app!', 'success');
}

async function refreshWorkspace() {
  if (!state.user) return;
  setStatus('Cargando datos…');

  const { data: membership, error: membershipError } = await state.client.from('memberships').select('business_id, role, businesses(id, name, logo_url, primary_color, bg_color, accent_dark, subscription_plan, subscription_status, trial_ends_at, subscription_ends_at, max_users)').eq('user_id', state.user.id).limit(1).maybeSingle();

  if (membershipError) { setStatus(messageFrom(membershipError), 'error'); return; }
  if (!membership) { showOnly('#onboarding-view'); return; }

  state.membership = membership;
  state.business = Array.isArray(membership.businesses) ? membership.businesses[0] : membership.businesses;

  const [settingsRes, tripsRes, garmentsRes, customersRes, purchasesRes, profileRes] = await Promise.all([
    state.client.from('business_settings').select('*').eq('business_id', membership.business_id).single(),
    state.client.from('trips').select('*').eq('business_id', membership.business_id).order('created_at', { ascending: false }),
    state.client.from('garments').select('*').eq('business_id', membership.business_id).order('created_at', { ascending: false }),
    state.client.from('customers').select('*').eq('business_id', membership.business_id).order('name', { ascending: true }),
    state.client.from('customer_purchases').select('*').eq('business_id', membership.business_id).order('created_at', { ascending: false }),
    state.client.from('profiles').select('*').eq('id', state.user.id).maybeSingle()
  ]);

  if (settingsRes.error) { setStatus(messageFrom(settingsRes.error), 'error'); return; }

  state.settings = settingsRes.data; state.trips = tripsRes.data || []; state.garments = garmentsRes.data || []; state.customers = customersRes.data || []; state.customerPurchases = purchasesRes.data || [];
  if (profileRes.data) state.profile = profileRes.data;

  if (state.trips.length > 0 && !state.currentTripId) state.currentTripId = state.trips[0].id;

  showOnly('#app-view');
  applyDynamicBranding(); updatePlanUIBadge(); checkMonthlySubscriptionAlert();

  if ($('#user-label')) $('#user-label').textContent = state.user.email;
  if ($('#role-label')) $('#role-label').textContent = membership.role === 'admin' ? 'Administradora' : 'Vendedora';

  renderSidebarNav(); loadCurrentView(); fetchLiveExchangeRates();

  if (membership.role === 'admin') await loadInvitations();
  setStatus('Todo está sincronizado.', 'success');
}

function renderSidebarNav() {
  const container = $('#sidebar-trips-list');
  if (!container) return; container.replaceChildren();

  $('#nav-dashboard')?.classList.toggle('active', state.currentView === 'dashboard');
  $('#nav-inventory')?.classList.toggle('active', state.currentView === 'inventory');
  $('#nav-sold')?.classList.toggle('active', state.currentView === 'sold');
  $('#nav-customers')?.classList.toggle('active', state.currentView === 'customers');
  $('#nav-team')?.classList.toggle('active', state.currentView === 'team');
  $('#nav-branding')?.classList.toggle('active', state.currentView === 'branding');
  $('#nav-profile')?.classList.toggle('active', state.currentView === 'profile');

  state.trips.forEach((trip) => {
    const isLocal = trip.trip_type === 'local';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `sidebar-item trip-item-btn ${state.currentView === 'calc' && trip.id === state.currentTripId ? 'active' : ''}`;

    const titleSpan = document.createElement('span'); 
    titleSpan.textContent = `${isLocal ? '🛍' : '✈'} ${trip.name}`;
    const dateSpan = document.createElement('span'); 
    dateSpan.className = 'trip-item-date'; 
    dateSpan.textContent = formatDate(trip.created_at);

    btn.append(titleSpan, dateSpan);

    btn.addEventListener('click', () => { state.currentView = 'calc'; state.currentTripId = trip.id; $('#sidebar')?.classList.remove('open'); renderSidebarNav(); loadCurrentView(); });
    btn.addEventListener('contextmenu', (e) => { e.preventDefault(); state.contextTripTarget = trip; const ctxMenu = $('#trip-context-menu'); if (ctxMenu) { ctxMenu.style.top = `${e.clientY}px`; ctxMenu.style.left = `${e.clientX}px`; show('#trip-context-menu'); } });
    container.append(btn);
  });
}

function loadCurrentView() {
  hide('#view-dashboard'); hide('#view-calc'); hide('#view-inv'); hide('#view-sold'); hide('#view-customers'); hide('#view-team'); hide('#view-branding'); hide('#view-profile');
  if (state.currentView === 'dashboard') { show('#view-dashboard'); renderKpiDashboard(); } 
  else if (state.currentView === 'inventory') { show('#view-inv'); renderAllInventory(); } 
  else if (state.currentView === 'sold') { show('#view-sold'); renderSoldInventory(); } 
  else if (state.currentView === 'customers') { show('#view-customers'); renderCustomersMainView(); } 
  else if (state.currentView === 'team') { show('#view-team'); loadInvitations(); } 
  else if (state.currentView === 'branding') { show('#view-branding'); applyDynamicBranding(); } 
  else if (state.currentView === 'profile') { show('#view-profile'); renderProfileView(); }
  else { show('#view-calc'); renderSettings(); renderGarments(); }
}

function renderProfileView() {
  const userName = state.user?.user_metadata?.full_name || state.profile?.full_name || 'Usuaria';
  $('#profile-name-display').textContent = userName;
  $('#profile-email-display').textContent = state.user?.email || '';
  
  const userRole = state.membership?.role || 'vendedora';
  $('#profile-role-display').textContent = userRole === 'admin' ? 'Administradora' : 'Vendedora';

  const planInfo = getEffectivePlan();
  const bannerContainer = $('#profile-upgrade-container');
  bannerContainer.replaceChildren();

  if (planInfo.plan === 'emprendedora') {
    const banner = document.createElement('div');
    banner.className = 'upgrade-banner';
    banner.innerHTML = `
      <div>
        <h3>Plan Actual: Emprendedora</h3>
        <p>Tienes acceso a la Calculadora de Viajes, Inventario y Excel masivo.</p>
      </div>
      <button class="button whatsapp-btn" style="width: auto; margin:0;" onclick="window.open('${ALEX_WHATSAPP_URL}', '_blank')">Sube a Plan Pro por $49/mes</button>
    `;
    bannerContainer.append(banner);
  } else if (planInfo.plan === 'pro') {
    const banner = document.createElement('div');
    banner.className = 'upgrade-banner';
    banner.innerHTML = `
      <div>
        <h3>Plan Actual: Boutique Pro</h3>
        <p>Tienes acceso a CRM de Fiados, Comprobantes WhatsApp y Personalización.</p>
      </div>
      <button class="button whatsapp-btn" style="width: auto; margin:0;" onclick="window.open('${ALEX_WHATSAPP_URL}', '_blank')">Sube a Agencia VIP 360° por $299/mes</button>
    `;
    bannerContainer.append(banner);
  } else {
    const banner = document.createElement('div');
    banner.className = 'upgrade-banner';
    banner.innerHTML = `
      <div>
        <h3>Plan Actual: Agencia VIP 360°</h3>
        <p>Tienes todos los accesos habilitados, incluyendo Tienda Web y Meta Ads.</p>
      </div>
    `;
    bannerContainer.append(banner);
  }

  if (state.profile && state.profile.password) {
    $('#profile-saved-pwd-row').classList.remove('hidden');
    $('#profile-saved-pwd-text').textContent = state.profile.password;
  } else {
    $('#profile-saved-pwd-row').classList.add('hidden');
  }
}

async function handlePasswordChange(e) {
  e.preventDefault();
  const newPwd = $('#profile-new-pwd').value;
  if (!newPwd || newPwd.length < 6) {
    setStatus('La contraseña debe tener al menos 6 caracteres.', 'error');
    return;
  }
  
  setStatus('Actualizando contraseña...');
  const { data, error } = await state.client.auth.updateUser({ password: newPwd });
  
  if (error) {
    setStatus(messageFrom(error), 'error');
  } else {
    setStatus('Contraseña actualizada con éxito.', 'success');
    $('#profile-new-pwd').value = '';
    if(state.profile) {
      await state.client.from('profiles').update({ password: newPwd }).eq('id', state.user.id);
      state.profile.password = newPwd;
      renderProfileView();
    }
  }
}

function calculateGarmentSalePrice(garment) {
  const trip = state.trips.find((t) => t.id === garment.trip_id); if (!trip) return 0;

  const rate = Number(trip.cotizacion || 1);
  const travel = Number(trip.pasajes || 0) + Number(trip.viaticos || 0) + Number(trip.flete || 0);
  const tripGarments = state.garments.filter((g) => g.trip_id === trip.id);
  const totalUnits = tripGarments.reduce((sum, item) => sum + Number(item.quantity), 0);
  const totalPurchase = tripGarments.reduce((sum, item) => sum + Number(item.quantity) * Number(item.price_brl) * rate, 0);

  const purchase = garment.price_brl * rate;
  const useValue = state.settings?.allocation_method === 'value';
  const travelPerItem = useValue && totalPurchase > 0 ? purchase * (travel / totalPurchase) : totalUnits > 0 ? travel / totalUnits : 0;
  const realCost = purchase + travelPerItem;

  const useMargin = state.settings?.profit_mode === 'margin';
  const safeProfit = useMargin ? Math.min(garment.profit_percentage, 99.99) : garment.profit_percentage;
  const sale = useMargin ? realCost / (1 - safeProfit / 100) : realCost * (1 + safeProfit / 100);

  return Math.round(sale);
}

function openPosModal(customer) {
  if (!checkFeatureAccess('customers')) return;
  state.posCustomer = customer; state.posCart = [];
  if ($('#pos-customer-title')) $('#pos-customer-title').textContent = `Cliente: ${customer.name} ${customer.phone ? '(' + customer.phone + ')' : ''}`;
  $('#pos-search-input').value = ''; $('#pos-payment-type').value = 'FULL'; $('#pos-initial-payment').value = '0'; hide('#pos-initial-pay-group');
  renderPosStock(); renderPosCart(); show('#pos-modal');
}

function renderPosStock() {
  const body = $('#pos-stock-rows'); if (!body) return; body.replaceChildren();
  const query = ($('#pos-search-input')?.value || '').toLowerCase().trim();
  const available = state.garments.filter((g) => !g.is_sold && g.quantity > 0);

  let filtered = available;
  if (query) filtered = filtered.filter((g) => g.name.toLowerCase().includes(query) || (g.category || '').toLowerCase().includes(query));

  if (filtered.length === 0) { body.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--muted); padding:16px;">Sin prendas disponibles en el stock.</td></tr>`; return; }

  filtered.forEach((garment) => {
    const salePrice = calculateGarmentSalePrice(garment);
    const inCart = state.posCart.find((ci) => ci.garment.id === garment.id);
    const availableQty = garment.quantity - (inCart ? inCart.qty : 0);

    const row = document.createElement('tr');
    row.innerHTML = `
      <td style="text-align:left; font-weight:600;">${garment.name}<span style="display:block; font-size:10px; color:var(--muted);">${garment.category || 'General'}</span></td>
      <td><strong>${availableQty}</strong> un.</td>
      <td class="money">${formatPYG(salePrice)}</td>
      <td><button type="button" class="small-button dark" ${availableQty <= 0 ? 'disabled style="opacity:0.4;"' : ''}>${availableQty <= 0 ? 'Agotado' : '+ Agregar'}</button></td>
    `;
    if (availableQty > 0) row.querySelector('button').addEventListener('click', () => addToPosCart(garment, salePrice));
    body.append(row);
  });
}

function addToPosCart(garment, salePrice) {
  const existing = state.posCart.find((ci) => ci.garment.id === garment.id);
  if (existing) { if (existing.qty < garment.quantity) existing.qty += 1; else { setStatus('Alcanzaste el stock disponible de esta prenda.', 'error'); return; } } 
  else state.posCart.push({ garment, pricePyg: salePrice, qty: 1 });
  renderPosStock(); renderPosCart();
}

function openManualDebtModal() {
  $('#manual-debt-concept').value = '';
  $('#manual-debt-amount').value = '';
  show('#manual-debt-modal');
  $('#manual-debt-concept').focus();
}

function processManualDebt() {
  const concept = $('#manual-debt-concept').value.trim();
  const amount = number($('#manual-debt-amount').value);
  
  if (!concept || amount <= 0) {
    setStatus('Debe ingresar un concepto y un monto mayor a 0.', 'error');
    return;
  }

  const manualItem = {
    id: 'manual_' + Date.now(),
    name: concept + ' (Manual)',
    quantity: 9999,
    price_brl: 0,
    is_manual: true
  };

  state.posCart.push({ garment: manualItem, pricePyg: amount, qty: 1 });
  renderPosCart();
  hide('#manual-debt-modal');
}

function removeFromPosCart(garmentId) {
  state.posCart = state.posCart.filter((ci) => ci.garment.id !== garmentId);
  renderPosStock(); renderPosCart();
}

function renderPosCart() {
  const container = $('#pos-cart-items-container'); if (!container) return; container.replaceChildren();

  if (state.posCart.length === 0) {
    container.innerHTML = `<p style="font-size: 12px; color: var(--muted); text-align: center; margin-top: 20px;">El carrito está vacío.</p>`;
    if ($('#pos-cart-total-display')) $('#pos-cart-total-display').textContent = '0 PYG'; return;
  }

  let totalCartPyg = 0;
  state.posCart.forEach((item) => {
    const itemSubtotal = item.pricePyg * item.qty; totalCartPyg += itemSubtotal;
    const row = document.createElement('div'); row.className = 'pos-cart-item-row';
    row.innerHTML = `
      <div style="text-align:left;">
        <strong style="display:block; font-size:12px;">${item.garment.name}</strong>
        <span style="font-size:11px; color:var(--muted);">${formatPYG(item.pricePyg)} × ${item.qty} = </span>
        <span class="money" style="font-size:11px;">${formatPYG(itemSubtotal)}</span>
      </div>
      <button type="button" class="delete" style="padding:2px 6px; font-size:10px;">×</button>
    `;
    row.querySelector('.delete').addEventListener('click', () => removeFromPosCart(item.garment.id));
    container.append(row);
  });
  if ($('#pos-cart-total-display')) $('#pos-cart-total-display').textContent = formatPYG(totalCartPyg);
}

async function processPosCheckout() {
  if (!state.posCustomer || state.posCart.length === 0) { setStatus('El carrito está vacío.', 'error'); return; }

  const totalCartPyg = state.posCart.reduce((sum, item) => sum + (item.pricePyg * item.qty), 0);
  const paymentType = $('#pos-payment-type')?.value;
  
  let paidPyg = totalCartPyg;
  if (paymentType === 'CREDIT') { const initialPayInput = $('#pos-initial-payment'); paidPyg = Math.min(totalCartPyg, Math.max(0, number(initialPayInput?.value, 0))); }

  setStatus('Procesando venta y actualizando stock…');
  const purchasesToInsert = []; const garmentUpdates = [];

  for (const cartItem of state.posCart) {
    const itemTotalPrice = cartItem.pricePyg * cartItem.qty;
    const itemRatio = totalCartPyg > 0 ? itemTotalPrice / totalCartPyg : 0;
    const itemPaidPrice = Math.min(itemTotalPrice, Math.round(paidPyg * itemRatio));

    purchasesToInsert.push({ business_id: state.membership.business_id, customer_id: state.posCustomer.id, item_name: cartItem.qty > 1 ? `${cartItem.garment.name} (${cartItem.qty} un.)` : cartItem.garment.name, price_pyg: itemTotalPrice, paid_pyg: itemPaidPrice });

    if (!cartItem.garment.is_manual) {
      if (cartItem.qty >= cartItem.garment.quantity) {
        garmentUpdates.push(state.client.from('garments').update({ is_sold: true, customer_id: state.posCustomer.id }).eq('id', cartItem.garment.id));
      } else {
        const newQty = cartItem.garment.quantity - cartItem.qty;
        garmentUpdates.push(state.client.from('garments').update({ quantity: newQty }).eq('id', cartItem.garment.id));
        garmentUpdates.push(state.client.from('garments').insert({ business_id: state.membership.business_id, trip_id: cartItem.garment.trip_id, name: cartItem.garment.name, category: cartItem.garment.category, quantity: cartItem.qty, price_brl: cartItem.garment.price_brl, profit_percentage: cartItem.garment.profit_percentage, is_sold: true, customer_id: state.posCustomer.id, updated_by: state.user.id }));
      }
    }
  }

  const [purchasesRes] = await Promise.all([ state.client.from('customer_purchases').insert(purchasesToInsert).select(), Promise.all(garmentUpdates) ]);

  if (purchasesRes.error) { setStatus(messageFrom(purchasesRes.error), 'error'); return; }

  const [garmentsRes, purchasesResAll] = await Promise.all([ state.client.from('garments').select('*').eq('business_id', state.membership.business_id).order('created_at', { ascending: false }), state.client.from('customer_purchases').select('*').eq('business_id', state.membership.business_id).order('created_at', { ascending: false }) ]);

  if (garmentsRes.data) state.garments = garmentsRes.data;
  if (purchasesResAll.data) state.customerPurchases = purchasesResAll.data;

  hide('#pos-modal'); renderGarments(); renderAllInventory();
  if (state.currentView === 'customers') renderCustomersMainView();
  renderKpiDashboard(); setStatus(`¡Venta anotada a ${state.posCustomer.name} con éxito!`, 'success');
}

function renderKpiDashboard() {
  const useMargin = state.settings?.profit_mode === 'margin';
  const useValue = state.settings?.allocation_method === 'value';

  const tripTotals = {};
  state.trips.forEach((trip) => {
    const tripGarments = state.garments.filter((g) => g.trip_id === trip.id);
    const travel = Number(trip.pasajes) + Number(trip.viaticos) + Number(trip.flete);
    const rate = trip.trip_type === 'local' ? 1 : Number(trip.cotizacion);
    const totalUnits = tripGarments.reduce((sum, item) => sum + Number(item.quantity), 0);
    const totalPurchase = tripGarments.reduce((sum, item) => sum + Number(item.quantity) * Number(item.price_brl) * rate, 0);
    tripTotals[trip.id] = { travel, totalUnits, totalPurchase, rate };
  });

  let stockCostPyg = 0; let stockSalePyg = 0; let stockUnits = 0;
  let soldProfitPyg = 0; let soldUnits = 0;

  state.garments.forEach((g) => {
    const trip = state.trips.find((t) => t.id === g.trip_id); if (!trip) return;
    const totals = tripTotals[trip.id];
    const purchase = g.price_brl * totals.rate;
    const travelPerItem = useValue && totals.totalPurchase > 0 ? purchase * (totals.travel / totals.totalPurchase) : totals.totalUnits > 0 ? totals.travel / totals.totalUnits : 0;
    const realCost = purchase + travelPerItem;
    const safeProfit = useMargin ? Math.min(g.profit_percentage, 99.99) : g.profit_percentage;
    const sale = useMargin ? realCost / (1 - safeProfit / 100) : realCost * (1 + safeProfit / 100);

    if (g.is_sold) { soldProfitPyg += (sale - realCost) * g.quantity; soldUnits += Number(g.quantity); } 
    else { stockCostPyg += realCost * g.quantity; stockSalePyg += sale * g.quantity; stockUnits += Number(g.quantity); }
  });

  let totalDebtPyg = 0; let debtClientsCount = 0;
  state.customers.forEach((c) => {
    const purchases = state.customerPurchases.filter((p) => p.customer_id === c.id);
    let cPrice = 0, cPaid = 0;
    purchases.forEach((p) => { cPrice += Number(p.price_pyg || 0); cPaid += Number(p.paid_pyg || 0); });
    const debt = cPrice - cPaid; if (debt > 0) { totalDebtPyg += debt; debtClientsCount++; }
  });

  if ($('#kpi-stock-cost')) $('#kpi-stock-cost').textContent = formatPYG(stockCostPyg);
  if ($('#kpi-stock-units')) $('#kpi-stock-units').textContent = `${stockUnits.toLocaleString('es-PY')} un. en stock`;
  if ($('#kpi-stock-sale')) $('#kpi-stock-sale').textContent = formatPYG(stockSalePyg);
  
  const potentialProfit = stockSalePyg - stockCostPyg;
  if ($('#kpi-potential-profit-value')) $('#kpi-potential-profit-value').textContent = formatPYG(potentialProfit);

  if ($('#kpi-debt-total')) $('#kpi-debt-total').textContent = formatPYG(totalDebtPyg);
  if ($('#kpi-debt-clients')) $('#kpi-debt-clients').textContent = `${debtClientsCount} clientes con saldo`;
  if ($('#kpi-sold-profit')) $('#kpi-sold-profit').textContent = formatPYG(soldProfitPyg);
  if ($('#kpi-sold-units')) $('#kpi-sold-units').textContent = `${soldUnits.toLocaleString('es-PY')} vendidas`;
}

function renderSettings() {
  const trip = state.trips.find((t) => t.id === state.currentTripId); if (!trip) return;
  const isLocal = trip.trip_type === 'local';

  if ($('#trip-title-display')) {
    $('#trip-title-display').innerHTML = `${trip.name} <span style="font-size:14px;color:var(--muted);">${isLocal ? '🛍️ Compra Local' : '✈️ Viaje Internacional'}</span>`;
  }
  
  if ($('#trip-date-display')) $('#trip-date-display').textContent = `Creado: ${formatDate(trip.created_at)}`;
  
  if ($('#calc-expenses-title')) $('#calc-expenses-title').textContent = isLocal ? 'Gastos de la Compra Local' : 'Gastos del Viaje';
  
  if ($('#label-expense-1') && $('#label-expense-1').firstChild) $('#label-expense-1').firstChild.nodeValue = isLocal ? 'Movilidad / Transporte (PYG)' : 'Pasajes totales (PYG)';
  if ($('#label-expense-2') && $('#label-expense-2').firstChild) $('#label-expense-2').firstChild.nodeValue = isLocal ? 'Gastos Varios / Comida (PYG)' : 'Viáticos / comida (PYG)';
  if ($('#label-expense-3') && $('#label-expense-3').firstChild) $('#label-expense-3').firstChild.nodeValue = isLocal ? 'Delivery / Fletes (PYG)' : 'Fletes / envíos (PYG)';
  
  if ($('#th-cost-origin')) $('#th-cost-origin').textContent = isLocal ? 'Costo (PYG)' : 'Costo (BRL / USD)';
  if ($('#th-sale-price')) $('#th-sale-price').textContent = isLocal ? 'Precio venta (PYG)' : 'Precio venta (PYG / USD)';

  const fxCard = document.querySelector('.live-fx-card');
  if (fxCard) {
    if (isLocal) { fxCard.classList.add('hidden'); } 
    else { fxCard.classList.remove('hidden'); }
  }

  const labelRate = document.getElementById('label-rate');
  if (labelRate) {
    if (isLocal) { labelRate.classList.add('hidden'); } 
    else { labelRate.classList.remove('hidden'); }
  }

  if ($('#cotizacion')) {
    $('#cotizacion').value = isLocal ? 1 : trip.cotizacion;
    $('#cotizacion').disabled = isLocal;
  }
  if ($('#pasajes')) $('#pasajes').value = trip.pasajes;
  if ($('#viaticos')) $('#viaticos').value = trip.viaticos;
  if ($('#flete')) $('#flete').value = trip.flete;
  if ($('#profit-mode')) $('#profit-mode').value = state.settings.profit_mode;
  if ($('#allocation-method')) $('#allocation-method').value = state.settings.allocation_method;
  updateProfitInputLimits(); calculate();
}

function calculate() {
  const trip = state.trips.find((t) => t.id === state.currentTripId); if (!trip || !state.settings) return;

  const isLocal = trip.trip_type === 'local';
  const rate = isLocal ? 1 : Math.max(0, number($('#cotizacion')?.value));
  const travel = Math.max(0, number($('#pasajes')?.value)) + Math.max(0, number($('#viaticos')?.value)) + Math.max(0, number($('#flete')?.value));
  
  const garmentRows = [...document.querySelectorAll('#garment-rows tr')].map((row) => ({
    row, quantity: Math.max(0, number(row.querySelector('[data-field="quantity"]')?.value)), price: Math.max(0, number(row.querySelector('[data-field="price_brl"]')?.value)), profit: Math.max(0, number(row.querySelector('[data-field="profit_percentage"]')?.value))
  }));

  const totalUnits = garmentRows.reduce((sum, item) => sum + item.quantity, 0);
  const totalPurchase = garmentRows.reduce((sum, item) => sum + item.quantity * item.price * rate, 0);
  const useMargin = $('#profit-mode')?.value === 'margin';
  const useValue = $('#allocation-method')?.value === 'value';
  let totalProfit = 0;

  garmentRows.forEach((item) => {
    const purchase = item.price * rate;
    const travelPerItem = useValue && totalPurchase > 0 ? purchase * (travel / totalPurchase) : totalUnits > 0 ? travel / totalUnits : 0;
    const realCost = purchase + travelPerItem;
    const safeProfit = useMargin ? Math.min(item.profit, 99.99) : item.profit;
    const sale = useMargin ? realCost / (1 - safeProfit / 100) : realCost * (1 + safeProfit / 100);

    totalProfit += (sale - realCost) * item.quantity;
    const purEl = item.row.querySelector('[data-output="purchase"]'); if (purEl) purEl.textContent = formatPYG(purchase);
    const traEl = item.row.querySelector('[data-output="travel"]'); if (traEl) traEl.textContent = formatPYG(travelPerItem);
    const reaEl = item.row.querySelector('[data-output="real"]'); if (reaEl) reaEl.textContent = formatPYG(realCost);
    
    const salEl = item.row.querySelector('[data-output="sale"]'); 
    if (salEl) {
      salEl.innerHTML = isLocal 
        ? formatPYG(sale) 
        : `${formatPYG(sale)} <span class="usd-sub">(${formatUSD(sale)})</span>`;
    }
  });

  if ($('#total-expenses')) $('#total-expenses').textContent = formatPYG(travel);
  if ($('#total-units')) $('#total-units').textContent = `${totalUnits.toLocaleString('es-PY')} un.`;
  if ($('#total-purchase')) $('#total-purchase').textContent = formatPYG(totalPurchase);
  
  if ($('#total-purchase-usd')) {
    $('#total-purchase-usd').style.display = isLocal ? 'none' : 'inline';
    if (!isLocal) $('#total-purchase-usd').textContent = `(${formatUSD(totalPurchase)})`;
  }
  
  if ($('#total-profit')) $('#total-profit').textContent = formatPYG(totalProfit);
  if ($('#total-profit-usd')) {
    $('#total-profit-usd').style.display = isLocal ? 'none' : 'inline';
    if (!isLocal) $('#total-profit-usd').textContent = `(${formatUSD(totalProfit)})`;
  }
}

function renderGarments() {
  const body = $('#garment-rows'); if (!body) return; body.replaceChildren();
  const query = ($('#search-input')?.value || '').toLowerCase().trim();
  const selectedCat = $('#filter-category')?.value || 'ALL';
  const sortBy = $('#sort-select')?.value || 'DATE_DESC';

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
    const row = document.createElement('tr'); row.dataset.id = garment.id;
    if (garment.is_sold) row.classList.add('sold-row');

    const soldCell = document.createElement('td'); const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'sold-checkbox'; checkbox.checked = Boolean(garment.is_sold); checkbox.addEventListener('change', (e) => toggleSoldStatus(garment.id, e.target.checked)); soldCell.append(checkbox);
    const nameCell = document.createElement('td'); nameCell.append(inputFor('name', garment.name, { type: 'text', maxlength: '160' }));
    const catCell = document.createElement('td'); catCell.append(selectForCategory(garment.category || 'General', (newCat) => saveGarmentField(garment.id, 'category', newCat)));
    const qtyCell = document.createElement('td'); qtyCell.append(inputFor('quantity', garment.quantity, { type: 'number', min: '0.01', step: '0.01' }));
    const priceCell = document.createElement('td'); priceCell.append(inputFor('price_brl', garment.price_brl, { type: 'number', min: '0', step: '0.01' }));

    row.append(soldCell, nameCell, catCell, qtyCell, priceCell);

    ['purchase', 'travel', 'real'].forEach((output) => { const cell = document.createElement('td'); const span = document.createElement('span'); span.dataset.output = output; span.className = 'money'; cell.append(span); row.append(cell); });

    const profitCell = document.createElement('td'); profitCell.append(inputFor('profit_percentage', garment.profit_percentage, { type: 'number', min: '0', step: '0.01' })); row.append(profitCell);
    const saleCell = document.createElement('td'); const saleSpan = document.createElement('span'); saleSpan.dataset.output = 'sale'; saleSpan.className = 'money'; saleCell.append(saleSpan); row.append(saleCell);
    const deleteCell = document.createElement('td'); const delBtn = document.createElement('button'); delBtn.type = 'button'; delBtn.className = 'delete'; delBtn.textContent = '×'; 
    delBtn.addEventListener('click', () => {
      openConfirmModal('Eliminar Prenda', '¿Seguro que deseas eliminar esta prenda del inventario?', 'Eliminar', true, () => deleteGarment(garment.id));
    });
    deleteCell.append(delBtn); row.append(deleteCell);

    row.querySelectorAll('input:not([type="checkbox"])').forEach((input) => input.addEventListener('input', () => queueGarmentSave(garment.id))); body.append(row);
  });

  updateProfitInputLimits(); calculate();
}

async function toggleSoldStatus(id, isSold) {
  const updatePayload = { is_sold: isSold }; if (!isSold) updatePayload.customer_id = null;
  const { error } = await state.client.from('garments').update(updatePayload).eq('id', id);
  if (error) { setStatus(messageFrom(error), 'error'); return; }

  const idx = state.garments.findIndex((g) => g.id === id);
  if (idx > -1) { state.garments[idx].is_sold = isSold; if (!isSold) state.garments[idx].customer_id = null; }

  renderGarments(); renderKpiDashboard(); setStatus(isSold ? 'Prenda marcada como VENDIDA.' : 'Prenda devuelta al stock.', 'success');
}

function selectForCategory(currentCat, onChange) {
  const select = document.createElement('select');
  CATEGORIES.forEach((cat) => { const opt = document.createElement('option'); opt.value = cat; opt.textContent = cat; if (cat.toLowerCase() === String(currentCat).toLowerCase()) opt.selected = true; select.append(opt); });
  select.addEventListener('change', (e) => onChange(e.target.value)); return select;
}

async function saveGarmentField(id, field, value) {
  const { error } = await state.client.from('garments').update({ [field]: value }).eq('id', id);
  if (error) setStatus(messageFrom(error), 'error');
  else { const idx = state.garments.findIndex((g) => g.id === id); if (idx > -1) state.garments[idx][field] = value; setStatus('Cambio guardado.', 'success'); }
}

function renderAllInventory() {
  const body = $('#all-garments-rows'); if (!body) return; body.replaceChildren();

  const query = ($('#inv-search-input')?.value || '').toLowerCase().trim();
  const selectedCat = $('#inv-filter-category')?.value || 'ALL';
  const useMargin = state.settings.profit_mode === 'margin';
  const useValue = state.settings.allocation_method === 'value';

  const tripTotals = {};
  state.trips.forEach((trip) => {
    const tripGarments = state.garments.filter((g) => g.trip_id === trip.id);
    const travel = Number(trip.pasajes) + Number(trip.viaticos) + Number(trip.flete);
    const rate = trip.trip_type === 'local' ? 1 : Number(trip.cotizacion);
    const totalUnits = tripGarments.reduce((sum, item) => sum + Number(item.quantity), 0);
    const totalPurchase = tripGarments.reduce((sum, item) => sum + Number(item.quantity) * Number(item.price_brl) * rate, 0);
    tripTotals[trip.id] = { travel, totalUnits, totalPurchase, rate };
  });

  let filtered = state.garments.filter((g) => !g.is_sold);
  if (query) filtered = filtered.filter((g) => g.name.toLowerCase().includes(query));
  if (selectedCat !== 'ALL') filtered = filtered.filter((g) => (g.category || 'General') === selectedCat);

  const totalUnitsInStock = filtered.reduce((sum, g) => sum + Number(g.quantity || 0), 0);
  if ($('#stock-count-badge')) $('#stock-count-badge').textContent = `${totalUnitsInStock.toLocaleString('es-PY')} un. en stock (${filtered.length} modelos)`;

  filtered.forEach((garment) => {
    const trip = state.trips.find((t) => t.id === garment.trip_id); if (!trip) return;
    const isLocal = trip.trip_type === 'local';
    
    const totals = tripTotals[trip.id];
    const purchase = garment.price_brl * totals.rate;
    const travelPerItem = useValue && totals.totalPurchase > 0 ? purchase * (totals.travel / totals.totalPurchase) : totals.totalUnits > 0 ? totals.travel / totals.totalUnits : 0;
    const realCost = purchase + travelPerItem;
    const safeProfit = useMargin ? Math.min(garment.profit_percentage, 99.99) : garment.profit_percentage;
    const sale = useMargin ? realCost / (1 - safeProfit / 100) : realCost * (1 + safeProfit / 100);

    const saleHtml = isLocal ? formatPYG(sale) : `${formatPYG(sale)} <span class="usd-sub">(${formatUSD(sale)})</span>`;

    const row = document.createElement('tr');
    row.innerHTML = `
      <td style="text-align:left; font-weight:600;">${garment.name}</td>
      <td><span class="role">${garment.category || 'General'}</span></td>
      <td class="money" style="font-size:14px;">${saleHtml}</td>
      <td style="text-align:right; color:var(--muted); font-size:12px;">${trip.name} (${formatDate(trip.created_at)})</td>
    `;
    body.append(row);
  });
}

function renderSoldInventory() {
  const body = $('#sold-garments-rows'); if (!body) return; body.replaceChildren();

  const useMargin = state.settings.profit_mode === 'margin';
  const useValue = state.settings.allocation_method === 'value';

  const tripTotals = {};
  state.trips.forEach((trip) => {
    const tripGarments = state.garments.filter((g) => g.trip_id === trip.id);
    const travel = Number(trip.pasajes) + Number(trip.viaticos) + Number(trip.flete);
    const rate = trip.trip_type === 'local' ? 1 : Number(trip.cotizacion);
    const totalUnits = tripGarments.reduce((sum, item) => sum + Number(item.quantity), 0);
    const totalPurchase = tripGarments.reduce((sum, item) => sum + Number(item.quantity) * Number(item.price_brl) * rate, 0);
    tripTotals[trip.id] = { travel, totalUnits, totalPurchase, rate };
  });

  const soldItems = state.garments.filter((g) => g.is_sold);
  const totalUnitsSold = soldItems.reduce((sum, g) => sum + Number(g.quantity || 0), 0);
  if ($('#sold-count-badge')) $('#sold-count-badge').textContent = `${totalUnitsSold.toLocaleString('es-PY')} un. vendidas (${soldItems.length} modelos)`;

  let totalRecaudado = 0; let totalGanancia = 0;

  soldItems.forEach((garment) => {
    const trip = state.trips.find((t) => t.id === garment.trip_id); if (!trip) return;
    const totals = tripTotals[trip.id];
    const purchase = garment.price_brl * totals.rate;
    const travelPerItem = useValue && totals.totalPurchase > 0 ? purchase * (totals.travel / totals.totalPurchase) : totals.totalUnits > 0 ? totals.travel / totals.totalUnits : 0;
    const realCost = purchase + travelPerItem;
    const safeProfit = useMargin ? Math.min(garment.profit_percentage, 99.99) : garment.profit_percentage;
    const theoreticalSale = useMargin ? realCost / (1 - safeProfit / 100) : realCost * (1 + safeProfit / 100);

    let finalPrice = theoreticalSale;
    let paidAmount = theoreticalSale;
    let debt = 0;

    if (garment.customer_id) {
       const purchaseRec = state.customerPurchases.find(p => p.customer_id === garment.customer_id && p.item_name.includes(garment.name));
       if (purchaseRec) {
          finalPrice = Number(purchaseRec.price_pyg);
          paidAmount = Number(purchaseRec.paid_pyg);
          debt = finalPrice - paidAmount;
       }
    }

    totalRecaudado += paidAmount * garment.quantity; 
    totalGanancia += (paidAmount - realCost) * garment.quantity;

    const customer = garment.customer_id ? state.customers.find((c) => c.id === garment.customer_id) : null;
    const customerBadge = customer ? `<span class="customer-badge">👤 ${customer.name}</span>` : `<span class="badge-unspecified">No especificado</span>`;

    const row = document.createElement('tr');
    row.innerHTML = `
      <td style="text-align:left; font-weight:600;">${garment.name}</td>
      <td><span class="role">${garment.category || 'General'}</span></td>
      <td class="money" style="font-size:14px; color:var(--text);">${formatPYG(finalPrice)}</td>
      <td class="money" style="font-size:14px; color:var(--success);">${formatPYG(paidAmount)}</td>
      <td class="money" style="font-size:14px; color:${debt > 0 ? 'var(--danger)' : 'var(--muted)'};">${formatPYG(debt)}</td>
      <td>${customerBadge}</td>
      <td style="color:var(--muted); font-size:12px;">${trip.name}</td>
      <td><button type="button" class="small-button" style="padding:4px 8px; font-size:11px;">Restaurar</button></td>
    `;
    row.querySelector('button').addEventListener('click', () => { toggleSoldStatus(garment.id, false); renderSoldInventory(); });
    body.append(row);
  });

  if ($('#sold-total-amount')) $('#sold-total-amount').textContent = formatPYG(totalRecaudado);
  if ($('#sold-total-profit')) $('#sold-total-profit').textContent = formatPYG(totalGanancia);
}

// Generación de PDFs Modernos y Descarga Directa
async function generateAndSharePDF(doc, filename) {
  doc.save(filename);
  setStatus('PDF generado y descargado con éxito.', 'success');
}

async function sendWhatsAppTicket(customer, purchases, total, paid, debt) {
  if (!checkFeatureAccess('whatsapp')) return;
  if (!purchases || purchases.length === 0) { setStatus('Cliente sin prendas.', 'error'); return; }
  if (typeof window.jspdf === 'undefined') { setStatus('Error: Motor PDF no cargado.', 'error'); return; }

  setStatus('Generando Comprobante PDF...');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ format: 'a5' }); // Formato para celular
  const bName = (state.business?.name || 'TUBOUTIQUE').toUpperCase();
  const hexColor = state.business?.primary_color || '#b87a70';

  // Cabecera Moderna
  doc.setFillColor(hexColor);
  doc.rect(0, 0, 148, 35, 'F');
  doc.setTextColor(255, 255, 255);

  let textStartX = 10;
  
  // Agregar el logo capturado del DOM
  try {
    const logoImg = document.querySelector('.sidebar-logo');
    if (logoImg && logoImg.complete && logoImg.naturalWidth > 0) {
      const canvas = document.createElement('canvas');
      canvas.width = logoImg.naturalWidth;
      canvas.height = logoImg.naturalHeight;
      canvas.getContext('2d').drawImage(logoImg, 0, 0);
      const imgData = canvas.toDataURL('image/png');
      
      const ratio = logoImg.naturalWidth / logoImg.naturalHeight;
      let finalW = 25 * ratio;
      if(finalW > 40) finalW = 40;
      
      doc.addImage(imgData, 'PNG', 10, 5, finalW, 25, undefined, 'FAST');
      textStartX = 10 + finalW + 5;
    }
  } catch(e) {
    console.warn('El logo no pudo ser insertado en el PDF por restricciones de la imagen', e);
  }

  doc.setFontSize(18);
  doc.text(bName, textStartX, 20);
  doc.setFontSize(9);
  doc.text('RECIBO / COMPROBANTE OFICIAL', textStartX, 28);

  // Datos
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(10);
  doc.text(`Cliente: ${customer.name}`, 10, 45);
  doc.text(`Fecha: ${new Date().toLocaleDateString('es-PY')} - ${new Date().toLocaleTimeString('es-PY').slice(0,5)}`, 10, 52);
  if(customer.phone) doc.text(`Teléfono: ${customer.phone}`, 10, 59);

  const tableData = purchases.map((p) => [
    p.item_name, 
    formatPYG(p.price_pyg), 
    formatPYG(p.paid_pyg), 
    formatPYG(Number(p.price_pyg) - Number(p.paid_pyg))
  ]);

  doc.autoTable({
    startY: 65,
    head: [['Prenda', 'Total', 'Abonado', 'Saldo']],
    body: tableData,
    headStyles: { fillColor: hexColor, textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: '#f9f9f9' },
    theme: 'grid',
    margin: { left: 10, right: 10 }
  });

  const finalY = doc.lastAutoTable.finalY + 10;
  
  // Resumen final
  doc.setFillColor('#f4f4f4');
  doc.rect(10, finalY, 128, 30, 'F');
  doc.setTextColor(40, 40, 40);
  doc.setFontSize(10);
  doc.text(`Total Compras: ${formatPYG(total)}`, 15, finalY + 8);
  doc.text(`Total Abonado: ${formatPYG(paid)}`, 15, finalY + 15);
  
  doc.setFontSize(12);
  doc.setTextColor(debt > 0 ? 200 : 40, debt > 0 ? 50 : 150, 50); 
  doc.text(`SALDO A COBRAR: ${formatPYG(debt)}`, 15, finalY + 25);

  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text('¡Gracias por tu preferencia!', 74, finalY + 40, { align: 'center' });

  const safeName = customer.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  await generateAndSharePDF(doc, `Recibo_${safeName}.pdf`);
}

async function sendWhatsAppCatalog() {
  if (!checkFeatureAccess('whatsapp')) return;
  if (typeof window.jspdf === 'undefined') { setStatus('Error: Motor PDF no cargado.', 'error'); return; }

  const available = state.garments.filter((g) => !g.is_sold && g.quantity > 0);
  if (available.length === 0) { setStatus('No hay stock para el catálogo.', 'error'); return; }

  setStatus('Construyendo Catálogo PDF Profesional...');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ format: 'a4' });
  const bName = (state.business?.name || 'TUBOUTIQUE').toUpperCase();
  const hexColor = state.business?.primary_color || '#b87a70';

  doc.setFillColor(hexColor);
  doc.rect(0, 0, 210, 40, 'F');
  doc.setTextColor(255, 255, 255);
  
  let textStartX = 14;
  
  try {
    const logoImg = document.querySelector('.sidebar-logo');
    if (logoImg && logoImg.complete && logoImg.naturalWidth > 0) {
      const canvas = document.createElement('canvas');
      canvas.width = logoImg.naturalWidth;
      canvas.height = logoImg.naturalHeight;
      canvas.getContext('2d').drawImage(logoImg, 0, 0);
      const imgData = canvas.toDataURL('image/png');
      
      const ratio = logoImg.naturalWidth / logoImg.naturalHeight;
      let finalW = 30 * ratio;
      if(finalW > 50) finalW = 50;
      
      doc.addImage(imgData, 'PNG', 14, 5, finalW, 30, undefined, 'FAST');
      textStartX = 14 + finalW + 5;
    }
  } catch(e) { console.warn('El logo no pudo ser insertado en el PDF por restricciones de la imagen', e); }

  doc.setFontSize(24);
  doc.text(bName, textStartX, 25);
  doc.setFontSize(12);
  doc.text('CATÁLOGO OFICIAL DE STOCK', textStartX, 32);

  const tableData = available.map((g) => [
    g.name, 
    g.category || 'General', 
    `${g.quantity} un.`, 
    formatPYG(calculateGarmentSalePrice(g))
  ]);

  doc.autoTable({
    startY: 45,
    head: [['Prenda', 'Categoría', 'Stock', 'Precio de Venta']],
    body: tableData,
    headStyles: { fillColor: hexColor, textColor: 255, fontSize: 10 },
    alternateRowStyles: { fillColor: '#f9f9f9' },
    theme: 'grid'
  });

  await generateAndSharePDF(doc, `Catalogo_${bName.replace(/\s+/g,'_')}.pdf`);
}

// Editar Nombre y Teléfono del Cliente
function editCustomerModalConfig(customer) {
  $('#edit-customer-id').value = customer.id;
  $('#edit-customer-name').value = customer.name;
  $('#edit-customer-phone').value = customer.phone || '';
  show('#edit-customer-modal');
}

async function handleEditCustomerSubmit(e) {
  e.preventDefault();
  const id = $('#edit-customer-id').value;
  const newName = $('#edit-customer-name').value.trim();
  const newPhone = $('#edit-customer-phone').value.trim();

  if (!newName) return;
  setStatus('Actualizando cliente...');

  const { error } = await state.client.from('customers').update({ name: newName, phone: newPhone }).eq('id', id);
  if (error) { setStatus(messageFrom(error), 'error'); return; }

  const idx = state.customers.findIndex(c => c.id === id);
  if (idx > -1) {
    state.customers[idx].name = newName;
    state.customers[idx].phone = newPhone;
  }
  
  hide('#edit-customer-modal');
  renderCustomersMainView();
  setStatus('Cliente actualizado.', 'success');
}

function renderCustomersMainView() {
  const container = $('#customers-list-container-main'); if (!container) return; container.replaceChildren();
  const query = ($('#customer-search-input-main')?.value || '').toLowerCase().trim();

  let filtered = state.customers;
  if (query) filtered = filtered.filter((c) => c.name.toLowerCase().includes(query) || (c.phone || '').includes(query));

  let totalDebtGlobal = 0; let totalPaidGlobal = 0;

  filtered.forEach((customer) => {
    const purchases = state.customerPurchases.filter((p) => p.customer_id === customer.id);
    let totalClientPrice = 0; let totalClientPaid = 0;

    purchases.forEach((p) => { totalClientPrice += Number(p.price_pyg || 0); totalClientPaid += Number(p.paid_pyg || 0); });
    const clientDebt = totalClientPrice - totalClientPaid;
    totalDebtGlobal += Math.max(0, clientDebt); totalPaidGlobal += totalClientPaid;

    const card = document.createElement('div'); card.className = 'customer-card customer-card-pro';
    const isPaidOut = clientDebt <= 0 && purchases.length > 0;
    const badgeHtml = isPaidOut ? `<span class="badge-paid">✓ Cuenta Al Día</span>` : clientDebt > 0 ? `<span class="badge-debt">Pendiente: ${formatPYG(clientDebt)}</span>` : `<span class="badge-paid">Sin Movimientos</span>`;

    let itemsListHtml = '';
    if (purchases.length === 0) itemsListHtml = `<p style="font-size:12px; color:var(--muted); padding:10px 0;">No tiene prendas registradas en su libreta.</p>`;
    else {
      itemsListHtml = purchases.map((p) => {
        const itemDebt = Number(p.price_pyg) - Number(p.paid_pyg);
        const isItemPaid = itemDebt <= 0;
        
        return `
        <div class="customer-item-row" style="flex-direction:column; align-items:stretch; gap:6px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span class="customer-item-title">${p.item_name}</span>
            <button type="button" class="delete" style="padding:2px 6px; font-size:10px;" data-del-purchase="${p.id}">×</button>
          </div>
          <div class="customer-item-financials">
            <div class="financial-col">
              <span>Total Prenda</span>
              <strong style="color:var(--text);">${formatPYG(p.price_pyg)}</strong>
            </div>
            <div class="financial-col">
              <span>Pagado</span>
              <strong style="color:var(--success);">${formatPYG(p.paid_pyg)}</strong>
            </div>
            <div class="financial-col">
              <span>A Pagar</span>
              <strong style="color:${isItemPaid ? 'var(--success)' : 'var(--danger)'};">${isItemPaid ? '0 PYG' : formatPYG(itemDebt)}</strong>
            </div>
          </div>
        </div>`;
      }).join('');
    }

    card.innerHTML = `<div class="customer-card-header"><div><p class="customer-name">${customer.name}</p><p class="customer-phone">${customer.phone ? '📱 ' + customer.phone : 'Sin número de teléfono'}</p></div>${badgeHtml}</div>
    <div class="customer-items-list">${itemsListHtml}</div>
    <div class="customer-actions">
      <button type="button" class="small-button dark" data-add-item="${customer.id}">+ Prenda</button>
      ${clientDebt > 0 ? `<button type="button" class="small-button" data-pay-debt="${customer.id}" style="border-color:#438a5e; color:#438a5e; font-weight:bold;">💵 Pago</button>` : ''}
      <button type="button" class="small-button whatsapp-btn" data-wa-ticket="${customer.id}">📄 PDF</button>
      <button type="button" class="small-button" data-wa-chat="${customer.id}">💬 WPP</button>
      <button type="button" class="small-button" data-edit-customer="${customer.id}" style="color:var(--text);">✏️ Editar</button>
      <button type="button" class="small-button" data-del-customer="${customer.id}" style="color:var(--danger);">Borrar</button>
    </div>`;

    card.querySelector(`[data-add-item="${customer.id}"]`)?.addEventListener('click', () => openPosModal(customer));
    card.querySelector(`[data-pay-debt="${customer.id}"]`)?.addEventListener('click', () => openPaymentModal(customer, purchases, clientDebt));
    card.querySelector(`[data-wa-ticket="${customer.id}"]`)?.addEventListener('click', () => sendWhatsAppTicket(customer, purchases, totalClientPrice, totalClientPaid, clientDebt));
    card.querySelector(`[data-edit-customer="${customer.id}"]`)?.addEventListener('click', () => editCustomerModalConfig(customer));
    
    card.querySelector(`[data-del-customer="${customer.id}"]`)?.addEventListener('click', () => {
      openConfirmModal('Eliminar Cliente', `¿Estás seguro de eliminar a ${customer.name} y todo su historial de compras?`, 'Eliminar', true, () => deleteCustomer(customer.id));
    });
    
    card.querySelector(`[data-wa-chat="${customer.id}"]`)?.addEventListener('click', () => {
      if(!customer.phone) { setStatus('Este cliente no tiene teléfono.', 'error'); return; }
      const num = customer.phone.replace(/\D/g, '');
      window.open(`https://wa.me/${num}?text=Hola%20${customer.name},%20te%20escribimos%20de%20${state.business?.name||'TUBOUTIQUE'}...`, '_blank');
    });

    card.querySelectorAll('[data-del-purchase]').forEach((btn) => { 
      btn.addEventListener('click', (e) => {
        openConfirmModal('Eliminar Prenda', '¿Borrar esta prenda del historial del cliente?', 'Eliminar', true, () => deletePurchase(e.target.getAttribute('data-del-purchase')));
      }); 
    });
    container.append(card);
  });

  if ($('#customers-total-debt-main')) $('#customers-total-debt-main').textContent = formatPYG(totalDebtGlobal);
  if ($('#customers-total-paid-main')) $('#customers-total-paid-main').textContent = formatPYG(totalPaidGlobal);
  if ($('#customers-total-count-main')) $('#customers-total-count-main').textContent = `${filtered.length} clientes`;
}

function openNewCustomerModal() {
  if (!checkFeatureAccess('customers')) return;
  $('#new-customer-name').value = '';
  $('#new-customer-phone').value = '';
  show('#new-customer-modal');
}

async function handleNewCustomerSubmit(e) {
  e.preventDefault();
  const name = $('#new-customer-name').value.trim();
  const phone = $('#new-customer-phone').value.trim();

  setStatus('Guardando cliente...');
  const { data, error } = await state.client.from('customers').insert({ 
    business_id: state.membership.business_id, 
    name: name, 
    phone: phone
  }).select().single();

  if (error) { setStatus(messageFrom(error), 'error'); return; }
  
  state.customers.unshift(data); 
  hide('#new-customer-modal');
  if (state.currentView === 'customers') renderCustomersMainView(); 
  renderKpiDashboard(); 
  setStatus(`Cliente "${data.name}" agregado.`, 'success');
}

function openPaymentModal(customer, purchases, totalDebt) {
  state.paymentCustomer = customer;
  state.paymentPurchases = purchases;
  state.paymentTotalDebt = totalDebt;
  
  $('#payment-modal-debt').textContent = formatPYG(totalDebt);
  $('#payment-modal-amount').value = '';
  show('#custom-payment-modal');
  $('#payment-modal-amount').focus();
}

async function handlePaymentSubmit(e) {
  e.preventDefault();
  const amountStr = $('#payment-modal-amount').value;
  let amount = number(amountStr, 0); 
  
  if (amount <= 0) {
    setStatus('Ingresa un monto válido.', 'error');
    return;
  }

  const pendingPurchases = state.paymentPurchases.filter((p) => Number(p.price_pyg) > Number(p.paid_pyg)).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  for (const p of pendingPurchases) {
    if (amount <= 0) break;
    const due = Number(p.price_pyg) - Number(p.paid_pyg); 
    const payForThis = Math.min(due, amount); 
    const newPaid = Number(p.paid_pyg) + payForThis; 
    amount -= payForThis;
    
    const { error } = await state.client.from('customer_purchases').update({ paid_pyg: newPaid }).eq('id', p.id);
    if (!error) { 
      const idx = state.customerPurchases.findIndex((cp) => cp.id === p.id); 
      if (idx > -1) state.customerPurchases[idx].paid_pyg = newPaid; 
    }
  }
  
  hide('#custom-payment-modal');
  if (state.currentView === 'customers') renderCustomersMainView(); 
  renderKpiDashboard(); 
  setStatus(`Pago de ${state.paymentCustomer.name} asentado con éxito.`, 'success');
}

async function deleteCustomer(id) {
  const { error } = await state.client.from('customers').delete().eq('id', id);
  if (error) { setStatus(messageFrom(error), 'error'); return; }
  state.customers = state.customers.filter((c) => c.id !== id); state.customerPurchases = state.customerPurchases.filter((cp) => cp.customer_id !== id);
  if (state.currentView === 'customers') renderCustomersMainView(); renderKpiDashboard(); setStatus('Cliente eliminado.', 'success');
}

async function deletePurchase(purchaseId) {
  const { error } = await state.client.from('customer_purchases').delete().eq('id', purchaseId);
  if (error) { setStatus(messageFrom(error), 'error'); return; }
  state.customerPurchases = state.customerPurchases.filter((cp) => cp.id !== purchaseId);
  if (state.currentView === 'customers') renderCustomersMainView(); renderKpiDashboard(); setStatus('Registro eliminado.', 'success');
}

function exportProXlsx() {
  if (typeof window.XLSX === 'undefined') { setStatus('Error: La librería SheetJS (XLSX) no está cargada.', 'error'); return; }
  const trip = state.trips.find((t) => t.id === state.currentTripId); if (!trip) { setStatus('No hay un ingreso activo seleccionado para exportar.', 'error'); return; }
  const tripGarments = state.garments.filter((g) => g.trip_id === state.currentTripId); if (tripGarments.length === 0) { setStatus('Este ingreso no posee prendas registradas para exportar.', 'error'); return; }

  setStatus('Generando archivo Excel profesional…');
  const rate = trip.trip_type === 'local' ? 1 : Number(trip.cotizacion || 0); 
  const travel = Number(trip.pasajes || 0) + Number(trip.viaticos || 0) + Number(trip.flete || 0);
  const totalUnits = tripGarments.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const totalPurchaseBrl = tripGarments.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.price_brl || 0), 0);
  const totalPurchasePyg = totalPurchaseBrl * rate;

  const useMargin = state.settings?.profit_mode === 'margin'; const useValue = state.settings?.allocation_method === 'value';
  const usdRate = state.liveRates?.usdToPyg || 7500; const boutiqueName = (state.business?.name || 'TUBOUTIQUE').toUpperCase();

  const aoa = [];
  aoa.push([`SISTEMA DE GESTIÓN BOUTIQUE - ${boutiqueName}`]); aoa.push([`REPORTE DE INGRESO: ${trip.name.toUpperCase()}`]); aoa.push([`Fecha de Exportación: ${new Date().toLocaleDateString('es-PY')} ${new Date().toLocaleTimeString('es-PY')}`]); aoa.push([]);
  aoa.push(['CONFIGURACIÓN Y GASTOS DEL INGRESO', '']); aoa.push(['Cotización Aplicada (BRL/USD a PYG):', rate]); aoa.push(['Gastos en Pasajes/Movilidad (PYG):', Number(trip.pasajes || 0)]); aoa.push(['Gastos en Viáticos/Varios (PYG):', Number(trip.viaticos || 0)]); aoa.push(['Gastos en Fletes/Envíos (PYG):', Number(trip.flete || 0)]); aoa.push(['Total Gastos Extra (PYG):', travel]); aoa.push(['Total Unidades del Ingreso:', totalUnits]); aoa.push(['Método de Cálculo de Ganancia:', useMargin ? 'Margen Comercial sobre Venta' : 'Markup sobre Costo']); aoa.push(['Distribución de Fletes:', useValue ? 'Proporcional al Valor de Compra' : 'Por Cantidad de Unidades']); aoa.push([]);
  aoa.push(['Estado Vendido', 'Prenda / Producto', 'Categoría', 'Cantidad', 'Costo Moneda Origen', 'Compra PYG', '+ Gastos PYG', 'Costo Real PYG', 'Ganancia %', 'Precio Venta PYG', 'Precio Venta USD']);

  let sumRealCostTotal = 0; let sumSaleTotalPyg = 0;

  tripGarments.forEach((garment) => {
    const qty = Number(garment.quantity || 0); const priceBrl = Number(garment.price_brl || 0); const purchasePyg = priceBrl * rate;
    const travelPerItem = useValue && totalPurchasePyg > 0 ? purchasePyg * (travel / totalPurchasePyg) : totalUnits > 0 ? travel / totalUnits : 0;
    const realCostPyg = purchasePyg + travelPerItem; const safeProfit = useMargin ? Math.min(Number(garment.profit_percentage || 0), 99.99) : Number(garment.profit_percentage || 0);
    const salePyg = useMargin ? realCostPyg / (1 - safeProfit / 100) : realCostPyg * (1 + safeProfit / 100);
    const saleUsd = usdRate > 0 ? salePyg / usdRate : 0;

    sumRealCostTotal += realCostPyg * qty; sumSaleTotalPyg += salePyg * qty;
    aoa.push([garment.is_sold ? 'SI' : 'NO', garment.name, garment.category || 'General', qty, priceBrl, Math.round(purchasePyg), Math.round(travelPerItem), Math.round(realCostPyg), Number(garment.profit_percentage || 0), Math.round(salePyg), Number(saleUsd.toFixed(2))]);
  });

  aoa.push([]); aoa.push(['TOTALES Y CONSOLIDADOS', '', '', totalUnits, Number(totalPurchaseBrl.toFixed(2)), Math.round(totalPurchasePyg), travel, Math.round(sumRealCostTotal), '', Math.round(sumSaleTotalPyg), Number((sumSaleTotalPyg / usdRate).toFixed(2))]);

  const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 15 }, { wch: 32 }, { wch: 20 }, { wch: 12 }, { wch: 18 }, { wch: 16 }, { wch: 15 }, { wch: 16 }, { wch: 12 }, { wch: 20 }, { wch: 18 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Reporte de Ingreso');
  const safeTripName = trip.name.replace(/[^a-zA-Z0-9_-]/g, '_'); const dateStr = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${boutiqueName}_${safeTripName}_${dateStr}.xlsx`);
  setStatus('¡Planilla Excel (.xlsx) exportada con éxito!', 'success');
}

// Exportar Base de Datos Completa
function exportAllData() {
  if (typeof window.XLSX === 'undefined') { setStatus('Librería Excel no cargada.', 'error'); return; }
  setStatus('Generando respaldo total de la tienda...');

  const wb = XLSX.utils.book_new();
  
  // 1. Exportar Stock Disponible
  const stock = state.garments.filter(g => !g.is_sold).map(g => ({
    Prenda: g.name, Categoria: g.category, Cantidad: g.quantity, 
    Costo_Origen: g.price_brl, Porcentaje_Ganancia: g.profit_percentage
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stock), 'Stock Disponible');

  // 2. Exportar Historial de Ventas
  const sold = state.garments.filter(g => g.is_sold).map(g => ({
    Prenda: g.name, Categoria: g.category, Cantidad: g.quantity,
    Cliente_Asignado: g.customer_id ? state.customers.find(c => c.id === g.customer_id)?.name : 'N/A'
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sold), 'Prendas Vendidas');

  // 3. Exportar CRM (Clientes y Fiados)
  const crm = state.customers.map(c => {
    const purchases = state.customerPurchases.filter(p => p.customer_id === c.id);
    const totalComprado = purchases.reduce((sum, p) => sum + Number(p.price_pyg), 0);
    const totalPagado = purchases.reduce((sum, p) => sum + Number(p.paid_pyg), 0);
    return {
      Cliente: c.name, Telefono: c.phone || 'N/A', 
      Total_Comprado_PYG: totalComprado, Total_Abonado_PYG: totalPagado, Saldo_Deuda_PYG: (totalComprado - totalPagado)
    };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(crm), 'Cartera Clientes');

  // Descargar Archivo
  const bName = state.business?.name.replace(/[^a-zA-Z0-9]/g, '_') || 'Boutique';
  const dateStr = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Respaldo_Total_${bName}_${dateStr}.xlsx`);
  setStatus('Respaldo descargado exitosamente.', 'success');
}

function parseUniversalExcelNumber(value, fallback = 0) {
  if (typeof value === 'number') return isNaN(value) ? fallback : value;
  if (!value) return fallback;
  let str = String(value).trim().toLowerCase();
  str = str.replace(/(r\$|\$|pyg|gs|usd|brl|reales|guaranies|dolares)/gi, '').trim();
  if (!str) return fallback;
  if (str.includes(',') && str.includes('.')) { if (str.indexOf('.') < str.indexOf(',')) str = str.replace(/\./g, '').replace(',', '.'); else str = str.replace(/,/g, ''); } 
  else if (str.includes(',')) str = str.replace(',', '.');
  str = str.replace(/[^0-9.-]/g, ''); const parsed = parseFloat(str); return isNaN(parsed) ? fallback : parsed;
}

function normalizeHeaderKey(str) { return String(str || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, ""); }

async function handleExcelUpload(event) {
  const file = event.target.files[0]; if (!file) return;
  if (typeof window.XLSX === 'undefined') { setStatus('Error: SheetJS no disponible.', 'error'); return; }
  if (!state.currentTripId) { setStatus('No hay un viaje activo para asociar la importación.', 'error'); return; }

  setStatus('Leyendo e interpretando archivo Excel…');
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = new Uint8Array(e.target.result); const workbook = window.XLSX.read(data, { type: 'array' });
      if (!workbook.SheetNames.length) return;

      let rawSheetData = null;
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName]; const json = window.XLSX.utils.sheet_to_json(sheet, { defval: '' });
        if (json && json.length > 0) { rawSheetData = json; break; }
      }

      if (!rawSheetData || rawSheetData.length === 0) { setStatus('La planilla no contiene filas con información.', 'error'); return; }

      const PATTERNS = {
        name: ['prenda', 'nombre', 'producto', 'item', 'descripcion', 'modelo', 'articulo', 'detalle', 'concepto', 'titulo'], category: ['categoria', 'cat', 'tipo', 'grupo', 'seccion', 'rubro', 'linea', 'departamento'], quantity: ['cantidad', 'cant', 'qty', 'unidades', 'un', 'unid', 'stock', 'piezas', 'u'], price: ['costobrl', 'preciobrl', 'costo', 'precio', 'costo_brl', 'brl', 'valbrl', 'monto', 'punit', 'pu', 'unitario', 'compra', 'valor'], profit: ['ganancia', 'gananciaporcentaje', 'profit', 'markup', 'margen', 'porcentaje', 'mar', 'utilidad'], sold: ['vendido', 'status', 'estado', 'vendida', 'sold', 'sale', 'venta']
      };

      const itemsToInsert = [];
      for (let i = 0; i < rawSheetData.length; i++) {
        const rawRow = rawSheetData[i]; const normalizedRow = {};
        Object.keys(rawRow).forEach((k) => { normalizedRow[normalizeHeaderKey(k)] = rawRow[k]; });

        const findValue = (patterns) => { for (const pattern of patterns) { for (const rowKey in normalizedRow) { if (rowKey.includes(pattern)) return normalizedRow[rowKey]; } } return null; };

        const rawNameVal = findValue(PATTERNS.name); const rawCatVal = findValue(PATTERNS.category); const rawQtyVal = findValue(PATTERNS.quantity); const rawPriceVal = findValue(PATTERNS.price); const rawProfitVal = findValue(PATTERNS.profit); const rawSoldVal = findValue(PATTERNS.sold);

        if (!rawNameVal && !rawPriceVal) continue;

        const name = String(rawNameVal || '').trim() || `Prenda Importada ${i + 1}`;
        const rawCatStr = normalizeHeaderKey(rawCatVal);
        const matchedCategory = CATEGORIES.find((c) => normalizeHeaderKey(c) === rawCatStr) || 'General';
        const quantity = Math.max(0.01, parseUniversalExcelNumber(rawQtyVal, 1));
        const priceBrl = Math.max(0, parseUniversalExcelNumber(rawPriceVal, 0));
        const profitPercentage = Math.max(0, parseUniversalExcelNumber(rawProfitVal, 100));
        const soldStr = String(rawSoldVal || '').trim().toUpperCase();
        const isSold = ['SI', 'SÍ', 'TRUE', '1', 'VENDIDO', 'VENDIDA', 'SOLD'].includes(soldStr);

        itemsToInsert.push({ business_id: state.membership.business_id, trip_id: state.currentTripId, name: name, quantity: quantity, price_brl: priceBrl, profit_percentage: profitPercentage, category: matchedCategory, is_sold: isSold, updated_by: state.user.id });
      }

      if (itemsToInsert.length === 0) { setStatus('No se lograron estructurar prendas válidas.', 'error'); return; }

      setStatus(`Cargando ${itemsToInsert.length} prendas automáticamente al viaje…`);
      const { data: inserted, error } = await state.client.from('garments').insert(itemsToInsert).select();
      if (error) { setStatus(messageFrom(error), 'error'); return; }

      state.garments.unshift(...inserted); renderGarments(); renderAllInventory(); renderKpiDashboard();
      setStatus(`¡Se cargaron e importaron automáticamente ${inserted.length} prendas al viaje!`, 'success');

    } catch (err) { console.error(err); setStatus('Error al procesar la lectura del archivo Excel.', 'error'); } finally { event.target.value = ''; }
  };
  reader.readAsArrayBuffer(file);
}

async function confirmExcelImport() {
  if (!state.pendingExcelItems.length) return; hide('#excel-modal'); setStatus('Guardando prendas en Supabase…');
  const { data: inserted, error } = await state.client.from('garments').insert(state.pendingExcelItems).select();
  if (error) { setStatus(messageFrom(error), 'error'); return; }

  state.garments.unshift(...inserted); state.pendingExcelItems = []; renderGarments(); renderKpiDashboard(); setStatus(`¡Importadas ${inserted.length} prendas!`, 'success');
}

function inputFor(field, value, attributes = {}) {
  const input = document.createElement('input'); input.dataset.field = field; input.value = value; input.setAttribute('aria-label', field);
  Object.entries(attributes).forEach(([key, attrValue]) => input.setAttribute(key, attrValue)); return input;
}

function updateProfitInputLimits() {
  const mode = $('#profit-mode')?.value; const max = mode === 'margin' ? '99.99' : '999.99';
  document.querySelectorAll('[data-field="profit_percentage"]').forEach((input) => input.max = max);
}

function queueSettingsSave() { calculate(); clearTimeout(state.settingsTimer); state.settingsTimer = setTimeout(saveSettings, 550); }

async function saveSettings() {
  const tripValues = { cotizacion: Math.max(0, number($('#cotizacion')?.value)), pasajes: Math.max(0, number($('#pasajes')?.value)), viaticos: Math.max(0, number($('#viaticos')?.value)), flete: Math.max(0, number($('#flete')?.value)) };
  const settingValues = { profit_mode: $('#profit-mode')?.value, allocation_method: $('#allocation-method')?.value };

  const [tripRes, setRes] = await Promise.all([ state.client.from('trips').update(tripValues).eq('id', state.currentTripId), state.client.from('business_settings').update(settingValues).eq('business_id', state.membership.business_id) ]);

  if (tripRes.error || setRes.error) setStatus(messageFrom(tripRes.error || setRes.error), 'error');
  else {
    const idx = state.trips.findIndex((t) => t.id === state.currentTripId);
    if (idx > -1) state.trips[idx] = { ...state.trips[idx], ...tripValues };
    state.settings = { ...state.settings, ...settingValues }; setStatus('Cambios guardados.', 'success');
  }
}

function queueGarmentSave(id) { calculate(); clearTimeout(state.garmentTimers.get(id)); state.garmentTimers.set(id, setTimeout(() => saveGarment(id), 550)); }

async function saveGarment(id) {
  const row = document.querySelector(`#garment-rows tr[data-id="${id}"]`); if (!row) return; const payload = {};
  row.querySelectorAll('[data-field]').forEach((input) => { payload[input.dataset.field] = input.dataset.field === 'name' ? input.value.trim() : number(input.value); });
  if (!payload.name) { setStatus('Ingresá un nombre para la prenda.', 'error'); return; }

  const { data, error } = await state.client.from('garments').update(payload).eq('id', id).select().single();
  if (error) { setStatus(messageFrom(error), 'error'); return; }
  state.garments = state.garments.map((item) => item.id === id ? data : item); setStatus('Prenda guardada.', 'success');
}

async function addGarment() {
  const { data, error } = await state.client.from('garments').insert({ business_id: state.membership.business_id, trip_id: state.currentTripId, name: 'Nueva prenda', category: 'General', quantity: 1, price_brl: 0, profit_percentage: 100, is_sold: false, updated_by: state.user.id }).select().single();
  if (error) { setStatus(messageFrom(error), 'error'); return; }
  state.garments.unshift(data); renderGarments(); document.querySelector(`#garment-rows tr[data-id="${data.id}"] [data-field="name"]`)?.focus(); setStatus('Prenda agregada.', 'success');
}

async function deleteGarment(id) {
  const { error } = await state.client.from('garments').delete().eq('id', id);
  if (error) { setStatus(messageFrom(error), 'error'); return; }
  state.garments = state.garments.filter((item) => item.id !== id); renderGarments(); renderKpiDashboard(); setStatus('Prenda eliminada.', 'success');
}

async function createBusiness(event) {
  event.preventDefault(); 
  const name = $('#business-name')?.value.trim(); if (!name) return;
  setStatus('Creando tu boutique...');
  const { data, error } = await state.client.rpc('create_business', { business_name: name });
  if (error) setStatus(messageFrom(error), 'error'); else await refreshWorkspace();
}

async function loadInvitations() {
  const { data, error } = await state.client.from('invitations').select('id, email, role, created_at').eq('business_id', state.membership.business_id);
  if (error) return;
  const list = $('#invite-list'); if (!list) return; list.replaceChildren();
  data.forEach((invite) => { const item = document.createElement('li'); item.textContent = `${invite.email} (${invite.role})`; list.append(item); });
}

async function createInvitation(event) {
  event.preventDefault();
  const planInfo = getEffectivePlan(); 
  const maxUsers = planInfo.plan === 'emprendedora' ? 2 : 5;
  const teamCount = $('#invite-list')?.children?.length || 1;
  
  if (teamCount >= maxUsers) { 
    setStatus(`Límite alcanzado (${maxUsers}). Por favor renueva o subí tu plan contactando a Alex.`, 'error'); 
    return; 
  }

  const email = $('#invite-email')?.value.trim().toLowerCase(); const role = $('#invite-role')?.value;
  const { data, error } = await state.client.rpc('invite_member', { target_business_id: state.membership.business_id, target_email: email, target_role: role });
  if (error) setStatus(messageFrom(error), 'error');
  else { $('#invite-form')?.reset(); setStatus(data === 'joined' ? 'Usuario agregado.' : 'Invitación enviada.', 'success'); await loadInvitations(); }
}

async function handleAuth(event) {
  event.preventDefault(); authError();
  const fullName = $('#full-name')?.value.trim(); const email = $('#email')?.value.trim(); const password = $('#password')?.value;
  if (fullName) localStorage.setItem('tuboutique_user_name', fullName);

  let result;
  if (state.registerMode) result = await state.client.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
  else result = await state.client.auth.signInWithPassword({ email, password });

  if (result.error) authError(messageFrom(result.error)); else triggerWelcomeSplash(fullName);
}

async function initialize() {
  if (!ready) { show('#setup-warning'); return; }
  state.client = createClient(config.supabaseUrl, config.supabaseAnonKey);

  $('#auth-form')?.addEventListener('submit', handleAuth);
  $('#auth-toggle')?.addEventListener('click', () => setAuthMode(!state.registerMode));
  $('#business-form')?.addEventListener('submit', createBusiness);
  $('#logout-button')?.addEventListener('click', () => state.client.auth.signOut());
  $('#onboarding-logout')?.addEventListener('click', () => state.client.auth.signOut());
  
  $('#add-garment')?.addEventListener('click', addGarment);
  $('#export-button')?.addEventListener('click', exportProXlsx);
  $('#print-button')?.addEventListener('click', () => window.print());
  $('#invite-form')?.addEventListener('submit', createInvitation);

  $('#search-input')?.addEventListener('input', renderGarments); $('#filter-category')?.addEventListener('change', renderGarments); $('#sort-select')?.addEventListener('change', renderGarments);
  $('#inv-search-input')?.addEventListener('input', renderAllInventory); $('#inv-filter-category')?.addEventListener('change', renderAllInventory);
  $('#customer-search-input-main')?.addEventListener('input', renderCustomersMainView); 
  
  $('#add-customer-btn-main')?.addEventListener('click', openNewCustomerModal);
  $('#new-customer-form')?.addEventListener('submit', handleNewCustomerSubmit);
  $('#close-new-customer-modal')?.addEventListener('click', () => hide('#new-customer-modal'));

  $('#close-edit-customer-modal')?.addEventListener('click', () => hide('#edit-customer-modal'));
  $('#edit-customer-form')?.addEventListener('submit', handleEditCustomerSubmit);

  $('#excel-file-input')?.addEventListener('change', handleExcelUpload);
  $('#close-excel-modal')?.addEventListener('click', () => hide('#excel-modal')); $('#btn-cancel-import')?.addEventListener('click', () => hide('#excel-modal')); $('#btn-confirm-import')?.addEventListener('click', confirmExcelImport);

  $('#close-upgrade-modal')?.addEventListener('click', () => hide('#plan-upgrade-modal'));
  $('#btn-request-upgrade')?.addEventListener('click', () => window.open(ALEX_WHATSAPP_URL, '_blank'));
  $('#btn-pay-renewal')?.addEventListener('click', () => window.open(ALEX_WHATSAPP_URL, '_blank'));
  $('#btn-support-wa')?.addEventListener('click', () => window.open(ALEX_SUPPORT_URL, '_blank'));
  $('#btn-renew-whatsapp')?.addEventListener('click', () => window.open(ALEX_WHATSAPP_URL, '_blank'));

  $('#btn-open-math-modal')?.addEventListener('click', () => show('#math-modal')); $('#close-math-modal')?.addEventListener('click', () => hide('#math-modal'));
  $('#close-pos-modal')?.addEventListener('click', () => hide('#pos-modal')); $('#pos-search-input')?.addEventListener('input', renderPosStock);
  $('#pos-payment-type')?.addEventListener('change', (e) => { if (e.target.value === 'CREDIT') show('#pos-initial-pay-group'); else hide('#pos-initial-pay-group'); });
  
  $('#custom-payment-form')?.addEventListener('submit', handlePaymentSubmit);
  $('#close-payment-modal')?.addEventListener('click', () => hide('#custom-payment-modal'));

  $('#btn-add-manual-debt')?.addEventListener('click', openManualDebtModal);
  $('#manual-debt-form')?.addEventListener('submit', (e) => { e.preventDefault(); processManualDebt(); });
  $('#close-manual-debt-modal')?.addEventListener('click', () => hide('#manual-debt-modal'));
  $('#cancel-manual-debt-btn')?.addEventListener('click', () => hide('#manual-debt-modal'));

  $('#btn-confirm-pos-checkout')?.addEventListener('click', processPosCheckout);

  $('#btn-fetch-rates')?.addEventListener('click', fetchLiveExchangeRates); 
  $('#btn-apply-brl')?.addEventListener('click', applyLiveBrlRate); 
  $('#btn-apply-usd')?.addEventListener('click', applyLiveUsdRate);
  $('#btn-apply-pyg')?.addEventListener('click', applyLivePygRate);
  
  $('#btn-share-catalog-wa')?.addEventListener('click', sendWhatsAppCatalog); 
  $('#branding-form')?.addEventListener('submit', saveBranding);
  
  $('#brand-logo-input')?.addEventListener('input', (e) => {
    if ($('#brand-logo-preview')) {
      $('#brand-logo-preview').src = e.target.value || 'Logo.png';
    }
  });

  $('#profile-pwd-form')?.addEventListener('submit', handlePasswordChange);

  $('#btn-export-all')?.addEventListener('click', exportAllData);

  $('#confirm-modal-btn')?.addEventListener('click', () => {
    if(confirmCallback) confirmCallback();
    hide('#custom-confirm-modal');
  });
  $('#close-confirm-modal')?.addEventListener('click', () => hide('#custom-confirm-modal'));
  $('#cancel-confirm-modal')?.addEventListener('click', () => hide('#custom-confirm-modal'));

  $('#prompt-modal-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if(promptCallback) promptCallback($('#prompt-modal-input').value);
    hide('#custom-prompt-modal');
  });
  $('#close-prompt-modal')?.addEventListener('click', () => hide('#custom-prompt-modal'));
  $('#cancel-prompt-modal')?.addEventListener('click', () => hide('#custom-prompt-modal'));

  $('#quick-go-calc')?.addEventListener('click', () => { state.currentView = 'calc'; loadCurrentView(); renderSidebarNav(); });
  $('#quick-go-stock')?.addEventListener('click', () => { state.currentView = 'inventory'; loadCurrentView(); renderSidebarNav(); });
  $('#quick-go-customers')?.addEventListener('click', () => { state.currentView = 'customers'; loadCurrentView(); renderSidebarNav(); });

  $('#toggle-sidebar-desktop')?.addEventListener('click', () => toggleSidebar());
  $('#toggle-sidebar-mobile')?.addEventListener('click', () => $('#sidebar')?.classList.add('open'));
  $('#close-sidebar-mobile')?.addEventListener('click', () => $('#sidebar')?.classList.remove('open'));

  ['#cotizacion', '#pasajes', '#viaticos', '#flete', '#profit-mode', '#allocation-method'].forEach((selector) => { $(selector)?.addEventListener('input', queueSettingsSave);$(selector)?.addEventListener('change', queueSettingsSave); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#trip-context-menu') && !e.target.closest('.trip-item-btn')) hide('#trip-context-menu');
  });

  $('#ctx-rename-trip')?.addEventListener('click', () => {
    if (!state.contextTripTarget) return;
    openPromptModal('Renombrar Ingreso', 'Nuevo nombre:', state.contextTripTarget.name, 'Guardar Cambios', async (newName) => {
      if (!newName || !newName.trim()) return;
      const { error } = await state.client.from('trips').update({ name: newName.trim() }).eq('id', state.contextTripTarget.id);
      if (error) { setStatus(messageFrom(error), 'error'); return; }
      const idx = state.trips.findIndex((t) => t.id === state.contextTripTarget.id); if (idx > -1) state.trips[idx].name = newName.trim();
      renderSidebarNav(); if (state.currentTripId === state.contextTripTarget.id) renderSettings(); setStatus('Nombre de ingreso actualizado.', 'success');
    });
  });

  $('#ctx-delete-trip')?.addEventListener('click', () => {
    if (!state.contextTripTarget) return;
    openConfirmModal('Eliminar Ingreso', `¿Seguro que querés eliminar "${state.contextTripTarget.name}"? Se borrarán todas sus prendas de forma irreversible.`, 'Eliminar', true, async () => {
      const { error } = await state.client.from('trips').delete().eq('id', state.contextTripTarget.id);
      if (error) { setStatus(messageFrom(error), 'error'); return; }
      state.trips = state.trips.filter((t) => t.id !== state.contextTripTarget.id); if (state.trips.length > 0) state.currentTripId = state.trips[0].id;
      renderSidebarNav(); loadCurrentView(); setStatus('Ingreso eliminado.', 'success');
    });
  });

  $('#nav-dashboard')?.addEventListener('click', () => { state.currentView = 'dashboard'; $('#sidebar')?.classList.remove('open'); renderSidebarNav(); loadCurrentView(); });
  $('#nav-inventory')?.addEventListener('click', () => { state.currentView = 'inventory'; $('#sidebar')?.classList.remove('open'); renderSidebarNav(); loadCurrentView(); });
  $('#nav-sold')?.addEventListener('click', () => { state.currentView = 'sold'; $('#sidebar')?.classList.remove('open'); renderSidebarNav(); loadCurrentView(); });
  $('#nav-customers')?.addEventListener('click', () => { if (checkFeatureAccess('customers')) { state.currentView = 'customers'; $('#sidebar')?.classList.remove('open'); renderSidebarNav(); loadCurrentView(); } });
  $('#nav-team')?.addEventListener('click', () => { state.currentView = 'team'; $('#sidebar')?.classList.remove('open'); renderSidebarNav(); loadCurrentView(); });
  $('#nav-branding')?.addEventListener('click', () => { if (checkFeatureAccess('branding')) { state.currentView = 'branding'; $('#sidebar')?.classList.remove('open'); renderSidebarNav(); loadCurrentView(); } });
  $('#nav-profile')?.addEventListener('click', () => { state.currentView = 'profile'; $('#sidebar')?.classList.remove('open'); renderSidebarNav(); loadCurrentView(); });

  $('#new-trip-btn')?.addEventListener('click', () => {
    const inputName = $('#new-trip-name');
    if(inputName) inputName.value = `Ingreso ${new Date().toLocaleDateString('es-PY')}`;
    show('#new-trip-modal');
  });
  
  $('#close-new-trip-modal')?.addEventListener('click', () => hide('#new-trip-modal'));

  $('#new-trip-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#new-trip-name')?.value.trim(); 
    if (!name) return;
    
    const typeEl = document.querySelector('input[name="trip_type"]:checked');
    const type = typeEl ? typeEl.value : 'viaje';
    
    const { data, error } = await state.client.from('trips').insert({ 
      business_id: state.membership.business_id, 
      name: name, 
      trip_type: type, 
      cotizacion: state.trips[0]?.cotizacion || 1420, 
      pasajes: 0, viaticos: 0, flete: 0 
    }).select().single();
    
    if (error) { setStatus(messageFrom(error), 'error'); return; }
    
    state.trips.unshift(data); 
    state.currentView = 'calc'; 
    state.currentTripId = data.id;
    
    hide('#new-trip-modal');
    $('#sidebar')?.classList.remove('open'); 
    renderSidebarNav(); loadCurrentView(); 
    setStatus('Ingreso creado exitosamente.', 'success');
  });

  state.client.auth.onAuthStateChange((_event, session) => { state.user = session?.user || null; if (state.user) refreshWorkspace(); else showOnly('#auth-view'); });
  const { data: { session } } = await state.client.auth.getSession();
  state.user = session?.user || null; if (state.user) await refreshWorkspace(); else { showOnly('#auth-view'); setAuthMode(false); }
}

initialize();