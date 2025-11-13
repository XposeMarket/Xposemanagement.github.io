/**
 * helpers/user.js - PHASE 2 UPDATE
 * User & Shop Management
 * Extracted from original app.js
 */

import { LS, ROLE_PAGES } from './constants.js';
import { readLS, writeLS, clearCache } from './storage.js';

/**
 * Get currently logged-in user
 */
function currentUser() {
  const session = readLS(LS.session, null);
  if (!session) return null;
  const users = readLS(LS.users, []);
  return users.find(x => x.email === session.email) || null;
}

/**
 * Get current user's shop
 */
function currentShop() {
  const user = currentUser();
  const shops = readLS(LS.shops, []) || [];
  if (user) {
    return shops.find(s => s.id === user.shop_id) || shops[0] || null;
  }
  return shops[0] || null;
}

/**
 * Async version - get user from Supabase
 */
async function getCurrentUser() {
  if (typeof supabase !== 'undefined' && supabase && supabase.auth) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) return user;
    } catch (e) {
      console.warn('getCurrentUser Supabase failed', e);
    }
  }
  return currentUser();
}

/**
 * Async version - get shop from database
 */
async function getCurrentShop() {
  if (!supabase) {
    return currentShop();
  }

  const user = await getCurrentUser();
  if (!user || !user.shop_id) return null;

  const { data, error } = await supabase
    .from('shops')
    .select('*')
    .eq('id', user.shop_id)
    .single();

  return error ? null : data;
}

/**
 * Logout user
 */
async function logout() {
  try {
    if (typeof supabase !== 'undefined' && supabase && supabase.auth) {
      try {
        await supabase.auth.signOut();
      } catch (e) {
        console.warn('Supabase signOut failed', e);
      }
    }
  } catch (e) {
    console.warn('logout error', e);
  }

  try {
    localStorage.removeItem(LS.session);
  } catch (e) {
    console.warn('removeItem session failed', e);
  }

  clearCache();
  window.location.href = 'index.html';
}

/**
 * Check if user can access page
 */
function canAccessPage(pageName, user = null) {
  const u = user || currentUser();
  if (!u) return false;
  const allowed = ROLE_PAGES[u.role] || [];
  return allowed.includes(pageName);
}

/**
 * Toggle dark theme
 */
function toggleTheme() {
  const html = document.documentElement;
  html.classList.toggle('dark');
  const dark = html.classList.contains('dark');
  const u = currentUser();
  if (!u) return;
  const users = readLS(LS.users, []);
  const i = users.findIndex(x => x.id === u.id);
  if (i >= 0) {
    users[i].theme = dark ? 'dark' : 'light';
    writeLS(LS.users, users);
  }
}

/**
 * Set theme from user preference
 */
function setThemeFromUser() {
  const u = currentUser();
  const t = (u && u.theme) || 'light';
  document.documentElement.classList.toggle('dark', t === 'dark');
}

export {
  currentUser,
  currentShop,
  getCurrentUser,
  getCurrentShop,
  logout,
  canAccessPage,
  toggleTheme,
  setThemeFromUser
};
