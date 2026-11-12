// Ojo Visual — configuración de Playwright Test (TOP 5, 2026-11-12).
// Baselines generadas SIEMPRE en el runner de GitHub (Linux): el render
// local de otra máquina no es comparable píxel a píxel.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'visual.spec.mjs',
  timeout: 90_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  expect: {
    toHaveScreenshot: {
      // Tolerancia sensata: 0,2 por píxel (ruido de render/antialiasing)
      // y hasta 1 % de píxeles distintos en total. Un texto cortado o un
      // botón movido cambia MUCHO más que eso; la hora o un contador, no
      // (y las zonas volátiles van enmascaradas en el spec).
      threshold: 0.2,
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    },
  },
  use: {
    ...devices['Pixel 7'],
    baseURL: 'https://ernesto5058.github.io/calculadora-ernesto',
    // Sin service worker: cada corrida fotografía lo que Pages sirve HOY,
    // no una caché vieja del navegador del robot.
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
  },
});
