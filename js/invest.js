// Calculs d'investissement (sans interface, testés dans tests/logic.test.mjs).
//
// Achat (purchase) : { id, setNo, name (nom choisi, facultatif), condition: "N" | "U", qty, unitPrice, fees, date: "AAAA-MM-JJ",
//                      shop, notes, soldPrice (total, ou null), soldDate }
// Relevé de prix (price) : { setNo, condition, on: "AAAA-MM-JJ", avgSold, minSold, maxSold, qtySold,
//                            avgStock, minStock, qtyStock }   — prix unitaires en euros.

export const CONDITIONS = { N: "Neuf", U: "Occasion" };
const DAY = 86400000;

// « 75192 » → « 75192-1 » (numérotation BrickLink : variante -1 par défaut).
export function normalizeSetNo(raw) {
  const s = String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return "";
  return /-\d+$/.test(s) ? s : `${s}-1`;
}

export const isSold = (p) => p.soldPrice != null && p.soldPrice !== "";
export const cost = (p) => (Number(p.qty) || 0) * (Number(p.unitPrice) || 0) + (Number(p.fees) || 0);

const num = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

// Valeur d'une boîte selon un relevé : moyenne des ventes, sinon moyenne des annonces.
export function unitValue(row) {
  if (!row) return null;
  return num(row.avgSold) ?? num(row.avgStock);
}
export const valueSource = (row) =>
  (!row ? null : row.manual ? "manuel" : num(row.avgSold) != null ? "ventes" : num(row.avgStock) != null ? "annonces" : null);

// Valeur encodée à la main → relevé (manual: true), fusionné avec les relevés BrickLink.
export const manualRow = (m) => ({ id: m.id, setNo: m.setNo, condition: m.condition, on: m.on, avgSold: Number(m.value), note: m.note || "", manual: true });

// Relevés d'un set dans un état donné, du plus ancien au plus récent.
// Le même jour, la valeur manuelle passe après (donc prime sur) le relevé BrickLink.
export function pricesFor(prices, setNo, condition) {
  return prices
    .filter((r) => r.setNo === setNo && r.condition === condition)
    .sort((a, b) => a.on.localeCompare(b.on) || (a.manual ? 1 : 0) - (b.manual ? 1 : 0));
}

// Dernier relevé utilisable (avec une valeur) à une date donnée (incluse), ou le plus récent.
export function latestPrice(prices, setNo, condition, onOrBefore = null) {
  const rows = pricesFor(prices, setNo, condition);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (onOrBefore && rows[i].on > onOrBefore) continue;
    if (unitValue(rows[i]) != null) return rows[i];
  }
  return null;
}

const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / DAY);

// Rendement annualisé : seulement après 6 mois de détention (avant, le chiffre trompe).
export function annualized(costValue, value, fromDate, toDate) {
  const days = daysBetween(fromDate, toDate);
  if (!(costValue > 0) || value == null || days < 182) return null;
  return Math.pow(value / costValue, 365 / days) - 1;
}

const today = () => new Date().toISOString().slice(0, 10);

// Situation d'un achat : coût, valeur (prix de vente si vendu), plus-value.
export function position(p, prices, now = today()) {
  const c = cost(p);
  if (isSold(p)) {
    const value = Number(p.soldPrice);
    const gain = value - c;
    return { cost: c, value, unit: null, row: null, gain, pct: c ? gain / c : null,
      cagr: annualized(c, value, p.date, p.soldDate || now), sold: true, priced: true };
  }
  const row = latestPrice(prices, p.setNo, p.condition);
  const unit = unitValue(row);
  const value = unit == null ? null : unit * (Number(p.qty) || 0);
  const gain = value == null ? null : value - c;
  return { cost: c, value, unit, row, gain, pct: gain == null || !c ? null : gain / c,
    cagr: annualized(c, value, p.date, now), sold: false, priced: value != null };
}

