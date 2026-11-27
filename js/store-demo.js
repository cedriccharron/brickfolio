// Stockage du mode démo : tout reste dans ce navigateur, prix simulés.
// Même interface que store-supabase.js.
import { uuid } from "./util.js";
import { manualRow } from "./invest.js";

const KEY = "brickfolio-demo-v1";
const INVOICES = "brickfolio-demo-factures"; // { id de l'achat: data URL }
const readInvoices = () => { try { return JSON.parse(localStorage.getItem(INVOICES)) || {}; } catch { return {}; } };
const writeInvoices = (v) => {
  try { localStorage.setItem(INVOICES, JSON.stringify(v)); }
  catch { throw new Error("Fichier trop lourd pour le mode démo (stockage du navigateur plein)"); }
};
const asDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error("Fichier illisible")); r.readAsDataURL(file);
});

// Petit catalogue pour essayer la recherche sans BrickLink.
export const DEMO_CATALOG = {
// Les dates de sortie et de retrait sont simulées (en vrai, elles viennent de Brickset).
  "75192-1": { name: "Millennium Falcon - UCS (2nd edition)", year: 2017, retail: 799.99, growth: 0.06, theme: "Star Wars", pieces: 7541, launch: "2017-10-01", exit: "2026-12-31" },
  "10294-1": { name: "Titanic", year: 2021, retail: 629.99, growth: 0.07, theme: "Icons", pieces: 9090, launch: "2021-11-08", exit: "2027-06-30" },
  "21318-1": { name: "Tree House", year: 2019, retail: 199.99, growth: 0.13, theme: "Ideas", pieces: 3036, launch: "2019-08-01", exit: "2021-12-31" },
  "10276-1": { name: "Colosseum", year: 2020, retail: 499.99, growth: 0.05, theme: "Icons", pieces: 9036, launch: "2020-11-27", exit: "2023-12-31" },
  "75313-1": { name: "AT-AT - UCS", year: 2021, retail: 849.99, growth: -0.02, theme: "Star Wars", pieces: 6785, launch: "2021-11-26", exit: "2027-02-15" },
  "10497-1": { name: "Galaxy Explorer", year: 2022, retail: 99.99, growth: 0.18, theme: "Icons", pieces: 1254, launch: "2022-08-01", exit: "2024-12-31" },
  "10300-1": { name: "Back to the Future Time Machine", year: 2022, retail: 169.99, growth: 0.09, theme: "Icons", pieces: 1872, launch: "2022-04-01", exit: "2025-12-31" },
  "42143-1": { name: "Ferrari Daytona SP3", year: 2022, retail: 399.99, growth: 0.04, theme: "Technic", pieces: 3778, launch: "2022-06-01", exit: "2025-12-31" },
};
// Opportunités simulées : [n°, nom, gamme, sous-gamme, disponibilité, minifigs, pièces, prix LEGO, sortie, retrait dans (jours),
//  membres qui le veulent, qui l'ont, note, moyenne vendue BrickLink, ventes 6 mois, annonces]
const DEMO_OPPS = [
  ["75192-1", "Millennium Falcon - UCS (2nd edition)", "Star Wars", "Ultimate Collector Series", "LEGO exclusive", 8, 7541, 849.99, "2017-10-01", 34, 9100, 15200, 4.8, 905, 41, 22],
  ["75313-1", "AT-AT - UCS", "Star Wars", "Ultimate Collector Series", "LEGO exclusive", 9, 6785, 849.99, "2021-11-26", 80, 6200, 7400, 4.6, 820, 28, 15],
  ["10316-1", "Rivendell", "Icons", "", "Retail", 15, 6167, 499.99, "2023-03-08", 34, 7800, 9800, 4.9, 560, 35, 40],
  ["76417-1", "Gringotts Wizarding Bank - Collectors' Edition", "Harry Potter", "", "LEGO exclusive", 13, 4801, 429.99, "2023-06-01", 55, 5100, 6300, 4.5, 455, 22, 30],
  ["10312-1", "Jazz Club", "Icons", "Modular Buildings", "Retail", 8, 2899, 229.99, "2023-01-01", 34, 4300, 8900, 4.7, 245, 30, 45],
  ["21343-1", "Viking Village", "Ideas", "", "Retail", 7, 2103, 139.99, "2023-08-01", 63, 3900, 6100, 4.6, 150, 26, 38],
  ["42154-1", "2022 Ford GT", "Technic", "", "Retail", 0, 1466, 119.99, "2022-03-01", 70, 900, 4200, 4.2, 112, 18, 60],
  ["60380-1", "Downtown", "City", "", "Retail", 14, 2010, 199.99, "2023-06-01", 34, 700, 2600, 4.1, 168, 9, 55],
  ["41757-1", "Botanical Garden", "Friends", "", "Retail", 7, 1072, 99.99, "2023-03-01", 85, 300, 1900, 4.0, 82, 6, 48],
  ["10331-1", "Kingfisher Bird", "Icons", "", "Retail", 0, 834, 49.99, "2024-01-01", 48, 1100, 3500, 4.3, null, null, null],
];
const WATCH = "brickfolio-demo-surveilles";
const ADVICE = "brickfolio-demo-avis";
const readJSON = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
const image = (no) => `https://img.bricklink.com/ItemImage/SN/0/${no}.png`;
const setInfo = (no) => {
  const c = DEMO_CATALOG[no];
  return c ? { setNo: no, name: c.name, year: c.year, image: image(no), theme: c.theme, pieces: c.pieces, rrp: c.retail,
    launchDate: c.launch, exitDate: c.exit || null, bricksetUrl: `https://brickset.com/sets/${no}` } : null;
};

