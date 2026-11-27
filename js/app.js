// Brickfolio — application principale (navigation, écrans, actions).
import { CONFIG } from "./config.js";
import { createDemoStore } from "./store-demo.js";
import { icon } from "./icons.js";
import { lineChart } from "./chart.js";
import { esc, uuid, fmtEur, fmtSigned, fmtPct, tone, fmtDate, todayIso, parseAmount, toast, confirmDialog, download } from "./util.js";
import {
  CONDITIONS, normalizeSetNo, isSold, position, positionHistory, portfolioHistory,
  pricesFor, unitValue, valueSource, SORTS, toCSV, analyze, stats, filterRows, sortRows, trends, splitSale, cost,
  setStatus, vsRetail, refreshSummary,
} from "./invest.js";

const VERSION = "0.8.1";
// Factures acceptées : PDF ou photo, 10 Mo au plus.
const INVOICE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const INVOICE_MAX = 10 * 1024 * 1024;
const $ = (s, root = document) => root.querySelector(s);
const inFrame = () => { try { return window.self !== window.top; } catch { return true; } };

const S = {
  store: null,
  data: null,
  filter: "held",   // held | sold | all
  sort: ((s) => (s && s !== "proj" ? s : "gain"))(localStorage.getItem("brickfolio-sort")),
  // Filtres du tableau de bord (gardés dans ce navigateur)
  f: (() => { try { return JSON.parse(localStorage.getItem("brickfolio-filters")) || {}; } catch { return {}; } })(),
  filtersOpen: false,
  draft: null,      // brouillon du formulaire d'achat
  scan: null,       // dernière facture lue : { file, invoice, used: Set des lignes déjà enregistrées }
  busy: false,      // relevé des prix en cours
};

const setOf = (no) => S.data.sets[no] || null;
const nameOf = (no) => setOf(no)?.name || no;
// Nom affiché d'un achat : celui choisi (facture ou saisie), sinon le catalogue BrickLink, sinon le numéro.
const pName = (p) => (p.name || "").trim() || setOf(p.setNo)?.name || p.setNo;
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
const FILTER_KEYS = ["q", "cond", "shop", "year", "perf", "trend", "status"];
const saveFilters = () => { try { localStorage.setItem("brickfolio-filters", JSON.stringify(S.f)); } catch { /* sans importance */ } };
const activeFilters = () => FILTER_KEYS.filter((k) => S.f[k]).length;

// Toutes les lignes analysées (situation, tendances passées), puis statut, filtres et tri.
function allRows() { return S.data.purchases.map((p) => ({ ...analyze(p, S.data.prices, S.data.sets), name: pName(p) })); }
function viewRows(rows) {
  const byStatus = rows.filter((r) => (S.filter === "all" ? true : S.filter === "sold" ? r.pos.sold : !r.pos.sold));
  return sortRows(filterRows(byStatus, S.f), S.sort, !!S.f.reverse);
}

const PERIODS = { m3: ["3 mois", 91], y1: ["1 an", 365], all: ["Tout", null] };
const cutoff = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); };
const pctTag = (x, label = "") => (x == null ? "" : `<span class="trend ${tone(x)}">${x > 0.0005 ? "↗" : x < -0.0005 ? "↘" : "→"} ${fmtPct(x)}${label ? ` <em>${label}</em>` : ""}</span>`);
const days2txt = (d) => (d == null ? "—" : d < 60 ? `${d} j` : d < 730 ? `${Math.round(d / 30.4)} mois` : `${(d / 365).toFixed(1).replace(".", ",")} ans`);

