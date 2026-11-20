// VICE BAY v2 — make.fun entrypoint (Node 22, stdlib only).
// Stages game/ and screenshots/ into MAKEFUN_OUTPUT_DIR (default /output)
// and writes /output/dossier.json through the kit's buildDossier helper.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = resolve(import.meta.dirname);
const outputDir = resolve(process.env.MAKEFUN_OUTPUT_DIR || '/output');

mkdirSync(outputDir, { recursive: true });

cpSync(join(repoRoot, 'game'), join(outputDir, 'game'), { recursive: true });

const shotsDir = join(repoRoot, 'screenshots');
if (existsSync(shotsDir)) {
  cpSync(shotsDir, join(outputDir, 'screenshots'), { recursive: true });
}

const dossier = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});

const dossierPath = join(outputDir, 'dossier.json');
writeFileSync(dossierPath, JSON.stringify(dossier, null, 2));
console.log(`VICE BAY v2 dossier written to ${dossierPath}`);
