// Inline the game into one HTML file (dist/chonk.html) for publishing as a claude.ai artifact.
// There the platform's `room` capability replaces our WebSocket server; declare it on publish as
// {"room": {"topics": {"log": "interact"}}}.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const read = p => readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8');
let html = read('index.html')
  .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${read('styles.css')}\n</style>`)
  .replace(/<link rel="icon"[^>]*>\n/, '')
  .replace(/<script src="(js\/[\w.-]+)"><\/script>/g, (_, src) => `<script>\n${read(src)}\n</script>`);
mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('../dist/chonk.html', import.meta.url), html);
console.log(`dist/chonk.html ${(html.length / 1024).toFixed(0)} KB`);
