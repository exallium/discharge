/**
 * Admin UI shared layout
 *
 * Provides the HTML shell, navigation, and Material Design 3 theming.
 * Supports light/dark mode with system preference detection.
 */

export interface LayoutOptions {
  title: string;
  activeNav?: 'dashboard' | 'projects' | 'settings' | 'jobs';
  scripts?: string[];
}

/**
 * Render the admin page layout
 */
export function renderLayout(content: string, options: LayoutOptions): string {
  const { title, activeNav = 'dashboard', scripts = [] } = options;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - AI Bug Fixer Admin</title>
  <style>
${getStyles()}
  </style>
  <script>
    // Theme detection and toggle
    (function() {
      const savedTheme = localStorage.getItem('theme');
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const theme = savedTheme || (prefersDark ? 'dark' : 'light');
      document.documentElement.setAttribute('data-theme', theme);
    })();
  </script>
</head>
<body>
  <header class="header">
    <div class="header-content">
      <a href="/admin" class="logo">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="32" height="32" rx="8" fill="var(--md-primary)"/>
          <path d="M16 6L8 10v12l8 4 8-4V10l-8-4z" fill="var(--md-on-primary)" opacity="0.9"/>
          <circle cx="16" cy="16" r="4" fill="var(--md-primary)"/>
        </svg>
        <span>AI Bug Fixer</span>
      </a>
      <nav class="nav">
        <a href="/admin/dashboard" class="nav-link ${activeNav === 'dashboard' ? 'active' : ''}">Dashboard</a>
        <a href="/admin/projects" class="nav-link ${activeNav === 'projects' ? 'active' : ''}">Projects</a>
        <a href="/admin/settings" class="nav-link ${activeNav === 'settings' ? 'active' : ''}">Settings</a>
        <a href="/admin/jobs" class="nav-link ${activeNav === 'jobs' ? 'active' : ''}">Jobs</a>
      </nav>
      <button class="theme-toggle" onclick="toggleTheme()" aria-label="Toggle theme">
        <svg class="sun-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="5"/>
          <line x1="12" y1="1" x2="12" y2="3"/>
          <line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1" y1="12" x2="3" y2="12"/>
          <line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
        <svg class="moon-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      </button>
    </div>
  </header>

  <main class="main">
    <div class="container">
      ${content}
    </div>
  </main>

  <footer class="footer">
    <div class="footer-content">
      <span class="footer-status">
        <span class="status-dot healthy"></span>
        System healthy
      </span>
      <span class="footer-version">v1.0.0</span>
    </div>
  </footer>

  <script>
    function toggleTheme() {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
    }

    // API helper
    async function api(method, path, data) {
      const options = {
        method,
        headers: { 'Content-Type': 'application/json' },
      };
      if (data) options.body = JSON.stringify(data);
      const res = await fetch('/admin/api' + path, options);
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || 'Request failed');
      }
      return res.json();
    }

    // Toast notifications
    function showToast(message, type = 'info') {
      const toast = document.createElement('div');
      toast.className = 'toast toast-' + type;
      toast.textContent = message;
      document.body.appendChild(toast);
      setTimeout(() => toast.classList.add('show'), 10);
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
      }, 3000);
    }
  </script>
  ${scripts.map(s => `<script>${s}</script>`).join('\n')}
</body>
</html>`;
}

/**
 * Get the CSS styles
 */
function getStyles(): string {
  return `
/* Material Design 3 Color System */
:root {
  /* Primary - Teal (friendly, tech-forward) */
  --md-primary: #006A6A;
  --md-on-primary: #FFFFFF;
  --md-primary-container: #6FF7F6;
  --md-on-primary-container: #002020;

  /* Secondary - Blue-gray */
  --md-secondary: #4A6363;
  --md-on-secondary: #FFFFFF;
  --md-secondary-container: #CCE8E7;
  --md-on-secondary-container: #051F1F;

  /* Tertiary - Orange (for accents, warnings) */
  --md-tertiary: #8B5000;
  --md-on-tertiary: #FFFFFF;
  --md-tertiary-container: #FFDCBE;

  /* Error */
  --md-error: #BA1A1A;
  --md-on-error: #FFFFFF;
  --md-error-container: #FFDAD6;

  /* Success */
  --md-success: #006E2C;
  --md-success-container: #95F9AD;

  /* Surface (light mode) */
  --md-surface: #FAFDFC;
  --md-on-surface: #191C1C;
  --md-surface-variant: #DAE5E4;
  --md-on-surface-variant: #3F4948;
  --md-outline: #6F7978;
  --md-outline-variant: #BEC9C8;

  /* Elevation */
  --md-surface-1: #EEF5F4;
  --md-surface-2: #E6EFEE;
  --md-surface-3: #DEE9E8;

  /* Typography */
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --font-mono: 'SF Mono', SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace;

  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-8: 48px;

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;

  /* Transitions */
  --transition-fast: 150ms ease;
  --transition-normal: 200ms ease;
}

