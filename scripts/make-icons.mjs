import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Ícono: dumbbell blanco sobre fondo violeta (acento de la app).
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../static/icons');
mkdirSync(dir, { recursive: true });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#7c5cff"/><g fill="#ffffff"><rect x="196" y="240" width="120" height="32" rx="16"/><rect x="156" y="192" width="40" height="128" rx="18"/><rect x="124" y="212" width="28" height="88" rx="14"/><rect x="316" y="192" width="40" height="128" rx="18"/><rect x="360" y="212" width="28" height="88" rx="14"/></g></svg>`;
const buf = Buffer.from(svg);

await sharp(buf).resize(192, 192).png().toFile(`${dir}/icon-192.png`);
await sharp(buf).resize(512, 512).png().toFile(`${dir}/icon-512.png`);
await sharp(buf).resize(512, 512).png().toFile(`${dir}/icon-maskable-512.png`);
await sharp(buf).resize(180, 180).png().toFile(`${dir}/apple-touch-icon.png`);

console.log('Iconos generados en', dir);
