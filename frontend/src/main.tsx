import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyTheme } from '@/theme';
import './index.css';

// Apply the saved theme before first paint to avoid a flash of the wrong theme.
try {
  const prefs = JSON.parse(localStorage.getItem('micelio_prefs') || '{}');
  applyTheme(prefs.theme || 'system');
} catch {
  applyTheme('system');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
