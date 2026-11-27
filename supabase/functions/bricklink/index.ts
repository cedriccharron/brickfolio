// Brickfolio — fonction Supabase « bricklink ».
// Garde les clés BrickLink côté serveur (jamais dans le navigateur).
//
//  POST {"action":"lookup","set_no":"75192-1"}  → fiche du set (nom, année, image), mise en cache dans « sets ».
//  POST {"action":"refresh"}                    → complète les fiches Brickset, puis relève les prix de tous les sets détenus (« prices »).
//  POST {"action":"scan"}                       → opportunités : balaie le catalogue Brickset (une fois par semaine) et relève
//                                                 les prix BrickLink des sets dont le retrait approche (« bf_catalog »).
//
// Appelants autorisés : un compte de la liste public.owners (bouton de l'app), ou la tâche
// planifiée (en-tête x-cron-secret, vérifié dans le coffre Supabase). Déployer avec « Verify JWT » désactivé
// (supabase functions deploy bricklink --no-verify-jwt) : le contrôle d'accès est fait ici.
//
// Secrets (Edge Functions > Secrets) : BRICKLINK_CONSUMER_KEY, BRICKLINK_CONSUMER_SECRET,
// BRICKLINK_TOKEN, BRICKLINK_TOKEN_SECRET ; facultatif : BRICKLINK_REGION (europe).
// Brickset (prix LEGO d'origine, dates de sortie et de retrait) : BRICKSET_API_KEY. Chaque source marche sans l'autre.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { blGet, bsGetSet, bsGetSets, isCandidate, mergeSet, needsBrickset, parseBrickset, parseCatalog, parseItem, priceGuide } from "./bricklink.js";

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

// ---------- Opportunités (v0.10) ----------
const SCAN_YEARS = 10;         // sets sortis ces 10 dernières années (certains restent longtemps en vente)
const SCAN_WINDOW_DAYS = 120;  // retrait dans les 4 prochains mois (l'app affiche les 3 prochains)
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function scan(force = false) {
  const started = Date.now();
  const today = new Date();
  const from = iso(today), to = iso(new Date(today.getTime() + SCAN_WINDOW_DAYS * 86400000));
  const notes: string[] = [];

  // 1) Catalogue Brickset : une fois par semaine (environ 2 appels par année balayée).
  let scanned = false, calls = 0, found = 0;
  if (BRICKSET_KEY) {
    const { data: last } = await admin.from("bf_catalog").select("seen_at").order("seen_at", { ascending: false }).limit(1);
    const age = last?.[0] ? Date.now() - new Date(last[0].seen_at).getTime() : Infinity;
    if (force || age > 6 * 86400000) {
      const scanStart = new Date().toISOString();
      const rows: Record<string, unknown>[] = [];
      let complete = true;
      try {
        for (let y = today.getUTCFullYear() - SCAN_YEARS + 1; y <= today.getUTCFullYear(); y++) {
          for (let page = 1; page <= 6; page++) {
            const { sets } = await bsGetSets({ year: String(y), pageSize: 500, pageNumber: page, orderBy: "Number" }, BRICKSET_KEY);
            calls++;
            for (const s of sets) { const r = parseCatalog(s); if (isCandidate(r, from, to)) rows.push(r!); }
            if (sets.length < 500) break;
          }
        }
      } catch (e) { complete = false; notes.push((e as Error).message); }
      const uniq = [...new Map(rows.map((r) => [r.set_no, r])).values()];
      for (let i = 0; i < uniq.length; i += 200) {
        const { error } = await admin.from("bf_catalog").upsert(uniq.slice(i, i + 200).map((r) => ({ ...r, seen_at: scanStart })));
        if (error) throw error;
      }
      // Sets sortis de la fenêtre (retirés, ou date repoussée) : retirés de la liste, seulement après un balayage complet.
      if (complete) await admin.from("bf_catalog").delete().lt("seen_at", scanStart);
      scanned = complete; found = uniq.length;
    }
  } else notes.push("Brickset : clé absente");

  // 2) Prix BrickLink (neuf, Europe) des candidats sans relevé de la semaine, les plus anciens d'abord.
  let priced = 0, pending = 0;
  const { data: todo } = await admin.from("bf_catalog").select("set_no, price_on")
    .or(`price_on.is.null,price_on.lt.${iso(new Date(Date.now() - 6 * 86400000))}`)
    .order("price_on", { ascending: true, nullsFirst: true }).order("exit_date", { ascending: true });
  for (const c of hasBrickLink ? todo || [] : []) {
    if (Date.now() - started > BUDGET_MS) break;
    try {
      const r = await priceGuide(c.set_no, "N", keys, { region: REGION });
      await admin.from("bf_catalog").update({ price_on: iso(new Date()), avg_sold: r.avg_sold, qty_sold: r.qty_sold,
        avg_stock: r.avg_stock, min_stock: r.min_stock, qty_stock: r.qty_stock, price_error: null }).eq("set_no", c.set_no);
      priced++;
    } catch (e) {
      await admin.from("bf_catalog").update({ price_on: iso(new Date()), price_error: (e as Error).message.slice(0, 200) }).eq("set_no", c.set_no);
    }
    await sleep(PAUSE_MS);
  }
  pending = Math.max(0, (todo?.length || 0) - priced);
  if (!hasBrickLink) notes.push("Prix BrickLink : clés absentes");
  const { count } = await admin.from("bf_catalog").select("set_no", { count: "exact", head: true });
  const message = [
    scanned ? `Catalogue Brickset parcouru (${calls} appels) : ${found} sets dont le retrait approche` : "",
    `${priced} prix BrickLink relevés`,
    pending ? `${pending} à relever au prochain passage` : "",
    ...notes,
  ].filter(Boolean).join(". ");
  return { scanned, candidates: count ?? 0, priced, pending, message };
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
    if (body.action === "scan") return json(await scan(body.force === true));
    return json({ error: "Action inconnue" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
