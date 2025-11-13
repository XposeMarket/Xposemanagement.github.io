/**
 * app.js - PHASE 3 (Modular Version)
 * Main Entry Point & Page Coordinator
 * FIXED: Added signup page route
 */

import { LS } from './helpers/constants.js';
import { readLS, writeLS, clearCache } from './helpers/storage.js';
import { currentUser, currentShop, logout, toggleTheme, setThemeFromUser } from './helpers/user.js';
import { byId, todayISO, addInvoiceCSS } from './helpers/utils.js';
import { pageName, applyNavPermissions, enforcePageAccess, requireAuth, ensureSeed, showServerBanner } from './helpers/auth.js';

import { setupLogin } from './pages/index.js';
import { setupDashboard } from './pages/dashboard.js';
import { setupAppointments } from './pages/appointments.js';
import { setupJobs } from './pages/jobs.js';
import { setupInvoices } from './pages/invoices.js';
import { setupMessages } from './pages/messages.js';
import { setupSettings } from './pages/settings.js';
import { setupProfile } from './pages/profile.js';

/**
 * Main initialization
 */
async function __mainBase() {
  // Seed demo data if first time
  await ensureSeed();

  // Set theme from user preference
  setThemeFromUser();


  // Theme toggle button
  if (byId("themeToggle")) {
    byId("themeToggle").addEventListener("click", toggleTheme);
  }

  // Logout button
  if (byId("logoutBtn")) {
    byId("logoutBtn").addEventListener("click", async () => {
      await logout();
    });
  }

  // Mobile burger menu toggle
  const menuToggle = byId("menuToggle");
  const mainNav = document.getElementById("mainNav");
  if (menuToggle && mainNav) {
    menuToggle.addEventListener("click", function () {
      mainNav.classList.toggle("active");
      menuToggle.classList.toggle("active");
    });
  }

  // Add invoice CSS
  addInvoiceCSS();

  // Get current page
  const p = pageName();

  // Route to appropriate page setup
  if (p === "index" || p === "") {
    // Login page - no auth required
    setupLogin();
  } else if (p === "signup") {
    // Signup page - no auth required
    // Load the signup module dynamically
    import('./pages/signup.js').then(() => {
      console.log('✅ Signup page loaded');
    }).catch(err => {
      console.error('❌ Failed to load signup page:', err);
    });
  } else if (p === "create-shop") {
    // Create shop page - no auth required
    // Already has its own script tag, no need to load here
    console.log('✅ Create shop page');
  } else {
    // All other pages require authentication
    await requireAuth();

    // Setup page based on route
    if (p === "dashboard") setupDashboard();
    else if (p === "appointments") setupAppointments();
    else if (p === "jobs") setupJobs();
    else if (p === "invoices") setupInvoices();
    else if (p === "messages") setupMessages();
    else if (p === "settings") setupSettings();
    else if (p === "profile") setupProfile();
  }
}

// Start app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  __mainBase().catch(err => {
    console.error('App initialization failed:', err);
    showServerBanner('Failed to load app. Please refresh the page.');
  });
});

// Expose to window for debugging
window.CRM = {
  readLS,
  writeLS,
  currentUser,
  currentShop,
  pageName,
  byId,
  todayISO
};
