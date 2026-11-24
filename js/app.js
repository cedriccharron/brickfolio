// Brickfolio — application principale (navigation, écrans, actions).
import { CONFIG } from "./config.js";
import { createDemoStore } from "./store-demo.js";
import { icon } from "./icons.js";
import { lineChart, sparkline } from "./chart.js";
import { esc, uuid, fmtEur, fmtSigned, fmtPct, tone, fmtDate, todayIso, parseAmount, toast, confirmDialog, download } from "./util.js";
import {
  CONDITIONS, normalizeSetNo, isSold, position, summary, positionHistory, portfolioHistory,
  pricesFor, unitValue, valueSource, SORTS, toCSV,
} from "./invest.js";

const VERSION = "0.4.4";
// Factures acceptées : PDF ou photo, 10 Mo au plus.
const INVOICE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const INVOICE_MAX = 10 * 1024 * 1024;
const $ = (s, root = document) => root.querySelector(s);
const inFrame = () => { try { return window.self !== window.top; } catch { return true; } };

const S = {
  store: null,
  data: null,
  filter: "held",   // held | sold | all
  sort: localStorage.getItem("brickfolio-sort") || "gain",
  draft: null,      // brouillon du formulaire d'achat
  scan: null,       // dernière facture lue : { file, invoice, used: Set des lignes déjà enregistrées }
  busy: false,      // relevé des prix en cours
};

const setOf = (no) => S.data.sets[no] || null;
const nameOf = (no) => setOf(no)?.name || no;
const purchase = (id) => S.data.purchases.find((p) => p.id === id);
const imgUrl = (no) => setOf(no)?.image || `https://img.bricklink.com/ItemImage/SN/0/${no}.png`;
const blUrl = (no) => `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${encodeURIComponent(no)}#T=P`;
// Image BrickLink, sinon Brickset, sinon une brique dessinée.
const thumb = (no, cls = "") => `<span class="thumb ${cls}">${icon("brick", 26)}<img src="${esc(imgUrl(no))}" alt="" loading="lazy"
  data-alt="https://images.brickset.com/sets/images/${esc(encodeURIComponent(no))}.jpg"
  onerror="if(this.dataset.alt){this.src=this.dataset.alt;this.removeAttribute('data-alt')}else this.remove()"></span>`;

// ---------- Démarrage ------------------------------------------------------
async function boot() {
  const forceDemo = new URLSearchParams(location.search).has("demo");
  if (!forceDemo && CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY && !inFrame()) {
    try {
      const { createSupabaseStore } = await import("./store-supabase.js");
      S.store = await createSupabaseStore();
      await S.store.init();
    } catch (e) {
      $("#main").innerHTML = `<div class="empty"><p>Impossible de joindre le serveur.</p><p class="muted small">${esc(e.message)}</p>
        <button class="btn primary" onclick="location.reload()">Réessayer</button></div>`;
      return;
    }
  } else {
    S.store = createDemoStore();
  }
  document.body.classList.toggle("demo", S.store.mode === "demo");
  if (S.store.account()) await reload(); else render();
}

async function reload() {
  try { S.data = await S.store.loadAll(); }
  catch (e) { toast(e.message, "error"); }
  render();
}

