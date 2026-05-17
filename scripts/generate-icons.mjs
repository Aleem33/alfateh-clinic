/**
 * Generate Windows app icons from src/assets/logo.png
 */
import { mkdir, copyFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';
import toIco from 'to-ico';

const SOURCE = 'src/assets/logo.png';
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const pngBuffers = await Promise.all(
  SIZES.map((size) => sharp(SOURCE).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer())
);

writeFileSync('icon.ico', await toIco(pngBuffers));
await sharp(SOURCE).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile('icon.png');

await mkdir('build', { recursive: true });
await copyFile('icon.png', 'build/icon.png');
await copyFile('src/assets/logo.png', 'public/logo.png');

console.log('Generated icon.ico, icon.png, build/icon.png');
