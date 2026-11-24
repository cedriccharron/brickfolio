// @ts-nocheck
// Fichier généré par tests/build-function.mjs (index.ts + bricklink.js) pour l'éditeur Supabase.
// Brickfolio — fonction Supabase « bricklink ».
// Garde les clés BrickLink côté serveur (jamais dans le navigateur).
//
//  POST {"action":"lookup","set_no":"75192-1"}  → fiche du set (nom, année, image), mise en cache dans « sets ».
//  POST {"action":"refresh"}                    → relève les prix de tous les sets détenus, écrit dans « prices ».
//
// Appelants autorisés : un compte de la liste public.owners (bouton de l'app), ou la tâche
// planifiée (en-tête x-cron-secret, vérifié dans le coffre Supabase). Déployer avec « Verify JWT » désactivé
// (supabase functions deploy bricklink --no-verify-jwt) : le contrôle d'accès est fait ici.
//
// Secrets (Edge Functions > Secrets) : BRICKLINK_CONSUMER_KEY, BRICKLINK_CONSUMER_SECRET,
// BRICKLINK_TOKEN, BRICKLINK_TOKEN_SECRET ; facultatif : BRICKLINK_REGION (europe).
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


const env = (k: string) => Deno.env.get(k) ?? "";
const keys = {
  consumerKey: env("BRICKLINK_CONSUMER_KEY"),
  consumerSecret: env("BRICKLINK_CONSUMER_SECRET"),
  token: env("BRICKLINK_TOKEN"),
  tokenSecret: env("BRICKLINK_TOKEN_SECRET"),
};
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

async function lookup(setNo: string) {
  const { data: cached } = await admin.from("sets").select("*").eq("set_no", setNo).maybeSingle();
  if (cached) return cached;
  try {
    const row = { ...parseItem(await blGet(`/items/SET/${encodeURIComponent(setNo)}`, {}, keys)), updated_at: new Date().toISOString() };
    const { error } = await admin.from("sets").upsert(row);
    if (error) throw error;
    return row;
  } catch (e) {
    if ((e as { code?: number }).code === 404) return null;
    throw e;
  }
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

  let ok = 0;
  const failed: string[] = [];
  let skipped = 0;
  for (const p of pairs) {
    if (Date.now() - started > BUDGET_MS) { skipped = pairs.length - ok - failed.length; break; }
    try {
      await lookup(p.set_no);
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
    `${ok} relevé(s) sur ${pairs.length}`,
    skipped ? `${skipped} reporté(s) au prochain passage` : "",
    failed.length ? `Échecs : ${failed.slice(0, 5).join(" ; ")}` : "",
  ].filter(Boolean).join(". ");
  if (run) await admin.from("runs").update({ finished_at: new Date().toISOString(), ok, failed: failed.length, message }).eq("id", run.id);
  return { ok, failed: failed.length, skipped, total: pairs.length, message };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST attendu" }, 405);
  if (!(await isCron(req)) && !(await isOwner(req))) return json({ error: "Accès refusé" }, 403);
  if (!keys.consumerKey || !keys.token) return json({ error: "Clés BrickLink absentes : ajoute-les dans Edge Functions > Secrets" }, 503);

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
