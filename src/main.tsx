import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/global.css';
import './styles/app.css';

// Nur für die Kalibrierung (scripts/calib/calibrate.mjs)
if (new URLSearchParams(location.search).has('calib')) void import('./scan/calibHook');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