// Totaux du portefeuille.
export function summary(purchases, prices, now = today()) {
  const s = { invested: 0, value: 0, unrealized: 0, realized: 0, realizedCost: 0, sets: 0, boxes: 0, unpriced: 0, pct: null };
  for (const p of purchases) {
    const pos = position(p, prices, now);
    if (pos.sold) { s.realized += pos.gain; s.realizedCost += pos.cost; continue; }
    s.sets += 1;
    s.boxes += Number(p.qty) || 0;
    s.invested += pos.cost;
    if (pos.priced) { s.value += pos.value; s.unrealized += pos.gain; }
    else { s.value += pos.cost; s.unpriced += 1; } // pas encore de prix : compté à son coût
  }
  s.pct = s.invested ? (s.value - s.invested) / s.invested : null;
  return s;
}

// Historique d'un achat : valeur de la position à chaque relevé depuis l'achat.
export function positionHistory(p, prices) {
  const pts = [{ on: p.date, value: cost(p) }];
  const end = isSold(p) ? p.soldDate : null;
  for (const r of pricesFor(prices, p.setNo, p.condition)) {
    if (r.on < p.date || (end && r.on > end) || unitValue(r) == null) continue;
    pts.push({ on: r.on, value: unitValue(r) * (Number(p.qty) || 0) });
  }
  if (end) pts.push({ on: end, value: Number(p.soldPrice) });
  return pts;
}

// Historique du portefeuille (boîtes détenues à chaque date de relevé) : valeur et montant investi.
// retail : prix LEGO d'origine (Brickset) des boîtes détenues ce jour-là ; null si une boîte n'en a pas.
// realized : plus-value des ventes faites jusqu'à ce jour ; gain = plus-value latente (value − invested) + realized.
export function portfolioHistory(purchases, prices, sets = {}) {
  const sales = purchases.filter((p) => isSold(p) && p.soldDate).map((p) => p.soldDate);
  const dates = [...new Set([...prices.map((r) => r.on), ...purchases.map((p) => p.date), ...sales])].sort();
  const first = purchases.reduce((m, p) => (!m || p.date < m ? p.date : m), null);
  const out = [];
  for (const d of dates) {
    if (!first || d < first) continue;
    let value = 0, invested = 0, held = 0, retail = 0, realized = 0, sold = 0;
    for (const p of purchases) {
      if (p.date > d) continue;
      if (isSold(p) && p.soldDate && p.soldDate <= d) { realized += Number(p.soldPrice) - cost(p); sold += 1; continue; }
      held += 1;
      const rrp = sets[p.setNo]?.rrp;
      retail = retail != null && rrp > 0 ? retail + rrp * (Number(p.qty) || 0) : null;
      const c = cost(p);
      invested += c;
      const u = unitValue(latestPrice(prices, p.setNo, p.condition, d));
      value += u == null ? c : u * (Number(p.qty) || 0);
    }
    if (!held) retail = null;
    if (held || sold) out.push({ on: d, value, invested, retail, realized, gain: value - invested + realized });
  }
  return out;
}

const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Tendance du prix d'une boîte sur une période (jours) : du relevé d'il y a « days » jours au dernier.
// null si l'historique couvre moins de 60 % de la période.
export function trend(prices, setNo, condition, days, now = today()) {
  const rows = pricesFor(prices, setNo, condition).filter((r) => r.on <= now && unitValue(r) != null);
  if (rows.length < 2) return null;
  const last = rows.at(-1);
  const start = addDays(last.on, -days);
  // Relevé de départ : le dernier avant la date de début, s'il n'est pas trop ancien ; sinon le premier après.
  let first = [...rows].reverse().find((r) => r.on <= start);
  if (!first || daysBetween(first.on, start) > days * 0.5) first = rows.find((r) => r.on > start);
  if (!first || first === last) return null;
  const span = daysBetween(first.on, last.on);
  if (span < days * 0.6) return null;
  const a = unitValue(first), b = unitValue(last);
  if (!(a > 0)) return null;
  return { from: a, to: b, since: first.on, days: span, pct: b / a - 1, yearly: Math.pow(b / a, 365 / span) - 1 };
}

