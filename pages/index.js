/**
 * pages/index.js
 * Login & Signup page setup
 * FIXED: Added Google OAuth support with callback handling
 * 
 * Imported by: app.js
 * Imports from: helpers/
 */

import { LS } from '../helpers/constants.js';
import { readLS, writeLS, getShopData } from '../helpers/storage.js';
import { getSupabaseClient } from '../helpers/supabase.js';
import { byId } from '../helpers/utils.js';
import { showServerBanner } from '../helpers/auth.js';

/**
 * Setup login form
 */
function setupLogin() {
  const form = byId("loginForm");
  if (!form) return;
  
  const supabase = getSupabaseClient();

  // ============================================================================
  // OAUTH CALLBACK HANDLER - Check if we're returning from Google OAuth
  // ============================================================================
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('oauth') === 'google' && supabase) {
    console.log('🔄 Processing OAuth login callback...');
    
    (async () => {
      try {
        // Get the session from Supabase
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) throw sessionError;
        
        if (session && session.user) {
          console.log('✅ OAuth session found:', session.user.email);
          
          const auth_id = session.user.id;
          const email = session.user.email;
          let shop_id = null;

          // Check if user exists in custom users table
          try {
            const { data: customUser, error: customUserErr } = await supabase
              .from('users')
              .select('id, shop_id, role')
              .eq('id', auth_id)
              .single();
            
            if (!customUser) {
              console.log('👤 User not in custom users table, creating record...');
              
              // Get shop_id from user metadata
              shop_id = session.user.user_metadata?.shop_id;
              const first = session.user.user_metadata?.given_name || session.user.user_metadata?.first || '';
              const last = session.user.user_metadata?.family_name || session.user.user_metadata?.last || '';
              const zipcode = session.user.user_metadata?.zipcode || '';
              const role = session.user.user_metadata?.role || 'staff';
              
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
                console.error('❌ Failed to insert user into users table:', userErr);
              } else {
                console.log('✅ User record created:', userData);
              }
            } else {
              console.log('✅ User found in custom users table:', customUser);
              shop_id = customUser.shop_id;
            }
          } catch (ex) {
            console.warn('⚠️ Failed to check/insert user after OAuth login:', ex);
          }

          // Save session locally with shop_id
          localStorage.setItem('xm_session', JSON.stringify({ 
            email, 
            shopId: shop_id, 
            at: Date.now() 
          }));

          // Try to load server data for the user's shop
          if (shop_id) {
            try {
              console.log('📦 Loading shop data for:', shop_id);
              const serverData = await getShopData(shop_id);
              if (serverData && Object.keys(serverData).length) {
                writeLS(LS.data, serverData);
                console.log('✅ Shop data loaded');
              }
            } catch (ex) {
              console.warn('⚠️ Failed to fetch server data after login:', ex);
              showServerBanner();
            }
          }

          console.log('🚀 Redirecting to dashboard...');
          window.location.href = "dashboard.html";
          return;
        } else {
          throw new Error('No session found after OAuth');
        }
      } catch (ex) {
  byId("loginErr").textContent = 'There was a problem signing in with Google. Please try again or use another method.';
      }
    })();
    
    return; // Don't setup regular login form if processing OAuth
  }

  // ============================================================================
  // REGULAR LOGIN FORM HANDLER
  // ============================================================================
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = byId("loginEmail").value.trim().toLowerCase();
    const pass = byId("loginPass").value;

    if (supabase) {
      // Try Supabase authentication first
      try {
        console.log('🔐 Attempting Supabase login...');
        const { data, error } = await supabase.auth.signInWithPassword({ 
          email, 
          password: pass 
        });
        
        if (!error && data && data.user) {
          // Supabase auth succeeded
          console.log('✅ Supabase login successful');

          const auth_id = data.user.id;
          let shop_id = null;

          // Check if user exists in custom users table
          try {
            const { data: customUser, error: customUserErr } = await supabase
              .from('users')
              .select('id, shop_id')
              .eq('id', auth_id)
              .single();
            
            if (!customUser) {
              console.log('👤 User not in custom users table, creating record...');
              
              // Get shop_id from user metadata
              shop_id = data.user.user_metadata?.shop_id;
              const first = data.user.user_metadata?.first || '';
              const last = data.user.user_metadata?.last || '';
              const zipcode = data.user.user_metadata?.zipcode || '';
              const role = data.user.user_metadata?.role || 'admin';
              
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
                console.error('❌ Failed to insert user into users table:', userErr);
              } else {
                console.log('✅ User record created:', userData);
              }
            } else {
              console.log('✅ User found in custom users table:', customUser);
              shop_id = customUser.shop_id;
            }
          } catch (ex) {
            console.warn('⚠️ Failed to check/insert user after login:', ex);
          }

          // Save session locally with shop_id
          localStorage.setItem('xm_session', JSON.stringify({ 
            email, 
            shopId: shop_id, 
            at: Date.now() 
          }));

          // Try to load server data for the user's shop
          if (shop_id) {
            try {
              console.log('📦 Loading shop data for:', shop_id);
              const serverData = await getShopData(shop_id);
              if (serverData && Object.keys(serverData).length) {
                writeLS(LS.data, serverData);
                console.log('✅ Shop data loaded');
              }
            } catch (ex) {
              console.warn('⚠️ Failed to fetch server data after login:', ex);
              showServerBanner();
            }
          }

          console.log('🚀 Redirecting to dashboard...');
          location.href = "dashboard.html";
          return;
        }
        
        // Supabase auth failed - fall through to localStorage
        console.log('⚠️ Supabase auth failed, trying localStorage...');
      } catch (ex) {
  byId("loginErr").textContent = 'Unable to sign in. Please check your email and password or try again later.';
      }
    }
    
    // Fallback to localStorage authentication
    const users = readLS(LS.users, []);
    const user = users.find(u => u.email === email);
    
    if (!user || user.password !== pass) {
  byId("loginErr").textContent = "Incorrect email or password. Please try again.";
      return;
    }
    
    console.log('✅ localStorage login successful');
    
    // Create session with shop_id
    writeLS(LS.session, { 
      email: user.email, 
      shopId: user.shop_id,
      at: Date.now() 
    });
    
    location.href = "dashboard.html";
  });

  // ============================================================================
  // GOOGLE OAUTH LOGIN BUTTON HANDLER
  // ============================================================================
  const googleLoginBtn = byId("googleLoginBtn");
  if (googleLoginBtn && supabase) {
    googleLoginBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      
      try {
        console.log('🔐 Initiating Google OAuth login...');
        
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: window.location.origin + '/index.html?oauth=google'
          }
        });
        
        if (error) {
          byId("loginErr").textContent = 'Could not start Google login. Please try again.';
        }
      } catch (ex) {
  byId("loginErr").textContent = 'Could not start Google login. Please try again.';
      }
    });
  }
}

/**
 * Setup signup form (placeholder for future implementation)
 */
function setupSignup() {
  console.log('📄 setupSignup() placeholder');
  // TODO: Implement signup functionality
}

// Export only public setup functions
export { setupLogin, setupSignup };