// Générateur pseudo-aléatoire reproductible (mêmes courbes à chaque ouverture).
function rng(seed) {
  let s = 0;
  for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const iso = (d) => d.toISOString().slice(0, 10);

// Relevés hebdomadaires simulés sur deux ans pour un set dans un état.
function simulate(setNo, condition, until = new Date()) {
  const info = DEMO_CATALOG[setNo];
  const rand = rng(setNo + condition);
  const start = new Date(until); start.setDate(start.getDate() - 7 * 104);
  const base = info.retail * (condition === "U" ? 0.78 : 1);
  const rows = [];
  let noise = 0;
  for (let w = 0; w <= 104; w++) {
    const d = new Date(start); d.setDate(d.getDate() + 7 * w);
    noise = noise * 0.7 + (rand() - 0.5) * 0.05;
    const avg = Math.round(base * Math.pow(1 + info.growth, (w - 30) / 52) * (1 + noise) * 100) / 100;
    rows.push(row(setNo, condition, iso(d), avg, rand));
  }
  return rows;
}
function row(setNo, condition, on, avg, rand) {
  return {
    setNo, condition, on,
    avgSold: avg, minSold: Math.round(avg * (0.78 + rand() * 0.08)), maxSold: Math.round(avg * (1.18 + rand() * 0.15)), qtySold: 3 + Math.floor(rand() * 40),
    avgStock: Math.round(avg * (1.05 + rand() * 0.1) * 100) / 100, minStock: Math.round(avg * 0.92), qtyStock: 5 + Math.floor(rand() * 60),
  };
}

function sample() {
  const P = (setNo, condition, qty, unitPrice, date, shop, extra = {}) =>
    ({ id: uuid(), setNo, condition, qty, unitPrice, fees: 0, date, shop, notes: "", soldPrice: null, soldDate: null, ...extra });
  const purchases = [
    P("75192-1", "N", 1, 679.99, "2022-11-25", "LEGO Store Bruxelles", { notes: "Black Friday, double points VIP" }),
    P("10294-1", "N", 2, 539.99, "2023-03-14", "Amazon.fr", { fees: 0 }),
    P("21318-1", "N", 1, 179.99, "2021-09-02", "Fnac"),
    P("10276-1", "N", 1, 449.0, "2022-06-18", "Dreamland"),
    P("75313-1", "N", 1, 849.99, "2024-05-04", "LEGO.com", { notes: "May the 4th" }),
    P("10497-1", "N", 3, 79.99, "2023-11-24", "Bol.com", { fees: 4.99 }),
    P("10300-1", "U", 1, 120.0, "2023-01-08", "2ememain", { soldPrice: 185, soldDate: "2025-10-12", notes: "Vendu sur Vinted" }),
  ];
  const pairs = [...new Set(purchases.map((p) => `${p.setNo}|${p.condition}`))];
  const prices = pairs.flatMap((k) => { const [no, c] = k.split("|"); return simulate(no, c); });
  const sets = Object.fromEntries(purchases.map((p) => [p.setNo, setInfo(p.setNo)]));
  return { purchases, prices, sets, lastRun: { finished_at: new Date().toISOString(), message: "Prix simulés (mode démo)" } };
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      for (const no of Object.keys(d.sets || {})) d.sets[no] = setInfo(no) || d.sets[no]; // fiches à jour (Brickset simulé)
      return d;
    }
  } catch { /* illisible : on repart de l'exemple */ }
  const d = sample();
  write(d);
  return d;
}
function write(d) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); }
  catch { throw new Error("Stockage du navigateur plein"); }
}

