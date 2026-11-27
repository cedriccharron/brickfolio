// @ts-nocheck
// Fichier généré par tests/build-function.mjs (index.ts + bricklink.js) pour l'éditeur Supabase.
// Brickfolio — fonction Supabase « bricklink ».
// Garde les clés BrickLink côté serveur (jamais dans le navigateur).
//
//  POST {"action":"lookup","set_no":"75192-1"}  → fiche du set (nom, année, image), mise en cache dans « sets ».
//  POST {"action":"refresh"}                    → complète les fiches Brickset, puis relève les prix de tous les sets détenus (« prices »).
//
// Appelants autorisés : un compte de la liste public.owners (bouton de l'app), ou la tâche
// planifiée (en-tête x-cron-secret, vérifié dans le coffre Supabase). Déployer avec « Verify JWT » désactivé
// (supabase functions deploy bricklink --no-verify-jwt) : le contrôle d'accès est fait ici.
//
// Secrets (Edge Functions > Secrets) : BRICKLINK_CONSUMER_KEY, BRICKLINK_CONSUMER_SECRET,
// BRICKLINK_TOKEN, BRICKLINK_TOKEN_SECRET ; facultatif : BRICKLINK_REGION (europe).
// Brickset (prix LEGO d'origine, dates de sortie et de retrait) : BRICKSET_API_KEY. Chaque source marche sans l'autre.
import { createClient } from "jsr:@supabase/supabase-js@2";

// Accès à l'API BrickLink (https://www.bricklink.com/v3/api.page) : signature OAuth 1.0
// et lecture des réponses. Fonctionne dans Deno (fonction Supabase) et Node (tests).

const API = "https://api.bricklink.com/api/store/v1";

// Encodage RFC 3986 exigé par OAuth (encodeURIComponent laisse passer !*'()).
const pct = (s) =>
  encodeURIComponent(String(s)).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

async function hmacSha1Base64(key, text) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(text)));
  let bin = "";
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}

