// Stockage en ligne : Supabase (compte e-mail, base de données, fonction « bricklink »).
// Même interface que store-demo.js.
import { CONFIG } from "./config.js";

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("Bibliothèque Supabase introuvable"));
    document.head.appendChild(s);
  });
}

const CACHE = "brickfolio-cache"; // dernières données connues, pour consulter hors ligne
const readJSON = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage plein */ } };

const translate = (m) => {
  if (/Invalid login credentials/i.test(m)) return "E-mail ou mot de passe incorrect";
  if (/row-level security/i.test(m)) return "Ce compte n'est pas autorisé (ajoute son e-mail dans la table owners)";
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Pas de réseau";
  return m;
};

const toRow = (p) => ({
  id: p.id, set_no: p.setNo, condition: p.condition, qty: p.qty, unit_price: p.unitPrice, fees: p.fees || 0,
  bought_on: p.date, shop: p.shop || null, notes: p.notes || null,
  sold_price: p.soldPrice ?? null, sold_on: p.soldPrice != null ? p.soldDate || null : null,
});
const fromRow = (r) => ({
  id: r.id, setNo: r.set_no, condition: r.condition, qty: r.qty, unitPrice: Number(r.unit_price), fees: Number(r.fees) || 0,
  date: r.bought_on, shop: r.shop || "", notes: r.notes || "",
  soldPrice: r.sold_price == null ? null : Number(r.sold_price), soldDate: r.sold_on || null,
});
const n = (v) => (v == null ? null : Number(v));
const priceFromRow = (r) => ({
  setNo: r.set_no, condition: r.condition, on: r.fetched_on,
  avgSold: n(r.avg_sold), minSold: n(r.min_sold), maxSold: n(r.max_sold), qtySold: r.qty_sold,
  avgStock: n(r.avg_stock), minStock: n(r.min_stock), qtyStock: r.qty_stock,
});
const setFromRow = (r) => ({ setNo: r.set_no, name: r.name, year: r.year, image: r.image_url });

export async function createSupabaseStore() {
  if (!window.supabase) await loadScript("js/vendor/supabase.js");
  const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  let session = null;

  const must = ({ data, error }) => {
    if (error) throw new Error(translate(error.message));
    return data;
  };

  async function call(body) {
    const { data, error } = await sb.functions.invoke("bricklink", { body });
    if (error) {
      let msg = error.message;
      try { msg = (await error.context.json()).error || msg; } catch { /* corps illisible */ }
      throw new Error(translate(msg));
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  return {
    mode: "online",
    async init() {
      session = (await sb.auth.getSession()).data.session;
    },
    account: () => (session ? { email: session.user.email } : null),
    async signIn(email, password) {
      session = must(await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })).session;
      if (!must(await sb.rpc("is_owner"))) {
        await sb.auth.signOut(); session = null;
        throw new Error("Ce compte n'est pas autorisé : ajoute son e-mail dans la table owners");
      }
    },
    async signOut() { await sb.auth.signOut(); session = null; localStorage.removeItem(CACHE); },

    async loadAll() {
      try {
        const [purchases, prices, sets, runs] = await Promise.all([
          sb.from("purchases").select("*").order("bought_on", { ascending: false }),
          sb.from("prices").select("*").order("fetched_on"),
          sb.from("sets").select("*"),
          sb.from("runs").select("*").order("id", { ascending: false }).limit(1),
        ]);
        const data = {
          purchases: must(purchases).map(fromRow),
          prices: must(prices).map(priceFromRow),
          sets: Object.fromEntries(must(sets).map((r) => [r.set_no, setFromRow(r)])),
          lastRun: must(runs)[0] || null,
        };
        writeJSON(CACHE, data);
        return data;
      } catch (e) {
        const cached = readJSON(CACHE, null);
        if (cached) return { ...cached, offline: true };
        throw e;
      }
    },

    async savePurchase(p) {
      const row = must(await sb.from("purchases").upsert(toRow(p)).select().single());
      return fromRow(row);
    },
    async deletePurchase(id) { must(await sb.from("purchases").delete().eq("id", id)); },

    async lookupSet(setNo) {
      const { set } = await call({ action: "lookup", set_no: setNo });
      return set ? setFromRow(set) : null;
    },
    async refreshPrices() {
      return await call({ action: "refresh" });
    },
  };
}