export function createDemoStore() {
  return {
    mode: "demo",
    async init() {},
    account: () => ({ email: "demo" }),
    async signIn() {},
    async signOut() {},
    async loadAll() { return structuredClone(read()); },
    async savePurchase(p) {
      const d = read();
      const i = d.purchases.findIndex((x) => x.id === p.id);
      if (i >= 0) d.purchases[i] = { ...d.purchases[i], ...p }; else d.purchases.unshift(p);
      if (!d.sets[p.setNo]) d.sets[p.setNo] = setInfo(p.setNo) || { setNo: p.setNo, name: p.setNo, year: null, image: image(p.setNo) };
      // Un set du catalogue démo reçoit tout de suite son historique simulé.
      if (DEMO_CATALOG[p.setNo] && !d.prices.some((r) => r.setNo === p.setNo && r.condition === p.condition && !r.manual)) {
        d.prices.push(...simulate(p.setNo, p.condition));
      }
      write(d);
      return p;
    },
    async deletePurchase(id) {
      const d = read();
      d.purchases = d.purchases.filter((p) => p.id !== id);
      write(d);
      const inv = readInvoices(); delete inv[id]; writeInvoices(inv);
    },
    async attachInvoice(p, file) {
      if (file.size > 3 * 1024 * 1024) throw new Error("En mode démo, la facture doit faire moins de 3 Mo");
      const inv = readInvoices(); inv[p.id] = await asDataUrl(file); writeInvoices(inv);
      const d = read();
      const x = d.purchases.find((y) => y.id === p.id);
      Object.assign(x, { invoicePath: p.id, invoiceName: file.name, invoiceType: file.type });
      write(d);
    },
    async linkInvoice(from, toId) {
      const inv = readInvoices();
      if (!inv[from.id]) return;
      inv[toId] = inv[from.id]; writeInvoices(inv);
      const d = read();
      Object.assign(d.purchases.find((y) => y.id === toId), { invoicePath: toId, invoiceName: from.invoiceName, invoiceType: from.invoiceType });
      write(d);
    },
    async invoiceUrl(p) {
      const data = readInvoices()[p.id];
      if (!data) throw new Error("Facture introuvable");
      return URL.createObjectURL(await (await fetch(data)).blob());
    },
    async removeInvoice(p) {
      const inv = readInvoices(); delete inv[p.id]; writeInvoices(inv);
      const d = read();
      Object.assign(d.purchases.find((y) => y.id === p.id), { invoicePath: null, invoiceName: null, invoiceType: null });
      write(d);
    },
    async addManualValue(m) {
      const d = read();
      d.prices.push(manualRow({ ...m, id: uuid() }));
      write(d);
    },
    async deleteManualValue(id) {
      const d = read();
      d.prices = d.prices.filter((r) => !(r.manual && r.id === id));
      write(d);
    },
    async lookupSet(setNo) {
      await new Promise((r) => setTimeout(r, 300));
      return setInfo(setNo);
    },
    // Ajoute un relevé du jour (marche aléatoire autour du dernier prix).
    async refreshPrices() {
      const d = read();
      const today = iso(new Date());
      const pairs = [...new Set(d.purchases.filter((p) => p.soldPrice == null).map((p) => `${p.setNo}|${p.condition}`))];
      let ok = 0;
      for (const k of pairs) {
        const [no, c] = k.split("|");
        const rows = d.prices.filter((r) => r.setNo === no && r.condition === c && !r.manual).sort((a, b) => a.on.localeCompare(b.on));
        const last = rows.at(-1);
        if (!last) continue;
        const rand = rng(no + c + today);
        const avg = Math.round(last.avgSold * (1 + (rand() - 0.47) * 0.04) * 100) / 100;
        d.prices = d.prices.filter((r) => r.manual || !(r.setNo === no && r.condition === c && r.on === today));
        d.prices.push(row(no, c, today, avg, rand));
        ok++;
      }
      d.lastRun = { finished_at: new Date().toISOString(), message: `${ok} relevé(s) simulé(s)` };
      write(d);
      return { ok, failed: 0, total: pairs.length, message: d.lastRun.message };
    },
    // Opportunités (démo) : catalogue simulé, dates de retrait calées sur aujourd'hui
    async loadOpportunities() {
      const plus = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return iso(x); };
      const catalog = DEMO_OPPS.map(([setNo, name, theme, subtheme, availability, minifigs, pieces, rrp, launch, inDays, wantedBy, ownedBy, rating, avgSold, qtySold, qtyStock]) => ({
        setNo, name, image: image(setNo), theme, subtheme, availability, minifigs, pieces, rrp, launchDate: launch, exitDate: plus(inDays),
        ageMin: rrp >= 199 || /Icons|Ideas/.test(theme) ? 18 : 9,
        wantedBy, ownedBy, rating, avgSold, avgStock: avgSold && Math.round(avgSold * 1.08), minStock: avgSold && Math.round(avgSold * 0.93),
        qtySold, qtyStock, priceOn: avgSold ? iso(new Date()) : null, bricksetUrl: `https://brickset.com/sets/${setNo}`, seenAt: new Date().toISOString(),
      }));
      return { catalog, advice: readJSON(ADVICE, {}), watched: readJSON(WATCH, []), scannedAt: new Date().toISOString() };
    },
    async setWatched(setNo, on) {
      const w = new Set(readJSON(WATCH, []));
      on ? w.add(setNo) : w.delete(setNo);
      localStorage.setItem(WATCH, JSON.stringify([...w]));
    },
    async saveAdvice(setNo, a) {
      const r = { setNo, at: new Date().toISOString(), model: "claude.ai", verdict: a.verdict, score: a.score, maxPrice: a.max_price,
        summary: a.summary, body: a.body, sources: [], tokens: 0, searches: 0 };
      const all = readJSON(ADVICE, {}); all[setNo] = r; localStorage.setItem(ADVICE, JSON.stringify(all));
      return r;
    },
    async scanCatalog() {
      return { scanned: true, candidates: DEMO_OPPS.length, priced: 0, pending: 0, message: "Catalogue simulé (mode démo)" };
    },
    reset() { localStorage.removeItem(KEY); localStorage.removeItem(INVOICES); },
  };
}
