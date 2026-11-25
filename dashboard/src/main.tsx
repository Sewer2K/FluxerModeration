import './lib/glitchtip';
import { initPosthogFromPrefs } from './lib/posthog';
initPosthogFromPrefs();

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App';
import { AuthProvider } from './lib/auth';
import { loadInstanceEndpoints } from './lib/instance';
import './index.css';

void loadInstanceEndpoints().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </StrictMode>,
  );
});
