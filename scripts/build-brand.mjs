import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

// The header SVG is the source for browser, installed-app and share icons.
const root = new URL("../", import.meta.url);
const green = "#1b3b28";
const paper = "#fbfcf8";
const source = (await readFile(new URL("public/brand/logo-symbol.svg", root), "utf8")).trim();
if (!source.includes('viewBox="0 0 24 24"') || !source.includes(green)) throw new Error("Unexpected brand SVG format");
const lightMark = source.replace('<svg ', '<svg x="4" y="4" ').replaceAll(green, paper);
const icon = (radius) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 32 32"><rect width="32" height="32" rx="${radius}" fill="${green}"/>${lightMark}</svg>\n`;
const normal = Buffer.from(icon(7));
const maskable = Buffer.from(icon(0));

await writeFile(new URL("src/app/icon.svg", root), normal);
await writeFile(new URL("public/brand/app-icon-b.svg", root), normal);
for (const size of [192, 512]) {
  await writeFile(new URL(`public/icons/icon-${size}.png`, root), await sharp(normal).resize(size, size).png().toBuffer());
}
await writeFile(new URL("public/icons/icon-maskable-512.png", root), await sharp(maskable).resize(512, 512).png().toBuffer());
await writeFile(new URL("src/app/apple-icon.png", root), await sharp(maskable).resize(180, 180).png().toBuffer());

// PNG entries inside ICO keep the small tab sizes sharp without another package.
const sizes = [16, 32, 48, 64];
const entries = [];
for (const size of sizes) entries.push(await sharp(normal).resize(size, size).png().toBuffer());
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
entries.forEach((png, i) => {
  const at = 6 + i * 16;
  header[at] = sizes[i];
  header[at + 1] = sizes[i];
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(png.length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += png.length;
});
await writeFile(new URL("src/app/favicon.ico", root), Buffer.concat([header, ...entries]));

// Keep the previous share-image URL consistent for clients that still request it.
const share = await sharp({ create: { width: 1200, height: 630, channels: 4, background: paper } })
  .composite([{ input: await sharp(normal).resize(440, 440).png().toBuffer(), gravity: "centre" }]).png().toBuffer();
await writeFile(new URL("public/og.png", root), share);
console.log("Updated SVG, ICO (16/32/48/64), PNG (180/192/512), maskable and share icons.");
