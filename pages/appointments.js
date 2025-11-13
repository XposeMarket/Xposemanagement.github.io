/**
 * pages/appointments.js
 * Appointments page - List, CRUD, Status management
 * 
 * Handles:
 * - Loading appointments from Supabase (data.appointments JSONB)
 * - Creating, editing, deleting appointments
 * - Status management
 * - Search and filtering
 * - Customer save integration with automatic vehicle save
 */

import { getSupabaseClient } from '../helpers/supabase.js';

// Current appointment being edited
let currentApptId = null;
let currentApptForStatus = null;
let allAppointments = [];
// Sorting state for appointments table
let apptSortCol = 'created';
let apptSortDir = 'desc'; // 'asc' | 'desc'

// Status options
const STATUSES = ['new', 'scheduled', 'in_progress', 'awaiting_parts', 'completed'];

/**
 * Get current user's shop ID
 */
function getCurrentShopId() {
  try {
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    return session.shopId || null;
  } catch (e) {
    return null;
  }
}

/**
 * Get current user info
 */
function getCurrentUser() {
  try {
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    const users = JSON.parse(localStorage.getItem('xm_users') || '[]');
    return users.find(u => u.email === session.email) || {};
  } catch (e) {
    return {};
  }
}

/**
 * Save or update vehicle in Supabase vehicles table
 */
async function upsertVehicleToSupabase(customerId, shopId, vehicleData) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  
  try {
    // Parse vehicle string for year/make/model
    const vehicleStr = vehicleData.vehicle || '';
    const parts = vehicleStr.trim().split(/\s+/);
    const year = /^\d{4}$/.test(parts[0]) ? parts.shift() : '';
    const make = parts.shift() || '';
    const model = parts.join(' ') || '';
    
    // Check if vehicle already exists for this customer (by VIN if available)
    let existingVehicle = null;
    
    if (vehicleData.vin) {
      const { data: vinMatch } = await supabase
        .from('vehicles')
        .select('*')
        .eq('customer_id', customerId)
        .eq('vin', vehicleData.vin)
        .single();
      
      if (vinMatch) existingVehicle = vinMatch;
    }
    
    // If no VIN match, try matching by year/make/model
    if (!existingVehicle && year && make && model) {
      const { data: ymmMatch } = await supabase
        .from('vehicles')
        .select('*')
        .eq('customer_id', customerId)
        .eq('year', year)
        .eq('make', make)
        .eq('model', model)
        .single();
      
      if (ymmMatch) existingVehicle = ymmMatch;
    }
    
    const vehiclePayload = {
      id: existingVehicle?.id || crypto.randomUUID(),
      customer_id: customerId,
      shop_id: shopId,
      vin: vehicleData.vin || '',
      year: year,
      make: make,
      model: model,
      trim: vehicleData.trim || '',
      plate: vehicleData.plate || '',
      vehicle_notes: vehicleData.vehicle_notes || '',
      is_primary: existingVehicle ? existingVehicle.is_primary : true, // First vehicle is primary
      created_at: existingVehicle?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const { data, error } = await supabase
      .from('vehicles')
      .upsert(vehiclePayload, { onConflict: 'id' })
      .select()
      .single();
    
    if (error) {
      console.error('❌ Error upserting vehicle:', error);
      return null;
    }
    
    console.log('✅ Vehicle upserted to vehicles table:', data);
    return data;
  } catch (err) {
    console.error('❌ Exception upserting vehicle:', err);
    return null;
  }
}

/**
 * Save or update customer in Supabase customers table
 * Also saves vehicle to vehicles table if provided
 */
async function upsertCustomerToSupabase(customerData) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  
  try {
    const shopId = getCurrentShopId();
    if (!shopId) return null;
    // Check if customer already exists by phone/email in this shop
    let existingCustomer = null;
    if (customerData.phone) {
      const { data: phoneMatch } = await supabase
        .from('customers')
        .select('*')
        .eq('shop_id', shopId)
        .eq('phone', customerData.phone)
        .maybeSingle();
      if (phoneMatch) existingCustomer = phoneMatch;
    }
    if (!existingCustomer && customerData.email) {
      const { data: emailMatch } = await supabase
        .from('customers')
        .select('*')
        .eq('shop_id', shopId)
        .eq('email', customerData.email)
        .maybeSingle();
      if (emailMatch) existingCustomer = emailMatch;
    }
    // Only use existingCustomer if both phone/email and name match
    let customerId;
    if (existingCustomer &&
        existingCustomer.first_name === (customerData.first_name || '') &&
        existingCustomer.last_name === (customerData.last_name || '')) {
      customerId = existingCustomer.id;
    } else {
      customerId = crypto.randomUUID();
    }
    const customerPayload = {
      id: customerId,
      shop_id: shopId,
      first_name: customerData.first_name || '',
      last_name: customerData.last_name || '',
      email: customerData.email || '',
      phone: customerData.phone || '',
      vehicle: customerData.vehicle || '',
      vin: customerData.vin || '',
      zipcode: customerData.zipcode || '',
      notes: customerData.notes || '',
      created_at: existingCustomer?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const { data, error } = await supabase
      .from('customers')
      .upsert(customerPayload, { onConflict: 'id' })
      .select()
      .single();
    if (error) {
      console.error('❌ Error upserting customer:', error);
      return null;
    }
    console.log('✅ Customer upserted to customers table:', data);
    // Save vehicle with correct customer_id
    if (customerData.vehicle || customerData.vin) {
      await upsertVehicleToSupabase(customerId, shopId, customerData);
    }
    return data;
  } catch (err) {
    console.error('❌ Exception upserting customer:', err);
    return null;
  }
}

