// Regroupe index.ts + bricklink.js en un seul fichier, à coller dans l'éditeur
// Supabase (Edge Functions > bricklink > Code) : node tests/build-function.mjs
import fs from "node:fs";

const dir = new URL("../supabase/functions/bricklink/", import.meta.url);
const lib = fs.readFileSync(new URL("bricklink.js", dir), "utf8").replace(/^export /gm, "");
const idx = fs.readFileSync(new URL("index.ts", dir), "utf8")
  .replace(/^import \{ blGet, parseItem, priceGuide \} from "\.\/bricklink\.js";\n/m, "");
if (idx.includes('from "./bricklink.js"')) throw new Error("Import de bricklink.js non reconnu");
const out = "// @ts-nocheck\n// Fichier généré par tests/build-function.mjs (index.ts + bricklink.js) pour l'éditeur Supabase.\n"
  + idx.replace(/(import \{ createClient \}[^\n]*\n)/, `$1\n${lib}\n`);
const target = new URL("../supabase/bricklink-editeur.ts", import.meta.url);
fs.writeFileSync(target, out);
console.log(`Écrit : supabase/bricklink-editeur.ts (${out.split("\n").length} lignes)`);
