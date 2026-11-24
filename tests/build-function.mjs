// Regroupe index.ts + bricklink.js en un seul fichier, à coller dans l'éditeur
// Supabase (Edge Functions > bricklink > Code) : node tests/build-function.mjs
import fs from "node:fs";

const dir = new URL("../supabase/functions/bricklink/", import.meta.url);
const strip = (f) => fs.readFileSync(new URL(f, dir), "utf8").replace(/^export /gm, "");
const lib = strip("bricklink.js") + "\n" + strip("facture.js");
const idx = fs.readFileSync(new URL("index.ts", dir), "utf8")
  .replace(/^import \{[^}]+\} from "\.\/(bricklink|facture)\.js";\n/gm, "");
if (/from "\.\//.test(idx)) throw new Error("Import local non reconnu");
const out = "// @ts-nocheck\n// Fichier généré par tests/build-function.mjs (index.ts + bricklink.js + facture.js) pour l'éditeur Supabase.\n"
  + idx.replace(/((?:^import [^\n]*\n)+)/m, `$1\n${lib}\n`);
const target = new URL("../supabase/bricklink-editeur.ts", import.meta.url);
fs.writeFileSync(target, out);
console.log(`Écrit : supabase/bricklink-editeur.ts (${out.split("\n").length} lignes)`);