/**
 * Load appointments from Supabase
 */
async function loadAppointments() {
  const shopId = getCurrentShopId();
  if (!shopId) {
    console.warn('No shop ID found');
    return [];
  }

  const supabase = getSupabaseClient();
  
  try {
    if (supabase) {
      // Load from Supabase data table
      const { data, error } = await supabase
        .from('data')
        .select('appointments')
        .eq('shop_id', shopId)
        .single();
      
      if (error) {
        console.warn('Error loading appointments from Supabase:', error);
        throw error;
      }
      
      return data?.appointments || [];
    }
  } catch (ex) {
    console.warn('Supabase load failed, using localStorage:', ex);
  }
  
  // Fallback to localStorage
  try {
    const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
    return (localData.appointments || []).filter(a => a.shop_id === shopId);
  } catch (e) {
    return [];
  }
}

/**
 * Save appointments to Supabase
 */
async function saveAppointments(appointments) {
  const shopId = getCurrentShopId();
  if (!shopId) return false;

  const supabase = getSupabaseClient();
  
  try {
    if (supabase) {
      // Get current data
      const { data: currentData, error: fetchError } = await supabase
        .from('data')
        .select('*')
        .eq('shop_id', shopId)
        .single();
      
      if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = no rows
        throw fetchError;
      }
      
      // Upsert with appointments
      const payload = {
        shop_id: shopId,
        appointments: appointments,
        settings: currentData?.settings || {},
        jobs: currentData?.jobs || [],
        threads: currentData?.threads || [],
        invoices: currentData?.invoices || [],
        updated_at: new Date().toISOString()
      };
      
      const { error: upsertError } = await supabase
        .from('data')
        .upsert(payload, { onConflict: 'shop_id' });
      
      if (upsertError) throw upsertError;
      
      // Also insert/update appointments in appointments table
      for (const appt of appointments) {
        // Skip appointments with old string IDs (not UUIDs)
        if (appt.id.includes('_')) {
          console.log('Skipping upsert for old appointment ID:', appt.id);
          continue;
        }
        // Parse customer name into first and last
        const nameParts = (appt.customer || '').trim().split(' ');
        const customer_first = nameParts[0] || '';
        const customer_last = nameParts.slice(1).join(' ') || '';
        // Upsert customer and get id
        const customerRecord = await upsertCustomerToSupabase({
          first_name: customer_first,
          last_name: customer_last,
          email: appt.email,
          phone: appt.phone,
          vehicle: appt.vehicle,
          vin: appt.vin,
          notes: appt.notes || ''
        });
        // Save appointment with customer_id
        const apptPayload = {
          id: appt.id,
          shop_id: shopId,
          customer_id: customerRecord?.id || null,
          customer_first,
          customer_last,
          email: appt.email || '',
          phone: appt.phone || '',
          vehicle: appt.vehicle || '',
          vin: appt.vin || '',
          service: appt.service || '',
          preferred_date: appt.preferred_date || null,
          preferred_time: appt.preferred_time || null,
          status: appt.status || 'new',
          source: appt.source || 'walk-in',
          created_at: appt.created_at,
          updated_at: appt.updated_at
        };
        const { error: apptError } = await supabase
          .from('appointments')
          .upsert(apptPayload, { onConflict: 'id' });
        if (apptError) {
          console.error('Failed to upsert appointment:', apptError);
        }
      }
      
      console.log('✅ Appointments saved to Supabase');
      return true;
    }
  } catch (ex) {
    console.warn('Supabase save failed, using localStorage:', ex);
  }
  
  // Fallback to localStorage
  try {
    const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
    localData.appointments = localData.appointments || [];
    
    // Remove old appointments for this shop
    localData.appointments = localData.appointments.filter(a => a.shop_id !== shopId);
    
    // Add new appointments
    localData.appointments.push(...appointments);
    
    localStorage.setItem('xm_data', JSON.stringify(localData));
    console.log('✅ Appointments saved to localStorage');
    return true;
  } catch (e) {
    console.error('Failed to save appointments:', e);
    return false;
  }
}