// ---------- Navigation ---------------------------------------------------
function route() {
  const h = location.hash.replace(/^#\/?/, "");
  return h.split("?")[0].split("/").filter(Boolean);
}
const go = (path) => { location.hash = path; };
window.addEventListener("hashchange", () => {
  if (!/^#\/p\/(new|[^/]+\/edit)/.test(location.hash)) S.draft = null; // formulaire quitté : brouillon oublié
  render(); window.scrollTo(0, 0);
});

function render() {
  const main = $("#main");
  const nav = $("#nav");
  if (!S.store.account()) { main.innerHTML = viewLogin(); nav.hidden = true; return; }
  if (!S.data) { main.innerHTML = `<div class="loading">Chargement…</div>`; return; }
  const [a, b, c] = route();
  let html, tab = null;
  if (!a) { html = viewPortfolio(); tab = "home"; }
  else if (a === "more") { html = viewMore(); tab = "more"; }
  else if (a === "p" && b === "new") html = viewForm(null);
  else if (a === "p" && b && c === "edit") html = purchase(b) ? viewForm(purchase(b)) : notFound();
  else if (a === "p" && b) html = purchase(b) ? viewDetail(purchase(b)) : notFound();
  else html = notFound();
  main.innerHTML = html;
  nav.hidden = !tab;
  for (const el of nav.querySelectorAll("a")) el.classList.toggle("active", el.dataset.tab === tab);
}

const notFound = () => `<div class="empty"><p>Cet achat n'existe plus.</p><a class="btn primary" href="#/">Retour au portefeuille</a></div>`;

function top(title, { back = null, sub = "", actions = "" } = {}) {
  return `<header class="top">
    ${back ? `<a class="icon-btn" href="${back}" aria-label="Retour">${icon("back")}</a>` : ""}
    <div class="top-title"><h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</div>
    <div class="top-actions">${actions}</div>
  </header>`;
}

// ---------- Connexion ------------------------------------------------------
function viewLogin() {
  return `<div class="login">
    <div class="logo">${icon("brick", 40)}</div>
    <h1>Brickfolio</h1>
    <p class="muted">Ton portefeuille LEGO, valorisé chaque semaine.</p>
    <form id="login-form" class="panel">
      <label class="field"><span>E-mail</span><input name="email" type="email" autocomplete="username" required></label>
      <label class="field"><span>Mot de passe</span><input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn primary block">Se connecter</button>
    </form>
  </div>`;
}

// ---------- Portefeuille ---------------------------------------------------
function rowsFor(filter) {
  return S.data.purchases
    .filter((p) => (filter === "all" ? true : filter === "sold" ? isSold(p) : !isSold(p)))
    .map((p) => ({ p, pos: position(p, S.data.prices), name: nameOf(p.setNo) }))
    .sort(SORTS[S.sort]?.fn || SORTS.gain.fn);
}

function viewPortfolio() {
  const { purchases, prices, lastRun } = S.data;
  if (!purchases.length) {
    return `${top("Portefeuille")}
      <div class="empty">${icon("brick", 48)}<p><strong>Aucun achat enregistré</strong></p>
      <p class="muted">Ajoute ton premier set : sa valeur sera relevée sur BrickLink chaque semaine.</p>
      <a class="btn primary" href="#/p/new">${icon("plus")} Ajouter un achat</a></div>`;
  }
  const s = summary(purchases, prices);
  const hist = portfolioHistory(purchases, prices);
  const gain = s.value - s.invested;
  const rows = rowsFor(S.filter);
  const counts = { held: purchases.filter((p) => !isSold(p)).length, sold: purchases.filter(isSold).length };

  return `${top("Portefeuille", { sub: lastRun?.finished_at ? `Prix du ${fmtDate(lastRun.finished_at)}${S.data.offline ? " · hors ligne" : ""}` : "Aucun relevé de prix pour l'instant",
      actions: `<button class="icon-btn" data-action="refresh" aria-label="Mettre à jour les prix" ${S.busy ? "disabled" : ""}>${icon("refresh")}</button>` })}
    <section class="hero">
      <span class="kicker">Valeur actuelle</span>
      <strong class="big-num">${fmtEur(s.value)}</strong>
      <span class="delta ${tone(gain)}">${fmtSigned(gain)} · ${fmtPct(s.pct)}</span>
      <div class="hero-grid">
        <div><span>Investi</span><strong>${fmtEur(s.invested)}</strong></div>
        <div><span>Boîtes</span><strong>${s.boxes}</strong></div>
        <div><span>Plus-value réalisée</span><strong class="${tone(s.realized)}">${fmtSigned(s.realized)}</strong></div>
      </div>
      ${s.unpriced ? `<p class="hero-note">${s.unpriced} set(s) sans prix encore : comptés à leur prix d'achat.</p>` : ""}
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Évolution</h2><span class="legend"><i class="lg-line"></i>Valeur <i class="lg-ref"></i>Investi</span></div>
      ${lineChart({ main: hist.map((h) => ({ on: h.on, value: h.value })), ref: hist.map((h) => ({ on: h.on, value: h.invested })), up: gain >= 0, label: "Valeur du portefeuille" })}
    </section>
    <div class="list-head">
      <div class="seg" role="tablist">
        ${[["held", `En stock (${counts.held})`], ["sold", `Vendus (${counts.sold})`], ["all", "Tout"]]
          .map(([k, l]) => `<button data-action="filter" data-v="${k}" class="${S.filter === k ? "on" : ""}">${l}</button>`).join("")}
      </div>
      <label class="sort">Trier par <select data-action="sort">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${S.sort === k ? "selected" : ""}>${v.label}</option>`).join("")}</select></label>
    </div>
    <ul class="positions">${rows.map(rowHtml).join("") || `<li class="muted center pad">Rien ici.</li>`}</ul>
    <a class="fab" href="#/p/new" aria-label="Ajouter un achat">${icon("plus", 28)}</a>`;
}

function rowHtml({ p, pos, name }) {
  const hist = positionHistory(p, S.data.prices);
  return `<li><a class="pos" href="#/p/${p.id}">
    ${thumb(p.setNo)}
    <span class="grow">
      <strong class="pos-name">${esc(name)}</strong>
      <span class="muted small">${esc(p.setNo)} · ${CONDITIONS[p.condition]}${p.qty > 1 ? ` · ×${p.qty}` : ""}${pos.sold ? " · vendu" : ""}</span>
    </span>
    ${sparkline(hist, (pos.gain ?? 0) >= 0)}
    <span class="pos-val">
      <strong>${pos.priced ? fmtEur(pos.value) : "—"}</strong>
      <span class="small ${tone(pos.pct)}">${pos.priced ? fmtPct(pos.pct) : "en attente"}</span>
    </span>
  </a></li>`;
}

// ---------- Détail d'un achat -------------------------------------------------
function viewDetail(p) {
  const pos = position(p, S.data.prices);
  const set = setOf(p.setNo);
  const rows = pricesFor(S.data.prices, p.setNo, p.condition).filter((r) => unitValue(r) != null);
  const hist = positionHistory(p, S.data.prices);
  const last = pos.row;
  const src = valueSource(last);
  const market = [...rows].reverse().find((r) => !r.manual); // dernier relevé BrickLink
  const recent = rows.slice(-10).reverse();

  return `${top(set?.name || p.setNo, { back: "#/", sub: `${esc(p.setNo)}${set?.year ? ` · ${set.year}` : ""} · ${CONDITIONS[p.condition]}`,
      actions: `<a class="icon-btn" href="#/p/${p.id}/edit" aria-label="Modifier">${icon("edit")}</a>` })}
    <div class="detail-head">
      ${thumb(p.setNo, "xl")}
      <div class="detail-num">
        <span class="kicker">${pos.sold ? "Vendu" : "Valeur actuelle"}</span>
        <strong class="big-num">${pos.priced ? fmtEur(pos.value) : "—"}</strong>
        <span class="delta ${tone(pos.gain)}">${pos.priced ? `${fmtSigned(pos.gain)} · ${fmtPct(pos.pct)}` : "En attente du premier relevé"}</span>
      </div>
    </div>
    <section class="panel">
      <div class="panel-head"><h2>Valeur de ta position</h2><span class="legend"><i class="lg-line"></i>Valeur <i class="lg-ref"></i>Coût</span></div>
      ${lineChart({ main: hist, ref: hist.length > 1 ? [{ on: hist[0].on, value: pos.cost }, { on: hist.at(-1).on, value: pos.cost }] : null, up: (pos.gain ?? 0) >= 0, label: "Valeur de la position" })}
    </section>
    <section class="panel stats">
      <div><span>Coût total</span><strong>${fmtEur(pos.cost, 2)}</strong><em>${p.qty} × ${fmtEur(p.unitPrice, 2)}${p.fees ? ` + ${fmtEur(p.fees, 2)} de frais` : ""}</em></div>
      <div><span>Valeur par boîte</span><strong>${pos.unit != null ? fmtEur(pos.unit, 2) : "—"}</strong><em>${src === "manuel" ? `valeur encodée le ${fmtDate(last.on)}` : src ? `moyenne des ${src} BrickLink` : pos.sold ? "—" : "pas encore de prix"}</em></div>
      <div><span>Rendement annualisé</span><strong class="${tone(pos.cagr)}">${fmtPct(pos.cagr)}</strong><em>${pos.cagr == null ? "après 6 mois de détention" : `depuis le ${fmtDate(p.date)}`}</em></div>
      <div><span>${pos.sold ? "Vendu le" : "Acheté le"}</span><strong>${fmtDate(pos.sold ? p.soldDate : p.date)}</strong><em>${esc(pos.sold ? `acheté le ${fmtDate(p.date)}` : p.shop || "")}</em></div>
    </section>
    ${market ? `<section class="panel">
      <h2>Marché BrickLink (${CONDITIONS[p.condition].toLowerCase()}, Europe)</h2>
      <div class="market">
        <div><span>Ventes 6 mois</span><strong>${market.qtySold ?? 0}</strong></div>
        <div><span>Min / max vendu</span><strong>${market.minSold != null ? `${fmtEur(market.minSold)} – ${fmtEur(market.maxSold)}` : "—"}</strong></div>
        <div><span>En vente</span><strong>${market.qtyStock ?? 0} dès ${fmtEur(market.minStock)}</strong></div>
      </div>
    </section>` : ""}
    <section class="panel">
      <div class="panel-head"><h2>Valeurs d'une boîte</h2>${pos.sold ? "" : `<button class="btn ghost small" data-action="manual" data-id="${p.id}">${icon("edit", 16)} Encoder</button>`}</div>
      ${recent.length ? `<table class="hist"><thead><tr><th>Date</th><th>Source</th><th>Valeur</th><th></th></tr></thead><tbody>
        ${recent.map((r) => `<tr><td>${fmtDate(r.on)}</td>
          <td>${r.manual ? `<span class="tag">manuel</span>${r.note ? `<span class="muted small note-cell">${esc(r.note)}</span>` : ""}` : r.avgSold != null ? "ventes" : "annonces"}</td>
          <td>${fmtEur(unitValue(r), 2)}</td>
          <td>${r.manual ? `<button class="icon-btn mini" data-action="del-manual" data-id="${esc(r.id)}" aria-label="Supprimer cette valeur">${icon("trash", 16)}</button>` : ""}</td></tr>`).join("")}
      </tbody></table>` : `<p class="muted small">Aucune valeur pour l'instant. Encode ta propre estimation (BrickEconomy, 2ememain, Vinted…) en attendant le relevé BrickLink.</p>`}
    </section>
    ${invoicePanel(p)}
    ${p.notes ? `<section class="panel"><h2>Notes</h2><p class="notes">${esc(p.notes)}</p></section>` : ""}
    <div class="form-actions">
      <a class="btn ghost" href="${blUrl(p.setNo)}" target="_blank" rel="noopener">${icon("external", 18)} BrickLink</a>
      ${pos.sold ? "" : `<a class="btn primary" href="#/p/${p.id}/edit?sell">${icon("tag", 18)} Vendu</a>`}
    </div>`;
}

function invoicePanel(p) {
  const pick = (label, cls) => `<label class="btn ${cls} small">${icon("clip", 16)} ${label}
    <input type="file" accept="application/pdf,image/*" data-action="invoice-file" data-id="${p.id}" hidden></label>`;
  if (!p.invoicePath) {
    return `<section class="panel">
      <div class="panel-head"><h2>Facture</h2>${pick("Joindre", "ghost")}</div>
      <p class="muted small">Garde la preuve d'achat avec le set : un PDF ou une photo du ticket (10 Mo au plus).</p>
    </section>`;
  }
  const isPdf = p.invoiceType === "application/pdf";
  return `<section class="panel">
    <div class="panel-head"><h2>Facture</h2><span class="invoice-tools">${pick("Remplacer", "ghost")}
      <button class="icon-btn mini" data-action="invoice-del" data-id="${p.id}" aria-label="Supprimer la facture">${icon("trash", 16)}</button></span></div>
    <button class="invoice-open" data-action="invoice-view" data-id="${p.id}">
      <span class="invoice-ic">${icon(isPdf ? "file" : "photo", 24)}</span>
      <span class="grow"><strong>${esc(p.invoiceName || "Facture")}</strong><span class="muted small">${isPdf ? "PDF" : "Photo"} · toucher pour ouvrir</span></span>
    </button>
  </section>`;
}

async function attachInvoice(p, file) {
  if (!file) return;
  const type = invoiceType(file);
  if (!type) return toast("Choisis un PDF ou une photo (JPEG, PNG, HEIC)", "error");
  if (file.size > INVOICE_MAX) return toast("Fichier trop lourd : 10 Mo au plus", "error");
  toast("Envoi de la facture…");
  try {
    await S.store.attachInvoice(p, type === file.type ? file : new File([file], file.name, { type }));
    await reload();
    toast(p.invoicePath ? "Facture remplacée" : "Facture jointe");
  } catch (e) { toast(e.message, "error"); }
}

// Aperçu dans une fenêtre : la photo s'affiche, le PDF s'ouvre d'un toucher (lien direct, jamais bloqué).
async function viewInvoice(p) {
  let url;
  try { url = await S.store.invoiceUrl(p); } catch (e) { return toast(e.message, "error"); }
  const dlg = $("#dialog");
  if (dlg.open) dlg.close();
  const isPdf = p.invoiceType === "application/pdf";
  dlg.innerHTML = `<form method="dialog" class="dlg">
    <h2>Facture</h2>
    <p class="muted small">${esc(nameOf(p.setNo))} · ${esc(p.invoiceName || "")}</p>
    ${isPdf ? `<div class="invoice-pdf">${icon("file", 48)}</div>` : `<img class="invoice-img" src="${esc(url)}" alt="Facture">`}
    <div class="dlg-actions">
      <button value="cancel" class="btn ghost">Fermer</button>
      <a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener">${icon("external", 18)} Ouvrir</a>
    </div></form>`;
  dlg.onclose = () => { if (url.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(url), 60000); };
  dlg.returnValue = "";
  dlg.showModal();
}

// ---------- Formulaire d'achat ---------------------------------------------------
function viewForm(p) {
  const selling = location.hash.includes("?sell");
  if (!S.draft || S.draft.id !== (p?.id || "new")) {
    S.draft = p ? { ...p, id: p.id, found: setOf(p.setNo), sold: isSold(p) || selling } : newDraft();
  }
  const d = S.draft;
  const v = (x) => (x == null ? "" : esc(String(x).replace(".", ",")));
  return `${top(p ? "Modifier l'achat" : "Nouvel achat", { back: p ? `#/p/${p.id}` : "#/" })}
    <form id="purchase-form" class="pad" autocomplete="off">
      ${p ? "" : invoiceBox(d)}
      <label class="field"><span>Numéro du set</span>
        <div class="inline-form">
          <input name="setNo" value="${esc(d.setNo)}" placeholder="ex. 75192" inputmode="text" required ${p ? "readonly" : ""}>
          ${p ? "" : `<button type="button" class="btn ghost" data-action="lookup">${icon("search", 18)} Chercher</button>`}
        </div>
        <span class="hint">Le numéro est imprimé sur la boîte. « 75192 » devient « 75192-1 » comme sur BrickLink.</span>
      </label>
      ${d.found ? `<div class="found">${thumb(d.found.setNo)}<div><strong>${esc(d.found.name)}</strong><span class="muted small">${esc(d.found.setNo)}${d.found.year ? ` · ${d.found.year}` : ""}</span></div></div>`
        : d.lookupError ? `${d.scanName ? `<div class="found">${thumb(normalizeSetNo(d.setNo))}<div><strong>${esc(d.scanName)}</strong><span class="muted small">nom lu sur la facture</span></div></div>` : ""}
            <p class="muted small">Catalogue BrickLink indisponible pour l'instant : le nom et l'image du set seront complétés au premier relevé. Tu peux enregistrer.</p>`
        : d.lookedUp ? `<p class="warn small">Set introuvable sur BrickLink : vérifie le numéro (tu peux quand même l'enregistrer).</p>`
        : d.scanName && d.setNo ? `<div class="found">${thumb(normalizeSetNo(d.setNo))}<div><strong>${esc(d.scanName)}</strong><span class="muted small">nom lu sur la facture</span></div></div>` : ""}
      <fieldset class="field"><legend>État</legend>
        <div class="seg">${Object.entries(CONDITIONS).map(([k, l]) => `<label class="seg-opt"><input type="radio" name="condition" value="${k}" ${d.condition === k ? "checked" : ""}>${l}</label>`).join("")}</div>
      </fieldset>
      <div class="two">
        <label class="field"><span>Quantité</span><input name="qty" type="number" min="1" step="1" value="${esc(d.qty)}" required></label>
        <label class="field"><span>Prix payé par boîte (€)</span><input name="unitPrice" inputmode="decimal" value="${v(d.unitPrice)}" placeholder="0,00" required></label>
      </div>
      <div class="two">
        <label class="field"><span>Frais (port…) (€)</span><input name="fees" inputmode="decimal" value="${v(d.fees || "")}" placeholder="0,00"></label>
        <label class="field"><span>Date d'achat</span><input name="date" type="date" value="${esc(d.date)}" max="${todayIso()}" required></label>
      </div>
      <label class="field"><span>Boutique</span><input name="shop" value="${esc(d.shop)}" placeholder="LEGO Store, Amazon, Vinted…"></label>
      <label class="field"><span>Notes</span><textarea name="notes" rows="2" placeholder="Promo, état de la boîte…">${esc(d.notes)}</textarea></label>
      <label class="check"><input type="checkbox" name="sold" ${d.sold ? "checked" : ""} data-action="toggle-sold"> J'ai vendu ce lot</label>
      <div class="two ${d.sold ? "" : "hidden"}" id="sold-fields">
        <label class="field"><span>Prix de vente total, net (€)</span><input name="soldPrice" inputmode="decimal" value="${v(d.soldPrice)}" placeholder="après frais et commissions"></label>
        <label class="field"><span>Date de vente</span><input name="soldDate" type="date" value="${esc(d.soldDate || todayIso())}" max="${todayIso()}"></label>
      </div>
      <div class="form-actions sticky">
        ${p ? `<button type="button" class="btn ghost" data-action="delete" data-id="${p.id}" aria-label="Supprimer">${icon("trash", 18)}</button>` : ""}
        <button class="btn primary">Enregistrer</button>
      </div>
    </form>`;
}

const newDraft = () => ({ id: "new", setNo: "", condition: "N", qty: 1, unitPrice: "", fees: "", date: todayIso(), shop: "", notes: "",
  soldPrice: null, soldDate: null, found: null, sold: false, invoiceFile: null, scanning: false, scanItem: null });

// Encart « Facture » du nouvel achat : lecture sur l'appareil (texte du PDF ou OCR de la photo), ou simple pièce jointe.
function invoiceBox(d) {
  const input = (action) => `<input type="file" accept="application/pdf,image/*" data-action="${action}" hidden>`;
  if (!d.invoiceFile) {
    return `<div class="scan-box">
      <div class="scan-actions">
        <label class="btn primary small">${icon("scan", 16)} Lire une facture${input("scan-file")}</label>
        <label class="btn ghost small">${icon("clip", 16)} Joindre sans lire${input("attach-file")}</label>
      </div>
      <p class="hint">« Lire » essaie de remplir le formulaire à partir du PDF ou de la photo (lecture sur ton appareil, gratuite) ; vérifie toujours avant d'enregistrer. Dans les deux cas, la facture est jointe à l'achat.</p>
    </div>`;
  }
  const sc = S.scan?.file === d.invoiceFile ? S.scan : null;
  const inv = sc?.invoice;
  const isPdf = d.invoiceFile.type === "application/pdf";
  const status = d.scanning ? `<span class="muted small" id="scan-progress">${esc(d.progress || "Lecture en cours…")}</span>`
    : d.scanError ? `<span class="small warn">Lecture impossible : ${esc(d.scanError)}. Remplis le formulaire à la main (la facture reste jointe).</span>`
    : inv ? `<span class="small up">Lue : vérifie les champs ci-dessous</span>` : `<span class="muted small">Jointe sans lecture</span>`;
  const readBtn = !d.scanning && !inv ? `<button type="button" class="btn ghost small" data-action="scan-again">${icon("scan", 16)} ${d.scanError ? "Réessayer" : "Lire cette facture"}</button>` : "";
  const notes = [];
  if (inv?.warning) notes.push(esc(inv.warning));
  return `<div class="scan-box">
    <div class="scan-file">
      <span class="invoice-ic">${icon(isPdf ? "file" : "photo", 22)}</span>
      <span class="grow"><strong>${esc(d.invoiceFile.name)}</strong>${status}</span>
      ${d.scanning ? "" : `<button type="button" class="icon-btn mini" data-action="draft-file-clear" aria-label="Retirer la facture">${icon("trash", 16)}</button>`}
    </div>
    ${readBtn ? `<div class="scan-actions scan-again">${readBtn}</div>` : ""}
    ${notes.map((t) => `<p class="warn small">${t}</p>`).join("")}
    ${inv?.items.length > 1 ? `<p class="small scan-title">${inv.items.length} sets sur cette facture : choisis celui à enregistrer.</p>
      <div class="scan-items">${inv.items.map((it, i) => `<button type="button" class="scan-item ${d.scanItem === i ? "on" : ""} ${sc.used.has(i) ? "done" : ""}" data-action="scan-item" data-i="${i}">
        <strong>${esc(it.name || it.set_no || "Set")}</strong>
        <span class="muted small">${esc(it.set_no || "n° ?")} · ×${it.qty} · ${it.unit_price != null ? fmtEur(it.unit_price, 2) : "prix ?"}${sc.used.has(i) ? " · déjà enregistré" : ""}</span>
      </button>`).join("")}</div>` : ""}
    ${sc?.text ? `<details class="scan-text"><summary class="small muted">Voir le texte lu</summary><pre>${esc(sc.text.trim().slice(0, 4000))}</pre></details>` : ""}
  </div>`;
}

const invoiceType = (file) => {
  const type = file.type || (/\.pdf$/i.test(file.name) ? "application/pdf" : /\.(heic|heif)$/i.test(file.name) ? "image/heic" : "");
  return INVOICE_TYPES.includes(type) ? type : null;
};
// Remplit le brouillon avec l'en-tête de la facture et la ligne i.
function applyScan(i) {
  const { invoice, used } = S.scan;
  const d = S.draft;
  if (invoice.date && invoice.date <= todayIso()) d.date = invoice.date;
  if (invoice.shop) d.shop = invoice.shop;
  d.fees = used.size === 0 && invoice.shipping ? invoice.shipping : ""; // frais de port comptés une seule fois
  const it = invoice.items[i];
  d.scanItem = it ? i : null;
  if (!it) return;
  Object.assign(d, { setNo: it.set_no || "", qty: it.qty, unitPrice: it.unit_price ?? "", found: it.set_no ? S.data.sets[it.set_no] || null : null, lookedUp: false, lookupError: null, scanName: it.name || null });
  if (it.condition) d.condition = it.condition;
}

async function pickInvoice(file, read) {
  if (!file) return;
  readForm();
  const type = invoiceType(file);
  if (!type) return toast("Choisis un PDF ou une photo (JPEG, PNG, HEIC)", "error");
  if (file.size > INVOICE_MAX) return toast("Fichier trop lourd : 10 Mo au plus", "error");
  const draft = S.draft;
  draft.invoiceFile = type === file.type ? file : new File([file], file.name, { type });
  draft.scanItem = null;
  draft.scanError = null;
  if (!read) { render(); return; }
  draft.scanning = true;
  render();
  try {
    const { readInvoiceFile } = await import("./invoice-read.js");
    const { invoice, text } = await readInvoiceFile(draft.invoiceFile, {
      knownSets: Object.keys(S.data.sets),
      onProgress: (msg) => { draft.progress = msg; const el = $("#scan-progress"); if (el) el.textContent = msg; },
    });
    S.scan = { file: draft.invoiceFile, invoice, text, used: new Set() };
    draft.scanning = false;
    if (S.draft !== draft) return; // formulaire quitté entre-temps
    applyScan(0);
    render();
    if (draft.setNo && !draft.found) lookup();
  } catch (e) {
    draft.scanning = false;
    draft.scanError = e?.message || String(e);
    if (S.draft === draft) render();
  }
}

// Recopie le formulaire dans le brouillon (avant de redessiner).
function readForm() {
  const f = $("#purchase-form");
  if (!f) return;
  const fd = new FormData(f);
  // Numéro changé à la main : le nom lu sur la facture et la dernière recherche ne valent plus.
  if (fd.get("setNo") != null && normalizeSetNo(fd.get("setNo")) !== normalizeSetNo(S.draft.setNo || "")) {
    Object.assign(S.draft, { scanName: null, lookupError: null, lookedUp: false, found: null });
  }
  Object.assign(S.draft, {
    setNo: fd.get("setNo"), condition: fd.get("condition") || "N", qty: fd.get("qty"), unitPrice: fd.get("unitPrice"),
    fees: fd.get("fees"), date: fd.get("date"), shop: fd.get("shop"), notes: fd.get("notes"),
    sold: fd.get("sold") === "on", soldPrice: fd.get("soldPrice"), soldDate: fd.get("soldDate"),
  });
}

async function lookup() {
  readForm();
  const no = normalizeSetNo(S.draft.setNo);
  if (!no) { toast("Entre un numéro de set", "error"); return; }
  S.draft.setNo = no;
  const btn = $('[data-action="lookup"]');
  if (btn) { btn.disabled = true; btn.textContent = "Recherche…"; }
  try {
    S.draft.found = S.data.sets[no] || await S.store.lookupSet(no);
    if (S.draft.found) S.data.sets[no] = S.draft.found;
    S.draft.lookupError = null;
  } catch (e) {
    // BrickLink indisponible (clés pas encore installées, panne) : pas une erreur de l'utilisateur.
    S.draft.found = null;
    S.draft.lookupError = e.message;
  }
  S.draft.lookedUp = true;
  render();
}

async function savePurchase() {
  readForm();
  const d = S.draft;
  const setNo = normalizeSetNo(d.setNo);
  const qty = Number(d.qty);
  const unitPrice = parseAmount(d.unitPrice);
  const fees = parseAmount(d.fees) ?? 0;
  const soldPrice = d.sold ? parseAmount(d.soldPrice) : null;
  if (!setNo) return toast("Numéro de set manquant", "error");
  if (!(qty >= 1) || !Number.isInteger(qty)) return toast("Quantité invalide", "error");
  if (unitPrice == null || !(unitPrice >= 0)) return toast("Prix d'achat invalide", "error");
  if (Number.isNaN(fees)) return toast("Frais invalides", "error");
  if (d.sold && (soldPrice == null || Number.isNaN(soldPrice))) return toast("Indique le prix de vente", "error");
  if (d.sold && d.soldDate < d.date) return toast("La vente ne peut pas précéder l'achat", "error");

  const p = {
    id: d.id === "new" ? uuid() : d.id, setNo, condition: d.condition, qty, unitPrice, fees, date: d.date,
    shop: (d.shop || "").trim(), notes: (d.notes || "").trim(), soldPrice, soldDate: d.sold ? d.soldDate : null,
  };
  const isNewPair = !S.data.prices.some((r) => r.setNo === setNo && r.condition === p.condition);
  try {
    if (!S.data.sets[setNo]) { try { await S.store.lookupSet(setNo); } catch { /* fiche plus tard */ } }
    await S.store.savePurchase(p);
  } catch (e) { return toast(e.message, "error"); }
  const file = d.invoiceFile;
  let saved = "Achat enregistré";
  if (file) {
    try { await S.store.attachInvoice(p, file); saved = "Achat enregistré avec sa facture"; }
    catch (e) { toast(`Achat enregistré, mais la facture n'a pas pu être jointe : ${e.message}`, "error"); saved = null; }
  }
  const sc = S.scan?.file === file && file ? S.scan : null;
  if (sc && d.scanItem != null) sc.used.add(d.scanItem);
  S.draft = null;
  await reload();
  const next = sc ? sc.invoice.items.findIndex((_, i) => !sc.used.has(i)) : -1;
  const left = sc ? sc.invoice.items.length - sc.used.size : 0;
  if (next >= 0 && await confirmDialog(`${saved || "Achat enregistré"}. Il reste ${left} set(s) sur cette facture : les encoder maintenant ?`, "Continuer", false)) {
    S.draft = { ...newDraft(), invoiceFile: file };
    applyScan(next);
    go("#/p/new");
    render();
    if (S.draft.setNo && !S.draft.found) lookup();
    return;
  }
  go(`#/p/${p.id}`);
  if (saved) toast(saved);
  // Premier achat de ce set dans cet état : on relève son prix sans attendre lundi.
  if (isNewPair && !p.soldPrice && S.store.mode === "online") refreshPrices(true);
}

// ---------- Plus ------------------------------------------------------------------
function viewMore() {
  const run = S.data.lastRun;
  const acc = S.store.account();
  return `${top("Plus")}
    <section class="panel">
      <h2>${icon("refresh", 20)} Prix BrickLink</h2>
      <p class="muted small">Chaque lundi matin, la valeur de tes sets est relevée sur BrickLink : moyenne des ventes des 6 derniers mois en Europe, TVA comprise, dans l'état de ton achat (neuf ou occasion). S'il n'y a eu aucune vente, la moyenne des annonces en cours est utilisée.</p>
      <p class="small">${run ? `Dernier relevé : <strong>${fmtDate(run.finished_at || run.started_at)}</strong>${run.message ? `<br><span class="muted">${esc(run.message)}</span>` : ""}` : "Aucun relevé pour l'instant."}</p>
      <button class="btn primary block" data-action="refresh" ${S.busy ? "disabled" : ""}>${S.busy ? "Relevé en cours…" : "Mettre à jour maintenant"}</button>
    </section>
    <section class="panel">
      <h2>${icon("download", 20)} Exporter</h2>
      <p class="muted small">Tous tes achats avec leur valeur actuelle, à ouvrir dans Excel ou Numbers.</p>
      <button class="btn ghost block" data-action="export">Télécharger le tableau (CSV)</button>
    </section>
    <section class="panel">
      <h2>${icon("info", 20)} Compte</h2>
      ${S.store.mode === "demo"
        ? `<p class="muted small">Mode démo : les données restent dans ce navigateur et les prix sont simulés. Renseigne <code>js/config.js</code> pour passer en ligne.</p>
           <button class="btn ghost block" data-action="reset-demo">Réinitialiser l'exemple</button>`
        : `<p class="small">Connecté : <strong>${esc(acc?.email)}</strong></p>
           <button class="btn ghost block" data-action="logout">${icon("logout", 18)} Se déconnecter</button>`}
      <p class="muted small center">Brickfolio ${VERSION} · Données de prix : BrickLink. LEGO® est une marque du groupe LEGO, qui ne soutient pas cette application.</p>
    </section>`;
}

async function refreshPrices(silent = false) {
  if (S.busy) return;
  S.busy = true;
  if (!silent) { render(); toast("Relevé des prix en cours…"); }
  try {
    const r = await S.store.refreshPrices();
    await reload();
    toast(r.failed ? `${r.ok} prix relevés, ${r.failed} échec(s)` : silent ? "Prix BrickLink relevé" : `${r.ok} prix relevés`, r.failed ? "error" : "info");
  } catch (e) {
    // Relevé automatique après un nouvel achat : on ne dérange pas si BrickLink n'est pas encore branché.
    if (!silent) toast(e.message, "error");
  } finally {
    S.busy = false;
    render();
  }
}

// ---------- Valeur manuelle ---------------------------------------------------------
function manualDialog(p) {
  const dlg = $("#dialog");
  if (dlg.open) dlg.close();
  const last = position(p, S.data.prices).unit;
  dlg.innerHTML = `<form method="dialog" class="dlg" id="manual-form">
    <h2>Valeur d'une boîte</h2>
    <p class="muted small">${esc(nameOf(p.setNo))} · ${CONDITIONS[p.condition].toLowerCase()}. Elle remplace la valeur actuelle jusqu'au prochain relevé BrickLink plus récent.</p>
    <label class="field"><span>Valeur par boîte (€)</span><input name="value" inputmode="decimal" placeholder="${last != null ? esc(String(last).replace(".", ",")) : "0,00"}" required autofocus></label>
    <label class="field"><span>Date</span><input name="on" type="date" value="${todayIso()}" max="${todayIso()}" required></label>
    <label class="field"><span>Source (facultatif)</span><input name="note" placeholder="BrickEconomy, 2ememain, Vinted…" maxlength="120"></label>
    <div class="dlg-actions">
      <button value="cancel" class="btn ghost" formnovalidate>Annuler</button>
      <button value="ok" class="btn primary">Enregistrer</button>
    </div></form>`;
  dlg.onclose = async () => {
    if (dlg.returnValue !== "ok") return;
    const fd = new FormData($("#manual-form"));
    const value = parseAmount(fd.get("value"));
    if (value == null || Number.isNaN(value) || value < 0) return toast("Valeur invalide", "error");
    try {
      await S.store.addManualValue({ setNo: p.setNo, condition: p.condition, on: fd.get("on"), value, note: String(fd.get("note") || "").trim() });
      await reload();
      toast("Valeur enregistrée");
    } catch (e) { toast(e.message, "error"); }
  };
  dlg.returnValue = "";
  dlg.showModal();
}

// ---------- Événements ------------------------------------------------------------
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.tagName === "SELECT") return;
  const a = el.dataset.action;
  if (a === "filter") { S.filter = el.dataset.v; render(); }
  else if (a === "refresh") refreshPrices();
  else if (a === "lookup") lookup();
  else if (a === "manual") manualDialog(purchase(el.dataset.id));
  else if (a === "del-manual") {
    if (!(await confirmDialog("Supprimer cette valeur encodée ?", "Supprimer"))) return;
    try { await S.store.deleteManualValue(el.dataset.id); await reload(); toast("Valeur supprimée"); }
    catch (err) { toast(err.message, "error"); }
  }
  else if (a === "invoice-view") viewInvoice(purchase(el.dataset.id));
  else if (a === "invoice-del") {
    if (!(await confirmDialog("Supprimer la facture jointe à cet achat ?", "Supprimer"))) return;
    try { await S.store.removeInvoice(purchase(el.dataset.id)); await reload(); toast("Facture supprimée"); }
    catch (err) { toast(err.message, "error"); }
  }
  else if (a === "scan-item") { readForm(); applyScan(Number(el.dataset.i)); render(); if (S.draft.setNo && !S.draft.found) lookup(); }
  else if (a === "scan-again") pickInvoice(S.draft.invoiceFile, true);
  else if (a === "draft-file-clear") { readForm(); Object.assign(S.draft, { invoiceFile: null, scanItem: null, scanError: null }); render(); }
  else if (a === "toggle-sold") $("#sold-fields").classList.toggle("hidden", !el.checked);
  else if (a === "delete") {
    if (!(await confirmDialog("Supprimer cet achat, son historique et sa facture ?", "Supprimer"))) return;
    try { await S.store.deletePurchase(el.dataset.id); S.draft = null; await reload(); go("#/"); toast("Achat supprimé"); }
    catch (err) { toast(err.message, "error"); }
  }
  else if (a === "export") {
    download(`brickfolio-${todayIso()}.csv`, toCSV(S.data.purchases, S.data.prices, S.data.sets));
  }
  else if (a === "logout") {
    if (!(await confirmDialog("Se déconnecter de Brickfolio ?", "Se déconnecter", false))) return;
    await S.store.signOut(); S.data = null; render();
  }
  else if (a === "reset-demo") {
    if (!(await confirmDialog("Remplacer tes données de démo par l'exemple de départ ?", "Réinitialiser"))) return;
    S.store.reset(); await reload(); go("#/");
  }
});

document.addEventListener("change", (e) => {
  if (e.target.dataset.action === "scan-file" || e.target.dataset.action === "attach-file") {
    pickInvoice(e.target.files[0], e.target.dataset.action === "scan-file"); return;
  }
  if (e.target.dataset.action === "invoice-file") { attachInvoice(purchase(e.target.dataset.id), e.target.files[0]); e.target.value = ""; return; }
  if (e.target.dataset.action === "sort") {
    S.sort = e.target.value;
    try { localStorage.setItem("brickfolio-sort", S.sort); } catch { /* sans importance */ }
    render();
  }
});

document.addEventListener("submit", async (e) => {
  if (e.target.method === "dialog") return; // fenêtres de dialogue : le navigateur les ferme lui-même
  e.preventDefault();
  if (e.target.id === "purchase-form") savePurchase();
  else if (e.target.id === "login-form") {
    const fd = new FormData(e.target);
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try { await S.store.signIn(fd.get("email"), fd.get("password")); await reload(); }
    catch (err) { toast(err.message, "error"); btn.disabled = false; }
  }
});

// Touche Entrée dans le numéro de set : chercher plutôt qu'enregistrer.
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.name === "setNo" && $('[data-action="lookup"]')) { e.preventDefault(); lookup(); }
});

if ("serviceWorker" in navigator && !inFrame() && location.protocol === "https:") {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js").then((reg) => reg.update()).catch(() => {});
  // Nouvelle version publiée : on recharge, sauf au milieu d'un formulaire (elle sera prise au prochain passage).
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController && !S.draft && !$("#dialog")?.open) location.reload();
  });
}

boot();
