import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ToastProvider } from './ui';
import './styles.css';
import App from './App';

if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
  document.documentElement.classList.add('dark');
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>
);
