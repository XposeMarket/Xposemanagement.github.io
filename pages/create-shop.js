// pages/create-shop.js
// Clean, modern create shop logic (Supabase + localStorage fallback)
// FIXED: Added OAuth callback handling

import { getSupabaseClient } from '../helpers/supabase.js';

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('createShopForm');
  const err = document.getElementById('csErr');
  if (!form) return;

  const supabase = getSupabaseClient();

  // ============================================================================
  // OAUTH CALLBACK HANDLER - Check if we're returning from Google OAuth
  // ============================================================================
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('oauth') === 'google' && supabase) {
    console.log('🔄 Processing OAuth create-shop callback...');
    
    try {
      // Get the session from Supabase
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError) throw sessionError;
      
      if (session && session.user) {
        console.log('✅ OAuth session found:', session.user.email);
        
        // Retrieve stored shop data from sessionStorage
        const shopName = sessionStorage.getItem('create_shop_name');
        const shopType = sessionStorage.getItem('create_shop_type');
        const zipcode = sessionStorage.getItem('create_shop_zipcode');
        
        if (!shopName) {
          err.textContent = 'OAuth error: Shop name not found. Please fill out the form and try again.';
          err.style.color = 'red';
          return;
        }
        
        console.log('📋 Retrieved shop data:', { shopName, shopType });
        
        // Create shop
        const join_code = Math.random().toString(36).slice(2,8).toUpperCase();
        const shopInsert = { 
          name: shopName, 
          type: shopType || 'Mechanic', 
          join_code, 
          staff_limit: 3 
        };
        
        const { data: shopData, error: shopErr } = await supabase
          .from('shops')
          .insert([shopInsert])
          .select()
          .single();
        
        if (shopErr || !shopData) {
          console.error('❌ Shop creation failed:', shopErr);
          throw shopErr || new Error('Could not create shop.');
        }
        
        console.log('✅ Shop created:', shopData);
        const shopId = shopData.id;
        
        // Create user record in users table
        const userId = session.user.id;
        const email = session.user.email;
        const first = session.user.user_metadata?.given_name || session.user.user_metadata?.first || '';
        const last = session.user.user_metadata?.family_name || session.user.user_metadata?.last || '';
        
        await createUserRecord(supabase, userId, email, first, last, zipcode || '', 'admin', shopId);
        
        // Initialize empty data record for the shop
        console.log('📊 Initializing shop data...');
        const { error: dataErr } = await supabase.from('data').insert([{
          shop_id: shopId,
          settings: {},
          appointments: [],
          jobs: [],
          threads: [],
          invoices: []
        }]);
        
        if (dataErr) {
          console.warn('⚠️ Failed to initialize shop data:', dataErr);
        } else {
          console.log('✅ Shop data initialized');
        }
        
        // Save session locally
        localStorage.setItem('xm_session', JSON.stringify({ 
          email, 
          shopId: shopId, 
          at: Date.now() 
        }));
        
        // Clean up sessionStorage
        sessionStorage.removeItem('create_shop_name');
        sessionStorage.removeItem('create_shop_type');
        sessionStorage.removeItem('create_shop_zipcode');
        
        err.textContent = 'Shop created successfully with Google! Redirecting...';
        err.style.color = 'green';
        console.log('✅ OAuth shop creation complete. Redirecting to dashboard...');
        
        setTimeout(() => {
          window.location.href = 'dashboard.html';
        }, 2000);
        
        return;
      } else {
        throw new Error('No session found after OAuth');
      }
    } catch (ex) {
  err.textContent = 'There was a problem creating your shop with Google. Please try again or use another method.';
  err.style.color = 'red';
    }
  }

  // ============================================================================
  // MANUAL DEBUG BUTTON - Test Supabase user creation
  // ============================================================================
  const manualBtn = document.getElementById('manualCreateUserBtn');
  if (manualBtn) {
    manualBtn.addEventListener('click', async () => {
      err.textContent = '';
      const supabase = getSupabaseClient();
      
      const emailInput = document.getElementById('csEmail');
      const passInput = document.getElementById('csPass');
      const firstInput = document.getElementById('csFirst');
      const lastInput = document.getElementById('csLast');
      const zipcodeInput = document.getElementById('csZipcode');
      
      const email = emailInput ? emailInput.value.trim() : '';
      const pass = passInput ? passInput.value.trim() : '';
      const first = firstInput ? firstInput.value.trim() : '';
      const last = lastInput ? lastInput.value.trim() : '';
      const zipcode = zipcodeInput ? zipcodeInput.value.trim() : '';
      
      console.log('DEBUG: Inputs', { email, pass, first, last, zipcode });
      
      if (!email || !pass) {
        err.textContent = 'Email and password required.';
        return;
      }
      if (!supabase) {
        err.textContent = 'Supabase client not available.';
        return;
      }
      
      try {
        const { data: signData, error: signErr } = await supabase.auth.signUp({
          email,
          password: pass,
          options: { data: { first, last, zipcode, role: 'admin' } }
        });
        
        console.log('DEBUG: Manual signUp result:', signData, signErr);
        
        if (signErr) {
          const msg = (signErr.message || '').toLowerCase();
          if (msg.includes('user already registered') || msg.includes('already registered') || msg.includes('already exists')) {
            console.log('DEBUG: User exists, attempting sign-in');
            const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({ 
              email, 
              password: pass 
            });
            
            console.log('DEBUG: signIn result:', signInData, signInErr);
            
            if (signInErr) {
              err.textContent = 'Manual sign-in failed: ' + (signInErr.message || JSON.stringify(signInErr));
            } else {
              err.textContent = 'Manual admin signed in successfully.';
            }
          } else {
            err.textContent = 'Manual user creation failed: ' + (signErr.message || JSON.stringify(signErr));
          }
        } else if (!signData || !signData.user) {
          err.textContent = 'Manual user creation failed: No user returned.';
        } else {
          err.textContent = 'Manual admin user created in Supabase Auth!';
        }
      } catch (ex) {
        err.textContent = 'Manual user creation error: ' + (ex.message || JSON.stringify(ex));
      }
    });
  }

  // ============================================================================
  // REGULAR FORM SUBMIT HANDLER
  // ============================================================================
  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    err.textContent = '';

    // Collect form data
    const shopName = document.getElementById('csName').value.trim();
    const shopType = document.getElementById('csType').value.trim();
    const shopLogoFile = document.getElementById('csLogo')?.files?.[0];
    const first = document.getElementById('csFirst').value.trim();
    const last = document.getElementById('csLast').value.trim();
    const email = document.getElementById('csEmail').value.trim();
    const pass = document.getElementById('csPass').value.trim();
    const zipcode = document.getElementById('csZipcode').value.trim();

    let shopLogo = '';
    if (shopLogoFile) {
      shopLogo = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.readAsDataURL(shopLogoFile);
      });
    }

    // Try Supabase first
    let supabaseSuccess = false;
    try {
      if (supabase) {
        console.log('🏪 Creating shop via Supabase...');
        
        // Create shop
        const join_code = Math.random().toString(36).slice(2,8).toUpperCase();
        const shopInsert = { name: shopName, type: shopType, join_code, staff_limit: 3 };
        const { data: shopData, error: shopErr } = await supabase.from('shops').insert([shopInsert]).select().single();
        
        if (shopErr || !shopData) {
          console.error('❌ Shop creation failed:', shopErr);
          throw shopErr || new Error('Could not create shop.');
        }
        
        console.log('✅ Shop created:', shopData);
        const shopId = shopData.id;
        
        // Create user in Supabase Auth with shop_id in metadata
        console.log('👤 Creating admin user in Supabase Auth...');
        const { data: signData, error: signErr } = await supabase.auth.signUp({
          email,
          password: pass,
          options: { 
            data: { 
              first, 
              last, 
              zipcode, 
              role: 'admin',
              shop_id: shopId
            } 
          }
        });
        
        console.log('DEBUG: signUp result:', signData, signErr);
        
        if (signErr) {
          const msg = (signErr.message || '').toLowerCase();
          // If the user already exists, sign them in instead
          if (msg.includes('user already registered') || msg.includes('already registered') || msg.includes('already exists')) {
            console.warn('⚠️ User already registered, signing in...');
            const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({ email, password: pass });
            
            if (signInErr) {
              console.error('❌ Sign-in after existing user failed:', signInErr);
              throw signInErr || new Error('Sign-in failed after existing user.');
            }
            
            console.log('✅ Signed in existing user:', signInData);
            
            // Create/update user record in users table
            const auth_id = signInData.user.id;
            await createUserRecord(supabase, auth_id, email, first, last, zipcode, 'admin', shopId);
            
            // Save session locally
            localStorage.setItem('xm_session', JSON.stringify({ 
              email, 
              shopId: shopId, 
              at: Date.now() 
            }));
            
            err.textContent = 'Shop created and signed in! Redirecting to dashboard...';
            supabaseSuccess = true;
            setTimeout(() => location.href = 'dashboard.html', 2000);
            return;
          }
          
          console.error('❌ User creation failed:', signErr);
          throw signErr || new Error('User creation failed.');
        }
        
        if (!signData || !signData.user) {
          console.error('❌ User creation returned no user:', signData);
          throw new Error('User creation failed: no user returned.');
        }
        
        console.log('✅ User created in Auth:', signData.user);
        
        // Create user record in custom users table
        const auth_id = signData.user.id;
        await createUserRecord(supabase, auth_id, email, first, last, zipcode, 'admin', shopId);
        
        // Initialize empty data record for the shop
        console.log('📊 Initializing shop data...');
        const { error: dataErr } = await supabase.from('data').insert([{
          shop_id: shopId,
          settings: {},
          appointments: [],
          jobs: [],
          threads: [],
          invoices: []
        }]);
        
        if (dataErr) {
          console.warn('⚠️ Failed to initialize shop data:', dataErr);
        } else {
          console.log('✅ Shop data initialized');
        }
        
        // Save session locally
        localStorage.setItem('xm_session', JSON.stringify({ 
          email, 
          shopId: shopId, 
          at: Date.now() 
        }));
        
        err.textContent = 'Shop created successfully! Redirecting to dashboard...';
        supabaseSuccess = true;
        console.log('✅ Shop creation complete. Redirecting to dashboard...');
        
        // Redirect directly to dashboard
        setTimeout(() => location.href = 'dashboard.html', 2000);
        return;
      }
    } catch (ex) {
  err.textContent = 'There was a problem creating your shop. Please try again.';
      // Do not redirect on error
    }

    // LocalStorage fallback
    if (!supabaseSuccess) {
      try {
        console.log('💾 Falling back to localStorage...');
        const shops = JSON.parse(localStorage.getItem('xm_shops') || '[]');
        const users = JSON.parse(localStorage.getItem('xm_users') || '[]');
        
        if (users.some(u => u.email === email)) {
          err.textContent = 'Email already in use.';
          return;
        }
        
        const shopId = 'shop_' + Math.random().toString(36).slice(2,8);
        const join_code = Math.random().toString(36).slice(2,8).toUpperCase();
        const shop = { id: shopId, name: shopName, type: shopType, logo: shopLogo, join_code, staff_limit: 3 };
        shops.push(shop);
        localStorage.setItem('xm_shops', JSON.stringify(shops));
        
        const admin = { 
          id: 'u_' + Math.random().toString(36).slice(2,8), 
          first, 
          last, 
          email, 
          password: pass, 
          zipcode, 
          role: 'admin', 
          shop_id: shopId 
        };
        users.push(admin);
        localStorage.setItem('xm_users', JSON.stringify(users));
        
        localStorage.setItem('xm_session', JSON.stringify({ 
          email, 
          shopId: shopId, 
          at: Date.now() 
        }));
        
        err.textContent = 'Shop created locally! Redirecting to dashboard...';
        console.log('✅ Local shop created successfully.');
        setTimeout(() => location.href = 'dashboard.html', 2000);
      } catch (ex) {
  err.textContent = 'There was a problem saving your shop. Please try again.';
      }
    }
  });

  // ============================================================================
  // GOOGLE OAUTH BUTTON HANDLER
  // ============================================================================
  const googleBtn = document.getElementById('googleCreateShopBtn');
  if (googleBtn && supabase) {
    googleBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      
      // Get form values and store them for after OAuth redirect
      const shopName = document.getElementById('csName')?.value?.trim();
      const shopType = document.getElementById('csType')?.value?.trim();
      const zipcode = document.getElementById('csZipcode')?.value?.trim();
      
      if (!shopName) {
        err.textContent = 'Please enter a shop name first.';
        err.style.color = 'red';
        return;
      }
      
      // Store shop data in sessionStorage for after redirect
      sessionStorage.setItem('create_shop_name', shopName);
      sessionStorage.setItem('create_shop_type', shopType || 'Mechanic');
      if (zipcode) sessionStorage.setItem('create_shop_zipcode', zipcode);
      
      try {
        console.log('🔐 Initiating Google OAuth shop creation...');
        
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { 
            redirectTo: window.location.origin + '/create-shop.html?oauth=google'
          }
        });
        
        if (error) {
          err.textContent = 'Could not start Google login. Please try again.';
          err.style.color = 'red';
        }
      } catch (ex) {
  err.textContent = 'Could not start Google login. Please try again.';
  err.style.color = 'red';
      }
    });
  }
});

/**
 * Helper function to create user record in custom users table
 */
async function createUserRecord(supabase, auth_id, email, first, last, zipcode, role, shop_id) {
  console.log('📝 Creating user record in users table...');
  
  // Check if user already exists
  const { data: existingUser, error: checkErr } = await supabase
    .from('users')
    .select('id')
    .eq('id', auth_id)
    .single();
  
  if (existingUser) {
    console.log('ℹ️ User record already exists, updating...');
    // Update existing record
    const { error: updateErr } = await supabase
      .from('users')
      .update({ shop_id, first, last, zipcode, role })
      .eq('id', auth_id);
    
    if (updateErr) {
      console.error('❌ Failed to update user record:', updateErr);
      throw updateErr;
    }
    console.log('✅ User record updated');
    return;
  }
  
  // Create new user record
  const userInsert = {
    id: auth_id,
    email,
    first,
    last,
    role,
    shop_id,
    zipcode,
    created_at: new Date().toISOString()
  };
  
  const { data: userData, error: userErr } = await supabase
    .from('users')
    .insert([userInsert])
    .select()
    .single();
  
  if (userErr) {
    console.error('❌ Failed to create user record:', userErr);
    throw userErr;
  }
  
  console.log('✅ User record created:', userData);
}