[data-theme="dark"] {
  --md-primary: #4CDADA;
  --md-on-primary: #003737;
  --md-primary-container: #004F4F;
  --md-on-primary-container: #6FF7F6;

  --md-secondary: #B0CCCB;
  --md-on-secondary: #1B3434;
  --md-secondary-container: #324B4B;

  --md-tertiary: #FFB86A;
  --md-tertiary-container: #6A3B00;

  --md-error: #FFB4AB;
  --md-error-container: #93000A;

  --md-success: #79DC94;
  --md-success-container: #005319;

  --md-surface: #191C1C;
  --md-on-surface: #E0E3E2;
  --md-surface-variant: #3F4948;
  --md-on-surface-variant: #BEC9C8;
  --md-outline: #899392;
  --md-outline-variant: #3F4948;

  --md-surface-1: #1E2424;
  --md-surface-2: #232A29;
  --md-surface-3: #283030;
}

/* Reset */
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

/* Base */
html {
  font-size: 16px;
  line-height: 1.5;
}

body {
  font-family: var(--font-sans);
  background: var(--md-surface);
  color: var(--md-on-surface);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Header */
.header {
  background: var(--md-surface-1);
  border-bottom: 1px solid var(--md-outline-variant);
  position: sticky;
  top: 0;
  z-index: 100;
}

.header-content {
  max-width: 1200px;
  margin: 0 auto;
  padding: var(--space-3) var(--space-4);
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.logo {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  text-decoration: none;
  color: var(--md-on-surface);
  font-weight: 600;
  font-size: 1.125rem;
}

.nav {
  display: flex;
  gap: var(--space-2);
  margin-left: auto;
}

.nav-link {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  text-decoration: none;
  color: var(--md-on-surface-variant);
  font-weight: 500;
  font-size: 0.875rem;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.nav-link:hover {
  background: var(--md-surface-2);
  color: var(--md-on-surface);
}

.nav-link.active {
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
}

.theme-toggle {
  background: none;
  border: none;
  padding: var(--space-2);
  border-radius: var(--radius-md);
  cursor: pointer;
  color: var(--md-on-surface-variant);
  display: flex;
  align-items: center;
  justify-content: center;
}

.theme-toggle:hover {
  background: var(--md-surface-2);
}

[data-theme="light"] .moon-icon { display: none; }
[data-theme="dark"] .sun-icon { display: none; }

/* Main */
.main {
  flex: 1;
  padding: var(--space-5) var(--space-4);
}

.container {
  max-width: 1200px;
  margin: 0 auto;
}

/* Footer */
.footer {
  background: var(--md-surface-1);
  border-top: 1px solid var(--md-outline-variant);
  padding: var(--space-3) var(--space-4);
}

.footer-content {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.75rem;
  color: var(--md-on-surface-variant);
}

.footer-status {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

/* Status dots */
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--md-outline);
}

.status-dot.healthy { background: var(--md-success); }
.status-dot.warning { background: var(--md-tertiary); }
.status-dot.error { background: var(--md-error); }
.status-dot.running {
  background: var(--md-primary);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* Page title */
.page-header {
  margin-bottom: var(--space-5);
}

.page-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--md-on-surface);
  margin-bottom: var(--space-1);
}

.page-subtitle {
  font-size: 0.875rem;
  color: var(--md-on-surface-variant);
}

/* Cards */
.card {
  background: var(--md-surface-1);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  border: 1px solid var(--md-outline-variant);
  transition: box-shadow var(--transition-fast), transform var(--transition-fast);
}

.card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.card-title {
  font-size: 1.125rem;
  font-weight: 600;
  margin-bottom: var(--space-3);
}

/* Grid */
.grid {
  display: grid;
  gap: var(--space-4);
}

.grid-2 { grid-template-columns: repeat(2, 1fr); }
.grid-3 { grid-template-columns: repeat(3, 1fr); }
.grid-4 { grid-template-columns: repeat(4, 1fr); }

@media (max-width: 768px) {
  .grid-2, .grid-3, .grid-4 {
    grid-template-columns: 1fr;
  }
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  transition: all var(--transition-fast);
  border: none;
  font-family: inherit;
}

.btn:active {
  transform: scale(0.98);
}

.btn-primary {
  background: var(--md-primary);
  color: var(--md-on-primary);
}

.btn-primary:hover {
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
}

.btn-secondary {
  background: transparent;
  color: var(--md-primary);
  border: 1px solid var(--md-primary);
}

.btn-secondary:hover {
  background: var(--md-surface-2);
}

.btn-danger {
  background: var(--md-error);
  color: var(--md-on-error);
}

.btn-danger:hover {
  background: var(--md-error-container);
  color: #BA1A1A;
}

.btn-ghost {
  background: transparent;
  color: var(--md-on-surface-variant);
}

.btn-ghost:hover {
  background: var(--md-surface-2);
  color: var(--md-on-surface);
}

/* Forms */
.form-group {
  margin-bottom: var(--space-4);
}

.form-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--md-on-surface);
  margin-bottom: var(--space-1);
}

