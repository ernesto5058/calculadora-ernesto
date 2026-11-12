// Humo E2E — configuración (TOP 6, 2026-11-12). Navegador real contra las
// URLs PÚBLICAS servidas: lo que el banco jsdom no puede ver (sesión real,
// service worker, red de verdad) lo caza esta suite.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'humo.spec.mjs',
  timeout: 120_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    ...devices['Pixel 7'],
    baseURL: 'https://ernesto5058.github.io/calculadora-ernesto',
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
  },
});
