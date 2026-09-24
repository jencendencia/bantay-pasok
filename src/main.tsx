import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ScannerApp from './scanner/ScannerApp';
import { DataProvider } from './store';
import { DialogHost } from './ui';
import './styles.css';

const hash = window.location.hash;

// Hidden container that holds ID cards when printing (only this prints).
let printRoot = document.getElementById('print-root');
if (!printRoot) {
  printRoot = document.createElement('div');
  printRoot.id = 'print-root';
  document.body.appendChild(printRoot);
}

const root = createRoot(document.getElementById('root')!);
if (hash.startsWith('#/scanner')) {
  root.render(
    <DataProvider>
      <ScannerApp />
      <DialogHost />
    </DataProvider>
  );
} else {
  root.render(
    <>
      <App />
      <DialogHost />
    </>
  );
}
