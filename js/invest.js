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
export function portfolioHistory(purchases, prices, sets = {}) {
  const dates = [...new Set([...prices.map((r) => r.on), ...purchases.map((p) => p.date)])].sort();
  const first = purchases.reduce((m, p) => (!m || p.date < m ? p.date : m), null);
  const out = [];
  for (const d of dates) {
    if (!first || d < first) continue;
    let value = 0, invested = 0, held = 0, retail = 0;
    for (const p of purchases) {
      if (p.date > d || (isSold(p) && p.soldDate && p.soldDate <= d)) continue;
      held += 1;
      const rrp = sets[p.setNo]?.rrp;
      retail = retail != null && rrp > 0 ? retail + rrp * (Number(p.qty) || 0) : null;
      const c = cost(p);
      invested += c;
      const u = unitValue(latestPrice(prices, p.setNo, p.condition, d));
      value += u == null ? c : u * (Number(p.qty) || 0);
    }
    if (held) out.push({ on: d, value, invested, retail });
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
