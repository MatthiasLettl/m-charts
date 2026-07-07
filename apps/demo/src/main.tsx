import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './styles.css';
import { ThemeModeProvider } from './theme/ThemeModeProvider.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeModeProvider>
        <App />
      </ThemeModeProvider>
    </BrowserRouter>
  </StrictMode>,
);