/**
 * Render appointments table
 */
function renderAppointments(appointments = allAppointments) {
  const tbody = document.querySelector('#apptTable tbody');
  const empty = document.getElementById('apptEmpty');
  
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (appointments.length === 0) {
    if (empty) empty.textContent = 'No appointments found.';
    return;
  }
  
  if (empty) empty.textContent = '';
  
  // Apply sorting based on header clicks
  const sorted = [...appointments].sort((a, b) => {
    const col = apptSortCol;
    const dir = apptSortDir === 'asc' ? 1 : -1;
    let va, vb;
    switch (col) {
      case 'created':
        va = new Date(a.created_at || 0).getTime();
        vb = new Date(b.created_at || 0).getTime();
        break;
      case 'customer':
        va = (a.customer || '').toLowerCase(); vb = (b.customer || '').toLowerCase();
        break;
      case 'vehicle':
        va = (a.vehicle || '').toLowerCase(); vb = (b.vehicle || '').toLowerCase();
        break;
      case 'service':
        va = (a.service || '').toLowerCase(); vb = (b.service || '').toLowerCase();
        break;
      case 'scheduled':
        va = new Date(a.preferred_date || 0).getTime(); vb = new Date(b.preferred_date || 0).getTime();
        break;
      case 'time':
        // compare preferred_date first then preferred_time
        va = (a.preferred_date || '') + ' ' + (a.preferred_time || '');
        vb = (b.preferred_date || '') + ' ' + (b.preferred_time || '');
        break;
      case 'status':
        va = (a.status || '').toLowerCase(); vb = (b.status || '').toLowerCase();
        break;
      default:
        va = (a.customer || '').toLowerCase(); vb = (b.customer || '').toLowerCase();
    }

    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });
  
  sorted.forEach(appt => {
    const tr = document.createElement('tr');
    tr.dataset.apptId = appt.id;
    // On mobile, make row clickable to open view modal
    if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
      tr.classList.add('appt-row-clickable');
      tr.addEventListener('click', (e) => {
        // Only trigger if not clicking a button inside the row
        if (e.target.closest('button')) return;
        openViewModal(appt);
      });
    }
    
    // Created date
    const tdCreated = document.createElement('td');
    try {
      const c = new Date(appt.created_at);
      const dateStr = c.toLocaleDateString();
      const timeStr = c.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      tdCreated.innerHTML = `<div class="stacked-datetime"><span class="dt-date">${dateStr}</span><span class="dt-time">${timeStr}</span></div>`;
    } catch (e) {
      tdCreated.textContent = appt.created_at || '';
    }
    tr.appendChild(tdCreated);
    
    // Customer
    const tdCustomer = document.createElement('td');
    tdCustomer.textContent = appt.customer || 'N/A';
    tr.appendChild(tdCustomer);
    
    // Vehicle
    const tdVehicle = document.createElement('td');
    tdVehicle.textContent = appt.vehicle || 'N/A';
    tr.appendChild(tdVehicle);
    
    // Service
    const tdService = document.createElement('td');
    tdService.textContent = appt.service || 'N/A';
    tr.appendChild(tdService);
    
    // Scheduled (date only)
    const tdDate = document.createElement('td');
    if (appt.preferred_date) {
      try {
        const d = new Date(appt.preferred_date);
        const dateStr = d.toLocaleDateString();
        tdDate.textContent = dateStr;
      } catch (e) {
        tdDate.textContent = appt.preferred_date;
      }
    } else {
      tdDate.textContent = 'Not set';
    }
    tr.appendChild(tdDate);
    
    // Time
    const tdTime = document.createElement('td');
    tdTime.textContent = appt.preferred_time || 'Not set';
    tr.appendChild(tdTime);
    
    // Status
    const tdStatus = document.createElement('td');
    const statusSpan = document.createElement('span');
    statusSpan.className = `tag ${getStatusClass(appt.status)}`;
    statusSpan.textContent = appt.status || 'new';
    statusSpan.style.cursor = 'pointer';
    statusSpan.title = 'Click to change status';
    statusSpan.addEventListener('click', () => openStatusModal(appt));
    tdStatus.appendChild(statusSpan);
    tr.appendChild(tdStatus);
    
    // Actions (2x2 grid: view/invoice on top row, edit/delete on bottom)
    const tdActions = document.createElement('td');
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'appt-actions-grid';

    // View button (top-left)
    const viewBtn = document.createElement('button');
    viewBtn.className = 'btn small';
    viewBtn.textContent = 'View';
    viewBtn.addEventListener('click', () => openViewModal(appt));
    actionsDiv.appendChild(viewBtn);

    // Open Invoice button (top-right)
    const invoiceBtn = document.createElement('button');
    invoiceBtn.className = 'btn small secondary';
    invoiceBtn.textContent = 'Invoice';
    invoiceBtn.title = 'Open related invoice';
    invoiceBtn.addEventListener('click', () => {
      // Find invoice for this appointment
      const invoices = JSON.parse(localStorage.getItem('xm_data') || '{}').invoices || [];
      const inv = invoices.find(i => i.appointment_id === appt.id);
      if (inv) {
        // Store invoice id in session for modal open
        localStorage.setItem('openInvoiceId', inv.id);
        window.location.href = 'invoices.html';
      } else {
        // No invoice found — create one automatically and open it
        createInvoiceForAppointment(appt).then(newInv => {
          if (newInv && newInv.id) {
            localStorage.setItem('openInvoiceId', newInv.id);
            window.location.href = 'invoices.html';
          } else {
            alert('Failed to create invoice for this appointment.');
          }
        }).catch(err => {
          console.error('Error creating invoice for appointment:', err);
          alert('Failed to create invoice for this appointment.');
        });
      }
    });
    actionsDiv.appendChild(invoiceBtn);

    // Edit button (bottom-left)
    const editBtn = document.createElement('button');
    // Use the blue "info" style for Edit to match New/Edit buttons
    editBtn.className = 'btn small info';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openEditModal(appt));
    actionsDiv.appendChild(editBtn);

  // Delete button (bottom-right) — use a compact white trash icon to fit current size
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn small danger';
  deleteBtn.setAttribute('aria-label', 'Delete appointment');
  // Inline SVG trash icon (white fill) sized to match text
  deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path fill="white" d="M3 6h18v2H3V6zm2 3h14l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2l-1-12zM9 4V3a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1h5v2H4V4h5z"/></svg>';
  deleteBtn.addEventListener('click', () => deleteAppointment(appt.id));
  actionsDiv.appendChild(deleteBtn);

    tdActions.appendChild(actionsDiv);
    tr.appendChild(tdActions);
    
    tbody.appendChild(tr);
  });
}

