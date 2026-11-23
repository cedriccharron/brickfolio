// Petits utilitaires partagés.

export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const uuid = () =>
  (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID()
  : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });

const LOC = "fr-BE";
export const fmtEur = (n, d = 0) =>
  n == null || Number.isNaN(n) ? "—" : Number(n).toLocaleString(LOC, { style: "currency", currency: "EUR", maximumFractionDigits: d, minimumFractionDigits: d });
export const fmtSigned = (n, d = 0) => (n == null ? "—" : (n > 0 ? "+" : n < 0 ? "−" : "") + fmtEur(Math.abs(n), d));
export const fmtPct = (x, d = 1) =>
  x == null || Number.isNaN(x) ? "—" : (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x * 100).toLocaleString(LOC, { maximumFractionDigits: d, minimumFractionDigits: d }) + " %";
export const tone = (x) => (x == null ? "" : x > 0.0005 ? "up" : x < -0.0005 ? "down" : "");

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
export const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
export const fmtMonth = (iso) => { const d = new Date(iso + "T12:00:00"); return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`; };
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
// « 12,50 » ou « 12.50 » → 12.5
export const parseAmount = (s) => {
  const v = String(s ?? "").replace(/\s|€/g, "").replace(",", ".");
  return v === "" ? null : Number(v);
};

let toastTimer;
export function toast(msg, kind = "info") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = "toast"), kind === "error" ? 5000 : 2600);
}

export function confirmDialog(message, okLabel = "Confirmer", danger = true) {
  return new Promise((resolve) => {
    const dlg = document.getElementById("dialog");
    if (dlg.open) dlg.close();
    dlg.innerHTML = `<form method="dialog" class="dlg">
      <p>${esc(message)}</p>
      <div class="dlg-actions">
        <button value="cancel" class="btn ghost">Annuler</button>
        <button value="ok" class="btn ${danger ? "danger" : "primary"}">${esc(okLabel)}</button>
      </div></form>`;
    dlg.onclose = () => resolve(dlg.returnValue === "ok");
    dlg.showModal();
  });
}

export function download(filename, text, type = "text/csv;charset=utf-8") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
