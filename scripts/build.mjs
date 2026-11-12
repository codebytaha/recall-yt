import { deflateSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

const extensionEntries = {
  background: "src/background/index.ts",
  "youtube-main": "src/youtube/main.ts",
  "youtube-content": "src/youtube/content.ts",
  options: "src/options/options.ts",
  popup: "src/popup/popup.ts",
};

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

await esbuild.build({
  absWorkingDir: root,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome120"],
  legalComments: "none",
  entryPoints: extensionEntries,
  outdir: dist,
});

await esbuild.build({
  absWorkingDir: root,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome120"],
  legalComments: "none",
  entryPoints: [path.join(root, "src/fixture/fixture.ts")],
  outfile: path.join(dist, "fixture/fixture.js"),
});

writeIcons(path.join(root, "icons"));
fs.cpSync(path.join(root, "icons"), path.join(dist, "icons"), { recursive: true });

const backgroundSource = fs.readFileSync(path.join(dist, "background.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
if (hasStaticImport(backgroundSource)) {
  manifest.background.type = "module";
  await esbuild.build({
    absWorkingDir: root,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["chrome120"],
    legalComments: "none",
    entryPoints: [path.join(root, "src/background/index.ts")],
    outfile: path.join(dist, "background.js"),
  });
}
fs.writeFileSync(path.join(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

copyPage(
  path.join(root, "src/options/options.html"),
  path.join(dist, "options.html"),
  'src="options.ts"',
  'src="options.js"',
);
copyPage(
  path.join(root, "src/popup/popup.html"),
  path.join(dist, "popup.html"),
  'src="popup.ts"',
  'src="popup.js"',
);
fs.copyFileSync(path.join(root, "src/options/options.css"), path.join(dist, "options.css"));
fs.copyFileSync(path.join(root, "src/popup/popup.css"), path.join(dist, "popup.css"));
fs.mkdirSync(path.join(dist, "fixture"), { recursive: true });
fs.copyFileSync(
  path.join(root, "src/fixture/quiz-fixture.html"),
  path.join(dist, "fixture/quiz-fixture.html"),
);

for (const name of ["youtube-main.js", "youtube-content.js", "options.js", "popup.js"]) {
  const source = fs.readFileSync(path.join(dist, name), "utf8");
  if (hasStaticImport(source)) {
    throw new Error(`${name} still has imports. Content scripts and pages are classic bundles.`);
  }
}

const fixtureJs = fs.readFileSync(path.join(dist, "fixture/fixture.js"), "utf8");
if (!fixtureJs.includes("mountQuiz") && !fixtureJs.includes("Recall")) {
  throw new Error("fixture.js does not look like the bundled quiz.");
}

function copyPage(from, to, token, replacement) {
  const html = fs.readFileSync(from, "utf8");
  if (!html.includes(token)) {
    throw new Error(`${path.basename(from)} is missing ${token}`);
  }
  fs.writeFileSync(to, html.replaceAll(token, replacement));
}

function hasStaticImport(source) {
  return /^\s*import\s/m.test(source) || /\bfrom\s+["'][^"']+["']/m.test(source);
}

function writeIcons(directory) {
  fs.mkdirSync(directory, { recursive: true });
  for (const size of [16, 48, 128]) {
    fs.writeFileSync(path.join(directory, `icon${size}.png`), pauseIcon(size));
  }
}

function pauseIcon(size) {
  const ink = [0x1c, 0x19, 0x17];
  const paper = [0xf6, 0xf3, 0xee];
  const barWidth = Math.max(2, Math.round(size * 0.14));
  const gap = Math.max(2, Math.round(size * 0.1));
  const barHeight = Math.max(6, Math.round(size * 0.46));
  const markWidth = barWidth * 2 + gap;
  const x0 = Math.floor((size - markWidth) / 2);
  const y0 = Math.floor((size - barHeight) / 2);
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    row[0] = 0;
    for (let x = 0; x < size; x++) {
      const inLeft = x >= x0 && x < x0 + barWidth;
      const inRight = x >= x0 + barWidth + gap && x < x0 + markWidth;
      const inMark = y >= y0 && y < y0 + barHeight && (inLeft || inRight);
      const color = inMark ? paper : ink;
      const offset = 1 + x * 3;
      row[offset] = color[0];
      row[offset + 1] = color[1];
      row[offset + 2] = color[2];
    }
    rows.push(row);
  }
  return encodePng(size, size, Buffer.concat(rows));
}

function encodePng(width, height, scanlines) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const name = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
