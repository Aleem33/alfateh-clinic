/**
 * Generate app logo PNGs and Windows icons from src/assets/logo-source.png
 */
import { mkdir, copyFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';

const SOURCE_IMAGE = 'src/assets/logo-source.png';
const SOURCE = 'src/assets/logo.png';
const SIZES = [16, 24, 32, 48, 64, 128, 256];

function createIco(pngBuffers) {
  const headerSize = 6;
  const entrySize = 16;
  const directorySize = headerSize + (pngBuffers.length * entrySize);
  const header = Buffer.alloc(directorySize);

  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngBuffers.length, 4);

  let offset = directorySize;
  pngBuffers.forEach((buffer, index) => {
    const size = SIZES[index];
    const entryOffset = headerSize + (index * entrySize);
    header.writeUInt8(size >= 256 ? 0 : size, entryOffset);
    header.writeUInt8(size >= 256 ? 0 : size, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2);
    header.writeUInt8(0, entryOffset + 3);
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(buffer.length, entryOffset + 8);
    header.writeUInt32LE(offset, entryOffset + 12);
    offset += buffer.length;
  });

  return Buffer.concat([header, ...pngBuffers]);
}

async function createTransparentLogo() {
  const image = sharp(SOURCE_IMAGE).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const output = Buffer.from(data);
  let minX = info.width;
  let minY = info.height;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const idx = (y * info.width + x) * 4;
      const r = output[idx];
      const g = output[idx + 1];
      const b = output[idx + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const avg = (r + g + b) / 3;
      const isCheckerboard = max - min < 10 && avg > 218;

      if (isCheckerboard) {
        output[idx + 3] = 0;
      } else {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  const padding = 24;
  const left = Math.max(0, minX - padding);
  const top = Math.max(0, minY - padding);
  const width = Math.min(info.width - left, maxX - minX + (padding * 2));
  const height = Math.min(info.height - top, maxY - minY + (padding * 2));

  await sharp(output, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract({ left, top, width, height })
    .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(SOURCE);
}

await createTransparentLogo();

const pngBuffers = await Promise.all(
  SIZES.map((size) => sharp(SOURCE).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer())
);

writeFileSync('icon.ico', createIco(pngBuffers));
await sharp(SOURCE).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile('icon.png');

await mkdir('build', { recursive: true });
await mkdir('assets', { recursive: true });
await copyFile('icon.png', 'build/icon.png');
await copyFile('icon.png', 'assets/icon.png');
await copyFile('src/assets/logo.png', 'public/logo.png');

console.log('Generated logo.png, public/logo.png, icon.ico, icon.png, build/icon.png, assets/icon.png');
