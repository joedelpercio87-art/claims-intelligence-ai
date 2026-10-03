import React from 'react';
import { createRoot } from 'react-dom/client';
import ClaimsApp from './ui/ClaimsApp';
import './ui/styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ClaimsApp /></React.StrictMode>
);