// Tendances passées d'un set : 3 mois et 1 an (pas de projection : le marché LEGO ne se prolonge pas en ligne droite).
export function trends(prices, setNo, condition, now = today()) {
  return { m3: trend(prices, setNo, condition, 91, now), y1: trend(prices, setNo, condition, 365, now) };
}

// Ligne complète pour le tableau de bord : achat, situation, tendances passées.
// Statut commercial d'après Brickset : « retired » (date de retrait passée), « retiring » (retrait annoncé), « available », ou null si inconnu.
export function setStatus(set, now = today()) {
  if (!set) return null;
  if (set.exitDate) return set.exitDate <= now ? "retired" : "retiring";
  return set.launchDate || set.rrp != null ? "available" : null;
}

// Comparaison au prix LEGO d'origine (par boîte) : remise obtenue à l'achat, valeur actuelle par rapport au prix d'origine.
export function vsRetail(p, set, unit) {
  const rrp = set?.rrp;
  if (!(rrp > 0)) return null;
  return { rrp, paid: num(p.unitPrice) / rrp - 1, value: unit != null ? unit / rrp - 1 : null };
}

export function analyze(p, prices, sets = {}, now = today()) {
  const pos = position(p, prices, now);
  const t = trends(prices, p.setNo, p.condition, now);
  const end = pos.sold ? p.soldDate || now : now;
  return {
    p, pos, t, name: (p.name || "").trim() || sets[p.setNo]?.name || "", alt: sets[p.setNo]?.name || "",
    heldDays: Math.max(0, daysBetween(p.date, end)),
    status: setStatus(sets[p.setNo], now),
    year: p.date.slice(0, 4),
  };
}

// Statistiques d'un ensemble de lignes (après filtres) : stock, potentiel, tendances, ventes.
export function stats(rows) {
  const held = rows.filter((r) => !r.pos.sold), sold = rows.filter((r) => r.pos.sold);
  const priced = held.filter((r) => r.pos.priced);
  const sum = (arr, f) => arr.reduce((s, r) => s + (f(r) ?? 0), 0);
  const by = (arr, f, dir = 1) => [...arr].filter((r) => f(r) != null).sort((a, b) => dir * (f(b) - f(a)));

  const invested = sum(held, (r) => r.pos.cost);
  const value = sum(held, (r) => (r.pos.priced ? r.pos.value : r.pos.cost));
  const latent = sum(priced, (r) => r.pos.gain);
  // Tendance du stock à quantités constantes (sets qui ont un historique sur la période)
  const tr = (key) => {
    const ok = held.filter((r) => r.t[key]);
    if (!ok.length) return null;
    const from = sum(ok, (r) => r.t[key].from * r.p.qty), to = sum(ok, (r) => r.t[key].to * r.p.qty);
    return { pct: to / from - 1, change: to - from, n: ok.length };
  };

  const revenue = sum(sold, (r) => r.pos.value), soldCost = sum(sold, (r) => r.pos.cost);
  const byYear = {};
  for (const r of sold) {
    const y = (r.p.soldDate || "").slice(0, 4) || "?";
    const e = (byYear[y] ??= { year: y, count: 0, revenue: 0, cost: 0, profit: 0 });
    e.count++; e.revenue += r.pos.value; e.cost += r.pos.cost; e.profit += r.pos.gain;
  }
  return {
    held: {
      count: held.length, boxes: sum(held, (r) => Number(r.p.qty) || 0), invested, value, latent,
      pct: invested ? (value - invested) / invested : null,
      winners: priced.filter((r) => r.pos.gain > 0).length, losers: priced.filter((r) => r.pos.gain < 0).length,
      unpriced: held.length - priced.length,
      best: by(priced, (r) => r.pos.pct)[0] || null, worst: by(priced, (r) => r.pos.pct, -1)[0] || null,
      m3: tr("m3"), y1: tr("y1"),
      rising: by(held.filter((r) => r.t.m3?.pct > 0), (r) => r.t.m3.pct).slice(0, 3),
      falling: by(held.filter((r) => r.t.m3?.pct < 0), (r) => r.t.m3.pct, -1).slice(0, 3),
    },
    sold: {
      count: sold.length, revenue, cost: soldCost, profit: revenue - soldCost, pct: soldCost ? (revenue - soldCost) / soldCost : null,
      avgDays: sold.length ? Math.round(sum(sold, (r) => r.heldDays) / sold.length) : null,
      best: by(sold, (r) => r.pos.gain)[0] || null, worst: by(sold, (r) => r.pos.gain, -1)[0] || null,
      byYear: Object.values(byYear).sort((a, b) => b.year.localeCompare(a.year)),
    },
  };
}