/**
 * Get status class for styling
 */
function getStatusClass(status) {
  const map = {
    'new': 'info',
    'scheduled': 'primary',
    'in_progress': 'warning',
    'awaiting_parts': 'danger',
    'completed': 'success'
  };
  return map[status] || 'info';
}

// --- Services & Suggestions ---
let _svcCache = null;
async function loadServices() {
  try {
    const supabase = getSupabaseClient();
    const shopId = getCurrentShopId();
    let services = [];
    if (supabase && shopId) {
      try {
        const { data, error } = await supabase.from('data').select('settings').eq('shop_id', shopId).single();
        if (!error && data && data.settings && Array.isArray(data.settings.services)) {
          services = data.settings.services;
        }
      } catch (e) {
        // fallthrough to localStorage
      }
    }

    if (!services.length) {
      const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
      services = (data.settings && data.settings.services) || [];
    }

    _svcCache = services;
    populateSvcOptions(services);
  } catch (ex) {
    console.error('Error loading services for suggestions:', ex);
  }
}

function populateSvcOptions(services) {
  try {
    const dl = document.getElementById('svcOptions');
    if (!dl) return;
    dl.innerHTML = '';
    (services || []).forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.name || '';
      dl.appendChild(opt);
    });
  } catch (e) { console.warn(e); }
}

/**
 * Add a service item to the invoice associated with an appointment (if exists)
 */
