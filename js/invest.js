// Calculs d'investissement (sans interface, testés dans tests/logic.test.mjs).
//
// Achat (purchase) : { id, setNo, condition: "N" | "U", qty, unitPrice, fees, date: "AAAA-MM-JJ",
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
export function portfolioHistory(purchases, prices) {
  const dates = [...new Set([...prices.map((r) => r.on), ...purchases.map((p) => p.date)])].sort();
  const first = purchases.reduce((m, p) => (!m || p.date < m ? p.date : m), null);
  const out = [];
  for (const d of dates) {
    if (!first || d < first) continue;
    let value = 0, invested = 0, held = 0;
    for (const p of purchases) {
      if (p.date > d || (isSold(p) && p.soldDate && p.soldDate <= d)) continue;
      held += 1;
      const c = cost(p);
      invested += c;
      const u = unitValue(latestPrice(prices, p.setNo, p.condition, d));
      value += u == null ? c : u * (Number(p.qty) || 0);
    }
    if (held) out.push({ on: d, value, invested });
  }
  return out;
}

// Tri de la liste des achats.
export const SORTS = {
  gain: { label: "Plus-value", fn: (a, b) => (b.pos.gain ?? -Infinity) - (a.pos.gain ?? -Infinity) },
  pct: { label: "Rendement", fn: (a, b) => (b.pos.pct ?? -Infinity) - (a.pos.pct ?? -Infinity) },
  value: { label: "Valeur", fn: (a, b) => (b.pos.value ?? 0) - (a.pos.value ?? 0) },
  date: { label: "Date d'achat", fn: (a, b) => b.p.date.localeCompare(a.p.date) },
  name: { label: "Nom", fn: (a, b) => (a.name || a.p.setNo).localeCompare(b.name || b.p.setNo, "fr") },
};

// Export tableur (séparateur « ; » et virgule décimale, comme Excel en Belgique).
export function toCSV(purchases, prices, sets) {
  const head = ["Set", "Nom", "État", "Quantité", "Prix unitaire", "Frais", "Coût", "Date d'achat", "Boutique",
    "Valeur actuelle", "Plus-value", "Rendement %", "Vendu le", "Prix de vente", "Notes"];
  const f = (n) => (n == null ? "" : String(Math.round(n * 100) / 100).replace(".", ","));
  const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const lines = purchases.map((p) => {
    const pos = position(p, prices);
    return [p.setNo, sets[p.setNo]?.name, CONDITIONS[p.condition], p.qty, f(p.unitPrice), f(p.fees), f(pos.cost), p.date, p.shop,
      f(pos.value), f(pos.gain), pos.pct == null ? "" : f(pos.pct * 100), p.soldDate || "", f(num(p.soldPrice)), p.notes].map(q).join(";");
  });
  return "﻿" + [head.map(q).join(";"), ...lines].join("\r\n");
}