// Filtres du tableau de bord. f = { q, cond, shop, year, perf, trend }
export function filterRows(rows, f = {}) {
  const q = (f.q || "").trim().toLowerCase();
  return rows.filter((r) => {
    if (q && !`${r.p.setNo} ${r.name} ${r.alt || ""} ${r.p.shop || ""} ${r.p.notes || ""}`.toLowerCase().includes(q)) return false;
    if (f.cond && r.p.condition !== f.cond) return false;
    if (f.shop && (r.p.shop || "") !== f.shop) return false;
    if (f.year && r.year !== f.year) return false;
    if (f.perf === "gain" && !(r.pos.gain > 0)) return false;
    if (f.perf === "loss" && !(r.pos.gain < 0)) return false;
    if (f.perf === "unpriced" && r.pos.priced) return false;
    if (f.trend === "up" && !(r.t.m3?.pct > 0)) return false;
    if (f.trend === "down" && !(r.t.m3?.pct < 0)) return false;
    if (f.status === "retired" && r.status !== "retired") return false;
    if (f.status === "available" && !(r.status === "available" || r.status === "retiring")) return false;
    return true;
  });
}

// Tris (ordre naturel : du plus grand au plus petit, du plus récent au plus ancien ; « reverse » inverse).
const desc = (f) => (a, b) => (f(b) ?? -Infinity) - (f(a) ?? -Infinity);
export const SORTS = {
  gain: { label: "Plus-value (€)", fn: desc((r) => r.pos.gain) },
  pct: { label: "Rendement (%)", fn: desc((r) => r.pos.pct) },
  cagr: { label: "Rendement annualisé", fn: desc((r) => r.pos.cagr) },
  value: { label: "Valeur", fn: desc((r) => r.pos.value) },
  cost: { label: "Coût", fn: desc((r) => r.pos.cost) },
  trend3: { label: "Tendance 3 mois", fn: desc((r) => r.t.m3?.pct) },
  trend12: { label: "Tendance 1 an", fn: desc((r) => r.t.y1?.pct) },
  date: { label: "Date d'achat", fn: (a, b) => b.p.date.localeCompare(a.p.date) },
  held: { label: "Durée de détention", fn: desc((r) => r.heldDays) },
  sold: { label: "Date de vente", fn: (a, b) => (b.p.soldDate || "").localeCompare(a.p.soldDate || "") },
  name: { label: "Nom", fn: (a, b) => (a.name || a.p.setNo).localeCompare(b.name || b.p.setNo, "fr") },
};
export function sortRows(rows, key, reverse = false) {
  const fn = (SORTS[key] || SORTS.gain).fn;
  const out = [...rows].sort(fn);
  return reverse ? out.reverse() : out;
}

