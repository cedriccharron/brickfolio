// Graphique en ligne (SVG) : valeur dans le temps, avec ligne « investi » en pointillés.
import { esc, fmtEur, fmtSigned, fmtDate } from "./util.js";

const W = 340, H = 180, L = 46, R = 10, T = 12, B = 24;
const t = (iso) => new Date(iso + "T12:00:00").getTime();

function niceStep(range) {
  const raw = range / 3;
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) || p * 10;
}

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const monthYear = (iso) => { const d = new Date(iso + "T12:00:00"); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const todayIso = () => new Date().toISOString().slice(0, 10);

// main = [{on, value}] (ligne pleine + aire) ; ref = [{on, value}] (pointillés, en escalier) ;
// marks = [{on, text}] (repères verticaux, ex. date d'achat) ; names = libellés de la bulle au doigt ;
// retail = [{on, value}] (prix LEGO d'origine, pointillés fins en escalier, nommé par names[2]).
// signed : montants qui peuvent être négatifs (plus-value) — axe autour de zéro, ligne du zéro marquée, valeurs signées.
export function lineChart({ main, ref = null, retail = null, up = true, label = "Évolution de la valeur", marks = [], names = ["Valeur", "Investi", "Prix LEGO"], signed = false }) {
  const pts = main.filter((p) => p.value != null);
  if (new Set(pts.map((p) => p.on)).size < 2) return `<div class="chart-empty">Pas encore assez de relevés pour tracer une courbe.<br>Le prochain relevé hebdomadaire complétera le graphique.</div>`;
  const refPts = (ref || []).filter((p) => p.value != null);
  const retailPts = (retail || []).filter((p) => p.value != null);
  const all = [...pts, ...refPts, ...retailPts];
  const x0 = Math.min(...all.map((p) => t(p.on))), x1 = Math.max(...all.map((p) => t(p.on)));
  let y0 = Math.min(...all.map((p) => p.value)), y1 = Math.max(...all.map((p) => p.value));
  if (signed) { y0 = Math.min(y0, 0); y1 = Math.max(y1, 0); }
  const step = niceStep(Math.max(y1 - y0, Math.abs(y1) * 0.05, signed ? 10 : 0));
  y0 = signed ? Math.floor(y0 / step) * step : Math.max(0, Math.floor(y0 / step) * step); y1 = Math.ceil(y1 / step) * step;
  const fmt = signed ? fmtSigned : fmtEur;
  if (y1 === y0) y1 = y0 + step;
  const X = (iso) => L + ((t(iso) - x0) / Math.max(1, x1 - x0)) * (W - L - R);
  const Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const path = (arr) => arr.map((p, i) => `${i ? "L" : "M"}${X(p.on).toFixed(1)},${Y(p.value).toFixed(1)}`).join("");
  // Montant investi : en escalier (il change aux achats et aux ventes, pas entre les deux)
  const stepPath = (arr) => arr.map((p, i) => (i ? `H${X(p.on).toFixed(1)}V${Y(p.value).toFixed(1)}` : `M${X(p.on).toFixed(1)},${Y(p.value).toFixed(1)}`)).join("");

  const grid = [];
  for (let v = y0; v <= y1 + 1e-6; v += step) {
    grid.push(`<line class="c-grid${signed && Math.abs(v) < 1e-6 ? " c-zero" : ""}" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/>
      <text class="c-lbl" x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${esc(fmt(v).replace(/\s?€/, "").trim())}</text>`);
  }
  // Axe du temps : début, repères intermédiaires et fin (« auj. » si c'est aujourd'hui), toujours avec l'année
  const first = new Date(x0).toISOString().slice(0, 10), last = new Date(x1).toISOString().slice(0, 10);
  const ticks = [{ on: first, text: monthYear(first), anchor: "start" }];
  const n = Math.max(0, Math.min(2, Math.floor((W - L - R) / 95) - 1));
  for (let i = 1; i <= n; i++) {
    const mid = new Date(x0 + ((x1 - x0) * i) / (n + 1)).toISOString().slice(0, 10);
    ticks.push({ on: mid, text: monthYear(mid), anchor: "middle" });
  }
  const isToday = (t(todayIso()) - t(last)) / 86400000 < 10;
  ticks.push({ on: last, text: isToday ? "auj." : monthYear(last), anchor: "end" });
  const axis = ticks.filter((k, i) => i === 0 || i === ticks.length - 1 || (X(k.on) - X(first) > 60 && X(last) - X(k.on) > 60))
    .map((k) => `<line class="c-tick" x1="${X(k.on)}" x2="${X(k.on)}" y1="${H - B}" y2="${H - B + 4}"/>
      <text class="c-lbl" x="${k.anchor === "start" ? L : k.anchor === "end" ? W - R : X(k.on)}" y="${H - 6}" text-anchor="${k.anchor}">${esc(k.text)}</text>`).join("");
  const markers = marks.filter((m) => t(m.on) >= x0 && t(m.on) <= x1).map((m) =>
    `<line class="c-mark" x1="${X(m.on)}" x2="${X(m.on)}" y1="${T}" y2="${H - B}"/><text class="c-lbl c-mark-lbl" x="${X(m.on) + 3}" y="${T + 9}">${esc(m.text)}</text>`).join("");

  const end = pts.at(-1);
  const base = signed ? 0 : y0; // aire jusqu'au zéro pour une plus-value
  const area = `${path(pts)}L${X(end.on).toFixed(1)},${Y(base)}L${X(pts[0].on).toFixed(1)},${Y(base)}Z`;
  const cls = up ? "up" : "down";
  // Points pour la lecture au doigt : x, y, date, valeur, valeur de référence à cette date
  const at = (arr, on) => { let v = null; for (const r of arr) if (r.on <= on) v = r.value; return v; };
  const data = pts.map((p) => [Math.round(X(p.on) * 10) / 10, Math.round(Y(p.value) * 10) / 10, p.on, Math.round(p.value),
    refPts.length ? at(refPts, p.on) : null, retailPts.length ? at(retailPts, p.on) : null]);
  const lines = 1 + (refPts.length ? 1 : 0) + (retailPts.length ? 1 : 0);

  return `<svg class="chart ${cls}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}, du ${esc(fmtDate(first))} au ${esc(fmtDate(last))} : de ${esc(fmt(pts[0].value))} à ${esc(fmt(end.value))}"
      data-pts='${esc(JSON.stringify(data))}' data-names='${esc(JSON.stringify(names))}'${signed ? ' data-signed="1"' : ""}>
    ${grid.join("")}
    ${axis}
    ${markers}
    <path class="c-area" d="${area}"/>
    ${refPts.length ? `<path class="c-ref" d="${stepPath(refPts)}"/>` : ""}
    ${retailPts.length ? `<path class="c-retail" d="${stepPath(retailPts)}"/>` : ""}
    <path class="c-line" d="${path(pts)}"/>
    <circle class="c-dot" cx="${X(end.on)}" cy="${Y(end.value)}" r="4"/>
    <g class="c-hover" visibility="hidden">
      <line class="c-hline" y1="${T}" y2="${H - B}"/>
      <circle class="c-hdot" r="4.5"/>
      <rect class="c-tip" rx="6" height="${5 + 13 * lines}" y="0"/>
      <text class="c-tip-t" y="12"></text><text class="c-tip-t2" y="25"></text><text class="c-tip-t3" y="${12 + 13 * (lines - 1)}"></text>
    </g>
  </svg>`;
}

// Lecture au doigt (ou à la souris) : date et valeur au point le plus proche.
function onPointer(e) {
  const svg = e.target.closest?.("svg.chart");
  document.querySelectorAll("svg.chart .c-hover").forEach((g) => { if (!svg || !svg.contains(g)) g.setAttribute("visibility", "hidden"); });
  if (!svg || e.type === "pointerleave") return;
  const pts = JSON.parse(svg.dataset.pts || "[]");
  const [mainName, refName, retailName] = JSON.parse(svg.dataset.names || "[]");
  if (!pts.length) return;
  const m = svg.getScreenCTM();
  if (!m) return;
  const x = (e.clientX - m.e) / m.a;
  let best = pts[0];
  for (const p of pts) if (Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p;
  const g = svg.querySelector(".c-hover");
  g.setAttribute("visibility", "visible");
  const [px, py, on, value, refV, retailV] = best;
  const line = g.querySelector(".c-hline"); line.setAttribute("x1", px); line.setAttribute("x2", px);
  const dot = g.querySelector(".c-hdot"); dot.setAttribute("cx", px); dot.setAttribute("cy", py);
  const t1 = g.querySelector(".c-tip-t"), t2 = g.querySelector(".c-tip-t2"), t3 = g.querySelector(".c-tip-t3");
  const fmt = svg.dataset.signed ? fmtSigned : fmtEur;
  t1.textContent = `${fmtDate(on)} · ${mainName} ${fmt(value)}`;
  t2.textContent = refV != null ? `${refName} ${fmt(refV)}` : "";
  t3.textContent = retailV != null ? `${retailName} ${fmt(retailV)}` : "";
  const w = Math.max(t1.getComputedTextLength?.() || 120, t2.getComputedTextLength?.() || 0, t3.getComputedTextLength?.() || 0) + 14;
  const left = Math.min(Math.max(px - w / 2, 2), W - w - 2);
  const rect = g.querySelector(".c-tip"); rect.setAttribute("x", left); rect.setAttribute("width", w);
  t1.setAttribute("x", left + 7); t2.setAttribute("x", left + 7); t3.setAttribute("x", left + 7);
}
if (typeof document !== "undefined" && !globalThis.__brickfolioChart) {
  globalThis.__brickfolioChart = true;
  document.addEventListener("pointermove", onPointer);
  document.addEventListener("pointerdown", onPointer);
  document.addEventListener("pointerleave", onPointer, true);
}

// Mini-courbe pour la liste.
export function sparkline(points, up = true) {
  const pts = points.filter((p) => p.value != null).slice(-26);
  if (pts.length < 2) return "";
  const w = 64, h = 24;
  const vs = pts.map((p) => p.value), lo = Math.min(...vs), hi = Math.max(...vs);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${((i / (pts.length - 1)) * w).toFixed(1)},${(h - 2 - ((p.value - lo) / ((hi - lo) || 1)) * (h - 4)).toFixed(1)}`).join("");
  return `<svg class="spark ${up ? "up" : "down"}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><path d="${d}"/></svg>`;
}