async function addServiceToInvoice(apptId, serviceName) {
  if (!apptId || !serviceName) return;
  const shopId = getCurrentShopId();
  const supabase = getSupabaseClient();

  // find service price from cache or settings
  let price = 0;
  if (!_svcCache) await loadServices();
  const svc = (_svcCache || []).find(s => s.name === serviceName);
  if (svc) price = parseFloat(svc.price) || 0;

  try {
    if (supabase && shopId) {
      const { data: currentData, error: fetchError } = await supabase.from('data').select('*').eq('shop_id', shopId).single();
      if (fetchError && fetchError.code !== 'PGRST116') {
        console.warn('Error fetching data for adding service to invoice:', fetchError);
        return;
      }

      const invoices = currentData?.invoices || [];
      const inv = invoices.find(i => i.appointment_id === apptId);
      if (!inv) return; // nothing to update

      inv.items = inv.items || [];
      // Avoid duplicates of same service name
      if (!inv.items.some(it => (it.name || '').toLowerCase() === serviceName.toLowerCase())) {
        inv.items.push({ name: serviceName, qty: 1, price: price || 0, type: 'part' });
      }

      // Upsert data record
      const payload = {
        shop_id: shopId,
        settings: currentData?.settings || {},
        appointments: currentData?.appointments || [],
        jobs: currentData?.jobs || [],
        threads: currentData?.threads || [],
        invoices: invoices,
        updated_at: new Date().toISOString()
      };

      await supabase.from('data').upsert(payload, { onConflict: 'shop_id' });

      // Upsert invoice to invoices table
      const invoicePayload = {
        id: inv.id,
        shop_id: shopId,
        number: inv.number,
        customer: inv.customer || '',
        customer_first: inv.customer_first || '',
        customer_last: inv.customer_last || '',
        appointment_id: inv.appointment_id || null,
        job_id: inv.job_id || null,
        status: inv.status || 'open',
        due: inv.due || null,
        tax_rate: inv.tax_rate || 6,
        discount: inv.discount || 0,
        items: inv.items || [],
        paid_date: inv.paid_date || null,
        created_at: inv.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      await supabase.from('invoices').upsert(invoicePayload, { onConflict: 'id' });
      console.log('Added service to invoice', inv.id, serviceName);
    } else {
      // localStorage path
      const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
      data.invoices = data.invoices || [];
      const inv = data.invoices.find(i => i.appointment_id === apptId);
      if (!inv) return;
      inv.items = inv.items || [];
      if (!inv.items.some(it => (it.name || '').toLowerCase() === serviceName.toLowerCase())) {
        inv.items.push({ name: serviceName, qty: 1, price: price || 0, type: 'part' });
      }
      localStorage.setItem('xm_data', JSON.stringify(data));
      console.log('Added service to local invoice', inv.id, serviceName);
    }
  } catch (ex) {
    console.error('Failed to add service to invoice:', ex);
  }
}

/**
 * Create a blank invoice for an appointment (includes customer/shop info and optionally the service as an item)
 */
async function createInvoiceForAppointment(appt) {
  if (!appt || !appt.id) return null;
  const shopId = getCurrentShopId();
  const supabase = getSupabaseClient();

  // Compose invoice object
  const id = crypto.randomUUID();
  // Generate a sequential invoice number to match Jobs flow (fallback to 1001+)
  let number;
  try {
    if (supabase && shopId) {
      const { data: currentData, error: fetchError } = await supabase.from('data').select('invoices').eq('shop_id', shopId).single();
      if (!fetchError) {
        const invoices = currentData?.invoices || [];
        const maxNumber = invoices.reduce((max, inv) => Math.max(max, parseInt(inv.number) || 0), 1000);
        number = String(maxNumber + 1);
      } else {
        // fall back to timestamp if fetch failed
        number = `INV-${Date.now().toString().slice(-6)}`;
      }
    } else {
      // localStorage path
      const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
      const invoices = data.invoices || [];
      const maxNumber = invoices.reduce((max, inv) => Math.max(max, parseInt(inv.number) || 0), 1000);
      number = String(maxNumber + 1);
    }
  } catch (e) {
    console.error('Error generating invoice number:', e);
    number = `INV-${Date.now().toString().slice(-6)}`;
  }
  const customer = appt.customer || '';
  const nameParts = (customer || '').trim().split(' ');
  const customer_first = nameParts[0] || '';
  const customer_last = nameParts.slice(1).join(' ') || '';
  // Attempt to get service price
  let items = [];
  if (appt.service) {
    if (!_svcCache) await loadServices();
    const svc = (_svcCache || []).find(s => s.name === appt.service);
    const price = svc ? (parseFloat(svc.price) || 0) : 0;
    items.push({ name: appt.service, qty: 1, price: price, type: 'part' });
  }

  const inv = {
    id,
    shop_id: shopId,
    number,
    customer,
    customer_first,
    customer_last,
    appointment_id: appt.id,
    job_id: null,
    status: 'open',
    due: null,
    tax_rate: 6,
    discount: 0,
    items,
    paid_date: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  try {
    if (supabase && shopId) {
      // Upsert into data table
      const { data: currentData, error: fetchError } = await supabase.from('data').select('*').eq('shop_id', shopId).single();
      if (fetchError && fetchError.code !== 'PGRST116') {
        console.warn('Error fetching data for invoice creation:', fetchError);
      }

      const invoices = currentData?.invoices || [];
      invoices.push(inv);

      const payload = {
        shop_id: shopId,
        settings: currentData?.settings || {},
        appointments: currentData?.appointments || [],
        jobs: currentData?.jobs || [],
        threads: currentData?.threads || [],
        invoices: invoices,
        updated_at: new Date().toISOString()
      };

      await supabase.from('data').upsert(payload, { onConflict: 'shop_id' });

      // Also insert into invoices table
      const { error: upsertError } = await supabase.from('invoices').upsert(inv, { onConflict: 'id' });
      if (upsertError) console.warn('Error upserting invoice to invoices table:', upsertError);

      console.log('Created invoice for appointment (supabase):', inv.id);
      return inv;
    } else {
      // localStorage path
      const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
      data.invoices = data.invoices || [];
      data.invoices.push(inv);
      localStorage.setItem('xm_data', JSON.stringify(data));
      console.log('Created invoice for appointment (local):', inv.id);
      return inv;
    }
  } catch (ex) {
    console.error('Failed to create invoice for appointment:', ex);
    return null;
  }
}

/**
 * Open view modal
 */
function openViewModal(appt) {
  const modal = document.getElementById('viewApptModal');
  const content = document.getElementById('viewApptContent');
  const editBtn = document.getElementById('editFromViewBtn');
  
  if (!modal || !content) return;
  
  content.innerHTML = `
    <div style="display: grid; gap: 12px;">
      <div><strong>Customer:</strong> ${appt.customer || 'N/A'}</div>
      <div><strong>Phone:</strong> ${appt.phone || 'N/A'}</div>
      <div><strong>Email:</strong> ${appt.email || 'N/A'}</div>
      <div><strong>Vehicle:</strong> ${appt.vehicle || 'N/A'}</div>
      ${appt.vin ? `<div><strong>VIN:</strong> ${appt.vin}</div>` : ''}
      <div><strong>Service:</strong> ${appt.service || 'N/A'}</div>
      <div><strong>Date:</strong> ${appt.preferred_date ? new Date(appt.preferred_date).toLocaleDateString() : 'Not set'}</div>
      <div><strong>Time:</strong> ${appt.preferred_time || 'Not set'}</div>
      <div><strong>Status:</strong> <span class="tag ${getStatusClass(appt.status)}">${appt.status || 'new'}</span></div>
      ${appt.notes ? `<div><strong>Notes:</strong><br>${appt.notes}</div>` : ''}
    </div>
  `;
  
  editBtn.onclick = () => {
    modal.classList.add('hidden');
    openEditModal(appt);
  };
  
  modal.classList.remove('hidden');
}

/**
 * Close view modal
 */
function closeViewModal() {
  const modal = document.getElementById('viewApptModal');
  if (modal) modal.classList.add('hidden');
}

// Make it global for onclick
window.closeViewApptModal = closeViewModal;

/**
 * Open status modal
 */
function openStatusModal(appt) {
  currentApptForStatus = appt;
  const modal = document.getElementById('statusModal');
  const pillsContainer = document.getElementById('statusPills');
  
  if (!modal || !pillsContainer) return;
  
  pillsContainer.innerHTML = '';
  
  STATUSES.forEach(status => {
    const pill = document.createElement('button');
    pill.className = `btn ${appt.status === status ? getStatusClass(status) : ''}`;
    pill.textContent = status.replace(/_/g, ' ').toUpperCase();
    pill.style.width = '100%';
    pill.style.textAlign = 'left';
    
    pill.addEventListener('click', async () => {
      await updateAppointmentStatus(appt.id, status);
      modal.classList.add('hidden');
    });
    
    pillsContainer.appendChild(pill);
  });
  
  modal.classList.remove('hidden');
}

/**
 * Close status modal
 */
function closeStatusModal() {
  const modal = document.getElementById('statusModal');
  if (modal) modal.classList.add('hidden');
  currentApptForStatus = null;
}

// Make it global for onclick
window.closeStatusModal = closeStatusModal;

/**
 * Update appointment status
 */
async function updateAppointmentStatus(apptId, newStatus) {
  const index = allAppointments.findIndex(a => a.id === apptId);
  if (index === -1) return;
  
  allAppointments[index].status = newStatus;
  allAppointments[index].updated_at = new Date().toISOString();

  await saveAppointments(allAppointments);
  renderAppointments();

  // Auto-create or update job if status is in_progress or awaiting_parts
  if (['in_progress', 'awaiting_parts'].includes(newStatus)) {
    const appt = allAppointments[index];
    // Load jobs from localStorage
    let jobs = [];
    try {
      const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
      jobs = localData.jobs || [];
    } catch (e) {}
    // Check if job already exists for this appointment
    let job = jobs.find(j => j.appointment_id === appt.id);
    if (!job) {
      job = {
        id: crypto.randomUUID(),
        shop_id: appt.shop_id,
        appointment_id: appt.id,
        customer: appt.customer || '',
        customer_first: appt.customer_first || '',
        customer_last: appt.customer_last || '',
        assigned_to: null,
        status: newStatus,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      jobs.push(job);
    } else {
      job.status = newStatus;
      job.updated_at = new Date().toISOString();
    }
    // Save jobs to localStorage
    try {
      const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
      localData.jobs = jobs;
      localStorage.setItem('xm_data', JSON.stringify(localData));
      console.log('✅ Job created/updated for appointment', appt.id);
    } catch (e) {
      console.error('Failed to save job:', e);
    }
    // Also sync jobs to Supabase
    try {
      const { saveJobs } = await import('./jobs.js');
      await saveJobs(jobs);
      console.log('✅ Jobs synced to Supabase');
    } catch (e) {
      console.error('Failed to sync jobs to Supabase:', e);
    }
  } else {
    // If status is not active, remove job from jobs
    let jobs = [];
    try {
      const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
      jobs = localData.jobs || [];
    } catch (e) {}
    const appt = allAppointments[index];
    jobs = jobs.filter(j => j.appointment_id !== appt.id);
    try {
      const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
      localData.jobs = jobs;
      localStorage.setItem('xm_data', JSON.stringify(localData));
      console.log('✅ Job removed for appointment', appt.id);
    } catch (e) {
      console.error('Failed to remove job:', e);
    }
    // Also sync jobs to Supabase
    try {
      const { saveJobs } = await import('./jobs.js');
      await saveJobs(jobs);
      console.log('✅ Jobs synced to Supabase');
    } catch (e) {
      console.error('Failed to sync jobs to Supabase:', e);
    }
  }

  showNotification(`Status updated to ${newStatus}`);
}

/**
 * Open new appointment modal
 */
function openNewModal() {
  const modal = document.getElementById('newApptModal');
  if (!modal) return;
  
  // Clear form
  document.getElementById('naFirst').value = '';
  document.getElementById('naLast').value = '';
  document.getElementById('naEmail').value = '';
  document.getElementById('naPhone').value = '';
  document.getElementById('naVehicle').value = '';
  document.getElementById('naVin').value = '';
  document.getElementById('naService').value = '';
  document.getElementById('naDate').value = '';
  document.getElementById('naTime').value = '';
  
  modal.classList.remove('hidden');
  document.getElementById('naFirst').focus();
}

/**
 * Close new appointment modal
 */
function closeNewModal() {
  const modal = document.getElementById('newApptModal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Save new appointment
 */
async function saveNewAppointment() {
  const first = document.getElementById('naFirst').value.trim();
  const last = document.getElementById('naLast').value.trim();
  const email = document.getElementById('naEmail').value.trim();
  const phone = document.getElementById('naPhone').value.trim();
  const vehicle = document.getElementById('naVehicle').value.trim();
  const vin = document.getElementById('naVin').value.trim();
  const service = document.getElementById('naService').value.trim();
  const date = document.getElementById('naDate').value;
  const time = document.getElementById('naTime').value;
  
  if (!first || !last || !phone || !vehicle || !service) {
    showNotification('Please fill in all required fields', 'error');
    return;
  }
  
  const newAppt = {
    id: crypto.randomUUID(),
    shop_id: getCurrentShopId(),
    customer: `${first} ${last}`,
    email,
    phone,
    vehicle,
    vin,
    service,
    preferred_date: date || null,
    preferred_time: time || null,
    status: 'new',
    notes: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  allAppointments.push(newAppt);
  await saveAppointments(allAppointments);
  
  // 🆕 Save customer to customers table (with vehicle)
  await upsertCustomerToSupabase({
    first_name: first,
    last_name: last,
    email,
    phone,
    vehicle,
    vin,
    notes: ''
  });
  // If there's an invoice for this appointment, add the chosen service to it
  await addServiceToInvoice(newAppt.id, newAppt.service);
  
  closeNewModal();
  renderAppointments();
  showNotification('Appointment created successfully!');
}

/**
 * Open edit modal
 */
function openEditModal(appt) {
  currentApptId = appt.id;
  const modal = document.getElementById('apptModal');
  const form = document.getElementById('apptForm');
  const title = document.getElementById('apptModalTitle');
  
  if (!modal || !form) return;
  
  title.textContent = 'Edit Appointment';
  
  // Populate form
  form.elements['customer'].value = appt.customer || '';
  form.elements['phone'].value = appt.phone || '';
  form.elements['email'].value = appt.email || '';
  form.elements['vehicle'].value = appt.vehicle || '';
  form.elements['vin'].value = appt.vin || '';
  form.elements['service'].value = appt.service || '';
  form.elements['preferred_date'].value = appt.preferred_date || '';
  form.elements['preferred_time'].value = appt.preferred_time || '';
  form.elements['notes'].value = appt.notes || '';
  
  modal.classList.remove('hidden');
}

/**
 * Close edit modal
 */
function closeEditModal() {
  const modal = document.getElementById('apptModal');
  if (modal) modal.classList.add('hidden');
  currentApptId = null;
}

/**
 * Save edited appointment
 */
async function saveEditedAppointment(e) {
  if (e) e.preventDefault();
  
  if (!currentApptId) return;
  
  const form = document.getElementById('apptForm');
  const index = allAppointments.findIndex(a => a.id === currentApptId);
  
  if (index === -1) return;
  
  const customer = form.elements['customer'].value.trim();
  const nameParts = customer.split(' ');
  const first_name = nameParts[0] || '';
  const last_name = nameParts.slice(1).join(' ') || '';
  
  allAppointments[index] = {
    ...allAppointments[index],
    customer,
    phone: form.elements['phone'].value.trim(),
    email: form.elements['email'].value.trim(),
    vehicle: form.elements['vehicle'].value.trim(),
    vin: form.elements['vin'].value.trim(),
    service: form.elements['service'].value.trim(),
    preferred_date: form.elements['preferred_date'].value || null,
    preferred_time: form.elements['preferred_time'].value || null,
    notes: form.elements['notes'].value.trim(),
    updated_at: new Date().toISOString()
  };
  
  await saveAppointments(allAppointments);
  
  // 🆕 Update customer in customers table (with vehicle)
  await upsertCustomerToSupabase({
    first_name,
    last_name,
    email: allAppointments[index].email,
    phone: allAppointments[index].phone,
    vehicle: allAppointments[index].vehicle,
    vin: allAppointments[index].vin,
    notes: allAppointments[index].notes || ''
  });
  // If there's an invoice linked to this appointment, ensure the service is added
  await addServiceToInvoice(currentApptId, allAppointments[index].service);
  
  closeEditModal();
  renderAppointments();
  showNotification('Appointment updated successfully!');
}

/**
 * Delete appointment
 */
async function deleteAppointment(apptId) {
  if (!confirm('Are you sure you want to delete this appointment?')) return;
  
  allAppointments = allAppointments.filter(a => a.id !== apptId);
  await saveAppointments(allAppointments);
  
  renderAppointments();
  showNotification('Appointment deleted');
}

/**
 * Apply filters
 */
function applyFilters() {
  const searchTerm = document.getElementById('apptSearch').value.toLowerCase();
  const statusFilter = document.getElementById('apptStatus').value;
  
  let filtered = [...allAppointments];
  
  if (searchTerm) {
    filtered = filtered.filter(a => 
      (a.customer || '').toLowerCase().includes(searchTerm) ||
      (a.vehicle || '').toLowerCase().includes(searchTerm) ||
      (a.service || '').toLowerCase().includes(searchTerm) ||
      (a.phone || '').includes(searchTerm)
    );
  }
  
  if (statusFilter) {
    filtered = filtered.filter(a => a.status === statusFilter);
  }
  
  renderAppointments(filtered);
}

/**
 * Show notification
 */
function showNotification(message, type = 'success') {
  const notification = document.getElementById('notification');
  if (!notification) return;
  
  notification.textContent = message;
  notification.className = 'notification';
  
  if (type === 'error') {
    notification.style.background = '#ef4444';
  } else {
    notification.style.background = '#10b981';
  }
  
  notification.classList.remove('hidden');
  
  setTimeout(() => {
    notification.classList.add('hidden');
  }, 3000);
}

/**
 * Setup appointments page
 */
async function setupAppointments() {
  console.log('📅 Setting up Appointments page...');
  
  // Load appointments
  allAppointments = await loadAppointments();
  console.log(`✅ Loaded ${allAppointments.length} appointments`);
  // Load services for suggestions
  await loadServices();
  
  // Render initial table
  renderAppointments();
  
  // Event listeners
  const newBtn = document.getElementById('newAppt');
  if (newBtn) newBtn.addEventListener('click', openNewModal);
  
  const closeNewBtn = document.getElementById('closeAppt');
  if (closeNewBtn) closeNewBtn.addEventListener('click', closeNewModal);
  
  const saveNewBtn = document.getElementById('saveAppt');
  if (saveNewBtn) saveNewBtn.addEventListener('click', saveNewAppointment);
  
  const closeEditBtn = document.getElementById('closeApptModal');
  if (closeEditBtn) closeEditBtn.addEventListener('click', closeEditModal);
  
  const saveEditBtn = document.getElementById('saveApptEdit');
  if (saveEditBtn) saveEditBtn.addEventListener('click', saveEditedAppointment);
  
  const apptForm = document.getElementById('apptForm');
  if (apptForm) apptForm.addEventListener('submit', saveEditedAppointment);
  
  const filterBtn = document.getElementById('apptFilter');
  if (filterBtn) filterBtn.addEventListener('click', applyFilters);
  
  const searchInput = document.getElementById('apptSearch');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      // Real-time search
      setTimeout(applyFilters, 300);
    });
  }

  // Make headers sortable
  try {
    document.querySelectorAll('#apptTable thead th.sortable').forEach(h => {
      h.style.cursor = 'pointer';
      h.addEventListener('click', () => {
        const col = h.dataset.col;
        if (!col) return;
        if (apptSortCol === col) apptSortDir = apptSortDir === 'asc' ? 'desc' : 'asc';
        else { apptSortCol = col; apptSortDir = 'asc'; }
        // update header classes
        document.querySelectorAll('#apptTable thead th.sortable').forEach(x => x.classList.remove('asc','desc'));
        h.classList.add(apptSortDir === 'asc' ? 'asc' : 'desc');
        renderAppointments();
      });
    });
  } catch (e) {}
  
  // Check for #new hash
  if (window.location.hash === '#new') {
    openNewModal();
  }
  
  console.log('✅ Appointments page setup complete');
}

// Export the customer upsert function so it can be used from the modal save buttons
export { setupAppointments, upsertCustomerToSupabase };