function viewPortfolio() {
  const { purchases, prices, lastRun } = S.data;
  if (!purchases.length) {
    return `${top("Portefeuille")}
      <div class="empty">${icon("brick", 48)}<p><strong>Aucun achat enregistré</strong></p>
      <p class="muted">Ajoute ton premier set : sa valeur sera relevée sur BrickLink chaque semaine.</p>
      <a class="btn primary" href="#/p/new">${icon("plus")} Ajouter un achat</a></div>`;
  }
  const all = allRows();
  const g = stats(all); // tout le portefeuille, sans filtres
  const gain = g.held.value - g.held.invested;
  const period = PERIODS[S.f.period] ? S.f.period : "all";
  let hist = portfolioHistory(purchases, prices, S.data.sets);
  if (PERIODS[period][1]) hist = hist.filter((h) => h.on >= cutoff(PERIODS[period][1]));
  // Prix LEGO d'origine du stock : affiché seulement si toutes les boîtes en ont un (sinon la comparaison tromperait)
  const retail = hist.length && hist.every((h) => h.retail != null) ? hist.map((h) => ({ on: h.on, value: h.retail })) : null;
  const chartView = S.f.chart === "value" ? "value" : "gain"; // plus-value par défaut
  const gainView = chartView === "gain";
  // Avant le premier relevé de prix, la plus-value latente est inconnue (pas nulle) : la courbe commence au premier prix connu.
  const firstPrice = prices.reduce((m, r) => (!m || r.on < m ? r.on : m), null);
  const gainHist = firstPrice ? hist.filter((h) => h.on >= firstPrice) : [];
  const hasSales = gainHist.some((h) => h.realized);
  const total = gain + g.sold.profit; // plus-value latente + réalisée
  const totalBase = g.held.invested + (g.sold.cost || 0);
  const totalPct = totalBase ? total / totalBase : null;
  const rows = viewRows(all);
  const st = stats(rows);
  const counts = { held: all.filter((r) => !r.pos.sold).length, sold: all.filter((r) => r.pos.sold).length };
  const nf = activeFilters();
  const shops = [...new Set(purchases.map((p) => p.shop).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  const years = [...new Set(purchases.map((p) => p.date.slice(0, 4)))].sort().reverse();
  const opt = (key, value, label) => `<option value="${esc(value)}" ${String(S.f[key] || "") === String(value) ? "selected" : ""}>${esc(label)}</option>`;
  const sel = (key, label, options) => `<label class="field"><span>${label}</span><select data-f="${key}">${options}</select></label>`;

  return `${top("Portefeuille", { sub: lastRun?.finished_at ? `Prix du ${fmtDate(lastRun.finished_at)}${S.data.offline ? " · hors ligne" : ""}` : "Aucun relevé de prix pour l'instant",
      actions: `<button class="icon-btn" data-action="refresh" aria-label="${S.busy ? "Relevé en cours" : "Mettre à jour les prix"}" ${S.busy ? "disabled aria-busy=\"true\"" : ""}><span class="${S.busy ? "spin" : ""}">${icon("refresh")}</span></button>` })}
    <section class="hero">
      <div class="hero-top">
        <div>
          <span class="kicker">Plus-value totale</span>
          <strong class="big-num">${fmtSigned(total)}</strong>
          <span class="pill ${tone(total)}">${fmtPct(totalPct)}</span>
          <span class="hero-sub">latente ${fmtSigned(gain)} · réalisée ${fmtSigned(g.sold.profit)}</span>
        </div>
        <span class="studs" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      </div>
      ${gainView
        ? lineChart({ main: gainHist.map((h) => ({ on: h.on, value: h.gain })), ref: hasSales ? gainHist.map((h) => ({ on: h.on, value: h.realized })) : null,
            up: (gainHist.at(-1)?.gain ?? 0) >= 0, signed: true, label: "Plus-value du portefeuille (latente et réalisée)", names: ["Plus-value", "dont réalisée"] })
        : lineChart({ main: hist.map((h) => ({ on: h.on, value: h.value })), ref: hist.map((h) => ({ on: h.on, value: h.invested })), retail, up: gain >= 0, label: "Valeur du portefeuille" })}
      <div class="legend">${gainView
        ? `<i class="lg-line"></i>Plus-value${hasSales ? ` <i class="lg-ref"></i>dont réalisée` : ""}`
        : `<i class="lg-line"></i>Valeur <i class="lg-ref"></i>Investi${retail ? ` <i class="lg-retail"></i>Prix LEGO` : ""}`}</div>
      <div class="chips period">${[["gain", "Plus-value"], ["value", "Valeur"]].map(([k, l]) => `<button class="chip ${chartView === k ? "on" : ""}" data-action="chart-view" data-v="${k}">${l}</button>`).join("")}<span class="chips-sep"></span>${Object.entries(PERIODS).map(([k, [l]]) => `<button class="chip ${period === k ? "on" : ""}" data-action="period" data-v="${k}">${l}</button>`).join("")}</div>
      <div class="hero-grid">
        <div><span>Valeur du stock</span><strong>${fmtEur(g.held.value)}</strong></div>
        <div><span>Investi</span><strong>${fmtEur(g.held.invested)}</strong></div>
        <div><span>Boîtes</span><strong>${g.held.boxes}</strong></div>
        <div><span>Tendance 3 mois</span><strong class="${tone(g.held.m3?.pct)}">${fmtPct(g.held.m3?.pct)}</strong></div>
        <div><span>Tendance 1 an</span><strong class="${tone(g.held.y1?.pct)}">${fmtPct(g.held.y1?.pct)}</strong></div>
        <div><span>Ventes</span><strong>${g.sold.count}</strong></div>
      </div>
      ${g.held.unpriced ? `<p class="hero-note">${g.held.unpriced} set(s) sans prix encore : comptés à leur prix d'achat.</p>` : ""}
    </section>

    <div class="seg view-seg" role="tablist">
      ${[["held", `En stock (${counts.held})`], ["sold", `Vendus (${counts.sold})`], ["all", "Tout"]]
        .map(([k, l]) => `<button data-action="filter" data-v="${k}" class="${S.filter === k ? "on" : ""}">${l}</button>`).join("")}
    </div>

    <details class="panel filters" ${S.filtersOpen || nf ? "open" : ""}>
      <summary><span>${icon("search", 18)} Filtres${nf ? ` <b class="badge">${nf}</b>` : ""}</span>${nf ? `<button class="btn ghost small" data-action="reset-filters">Effacer</button>` : ""}</summary>
      <div class="filter-grid">
        <label class="field wide"><span>Rechercher</span><input data-f="q" type="search" value="${esc(S.f.q || "")}" placeholder="Nom, numéro, boutique, note…" autocomplete="off"></label>
        ${sel("cond", "État", opt("cond", "", "Tous") + Object.entries(CONDITIONS).map(([k, l]) => opt("cond", k, l)).join(""))}
        ${sel("shop", "Boutique", opt("shop", "", "Toutes") + shops.map((x) => opt("shop", x, x)).join(""))}
        ${sel("year", "Acheté en", opt("year", "", "Toutes") + years.map((y) => opt("year", y, y)).join(""))}
        ${sel("perf", "Résultat", opt("perf", "", "Tous") + opt("perf", "gain", "En gain") + opt("perf", "loss", "En perte") + opt("perf", "unpriced", "Sans prix"))}
        ${sel("trend", "Tendance 3 mois", opt("trend", "", "Toutes") + opt("trend", "up", "En hausse") + opt("trend", "down", "En baisse"))}
        ${sel("status", "Chez LEGO", opt("status", "", "Tous") + opt("status", "retired", "Retirés") + opt("status", "available", "Encore en vente"))}
      </div>
    </details>

    ${S.filter !== "sold" ? panelHeld(st.held, nf) : ""}
    ${S.filter !== "held" ? panelSold(st.sold, nf) : ""}

    <div class="list-head">
      <span class="muted small">${rows.length} achat${rows.length > 1 ? "s" : ""}</span>
      <div class="sort">
        <select data-action="sort" aria-label="Trier par">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${S.sort === k ? "selected" : ""}>${v.label}</option>`).join("")}</select>
        <button class="icon-btn mini" data-action="reverse" aria-label="Inverser l'ordre" title="Inverser l'ordre">${S.f.reverse ? "↑" : "↓"}</button>
      </div>
    </div>
    <ul class="positions grid">${rows.map(rowHtml).join("") || `<li class="muted center pad">Aucun achat ne correspond${nf ? ` aux filtres. <button class="link" data-action="reset-filters">Effacer les filtres</button>` : "."}</li>`}</ul>
    <a class="fab" href="#/p/new" aria-label="Ajouter un achat">${icon("plus", 28)}</a>`;
}

// Potentiel du stock affiché (après filtres)
function panelHeld(h, filtered) {
  if (!h.count) return "";
  const link = (r) => `<a href="#/p/${r.p.id}">${esc(r.name || r.p.setNo)}</a>`;
  const mini = (list, key) => list.map((r) => `<li>${link(r)} ${pctTag(r.t.m3.pct)}</li>`).join("");
  return `<section class="panel">
    <h2>Potentiel du stock${filtered ? " <span class=\"muted small\">(filtré)</span>" : ""}</h2>
    <div class="kpis">
      <div><span>Plus-value latente</span><strong class="${tone(h.latent)}">${fmtSigned(h.latent)}</strong><em>${fmtPct(h.pct)} sur ${fmtEur(h.invested)}</em></div>
      <div><span>Valeur du stock</span><strong>${fmtEur(h.value)}</strong><em>investi ${fmtEur(h.invested)}</em></div>
      <div><span>En gain / en perte</span><strong><b class="up">${h.winners}</b> / <b class="down">${h.losers}</b></strong><em>${h.unpriced ? `${h.unpriced} sans prix` : `${h.count} set(s), ${h.boxes} boîte(s)`}</em></div>
      <div><span>Tendance du stock</span><strong class="${tone(h.m3?.pct)}">${fmtPct(h.m3?.pct)}</strong><em>3 mois · 1 an : ${fmtPct(h.y1?.pct)}</em></div>
    </div>
    ${h.best || h.worst ? `<p class="small best-worst">${h.best ? `Meilleur : ${link(h.best)} <b class="${tone(h.best.pos.pct)}">${fmtPct(h.best.pos.pct)}</b>` : ""}${h.worst && h.worst !== h.best ? ` · Moins bon : ${link(h.worst)} <b class="${tone(h.worst.pos.pct)}">${fmtPct(h.worst.pos.pct)}</b>` : ""}</p>` : ""}
    ${h.rising.length || h.falling.length ? `<div class="movers">
      ${h.rising.length ? `<div><h3>Ça monte (3 mois)</h3><ul>${mini(h.rising)}</ul></div>` : ""}
      ${h.falling.length ? `<div><h3>Ça baisse (3 mois)</h3><ul>${mini(h.falling)}</ul></div>` : ""}
    </div>` : ""}
  </section>`;
}

// Bénéfices des ventes affichées (après filtres)
function panelSold(v, filtered) {
  if (!v.count) return S.filter === "sold" ? `<section class="panel"><h2>Ventes</h2><p class="muted small">Aucune vente${filtered ? " avec ces filtres" : " enregistrée"}. Sur la fiche d'un set, « Vendu » enregistre le prix de vente.</p></section>` : "";
  const link = (r) => `<a href="#/p/${r.p.id}">${esc(r.name || r.p.setNo)}</a>`;
  return `<section class="panel">
    <h2>Ventes${filtered ? " <span class=\"muted small\">(filtré)</span>" : ""}</h2>
    <div class="kpis">
      <div><span>Bénéfice réalisé</span><strong class="${tone(v.profit)}">${fmtSigned(v.profit)}</strong><em>${fmtPct(v.pct)} sur ${fmtEur(v.cost)}</em></div>
      <div><span>Encaissé</span><strong>${fmtEur(v.revenue)}</strong><em>${v.count} vente(s)</em></div>
      <div><span>Détention moyenne</span><strong>${days2txt(v.avgDays)}</strong><em>de l'achat à la vente</em></div>
      <div><span>Meilleure vente</span><strong class="${tone(v.best?.pos.gain)}">${fmtSigned(v.best?.pos.gain)}</strong><em>${v.best ? link(v.best) : "—"}</em></div>
    </div>
    ${v.byYear.length > 1 || (v.byYear[0] && v.byYear[0].count > 1) ? `<table class="hist years"><thead><tr><th>Année</th><th>Ventes</th><th>Encaissé</th><th>Bénéfice</th></tr></thead><tbody>
      ${v.byYear.map((y) => `<tr><td>${esc(y.year)}</td><td>${y.count}</td><td>${fmtEur(y.revenue)}</td><td class="${tone(y.profit)}">${fmtSigned(y.profit)} <span class="muted small">${fmtPct(y.cost ? y.profit / y.cost : null)}</span></td></tr>`).join("")}
    </tbody></table>` : ""}
  </section>`;
}

function rowHtml(r) {
  const { p, pos, name, t } = r;
  // Colonne de droite : selon le tri choisi
  let main = pos.priced ? fmtEur(pos.value) : "—", sub = pos.priced ? `<span class="small ${tone(pos.pct)}">${fmtPct(pos.pct)}</span>` : `<span class="small muted">en attente</span>`;
  if (S.sort === "gain" || S.sort === "pct") { main = `<span class="${tone(pos.gain)}">${fmtSigned(pos.gain)}</span>`; sub = `<span class="small ${tone(pos.pct)}">${fmtPct(pos.pct)}</span>`; }
  if (S.sort === "cagr") { main = `<span class="${tone(pos.cagr)}">${fmtPct(pos.cagr)}</span>`; sub = `<span class="small muted">par an</span>`; }
  if (S.sort === "cost") { main = fmtEur(pos.cost); sub = `<span class="small muted">coût</span>`; }
  if (S.sort === "trend3" || S.sort === "trend12") { const x = S.sort === "trend3" ? t.m3 : t.y1; main = `<span class="${tone(x?.pct)}">${fmtPct(x?.pct)}</span>`; sub = `<span class="small muted">${S.sort === "trend3" ? "3 mois" : "1 an"}</span>`; }
  if (S.sort === "held") { main = days2txt(r.heldDays); sub = `<span class="small muted">${pos.sold ? "détenu" : "en stock"}</span>`; }
  if (pos.sold && !["cagr", "held", "trend3", "trend12"].includes(S.sort)) { main = `<span class="${tone(pos.gain)}">${fmtSigned(pos.gain)}</span>`; sub = `<span class="small muted">vendu ${fmtEur(pos.value)}</span>`; }
  const badge = r.status === "retired" ? `<span class="tag retired">retiré</span>` : r.status === "retiring" ? `<span class="tag retiring">retrait annoncé</span>` : pos.sold ? `<span class="tag sold">vendu</span>` : "";
  return `<li><a class="card" href="#/p/${p.id}">
    <span class="card-img" style="--tint:${tint(p.setNo)}">${thumb(p.setNo, "fill")}${badge}</span>
    <strong class="card-name">${esc(name)}</strong>
    <span class="card-info">${[esc(p.setNo), p.qty > 1 ? `×${p.qty}` : "", p.condition !== "N" ? CONDITIONS[p.condition] : ""].filter(Boolean).join(" · ")}</span>
    <span class="card-val"><strong>${main}</strong>${sub}</span>
  </a></li>`;
}

// Fond pastel de la vignette, stable pour un même set (jaune, bleu, rouge, vert, orange, violet).
const TINTS = ["#fff4cc", "#e3ecf8", "#fbe4df", "#e2f1e5", "#fde9d4", "#ece6f6"];
function tint(no) { let h = 0; for (const c of String(no)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return TINTS[h % TINTS.length]; }

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
  const status = setStatus(set);

  return `${top(pName(p), { back: "#/", sub: `${esc(p.setNo)}${set?.year ? ` · ${set.year}` : ""} · ${CONDITIONS[p.condition]}`,
      actions: `<a class="icon-btn" href="#/p/${p.id}/edit" aria-label="Modifier">${icon("edit")}</a>` })}
    <div class="showcase" style="--tint:${tint(p.setNo)}">
      ${thumb(p.setNo, "fill")}
      <span class="showcase-tags">${status === "retired" ? `<span class="tag retired">retiré</span>` : status === "retiring" ? `<span class="tag retiring">retrait annoncé</span>` : ""}${pos.sold ? `<span class="tag sold">vendu</span>` : ""}${p.qty > 1 ? `<span class="tag qty">×${p.qty}</span>` : ""}</span>
    </div>
    <section class="hero detail-hero">
      <div class="hero-top">
        <div>
          <span class="kicker">${pos.sold ? "Plus-value réalisée" : "Plus-value latente"}</span>
          <strong class="big-num">${pos.priced ? fmtSigned(pos.gain) : "—"}</strong>
          ${pos.priced ? `<span class="pill ${tone(pos.gain)}">${fmtPct(pos.pct)}</span>` : ""}
          <span class="hero-sub">${pos.priced ? `${pos.sold ? "vendu" : "vaut"} ${fmtEur(pos.value)} · coût ${fmtEur(pos.cost)}` : "En attente du premier relevé de prix"}</span>
        </div>
        <span class="studs" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      </div>
      ${lineChart({ main: hist, ref: hist.length > 1 ? [{ on: hist[0].on, value: pos.cost }, { on: hist.at(-1).on, value: pos.cost }] : null,
        retail: set?.rrp && hist.length > 1 ? [{ on: hist[0].on, value: set.rrp * (Number(p.qty) || 1) }, { on: hist.at(-1).on, value: set.rrp * (Number(p.qty) || 1) }] : null,
        up: (pos.gain ?? 0) >= 0, label: "Valeur de la position",
        names: ["Valeur", "Coût", "Prix LEGO"], marks: pos.sold ? [{ on: p.soldDate, text: "vente" }] : [] })}
      <div class="legend"><i class="lg-line"></i>Valeur de ta position <i class="lg-ref"></i>Coût${set?.rrp ? ` <i class="lg-retail"></i>Prix LEGO` : ""}</div>
      <div class="hero-grid two">
        <div><span>Coût total</span><strong>${fmtEur(pos.cost, 2)}</strong><em>${p.qty} × ${fmtEur(p.unitPrice, 2)}${p.fees ? ` + ${fmtEur(p.fees, 2)} de frais` : ""}</em></div>
        <div><span>Valeur par boîte</span><strong>${pos.unit != null ? fmtEur(pos.unit, 2) : "—"}</strong><em>${src === "manuel" ? `valeur encodée le ${fmtDate(last.on)}` : src ? `moyenne des ${src} BrickLink` : pos.sold ? "—" : "pas encore de prix"}</em></div>
        <div><span>Rendement annualisé</span><strong class="${tone(pos.cagr)}">${fmtPct(pos.cagr)}</strong><em>${pos.cagr == null ? "après 6 mois de détention" : `depuis le ${fmtDate(p.date)}`}</em></div>
        <div><span>${pos.sold ? "Vendu le" : "Acheté le"}</span><strong>${fmtDate(pos.sold ? p.soldDate : p.date)}</strong><em>${esc(pos.sold ? `acheté le ${fmtDate(p.date)}` : p.shop || "")}</em></div>
      </div>
    </section>
    ${marketChart(p, rows)}
    ${trendPanel(p, pos)}
    ${legoPanel(p, set, pos)}
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
      ${pos.sold ? "" : `<button class="btn primary" data-action="sell" data-id="${p.id}">${icon("tag", 18)} Vendre${p.qty > 1 ? "…" : ""}</button>`}
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
    <p class="muted small">${esc(pName(p))} · ${esc(p.invoiceName || "")}</p>
    ${isPdf ? `<div class="invoice-pdf">${icon("file", 48)}</div>` : `<img class="invoice-img" src="${esc(url)}" alt="Facture">`}
    <div class="dlg-actions">
      <button value="cancel" class="btn ghost">Fermer</button>
      <a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener">${icon("external", 18)} Ouvrir</a>
    </div></form>`;
  dlg.onclose = () => { if (url.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(url), 60000); };
  dlg.returnValue = "";
  dlg.showModal();
}

// Prix d'une boîte sur le marché depuis le premier relevé (y compris avant l'achat), avec le prix payé.
function marketChart(p, rows) {
  const pts = rows.map((r) => ({ on: r.on, value: unitValue(r) }));
  if (new Set(pts.map((x) => x.on)).size < 2) return "";
  const paid = Number(p.unitPrice) + (Number(p.fees) || 0) / (Number(p.qty) || 1);
  const marks = [{ on: p.date, text: "achat" }, ...(isSold(p) ? [{ on: p.soldDate, text: "vente" }] : [])];
  const up = pts.at(-1).value >= paid;
  const rrp = setOf(p.setNo)?.rrp;
  return `<section class="panel">
    <div class="panel-head"><h2>Prix d'une boîte</h2><span class="legend"><i class="lg-line"></i>Marché <i class="lg-ref"></i>Payé${rrp ? ` <i class="lg-retail"></i>Prix LEGO` : ""}</span></div>
    ${lineChart({ main: pts, ref: [{ on: pts[0].on, value: paid }, { on: pts.at(-1).on, value: paid }],
      retail: rrp ? [{ on: pts[0].on, value: rrp }, { on: pts.at(-1).on, value: rrp }] : null,
      up, label: "Prix d'une boîte sur le marché", names: ["Marché", "Payé", "Prix LEGO"], marks })}
    <p class="muted tiny chart-hint">Depuis le premier relevé${pts[0].on < p.date ? ", avant et après ton achat" : ""} · prix payé par boîte : ${fmtEur(paid, 2)}${p.fees ? " (frais compris)" : ""}${rrp ? ` · prix LEGO d'origine : ${fmtEur(rrp, 2)}` : ""}.</p>
  </section>`;
}

// Fiche LEGO (Brickset) : prix d'origine, sortie, retrait, thème, pièces.
function legoPanel(p, set, pos) {
  if (!set || !(set.rrp || set.launchDate || set.exitDate || set.theme)) return "";
  const st = setStatus(set);
  const cmp = vsRetail(p, set, pos.unit);
  const statusTxt = st === "retired" ? `Retiré depuis le ${fmtDate(set.exitDate)}` : st === "retiring" ? `Retrait prévu le ${fmtDate(set.exitDate)}` : st === "available" ? "Encore en vente" : "—";
  return `<section class="panel">
    <div class="panel-head"><h2>Fiche LEGO</h2>${set.bricksetUrl ? `<a class="btn ghost small" href="${esc(set.bricksetUrl)}" target="_blank" rel="noopener">Brickset ↗</a>` : ""}</div>
    <div class="stats lego">
      <div><span>Prix LEGO d'origine</span><strong>${set.rrp ? fmtEur(set.rrp, 2) : "—"}</strong><em>${cmp ? `payé ${fmtPct(cmp.paid)}${cmp.paid < 0 ? " (remise)" : ""}` : "prix allemand, LEGO.com"}</em></div>
      <div><span>Valeur / prix d'origine</span><strong class="${tone(cmp?.value)}">${cmp?.value != null ? fmtPct(cmp.value) : "—"}</strong><em>${cmp?.value != null ? `${fmtEur(pos.unit, 2)} la boîte` : "en attente d'un prix"}</em></div>
      <div><span>Chez LEGO</span><strong class="${st === "retired" ? "up" : ""}">${st === "retired" ? "Retiré" : st === "retiring" ? "Bientôt retiré" : st === "available" ? "En vente" : "—"}</strong><em>${esc(statusTxt)}</em></div>
      <div><span>Sorti le</span><strong>${set.launchDate ? fmtDate(set.launchDate) : set.year || "—"}</strong><em>${esc([set.theme, set.pieces ? `${set.pieces.toLocaleString("fr-BE")} pièces` : "", set.minifigs ? `${set.minifigs} minifig${set.minifigs > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · "))}</em></div>
    </div>
  </section>`;
}

function trendPanel(p, pos) {
  const t = trends(S.data.prices, p.setNo, p.condition);
  if (!t.m3 && !t.y1) return "";
  return `<section class="panel stats">
    <div><span>Tendance 3 mois</span><strong class="${tone(t.m3?.pct)}">${fmtPct(t.m3?.pct)}</strong><em>${t.m3 ? `${fmtEur(t.m3.from, 2)} → ${fmtEur(t.m3.to, 2)} la boîte` : "pas assez de relevés"}</em></div>
    <div><span>Tendance 1 an</span><strong class="${tone(t.y1?.pct)}">${fmtPct(t.y1?.pct)}</strong><em>${t.y1 ? `depuis le ${fmtDate(t.y1.since)}` : "pas assez de relevés"}</em></div>
  </section>`;
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
      <label class="field"><span>Nom du set <em class="opt">facultatif</em></span><input name="name" value="${esc(d.name || "")}" placeholder="${esc(d.found?.name || "ex. Faucon Millenium UCS")}" maxlength="120">
        <span class="hint">Affiché dans le portefeuille ; sinon le nom du catalogue BrickLink est utilisé.</span></label>
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

const newDraft = () => ({ id: "new", setNo: "", name: "", condition: "N", qty: 1, unitPrice: "", fees: "", date: todayIso(), shop: "", notes: "",
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
// Nom lu sur la facture, sans « LEGO® » ni gamme en tête si un nom suit (« LEGO Star Wars UCS Faucon » → garde tout sauf LEGO).
const cleanName = (s) => String(s || "").replace(/\bLEGO\b[®™]?\s*/i, "").replace(/\s+/g, " ").trim().slice(0, 120);

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
  Object.assign(d, { setNo: it.set_no || "", qty: it.qty, unitPrice: it.unit_price ?? "", found: it.set_no ? S.data.sets[it.set_no] || null : null, lookedUp: false, lookupError: null, scanName: it.name || null, name: cleanName(it.name) });
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
    setNo: fd.get("setNo"), name: fd.get("name") ?? S.draft.name, condition: fd.get("condition") || "N", qty: fd.get("qty"), unitPrice: fd.get("unitPrice"),
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
    id: d.id === "new" ? uuid() : d.id, setNo, name: (d.name || "").trim(), condition: d.condition, qty, unitPrice, fees, date: d.date,
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
      <p class="muted small">Le prix LEGO d'origine, les dates de sortie et de retrait, le thème et le nombre de pièces viennent de Brickset (fiche vérifiée tous les 30 jours tant que le set n'est pas retiré).</p>
      <p class="small">${run ? `Dernier relevé : <strong>${fmtDate(run.finished_at || run.started_at)}</strong>${run.message ? `<br><span class="muted">${esc(run.message)}</span>` : ""}` : "Aucun relevé pour l'instant."}</p>
      <button class="btn primary block" data-action="refresh" ${S.busy ? "disabled" : ""}>${S.busy ? `<span class="spin">${icon("refresh", 18)}</span> Relevé BrickLink et Brickset en cours…` : "Mettre à jour maintenant"}</button>
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
  render(); // roue qui tourne pendant le relevé
  if (!silent) toast("Relevé BrickLink et Brickset en cours…", "info", { sticky: true }); // reste affiché jusqu'au résultat
  try {
    const r = await S.store.refreshPrices();
    await reload();
    const sum = refreshSummary(r);
    if (!silent) toast(sum.text, sum.error ? "error" : "info");
    else if (r.bricklink !== false) toast(r.failed ? sum.text : "Prix BrickLink relevé", r.failed ? "error" : "info");
  } catch (e) {
    // Relevé automatique après un nouvel achat : on ne dérange pas si BrickLink n'est pas encore branché.
    if (!silent) toast(e.message, "error");
  } finally {
    S.busy = false;
    render();
  }
}

// ---------- Vente (tout le lot ou une partie) -------------------------------------------
function sellDialog(p) {
  const dlg = $("#dialog");
  if (dlg.open) dlg.close();
  const qty = Number(p.qty) || 1;
  const unit = position(p, S.data.prices).unit;
  dlg.innerHTML = `<form method="dialog" class="dlg" id="sell-form">
    <h2>Vendre</h2>
    <p class="muted small">${esc(pName(p))} · ${qty} boîte${qty > 1 ? "s" : ""} achetée${qty > 1 ? "s" : ""} le ${fmtDate(p.date)}${p.shop ? ` (${esc(p.shop)})` : ""}</p>
    ${qty > 1 ? `<label class="field"><span>Boîtes vendues</span>
      <div class="stepper"><button type="button" class="btn ghost small" data-step="-1" aria-label="Une de moins">−</button>
      <input name="n" type="number" min="1" max="${qty}" step="1" value="${qty}" inputmode="numeric" required>
      <button type="button" class="btn ghost small" data-step="1" aria-label="Une de plus">+</button><span class="muted small">sur ${qty}</span></div></label>` : ""}
    <label class="field"><span>Prix de vente total, net (€)</span><input name="price" inputmode="decimal" placeholder="0,00" required autofocus>
      <span class="hint">Pour les boîtes vendues, après frais d'envoi et commissions.</span></label>
    <label class="field"><span>Date de vente</span><input name="on" type="date" value="${todayIso()}" min="${esc(p.date)}" max="${todayIso()}" required></label>
    <div class="sell-preview" id="sell-preview"></div>
    <div class="dlg-actions">
      <button value="cancel" class="btn ghost" formnovalidate>Annuler</button>
      <button value="ok" class="btn primary">Enregistrer la vente</button>
    </div></form>`;
  const form = $("#sell-form");
  const read = () => {
    const fd = new FormData(form);
    return { n: qty > 1 ? Number(fd.get("n")) : 1, price: parseAmount(fd.get("price")), on: fd.get("on") };
  };
  // Aperçu : coût de ces boîtes (frais au prorata), valeur estimée, bénéfice
  const preview = () => {
    const { n, price } = read();
    if (!(n >= 1 && n <= qty)) { $("#sell-preview").innerHTML = `<p class="warn small">Entre 1 et ${qty} boîtes.</p>`; return; }
    const c = cost({ ...p, qty: n, fees: (Number(p.fees) || 0) * n / qty });
    const est = unit != null ? unit * n : null;
    const gain = price != null && !Number.isNaN(price) ? price - c : null;
    $("#sell-preview").innerHTML = `<div class="kpis">
      <div><span>Coût de ${n > 1 ? "ces boîtes" : "cette boîte"}</span><strong>${fmtEur(c, 2)}</strong></div>
      <div><span>Bénéfice</span><strong class="${tone(gain)}">${gain == null ? "—" : fmtSigned(gain, 2)}</strong><em>${gain == null ? "" : fmtPct(c ? gain / c : null)}</em></div>
    </div>
    ${est != null ? `<p class="muted small">Valeur actuelle estimée : ${fmtEur(est)}${n > 1 ? ` (${fmtEur(unit)} la boîte)` : ""}.</p>` : ""}
    ${qty > 1 && n < qty ? `<p class="muted small">Le lot sera partagé : ${qty - n} boîte${qty - n > 1 ? "s restent" : " reste"} en stock, ${n} passe${n > 1 ? "nt" : ""} en « Vendus ».${p.invoicePath ? " La facture reste jointe aux deux." : ""}</p>` : ""}`;
  };
  form.addEventListener("input", preview);
  form.addEventListener("click", (e) => {
    const b = e.target.closest("[data-step]");
    if (!b) return;
    const inp = form.elements.n;
    inp.value = Math.min(qty, Math.max(1, (Number(inp.value) || 1) + Number(b.dataset.step)));
    preview();
  });
  preview();
  dlg.onclose = null;
  // À l'envoi du formulaire (plus sûr que l'événement de fermeture de la fenêtre)
  form.addEventListener("submit", async (e) => {
    if (e.submitter?.value !== "ok") return;
    const { n, price, on } = read();
    let parts;
    try { parts = splitSale(p, n, price ?? NaN, on, uuid()); } catch (e) { return toast(e.message, "error"); }
    const { kept, sold } = parts;
    try {
      await S.store.savePurchase(sold); // d'abord la vente…
      if (kept) {
        try { await S.store.savePurchase(kept); } // …puis le lot réduit ; en cas d'échec, on annule la vente
        catch (e) { await S.store.deletePurchase(sold.id).catch(() => {}); throw e; }
        if (p.invoicePath) await S.store.linkInvoice(p, sold.id).catch(() => toast("Vente enregistrée, mais la facture n'a pas été recopiée", "error"));
      }
      await reload();
      go(`#/p/${kept ? p.id : sold.id}`);
      toast(kept ? `Vente de ${n} boîte${n > 1 ? "s" : ""} enregistrée · ${kept.qty} en stock` : "Vente enregistrée");
    } catch (e) { toast(e.message, "error"); }
  });
  dlg.returnValue = "";
  dlg.showModal();
}

// ---------- Valeur manuelle ---------------------------------------------------------
function manualDialog(p) {
  const dlg = $("#dialog");
  if (dlg.open) dlg.close();
  const last = position(p, S.data.prices).unit;
  dlg.innerHTML = `<form method="dialog" class="dlg" id="manual-form">
    <h2>Valeur d'une boîte</h2>
    <p class="muted small">${esc(pName(p))} · ${CONDITIONS[p.condition].toLowerCase()}. Elle remplace la valeur actuelle jusqu'au prochain relevé BrickLink plus récent.</p>
    <label class="field"><span>Valeur par boîte (€)</span><input name="value" inputmode="decimal" placeholder="${last != null ? esc(String(last).replace(".", ",")) : "0,00"}" required autofocus></label>
    <label class="field"><span>Date</span><input name="on" type="date" value="${todayIso()}" max="${todayIso()}" required></label>
    <label class="field"><span>Source (facultatif)</span><input name="note" placeholder="BrickEconomy, 2ememain, Vinted…" maxlength="120"></label>
    <div class="dlg-actions">
      <button value="cancel" class="btn ghost" formnovalidate>Annuler</button>
      <button value="ok" class="btn primary">Enregistrer</button>
    </div></form>`;
  dlg.onclose = null;
  $("#manual-form").addEventListener("submit", async (e) => {
    if (e.submitter?.value !== "ok") return;
    const fd = new FormData($("#manual-form"));
    const value = parseAmount(fd.get("value"));
    if (value == null || Number.isNaN(value) || value < 0) return toast("Valeur invalide", "error");
    try {
      await S.store.addManualValue({ setNo: p.setNo, condition: p.condition, on: fd.get("on"), value, note: String(fd.get("note") || "").trim() });
      await reload();
      toast("Valeur enregistrée");
    } catch (e) { toast(e.message, "error"); }
  });
  dlg.returnValue = "";
  dlg.showModal();
}

// ---------- Événements ------------------------------------------------------------
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.tagName === "SELECT") return;
  const a = el.dataset.action;
  if (a === "filter") { S.filter = el.dataset.v; render(); }
  else if (a === "period") { S.f.period = el.dataset.v; saveFilters(); render(); }
  else if (a === "chart-view") { S.f.chart = el.dataset.v; saveFilters(); render(); }
  else if (a === "reverse") { S.f.reverse = !S.f.reverse; saveFilters(); render(); }
  else if (a === "reset-filters") { e.preventDefault(); for (const k of FILTER_KEYS) delete S.f[k]; saveFilters(); render(); }
  else if (a === "refresh") refreshPrices();
  else if (a === "lookup") lookup();
  else if (a === "manual") manualDialog(purchase(el.dataset.id));
  else if (a === "sell") sellDialog(purchase(el.dataset.id));
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

// Filtres : listes (change) et recherche (input, en gardant le curseur dans le champ)
document.addEventListener("input", (e) => {
  const k = e.target.dataset?.f;
  if (k !== "q") return;
  S.f.q = e.target.value; saveFilters();
  const pos = e.target.selectionStart;
  render();
  const el = $('[data-f="q"]');
  if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { /* type search */ } }
});
document.addEventListener("toggle", (e) => { if (e.target.classList?.contains("filters")) S.filtersOpen = e.target.open; }, true);

document.addEventListener("change", (e) => {
  if (e.target.dataset?.f && e.target.dataset.f !== "q") { S.f[e.target.dataset.f] = e.target.value; saveFilters(); render(); return; }
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