// Vente de n boîtes d'un lot. Tout le lot : l'achat est simplement marqué vendu.
// Une partie : le lot est partagé en deux achats (gardé / vendu), frais d'achat répartis au prorata.
export function splitSale(p, n, soldPrice, soldDate, newId) {
  const qty = Number(p.qty) || 0;
  if (!(Number.isInteger(n) && n >= 1 && n <= qty)) throw new Error("Nombre de boîtes invalide");
  if (!(soldPrice >= 0)) throw new Error("Prix de vente invalide");
  if (!soldDate || soldDate < p.date) throw new Error("La vente ne peut pas précéder l'achat");
  if (n === qty) return { kept: null, sold: { ...p, soldPrice, soldDate } };
  const fees = Number(p.fees) || 0;
  const soldFees = Math.round((fees * n / qty) * 100) / 100;
  return {
    kept: { ...p, qty: qty - n, fees: Math.round((fees - soldFees) * 100) / 100 },
    sold: { ...p, id: newId, qty: n, fees: soldFees, soldPrice, soldDate,
      notes: [p.notes, `Vente partielle : ${n} boîte${n > 1 ? "s" : ""} sur ${qty}`].filter(Boolean).join(" · ") },
  };
}

// Export tableur (séparateur « ; » et virgule décimale, comme Excel en Belgique).
export function toCSV(purchases, prices, sets) {
  const head = ["Set", "Nom", "État", "Quantité", "Prix unitaire", "Frais", "Coût", "Date d'achat", "Boutique",
    "Valeur actuelle", "Plus-value", "Rendement %", "Tendance 3 mois %", "Tendance 1 an %", "Prix LEGO d'origine", "Date de retrait", "Vendu le", "Prix de vente", "Notes"];
  const f = (n) => (n == null ? "" : String(Math.round(n * 100) / 100).replace(".", ","));
  const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const lines = purchases.map((p) => {
    const { pos, t } = analyze(p, prices, sets);
    const pc = (v) => (v == null ? "" : f(v * 100));
    return [p.setNo, (p.name || "").trim() || sets[p.setNo]?.name, CONDITIONS[p.condition], p.qty, f(p.unitPrice), f(p.fees), f(pos.cost), p.date, p.shop,
      f(pos.value), f(pos.gain), pc(pos.pct), pc(t.m3?.pct), pc(t.y1?.pct), f(sets[p.setNo]?.rrp), sets[p.setNo]?.exitDate || "", p.soldDate || "", f(num(p.soldPrice)), p.notes].map(q).join(";");
  });
  return "﻿" + [head.map(q).join(";"), ...lines].join("\r\n");
}

// Message de fin de relevé : une ligne par source (BrickLink pour les prix, Brickset pour les fiches LEGO).
// r = réponse de refresh : { ok, failed, skipped, total, message, brickset, bricklink }.
export function refreshSummary(r) {
  const s = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const msg = String(r?.message || "");
  let bl;
  if (r?.bricklink === false) bl = "✗ BrickLink : clés absentes, prix non relevés";
  else {
    const parts = [s(r?.ok || 0, "prix relevé", "prix relevés")];
    if (r?.failed) parts.push(s(r.failed, "échec", "échecs"));
    if (r?.skipped) parts.push(`${r.skipped} reporté${r.skipped > 1 ? "s" : ""}`);
    bl = `${r?.failed ? "✗" : "✓"} BrickLink : ${parts.join(", ")}`;
  }
  const lines = [bl];
  let bsError = false;
  if (r?.brickset != null) { // absent en démo
    if (!/fiche\(s\) Brickset/.test(msg)) lines.push("✗ Brickset : clé absente, fiches LEGO non vérifiées");
    else {
      const err = msg.match(/Brickset : ([^;]+?)(?: ;|\. |$)/);
      bsError = !!err;
      const done = r.brickset ? s(r.brickset, "fiche LEGO mise à jour", "fiches LEGO mises à jour") : "fiches LEGO déjà à jour";
      lines.push(err ? `✗ Brickset : ${r.brickset ? `${done}, ` : ""}erreur (${err[1]})` : `✓ Brickset : ${done}`);
    }
  }
  return { text: lines.join("\n"), error: !!r?.failed || bsError || r?.bricklink === false };
}

