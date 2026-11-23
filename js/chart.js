// Graphique en ligne (SVG) : valeur dans le temps, avec ligne « investi » en pointillés.
import { esc, fmtEur, fmtMonth } from "./util.js";

const W = 340, H = 180, L = 46, R = 10, T = 12, B = 24;
const t = (iso) => new Date(iso + "T12:00:00").getTime();

function niceStep(range) {
  const raw = range / 3;
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) || p * 10;
}

// main = [{on, value}] (ligne pleine + aire) ; ref = [{on, value}] (pointillés) ; up = couleur de gain ou perte.
export function lineChart({ main, ref = null, up = true, label = "Évolution de la valeur" }) {
  const pts = main.filter((p) => p.value != null);
  if (new Set(pts.map((p) => p.on)).size < 2) return `<div class="chart-empty">Pas encore assez de relevés pour tracer une courbe.<br>Le prochain relevé hebdomadaire complétera le graphique.</div>`;
  const all = [...pts, ...(ref || [])];
  const x0 = Math.min(...all.map((p) => t(p.on))), x1 = Math.max(...all.map((p) => t(p.on)));
  let y0 = Math.min(...all.map((p) => p.value)), y1 = Math.max(...all.map((p) => p.value));
  const step = niceStep(Math.max(y1 - y0, y1 * 0.05));
  y0 = Math.max(0, Math.floor(y0 / step) * step); y1 = Math.ceil(y1 / step) * step;
  if (y1 === y0) y1 = y0 + step;
  const X = (iso) => L + ((t(iso) - x0) / Math.max(1, x1 - x0)) * (W - L - R);
  const Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const path = (arr) => arr.map((p, i) => `${i ? "L" : "M"}${X(p.on).toFixed(1)},${Y(p.value).toFixed(1)}`).join("");

  const grid = [];
  for (let v = y0; v <= y1 + 1e-6; v += step) {
    grid.push(`<line class="c-grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/>
      <text class="c-lbl" x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${esc(fmtEur(v).replace(/\s?€/, "").trim())}</text>`);
  }
  const first = all.reduce((m, p) => (p.on < m ? p.on : m), all[0].on);
  const last = all.reduce((m, p) => (p.on > m ? p.on : m), all[0].on);
  const end = pts.at(-1);
  const area = `${path(pts)}L${X(end.on).toFixed(1)},${Y(y0)}L${X(pts[0].on).toFixed(1)},${Y(y0)}Z`;
  const cls = up ? "up" : "down";

  return `<svg class="chart ${cls}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}, de ${esc(fmtEur(pts[0].value))} à ${esc(fmtEur(end.value))}">
    ${grid.join("")}
    <text class="c-lbl" x="${L}" y="${H - 6}">${esc(fmtMonth(first))}</text>
    <text class="c-lbl" x="${W - R}" y="${H - 6}" text-anchor="end">${esc(fmtMonth(last))}</text>
    <path class="c-area" d="${area}"/>
    ${ref && ref.length ? `<path class="c-ref" d="${path(ref)}"/>` : ""}
    <path class="c-line" d="${path(pts)}"/>
    <circle class="c-dot" cx="${X(end.on)}" cy="${Y(end.value)}" r="4"/>
  </svg>`;
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
