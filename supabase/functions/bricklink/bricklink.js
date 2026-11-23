// Accès à l'API BrickLink (https://www.bricklink.com/v3/api.page) : signature OAuth 1.0
// et lecture des réponses. Fonctionne dans Deno (fonction Supabase) et Node (tests).

export const API = "https://api.bricklink.com/api/store/v1";

// Encodage RFC 3986 exigé par OAuth (encodeURIComponent laisse passer !*'()).
export const pct = (s) =>
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
export async function oauthHeader(method, url, keys, { nonce, timestamp } = {}) {
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
export async function blGet(path, query, keys, fetchFn = fetch) {
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
export function decodeEntities(s) {
  return String(s ?? "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

const httpsUrl = (u) => (!u ? null : u.startsWith("//") ? `https:${u}` : u.replace(/^http:/, "https:"));

// Fiche catalogue d'un set → ligne de la table « sets ».
export function parseItem(data) {
  return {
    set_no: data.no,
    name: decodeEntities(data.name),
    year: data.year_released || null,
    image_url: httpsUrl(data.image_url) || `https://img.bricklink.com/ItemImage/SN/0/${data.no}.png`,
    category_id: data.category_id ?? null,
  };
}

// Guide des prix → valeurs unitaires (null si aucune vente / annonce).
export function parseGuide(data) {
  const qty = Number(data?.total_quantity) || 0;
  const n = (v) => (qty > 0 && v != null && Number(v) > 0 ? Math.round(Number(v) * 100) / 100 : null);
  return { avg: n(data?.qty_avg_price ?? data?.avg_price), min: n(data?.min_price), max: n(data?.max_price), qty, currency: data?.currency_code || null };
}

// Guide des prix « vendus » (6 derniers mois) et « en vente » pour un set dans un état.
export async function priceGuide(setNo, condition, keys, { region = "europe", currency = "EUR", fetchFn } = {}) {
  const base = { new_or_used: condition, currency_code: currency, region, vat: "Y" };
  const sold = parseGuide(await blGet(`/items/SET/${encodeURIComponent(setNo)}/price`, { ...base, guide_type: "sold" }, keys, fetchFn));
  const stock = parseGuide(await blGet(`/items/SET/${encodeURIComponent(setNo)}/price`, { ...base, guide_type: "stock" }, keys, fetchFn));
  return {
    set_no: setNo, condition, currency,
    avg_sold: sold.avg, min_sold: sold.min, max_sold: sold.max, qty_sold: sold.qty,
    avg_stock: stock.avg, min_stock: stock.min, qty_stock: stock.qty,
  };
}