// ---------- Opportunités (v0.10) : sets du catalogue dont le retrait approche ----------
// Note sur 100 à partir de 10 critères mesurés aujourd'hui (pas de prédiction). Chaque critère vaut 0 à 1,
// multiplié par son poids ; un critère inconnu (ex. pas encore de prix BrickLink) compte pour moitié
// (« provisoire » s'il en manque).
// Réputation des gammes : ce que constatent les collectionneurs, pas une garantie (modifiable ici).
export const THEME_REPUTATION = {
  "Star Wars": 0.9, "Harry Potter": 0.8, "Icons": 0.85, "Creator Expert": 0.85, "Ideas": 0.85, "The Lord of the Rings": 0.85,
  "Marvel Super Heroes": 0.7, "Batman": 0.65, "DC Comics Super Heroes": 0.6, "Indiana Jones": 0.65, "Disney": 0.6,
  "Technic": 0.6, "Architecture": 0.6, "Jurassic World": 0.5, "Ninjago": 0.55, "Botanical Collection": 0.5, "Botanicals": 0.5,
  "Speed Champions": 0.45, "Creator": 0.45, "Avatar": 0.45, "Minecraft": 0.4, "Super Mario": 0.4, "Art": 0.3,
  "City": 0.35, "Friends": 0.25, "Duplo": 0.15, "Dots": 0.15,
};
const SUBTHEME_BONUS = { "Ultimate Collector Series": 1, "Modular Buildings": 1, "Master Builder Series": 0.95 };
const THEME_DEFAULT = 0.4;
export const CRITERIA = [
  { key: "theme", label: "Gamme", max: 15 },
  { key: "exclusive", label: "Exclusivité", max: 10 },
  { key: "minifigs", label: "Minifigs", max: 10 },
  { key: "ppp", label: "Prix par pièce", max: 5 },
  { key: "band", label: "Gamme de prix", max: 5 },
  { key: "shelf", label: "Durée de vente", max: 5 },
  { key: "desire", label: "Envie des collectionneurs", max: 15 },
  { key: "premium", label: "Prime sur le prix LEGO", max: 15 },
  { key: "tension", label: "Tension du marché", max: 15 },
  { key: "timing", label: "Délai avant retrait", max: 5 },
];
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lin = (x, a, b) => clamp01((x - a) / (b - a)); // 0 en a, 1 en b (a > b possible : décroissant)
const pctTxt = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x * 100))} %`;
const eur = (x) => `${Math.round(x)} €`;

// c : fiche du catalogue (champs de bf_catalog en camelCase). Renvoie { score, provisional, parts, market, premium, daysLeft }.
export function candidateScore(c, now = today()) {
  const rrp = c.rrp > 0 ? Number(c.rrp) : null;
  const market = c.avgSold ?? c.avgStock ?? null;
  const v = {}, d = {};
  // 1. Gamme (sous-gamme UCS / modulaires prioritaire)
  const sub = SUBTHEME_BONUS[c.subtheme];
  v.theme = sub ?? THEME_REPUTATION[c.theme] ?? THEME_DEFAULT;
  d.theme = [c.theme, sub ? c.subtheme : ""].filter(Boolean).join(" · ") || "gamme inconnue";
  // 2. Exclusivité
  const av = String(c.availability || "");
  v.exclusive = /exclusive/i.test(av) ? 1 : /limited/i.test(av) ? 0.8 : /promo/i.test(av) ? 0.7 : av ? 0.3 : null;
  d.exclusive = av || "inconnue";
  // 3. Minifigs : figurines pour 100 € (4 et plus = maximum)
  if (rrp && c.minifigs != null) { const f = (c.minifigs * 100) / rrp; v.minifigs = clamp01(f / 4); d.minifigs = `${c.minifigs} figurine${c.minifigs > 1 ? "s" : ""} (${f.toFixed(1).replace(".", ",")} pour 100 €)`; }
  else if (rrp && c.pieces) { v.minifigs = 0; d.minifigs = "aucune"; }
  // 4. Prix par pièce : 8 centimes ou moins = maximum, 15 centimes ou plus = 0
  if (rrp && c.pieces) { const ppp = rrp / c.pieces; v.ppp = lin(ppp, 0.15, 0.08); d.ppp = `${(ppp * 100).toFixed(1).replace(".", ",")} centimes par pièce`; }
  // 5. Gamme de prix : 80 à 500 € idéal
  if (rrp) { v.band = rrp >= 80 && rrp <= 500 ? 1 : (rrp >= 40 && rrp < 80) || (rrp > 500 && rrp <= 900) ? 0.6 : 0.2; d.band = `prix LEGO ${eur(rrp)}`; }
  // 6. Durée de vente : 18 mois ou moins = maximum, 4 ans ou plus = 0
  if (c.launchDate && c.exitDate) { const m = daysBetween(c.launchDate, c.exitDate) / 30.4; v.shelf = lin(m, 48, 18); d.shelf = `${Math.round(m)} mois en rayon`; }
  // 7. Envie des collectionneurs : membres Brickset qui le veulent / qui l'ont, et note des avis
  if (c.wantedBy != null && c.ownedBy != null) {
    const r = c.wantedBy / Math.max(1, c.ownedBy);
    const rating = c.rating ? lin(c.rating, 3.5, 5) : null;
    v.desire = rating == null ? clamp01(r / 0.5) : clamp01(r / 0.5) * 0.7 + rating * 0.3;
    d.desire = `${c.wantedBy} le veulent, ${c.ownedBy} l'ont${c.rating ? ` · avis ${String(c.rating).replace(".", ",")}/5` : ""}`;
  }
  // 8. Prime : se revend-il déjà au-dessus du prix LEGO ? (−20 % → 0, +50 % → max)
  let premium = null;
  if (rrp && market != null) { premium = market / rrp - 1; v.premium = lin(premium, -0.2, 0.5); d.premium = `marché ${eur(market)} (${pctTxt(premium)})`; }
  // 9. Tension : ventes 6 mois par annonce en ligne (1 vente par annonce = moitié)
  if (c.qtySold != null && c.qtyStock != null) { const t = c.qtySold / Math.max(1, c.qtyStock); v.tension = t / (t + 1); d.tension = `${c.qtySold} ventes / ${c.qtyStock} annonces`; }
  // 10. Délai : proche = plus sûr (30 jours ou moins = maximum, 90 jours = 0,4)
  const daysLeft = c.exitDate ? daysBetween(now, c.exitDate) : null;
  if (daysLeft != null) { v.timing = daysLeft <= 30 ? 1 : Math.max(0.4, 1 - ((daysLeft - 30) / 60) * 0.6); d.timing = `retrait dans ${Math.max(0, daysLeft)} j`; }

  const parts = CRITERIA.map((k) => ({ ...k, value: v[k.key] ?? null, points: v[k.key] == null ? null : Math.round(v[k.key] * k.max * 10) / 10, detail: d[k.key] || "inconnu" }));
  // Critère inconnu (souvent le prix BrickLink pas encore relevé) : compté pour moitié, ni bonus ni pénalité.
  const score = Math.round(parts.reduce((a, p) => a + (p.points ?? p.max / 2), 0));
  return { score, provisional: parts.some((p) => p.points == null), parts, market, premium, daysLeft };
}

// Liste classée : catalogue + sets détenus (repérés « à toi ») + surveillés, dans la fenêtre de « days » jours.
export function rankCandidates(catalog, { now = today(), days = 91, owned = new Set(), watched = new Set() } = {}) {
  const to = addDays(now, days);
  return catalog
    .filter((c) => c.exitDate && c.exitDate >= now && c.exitDate <= to)
    .filter((c) => !/gift with purchase|reward/i.test(c.availability || "")) // cadeaux offerts : pas achetables
    .map((c) => ({ ...c, ...candidateScore(c, now), owned: owned.has(c.setNo), watched: watched.has(c.setNo) }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.daysLeft - b.daysLeft);
}
