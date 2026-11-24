// Brickfolio — fonction Supabase « bricklink ».
// Garde les clés BrickLink côté serveur (jamais dans le navigateur).
//
//  POST {"action":"lookup","set_no":"75192-1"}  → fiche du set (nom, année, image), mise en cache dans « sets ».
//  POST {"action":"refresh"}                    → relève les prix de tous les sets détenus, écrit dans « prices ».
//  POST {"action":"invoice","media_type":"application/pdf","data":"<base64>"}
//                                               → lit une facture avec Claude : vendeur, date, sets, prix (rien n'est enregistré).
//
// Appelants autorisés : un compte de la liste public.owners (bouton de l'app), ou la tâche
// planifiée (en-tête x-cron-secret, vérifié dans le coffre Supabase). Déployer avec « Verify JWT » désactivé
// (supabase functions deploy bricklink --no-verify-jwt) : le contrôle d'accès est fait ici.
//
// Secrets (Edge Functions > Secrets) : BRICKLINK_CONSUMER_KEY, BRICKLINK_CONSUMER_SECRET,
// BRICKLINK_TOKEN, BRICKLINK_TOKEN_SECRET ; facultatif : BRICKLINK_REGION (europe).
// Lecture des factures : ANTHROPIC_API_KEY (console.anthropic.com).
import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";
import { blGet, parseItem, priceGuide } from "./bricklink.js";
import { INVOICE_MAX_BYTES, INVOICE_TYPES, invoiceRequest, parseInvoice } from "./facture.js";

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

// Facture → { shop, date, currency, shipping, items: [{ set_no, name, qty, unit_price, condition }], warning }
async function readInvoice(mediaType: string, data: string) {
  const apiKey = env("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "Clé Anthropic absente : ajoute ANTHROPIC_API_KEY dans Edge Functions > Secrets" }, 503);
  if (!INVOICE_TYPES.includes(mediaType)) return json({ error: "Format non lisible : envoie un PDF ou une photo JPEG / PNG" }, 400);
  if (!data || data.length > INVOICE_MAX_BYTES * 1.37) return json({ error: "Fichier trop lourd pour être lu (8 Mo au plus)" }, 413);
  const client = new Anthropic({ apiKey, timeout: 100_000, maxRetries: 1 });
  try {
    const response = await client.beta.messages.create(invoiceRequest(mediaType, data));
    return json({ invoice: parseInvoice(response) });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "Clé Anthropic refusée : vérifie ANTHROPIC_API_KEY" }, 502);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "Trop de lectures d'un coup, réessaie dans une minute" }, 429);
    if (e instanceof Anthropic.BadRequestError) return json({ error: `Facture refusée par Claude : ${e.message}` }, 400);
    if (e instanceof Anthropic.APIError) return json({ error: `Service de lecture indisponible (${e.status ?? "réseau"})` }, 502);
    return json({ error: (e as Error).message }, 500);
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

  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "invoice") {
      if (await isCron(req)) return json({ error: "Accès refusé" }, 403);
      return await readInvoice(String(body.media_type || ""), String(body.data || ""));
    }
    if (!keys.consumerKey || !keys.token) return json({ error: "Clés BrickLink absentes : ajoute-les dans Edge Functions > Secrets" }, 503);
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
