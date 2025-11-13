/**
 * pages/settings.js
 * Settings page setup - Shop info, services, labor rates, staff management
 * 
 * Imported by: app.js
 * Imports from: helpers/
 */

import { getSupabaseClient } from '../helpers/supabase.js';

function setupSettings() {
  console.log('📄 Setting up Settings page...');
  
  const supabase = getSupabaseClient();
  let currentShopId = null;
  let currentUser = null;
  let shopData = null;
  let settings = {};
  
  // Get current shop ID and user
  function getCurrentShopId() {
    try {
      const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
      return session.shopId || null;
    } catch (e) {
      return null;
    }
  }
  
  function getCurrentUser() {
    try {
      const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
      const users = JSON.parse(localStorage.getItem('xm_users') || '[]');
      return users.find(u => u.email === session.email) || {};
    } catch (e) {
      return {};
    }
  }
  
  // Initialize
  currentShopId = getCurrentShopId();
  currentUser = getCurrentUser();
  
  // Load shop data
  async function loadShopData() {
    if (!currentShopId) return;
    
    try {
      if (supabase) {
        // Load from Supabase
        const { data: shop, error } = await supabase
          .from('shops')
          .select('*')
          .eq('id', currentShopId)
          .single();
        
        if (error) throw error;
        shopData = shop;
        
        // Load settings from data table
        const { data: dataRecord, error: dataError } = await supabase
          .from('data')
          .select('settings')
          .eq('shop_id', currentShopId)
          .single();
        
        if (!dataError && dataRecord) {
          settings = dataRecord.settings || {};
        }
      } else {
        // Load from localStorage
        const shops = JSON.parse(localStorage.getItem('xm_shops') || '[]');
        shopData = shops.find(s => s.id === currentShopId);
        const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
        settings = data.settings || {};
      }
      
      populateForm();
    } catch (ex) {
      console.error('Error loading shop data:', ex);
    }
  }
  
  // Populate form fields
  function populateForm() {
    if (!shopData) return;
    
    document.getElementById('shopName').value = shopData.name || '';
    document.getElementById('shopPhone').value = shopData.phone || '';
    document.getElementById('shopEmail').value = shopData.email || '';
    document.getElementById('shopZipcode').value = shopData.zipcode || '';
    // Populate logo preview if present
    try{
      const logoEl = document.getElementById('shopLogoPreview');
      if(logoEl){
        if(shopData.logo){
          logoEl.src = shopData.logo;
          logoEl.style.display = 'block';
        } else {
          logoEl.src = '';
          logoEl.style.display = 'none';
        }
      }
    }catch(e){}
    
    // Populate services
    renderServices();
    
    // Populate labor rates
    renderLaborRates();
  }
  
  // Render services
  function renderServices() {
    const svcList = document.getElementById('svcList');
    if (!svcList) return;
    
    const services = settings.services || [];
    
    if (services.length === 0) {
      svcList.innerHTML = '<div class="muted">No services added yet.</div>';
      return;
    }
    
    svcList.innerHTML = services.map(svc => `
      <div class="chip" data-service="${svc.name}" style="cursor: pointer;">
        ${svc.name} - $${svc.price}
      </div>
    `).join('');
    
    // Add click listeners to remove
    svcList.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => removeService(chip.dataset.service));
    });
  }
  
  // Render labor rates
  function renderLaborRates() {
    const labList = document.getElementById('labList');
    if (!labList) return;
    
    const laborRates = settings.labor_rates || [];
    
    if (laborRates.length === 0) {
      labList.innerHTML = '<div class="muted">No labor rates added yet.</div>';
      return;
    }
    
    labList.innerHTML = laborRates.map(rate => `
      <div class="chip" data-rate="${rate.name}" style="cursor: pointer;">
        ${rate.name} - $${rate.rate}/hr
      </div>
    `).join('');
    
    // Add click listeners to remove
    labList.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => removeLaborRate(chip.dataset.rate));
    });
  }
  
  // Save shop info
  async function saveShopInfo() {
    const shopName = document.getElementById('shopName').value.trim();
    const shopPhone = document.getElementById('shopPhone').value.trim();
    const shopEmail = document.getElementById('shopEmail').value.trim();
    const shopZipcode = document.getElementById('shopZipcode').value.trim();
    const shopLogoFile = document.getElementById('shopLogoFile')?.files?.[0];
    
    let shopLogo = shopData?.logo || '';
    
    // Handle logo upload
    if (shopLogoFile) {
      shopLogo = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.readAsDataURL(shopLogoFile);
      });
      // show preview immediately so user can see the logo before save completes
      try{
        const logoEl = document.getElementById('shopLogoPreview');
        if(logoEl){ logoEl.src = shopLogo; logoEl.style.display = 'block'; }
      }catch(e){}
    }
    
    try {
      if (supabase) {
        // Update in Supabase with defensive retries for missing columns
        let payload = {
          name: shopName,
          phone: shopPhone,
          email: shopEmail,
          zipcode: shopZipcode,
          logo: shopLogo,
          updated_at: new Date().toISOString()
        };

        // Try updating, but if the DB schema doesn't include a column (PGRST204), strip it and retry
        const maxRetries = 6;
        let attempt = 0;
        while (attempt < maxRetries) {
          attempt += 1;
          const { error } = await supabase
            .from('shops')
            .update(payload)
            .eq('id', currentShopId);

          if (!error) break;

          // If column not found in schema cache, PostgREST returns PGRST204 with message mentioning the column
          const msg = (error && error.message) || '';
          const m = msg.match(/Could not find the '([^']+)' column of 'shops'/i) || msg.match(/relation "shops" has no column named "([^\"]+)"/i);
          if (m && m[1]) {
            const col = m[1];
            console.warn('[settings.js] Column not found in shops table, removing from payload and retrying:', col);
            delete payload[col];
            // continue loop to retry without this column
            continue;
          }

          // If it's some other error, throw it
          throw error;
        }
      } else {
        // Update in localStorage
        const shops = JSON.parse(localStorage.getItem('xm_shops') || '[]');
        const shopIndex = shops.findIndex(s => s.id === currentShopId);
        if (shopIndex !== -1) {
          shops[shopIndex] = {
            ...shops[shopIndex],
            name: shopName,
            phone: shopPhone,
            // only set fields that exist in the local store object
            ...(shopEmail ? { email: shopEmail } : {}),
            ...(shopZipcode ? { zipcode: shopZipcode } : {}),
            logo: shopLogo
          };
          localStorage.setItem('xm_shops', JSON.stringify(shops));
        }
      }
      
      showNotification('Shop info saved successfully!');
      await loadShopData(); // Reload
    } catch (ex) {
      console.error('Error saving shop info:', ex);
      showNotification('Error saving shop info: ' + ex.message, 'error');
    }
  }
  
  // Add service
  async function addService() {
    const svcName = document.getElementById('svcName').value.trim();
    const svcPrice = parseFloat(document.getElementById('svcPrice').value) || 0;
    
    if (!svcName) {
      showNotification('Please enter a service name', 'error');
      return;
    }
    
    settings.services = settings.services || [];
    
    // Check if service already exists
    if (settings.services.some(s => s.name === svcName)) {
      showNotification('Service already exists', 'error');
      return;
    }
    
    settings.services.push({ name: svcName, price: svcPrice });
    
    await saveSettings();
    
    // Clear inputs
    document.getElementById('svcName').value = '';
    document.getElementById('svcPrice').value = '';
    
    renderServices();
    showSectionNotice('svcSaved', 'svcList', 'Service added!');
  }
  
  // Remove service
  async function removeService(serviceName) {
    const ok = await showConfirm(`Remove service "${serviceName}"?`, 'Remove', 'Cancel');
    if (!ok) return;

    settings.services = (settings.services || []).filter(s => s.name !== serviceName);

    await saveSettings();
    renderServices();
    showSectionNotice('svcSaved', 'svcList', 'Service removed');
  }
  
  // Add labor rate
  async function addLaborRate() {
    const labName = document.getElementById('labName').value.trim();
    const labRate = parseFloat(document.getElementById('labRate').value) || 0;
    
    if (!labName) {
      showNotification('Please enter a rate name', 'error');
      return;
    }
    
    settings.labor_rates = settings.labor_rates || [];
    
    // Check if rate already exists
    if (settings.labor_rates.some(r => r.name === labName)) {
      showNotification('Labor rate already exists', 'error');
      return;
    }
    
    settings.labor_rates.push({ name: labName, rate: labRate });
    
    await saveSettings();
    
    // Clear inputs
    document.getElementById('labName').value = '';
    document.getElementById('labRate').value = '';
    
    renderLaborRates();
    showSectionNotice('labSaved', 'labList', 'Labor rate added!');
  }
  
  // Remove labor rate
  async function removeLaborRate(rateName) {
    const ok = await showConfirm(`Remove labor rate "${rateName}"?`, 'Remove', 'Cancel');
    if (!ok) return;

    settings.labor_rates = (settings.labor_rates || []).filter(r => r.name !== rateName);

    await saveSettings();
    renderLaborRates();
    showSectionNotice('labSaved', 'labList', 'Labor rate removed');
  }
  
  // Save settings to Supabase or localStorage
  async function saveSettings() {
    try {
      if (supabase) {
        // Get current data
        const { data: currentData, error: fetchError } = await supabase
          .from('data')
          .select('*')
          .eq('shop_id', currentShopId)
          .single();
        
        if (fetchError && fetchError.code !== 'PGRST116') {
          throw fetchError;
        }
        
        // Upsert with updated settings
        const payload = {
          shop_id: currentShopId,
          settings: settings,
          appointments: currentData?.appointments || [],
          jobs: currentData?.jobs || [],
          threads: currentData?.threads || [],
          invoices: currentData?.invoices || [],
          updated_at: new Date().toISOString()
        };
        
        const { error } = await supabase
          .from('data')
          .upsert(payload, { onConflict: 'shop_id' });
        
        if (error) throw error;
      } else {
        // Save to localStorage
        const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
        data.settings = settings;
        localStorage.setItem('xm_data', JSON.stringify(data));
      }
    } catch (ex) {
      console.error('Error saving settings:', ex);
      throw ex;
    }
  }
  
  // Show notification
  function showNotification(message, type = 'success') {
    const shopSaved = document.getElementById('shopSaved');
    if (!shopSaved) return;
    
    shopSaved.textContent = message;
    shopSaved.className = 'notice ' + (type === 'error' ? 'danger' : 'success');
    
    setTimeout(() => {
      shopSaved.textContent = '';
      shopSaved.className = 'notice';
    }, 3000);
  }

  // Ensure a per-section notice element exists and show a message there
  function ensureSectionNotice(id, insertAfterId) {
    let el = document.getElementById(id);
    if (el) return el;
    const after = document.getElementById(insertAfterId);
    el = document.createElement('p');
    el.id = id;
    el.className = 'notice';
    el.style.marginTop = '8px';
    if (after && after.parentNode) {
      // insert after the reference element
      if (after.nextSibling) after.parentNode.insertBefore(el, after.nextSibling);
      else after.parentNode.appendChild(el);
    } else if (after && after.parentElement) {
      after.parentElement.appendChild(el);
    } else {
      document.body.appendChild(el);
    }
    return el;
  }

  function showSectionNotice(id, insertAfterId, message, type = 'success') {
    try {
      const el = ensureSectionNotice(id, insertAfterId);
      el.textContent = message;
      el.className = 'notice ' + (type === 'error' ? 'danger' : 'success');
      setTimeout(() => {
        el.textContent = '';
        el.className = 'notice';
      }, 3500);
    } catch (e) {
      // fallback to global notification
      showNotification(message, type);
    }
  }

  // In-page confirm helper (returns Promise<boolean>) using the page's confirm modal
  function showConfirm(message, okText = 'OK', cancelText = 'Cancel') {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirmModal');
      const msgEl = document.getElementById('confirmMessage');
      const okBtn = document.getElementById('confirmOk');
      const cancelBtn = document.getElementById('confirmCancel');
      if (!modal || !msgEl || !okBtn || !cancelBtn) {
        // fallback to native confirm if modal not present
        resolve(window.confirm(message));
        return;
      }

      msgEl.textContent = message;
      okBtn.textContent = okText;
      cancelBtn.textContent = cancelText;

      function clean(result) {
        modal.classList.add('hidden');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        resolve(result);
      }

      function onOk() { clean(true); }
      function onCancel() { clean(false); }

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      modal.classList.remove('hidden');
    });
  }
  
  // Event listeners
  const saveShopBtn = document.getElementById('saveShop');
  if (saveShopBtn) {
    saveShopBtn.addEventListener('click', saveShopInfo);
  }

  // Preview logo when user picks a file (before hitting save)
  const logoFileInput = document.getElementById('shopLogoFile');
  if (logoFileInput) {
    logoFileInput.addEventListener('change', function(ev){
      const f = ev.target.files && ev.target.files[0];
      if(!f) return;
      const reader = new FileReader();
      reader.onload = function(e){
        try{ const logoEl = document.getElementById('shopLogoPreview'); if(logoEl){ logoEl.src = e.target.result; logoEl.style.display = 'block'; } }catch(err){}
      };
      reader.readAsDataURL(f);
    });
  }
  
  const svcAddBtn = document.getElementById('svcAdd');
  if (svcAddBtn) {
    svcAddBtn.addEventListener('click', addService);
  }
  
  const labAddBtn = document.getElementById('labAdd');
  if (labAddBtn) {
    labAddBtn.addEventListener('click', addLaborRate);
  }
  
  // Initial load
  loadShopData();
  
  console.log('✅ Settings page setup complete');
}

export { setupSettings };
