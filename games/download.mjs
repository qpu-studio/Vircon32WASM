// Downloads the Vircon32 cartridges listed in games.json into this folder,
// skipping the ones already present and checking each file's SHA-256.
//   node games/download.mjs            (all)
//   node games/download.mjs 2048 doom  (only files whose name contains any of the words)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const folder = path.dirname(fileURLToPath(import.meta.url));
const games = JSON.parse(fs.readFileSync(path.join(folder, "games.json"), "utf8"));
const filters = process.argv.slice(2).map((word) => word.toLowerCase());
const wanted = filters.length ? games.filter((g) => filters.some((word) => g.file.toLowerCase().includes(word))) : games;

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
let failed = 0;

for (const [i, game] of wanted.entries()) {
  const target = path.join(folder, game.file);
  const label = `[${i + 1}/${wanted.length}] ${game.file}`;
  if (fs.existsSync(target) && sha256(fs.readFileSync(target)) === game.sha256) {
    console.log(`${label}: already downloaded`);
    continue;
  }
  try {
    const response = await fetch(game.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (sha256(data) !== game.sha256) throw new Error("SHA-256 does not match (the file changed at the source)");
    fs.writeFileSync(target, data);
    console.log(`${label}: ${(data.length / 1048576).toFixed(1)} MB`);
  } catch (e) {
    failed++;
    console.error(`${label}: FAILED, ${e.message} (${game.url})`);
  }
}
process.exit(failed ? 1 : 0);
