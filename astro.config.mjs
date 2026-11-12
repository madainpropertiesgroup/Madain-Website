import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

// The 2026 general assembly has been held and its section is closed. Old
// links to it land on the front page, where the closing announcement is.
const closed = [
  '/general-assembly-2026',
  '/general-assembly-2026/postponement',
  '/general-assembly-2026/nomination',
  '/general-assembly-2026/nominees',
  '/general-assembly-2026/nominees/asma-moosa',
  '/general-assembly-2026/nominees/khamis-buharoon',
  '/general-assembly-2026/nominees/hazza-almansoori',
  '/general-assembly-2026/briefing',
  '/general-assembly-2026/attendance-voting',
  '/general-assembly-2026/documents',
];

export default defineConfig({
  integrations: [tailwind()],
  redirects: Object.fromEntries(closed.map((path) => [path, '/'])),
});