// Signature OAuth 1.0 HMAC-SHA1 (RFC 5849). Renvoie l'en-tête Authorization.
// keys = { consumerKey, consumerSecret, token, tokenSecret } ; nonce et timestamp injectables pour les tests.
async function oauthHeader(method, url, keys, { nonce, timestamp } = {}) {
  const u = new URL(url);
  const oauth = {
    oauth_consumer_key: keys.consumerKey,
    oauth_token: keys.token,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_nonce: nonce ?? crypto.randomUUID().replace(/-/g, ""),
    oauth_version: "1.0",
  };
  const params = [...u.searchParams.entries(), ...Object.entries(oauth)]
    .map(([k, v]) => [pct(k), pct(v)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = `${u.protocol}//${u.host.toLowerCase()}${u.pathname}`;
  const text = [method.toUpperCase(), pct(base), pct(params)].join("&");
  const signature = await hmacSha1Base64(`${pct(keys.consumerSecret)}&${pct(keys.tokenSecret)}`, text);
  const all = { ...oauth, oauth_signature: signature };
  return "OAuth " + Object.entries(all).map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(", ");
}

// Appel signé ; lève une erreur lisible si BrickLink refuse.
async function blGet(path, query, keys, fetchFn = fetch) {
  const u = new URL(API + path);
  for (const [k, v] of Object.entries(query || {})) if (v != null && v !== "") u.searchParams.set(k, v);
  const res = await fetchFn(u.toString(), { headers: { Authorization: await oauthHeader("GET", u.toString(), keys), Accept: "application/json" } });
  let body;
  try { body = await res.json(); } catch { throw new Error(`BrickLink : réponse illisible (HTTP ${res.status})`); }
  const code = body?.meta?.code;
  if (code !== 200) {
    const msg = body?.meta?.description || body?.meta?.message || `HTTP ${res.status}`;
    const err = new Error(`BrickLink : ${msg}`);
    err.code = code;
    throw err;
  }
  return body.data;
}

// BrickLink renvoie les noms avec des entités HTML (« &#40; », « &amp; »).
function decodeEntities(s) {
  return String(s ?? "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

const httpsUrl = (u) => (!u ? null : u.startsWith("//") ? `https:${u}` : u.replace(/^http:/, "https:"));

// Fiche catalogue d'un set → ligne de la table « sets ».
function parseItem(data) {
  return {
    set_no: data.no,
    name: decodeEntities(data.name),
    year: data.year_released || null,
    image_url: httpsUrl(data.image_url) || `https://img.bricklink.com/ItemImage/SN/0/${data.no}.png`,
    category_id: data.category_id ?? null,
  };
}

// Guide des prix → valeurs unitaires (null si aucune vente / annonce).
function parseGuide(data) {
  const qty = Number(data?.total_quantity) || 0;
  const n = (v) => (qty > 0 && v != null && Number(v) > 0 ? Math.round(Number(v) * 100) / 100 : null);
  return { avg: n(data?.qty_avg_price ?? data?.avg_price), min: n(data?.min_price), max: n(data?.max_price), qty, currency: data?.currency_code || null };
}

// Guide des prix « vendus » (6 derniers mois) et « en vente » pour un set dans un état.
async function priceGuide(setNo, condition, keys, { region = "europe", currency = "EUR", fetchFn } = {}) {
  const base = { new_or_used: condition, currency_code: currency, region, vat: "Y" };
  const sold = parseGuide(await blGet(`/items/SET/${encodeURIComponent(setNo)}/price`, { ...base, guide_type: "sold" }, keys, fetchFn));
  const stock = parseGuide(await blGet(`/items/SET/${encodeURIComponent(setNo)}/price`, { ...base, guide_type: "stock" }, keys, fetchFn));
  return {
    set_no: setNo, condition, currency,
    avg_sold: sold.avg, min_sold: sold.min, max_sold: sold.max, qty_sold: sold.qty,
    avg_stock: stock.avg, min_stock: stock.min, qty_stock: stock.qty,
  };
}

// ---------- Brickset (https://brickset.com/article/52664/api-version-3-documentation) ----------
// Clé gratuite, 100 appels par jour : on ne demande chaque fiche qu'une fois, puis tous les 30 jours tant que le set n'est pas retiré.
const BRICKSET_API = "https://brickset.com/api/v3.asmx";
const BRICKSET_FIELDS = ["theme", "subtheme", "pieces", "minifigs", "rrp_eur", "launch_date", "exit_date", "brickset_url"];

async function bsGetSet(setNo, apiKey, fetchFn = fetch) {
  const body = new URLSearchParams({ apiKey, userHash: "", params: JSON.stringify({ setNumber: setNo }) });
  const res = await fetchFn(`${BRICKSET_API}/getSets`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: body.toString(),
  });
  let data;
  try { data = await res.json(); } catch { throw new Error(`Brickset : réponse illisible (HTTP ${res.status})`); }
  if (data?.status !== "success") throw new Error(`Brickset : ${data?.message || `HTTP ${res.status}`}`);
  return data.sets?.[0] || null;
}

const day = (d) => (d && /^\d{4}-\d{2}-\d{2}/.test(String(d)) ? String(d).slice(0, 10) : null);
const posInt = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.round(Number(n)) : null);

// Fiche Brickset → colonnes de la table « sets ». Prix d'origine : LEGO.com Allemagne (euros).
function parseBrickset(s) {
  if (!s) return null;
  const de = s.LEGOCom?.DE || {};
  const rrp = Number(de.retailPrice);
  return {
    set_no: `${s.number}-${s.numberVariant ?? 1}`,
    name: decodeEntities(s.name || ""),
    year: posInt(s.year),
    image_url: httpsUrl(s.image?.imageURL) || null,
    theme: s.theme || null,
    subtheme: s.subtheme || null,
    pieces: posInt(s.pieces),
    minifigs: posInt(s.minifigs),
    rrp_eur: rrp > 0 ? Math.round(rrp * 100) / 100 : null,
    launch_date: day(s.launchDate) || day(de.dateFirstAvailable),
    exit_date: day(s.exitDate),
    brickset_url: httpsUrl(s.bricksetURL) || null,
  };
}

// Fusion : la fiche BrickLink (nom, image) prime ; Brickset complète. « at » marque la date de consultation de Brickset.
function mergeSet(base, bs, at) {
  const out = { ...(base || {}) };
  if (bs) {
    if (!base) Object.assign(out, { set_no: bs.set_no, name: bs.name, year: bs.year, image_url: bs.image_url, category_id: null });
    for (const k of BRICKSET_FIELDS) out[k] = bs[k] ?? null;
  }
  if (at) out.brickset_at = at;
  return out;
}

// Faut-il (re)demander la fiche Brickset ? Jamais consultée ; chaque semaine autour de la date de retrait
// (Brickset la repousse souvent) ; tous les 30 jours sinon ; plus du tout 6 mois après le retrait.
function needsBrickset(row, now = new Date()) {
  if (!row?.brickset_at) return true;
  const DAY = 86400000;
  const age = now - new Date(row.brickset_at);
  if (row.exit_date) {
    const since = (now - new Date(`${row.exit_date}T00:00:00Z`)) / DAY; // jours depuis la date de retrait
    if (since > 180) return false;
    if (since > -60) return age > 6 * DAY;
  }
  return age > 30 * DAY;
}


const env = (k: string) => Deno.env.get(k) ?? "";
const keys = {
  consumerKey: env("BRICKLINK_CONSUMER_KEY"),
  consumerSecret: env("BRICKLINK_CONSUMER_SECRET"),
  token: env("BRICKLINK_TOKEN"),
  tokenSecret: env("BRICKLINK_TOKEN_SECRET"),
};
const hasBrickLink = !!(keys.consumerKey && keys.token);
const BRICKSET_KEY = env("BRICKSET_API_KEY");
const BRICKSET_PER_RUN = 25; // la clé Brickset gratuite permet 100 appels par jour
const REGION = env("BRICKLINK_REGION") || "europe";
const BUDGET_MS = 110_000; // on s'arrête avant la limite de durée de la fonction
const PAUSE_MS = 250;      // politesse envers l'API (5 000 appels / jour)

const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function isOwner(req: Request): Promise<boolean> {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  const { data } = await admin.auth.getUser(jwt);
  const email = data?.user?.email?.toLowerCase();
  if (!email) return false;
  const { data: row } = await admin.from("owners").select("email").eq("email", email).maybeSingle();
  return !!row;
}

// Tâche planifiée : secret généré dans le coffre Supabase (voir supabase/cron.sql).
async function isCron(req: Request): Promise<boolean> {
  const s = req.headers.get("x-cron-secret");
  if (!s) return false;
  const { data } = await admin.rpc("brickfolio_cron_ok", { s });
  return data === true;
}

async function saveSet(row: Record<string, unknown>) {
  const { error } = await admin.from("sets").upsert({ ...row, updated_at: new Date().toISOString() });
  if (error) throw error;
  return row;
}

// Complète une fiche existante avec Brickset (null si le set est inconnu de Brickset : on réessaiera dans 30 jours).
async function enrich(row: Record<string, unknown>) {
  const bs = parseBrickset(await bsGetSet(String(row.set_no), BRICKSET_KEY));
  return await saveSet(mergeSet(row, bs, new Date().toISOString()));
}

// Fiche d'un set : cache, sinon BrickLink et/ou Brickset selon les clés présentes.
// withBrickset = false pendant le relevé des prix : les fiches Brickset passent par catalogPass (quota limité).
async function lookup(setNo: string, withBrickset = true) {
  const { data: cached } = await admin.from("sets").select("*").eq("set_no", setNo).maybeSingle();
  if (cached) {
    if (withBrickset && BRICKSET_KEY && !cached.brickset_at) { try { return await enrich(cached); } catch { /* Brickset plus tard */ } }
    return cached;
  }
  let bl = null, bs = null, bsTried = false;
  const errors: Error[] = [];
  if (hasBrickLink) {
    try { bl = parseItem(await blGet(`/items/SET/${encodeURIComponent(setNo)}`, {}, keys)); }
    catch (e) { if ((e as { code?: number }).code !== 404) errors.push(e as Error); }
  }
  if (withBrickset && BRICKSET_KEY) {
    try { bs = parseBrickset(await bsGetSet(setNo, BRICKSET_KEY)); bsTried = true; }
    catch (e) { errors.push(e as Error); }
  }
  if (!bl && !bs) { if (errors.length) throw errors[0]; return null; }
  return await saveSet(mergeSet(bl, bs, bsTried ? new Date().toISOString() : null));
}

// Fiches Brickset des sets détenus : manquantes d'abord, puis celles de plus de 30 jours (sets pas encore retirés).
async function catalogPass(setNos: string[]) {
  if (!BRICKSET_KEY) return { done: 0, failed: [] as string[] };
  const { data: rows } = await admin.from("sets").select("*").in("set_no", setNos);
  const bySet = new Map((rows || []).map((r) => [r.set_no, r]));
  const todo = setNos.filter((no) => !bySet.has(no) || needsBrickset(bySet.get(no)))
    .sort((a, b) => String(bySet.get(a)?.brickset_at || "").localeCompare(String(bySet.get(b)?.brickset_at || "")))
    .slice(0, BRICKSET_PER_RUN);
  let done = 0;
  const failed: string[] = [];
  for (const no of todo) {
    try {
      const row = bySet.get(no);
      if (row) await enrich(row); else await lookup(no);
      done++;
    } catch (e) {
      failed.push(`${no} : ${(e as Error).message}`);
      if (/limit/i.test((e as Error).message)) break; // quota du jour atteint
    }
    await sleep(PAUSE_MS);
  }
  return { done, failed };
}

async function refresh() {
  const started = Date.now();
  const { data: run } = await admin.from("runs").insert({ started_at: new Date().toISOString() }).select("id").single();

  // Sets détenus (non vendus), les moins récemment relevés d'abord.
  const { data: owned, error } = await admin.from("purchases").select("set_no, condition").is("sold_price", null);
  if (error) throw error;
  const pairs = [...new Map((owned || []).map((p) => [`${p.set_no}|${p.condition}`, p])).values()];
  const { data: last } = await admin.from("prices").select("set_no, condition, fetched_on").order("fetched_on", { ascending: false });
  const lastOn = new Map<string, string>();
  for (const r of last || []) { const k = `${r.set_no}|${r.condition}`; if (!lastOn.has(k)) lastOn.set(k, r.fetched_on); }
  pairs.sort((a, b) => (lastOn.get(`${a.set_no}|${a.condition}`) || "").localeCompare(lastOn.get(`${b.set_no}|${b.condition}`) || ""));

  const cat = await catalogPass([...new Set(pairs.map((p) => p.set_no))]);

  let ok = 0;
  const failed: string[] = [];
  let skipped = 0;
  for (const p of hasBrickLink ? pairs : []) {
    if (Date.now() - started > BUDGET_MS) { skipped = pairs.length - ok - failed.length; break; }
    try {
      await lookup(p.set_no, false);
      const row = await priceGuide(p.set_no, p.condition, keys, { region: REGION });
      const { error: e } = await admin.from("prices").upsert(
        { ...row, region: REGION, fetched_on: new Date().toISOString().slice(0, 10), fetched_at: new Date().toISOString() },
        { onConflict: "set_no,condition,fetched_on" },
      );
      if (e) throw e;
      ok++;
    } catch (e) {
      failed.push(`${p.set_no} (${p.condition}) : ${(e as Error).message}`);
    }
    await sleep(PAUSE_MS);
  }

  const message = [
    hasBrickLink ? `${ok} relevé(s) sur ${pairs.length}` : "Prix BrickLink : clés absentes",
    BRICKSET_KEY ? `${cat.done} fiche(s) Brickset mise(s) à jour` : "",
    cat.failed.length ? `Brickset : ${cat.failed.slice(0, 3).join(" ; ")}` : "",
    skipped ? `${skipped} reporté(s) au prochain passage` : "",
    failed.length ? `Échecs : ${failed.slice(0, 5).join(" ; ")}` : "",
  ].filter(Boolean).join(". ");
  if (run) await admin.from("runs").update({ finished_at: new Date().toISOString(), ok, failed: failed.length, message }).eq("id", run.id);
  return { ok, failed: failed.length, skipped, total: pairs.length, message, brickset: cat.done, bricklink: hasBrickLink };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST attendu" }, 405);
  if (!(await isCron(req)) && !(await isOwner(req))) return json({ error: "Accès refusé" }, 403);
  if (!hasBrickLink && !BRICKSET_KEY) return json({ error: "Clés BrickLink absentes : ajoute-les dans Edge Functions > Secrets" }, 503);

  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "lookup") {
      const setNo = String(body.set_no || "").trim().toUpperCase();
      if (!/^[0-9A-Z]+(-\d+)?$/.test(setNo)) return json({ error: "Numéro de set invalide" }, 400);
      return json({ set: await lookup(setNo) });
    }
    if (body.action === "refresh") return json(await refresh());
    return json({ error: "Action inconnue" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