.form-input {
  width: 100%;
  padding: var(--space-3);
  border: 1px solid var(--md-outline);
  border-radius: var(--radius-md);
  font-size: 1rem;
  font-family: inherit;
  background: var(--md-surface);
  color: var(--md-on-surface);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.form-input:focus {
  outline: none;
  border-color: var(--md-primary);
  box-shadow: 0 0 0 3px rgba(0, 106, 106, 0.2);
}

.form-input::placeholder {
  color: var(--md-outline);
}

.form-help {
  font-size: 0.75rem;
  color: var(--md-on-surface-variant);
  margin-top: var(--space-1);
}

.form-error {
  color: var(--md-error);
}

/* Tables */
.table {
  width: 100%;
  border-collapse: collapse;
}

.table th,
.table td {
  padding: var(--space-3);
  text-align: left;
  border-bottom: 1px solid var(--md-outline-variant);
}

.table th {
  font-weight: 600;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--md-on-surface-variant);
}

.table tr:hover {
  background: var(--md-surface-2);
}

/* Badges */
.badge {
  display: inline-flex;
  align-items: center;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  font-weight: 500;
}

.badge-success {
  background: var(--md-success-container);
  color: var(--md-success);
}

.badge-error {
  background: var(--md-error-container);
  color: var(--md-error);
}

.badge-warning {
  background: var(--md-tertiary-container);
  color: var(--md-tertiary);
}

.badge-info {
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
}

/* Empty state */
.empty-state {
  text-align: center;
  padding: var(--space-8) var(--space-4);
}

.empty-state-icon {
  font-size: 3rem;
  margin-bottom: var(--space-4);
}

.empty-state-title {
  font-size: 1.25rem;
  font-weight: 600;
  margin-bottom: var(--space-2);
}

.empty-state-text {
  color: var(--md-on-surface-variant);
  margin-bottom: var(--space-4);
}

/* Stats */
.stat {
  text-align: center;
}

.stat-value {
  font-size: 2rem;
  font-weight: 700;
  color: var(--md-primary);
}

.stat-label {
  font-size: 0.75rem;
  color: var(--md-on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Toast notifications */
.toast {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%) translateY(100px);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--md-surface-3);
  color: var(--md-on-surface);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  opacity: 0;
  transition: transform var(--transition-normal), opacity var(--transition-normal);
  z-index: 1000;
}

.toast.show {
  transform: translateX(-50%) translateY(0);
  opacity: 1;
}

.toast-success { background: var(--md-success-container); color: var(--md-success); }
.toast-error { background: var(--md-error-container); color: var(--md-error); }

/* Modal */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.modal {
  background: var(--md-surface);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  max-width: 500px;
  width: 90%;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-title {
  font-size: 1.25rem;
  font-weight: 600;
  margin-bottom: var(--space-4);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-4);
}

/* Code */
code {
  font-family: var(--font-mono);
  font-size: 0.875em;
  background: var(--md-surface-2);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}

/* Utilities */
.text-muted { color: var(--md-on-surface-variant); }
.text-success { color: var(--md-success); }
.text-error { color: var(--md-error); }
.text-warning { color: var(--md-tertiary); }

.flex { display: flex; }
.flex-col { flex-direction: column; }
.items-center { align-items: center; }
.justify-between { justify-content: space-between; }
.gap-2 { gap: var(--space-2); }
.gap-4 { gap: var(--space-4); }

.mt-2 { margin-top: var(--space-2); }
.mt-4 { margin-top: var(--space-4); }
.mb-2 { margin-bottom: var(--space-2); }
.mb-4 { margin-bottom: var(--space-4); }
`;
}

/**
 * Escape HTML special characters
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, c => map[c]);
}
