import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyTheme, applyAccent, applyVariant } from '@/theme';
import { applyLocale } from '@/i18n';
import './index.css';

// Apply the saved theme before first paint to avoid a flash of the wrong theme.
try {
  const prefs = JSON.parse(localStorage.getItem('micelio_prefs') || '{}');
  applyTheme(prefs.theme || 'system');
  applyLocale(prefs.locale || 'en');
  applyAccent(prefs.accentColor as any || 'default');
  applyVariant(prefs.themeVariant as any || 'default');
} catch {
  applyTheme('system');
  applyLocale('en');
  applyAccent('default');
  applyVariant('default');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
