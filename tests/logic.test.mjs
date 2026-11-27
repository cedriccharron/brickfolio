// node tests/logic.test.mjs
import assert from "node:assert/strict";
import {
  normalizeSetNo, cost, unitValue, latestPrice, annualized, position, summary, positionHistory, portfolioHistory, toCSV,
  manualRow, valueSource, splitSale, trend, trends, analyze, stats, filterRows, sortRows, setStatus, vsRetail, refreshSummary,
} from "../js/invest.js";
import {
  pct, oauthHeader, parseGuide, parseItem, decodeEntities, priceGuide, bsGetSet, parseBrickset, mergeSet, needsBrickset,
} from "../supabase/functions/bricklink/bricklink.js";

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log("ok -", name); };

const P = (o) => ({ id: "x", setNo: "10294-1", condition: "N", qty: 1, unitPrice: 500, fees: 0, date: "2023-01-01", soldPrice: null, soldDate: null, ...o });
const R = (on, avgSold, avgStock = null, o = {}) => ({ setNo: "10294-1", condition: "N", on, avgSold, avgStock, ...o });

await test("numéro de set normalisé", () => {
  assert.equal(normalizeSetNo(" 75192 "), "75192-1");
  assert.equal(normalizeSetNo("10294-2"), "10294-2");
  assert.equal(normalizeSetNo("sw0001a"), "SW0001A-1");
  assert.equal(normalizeSetNo(""), "");
});

await test("coût = quantité × prix + frais", () => {
  assert.equal(cost(P({ qty: 3, unitPrice: 79.99, fees: 4.99 })), 3 * 79.99 + 4.99);
});

await test("valeur : ventes, sinon annonces", () => {
  assert.equal(unitValue(R("2024-01-01", 600, 650)), 600);
  assert.equal(unitValue(R("2024-01-01", null, 650)), 650);
  assert.equal(unitValue(R("2024-01-01", null, null)), null);
});

await test("dernier relevé utilisable, avec date limite", () => {
  const prices = [R("2024-01-01", 550), R("2024-02-01", 600), R("2024-03-01", null), R("2024-01-15", 570, null, { condition: "U" })];
  assert.equal(latestPrice(prices, "10294-1", "N").on, "2024-02-01");
  assert.equal(latestPrice(prices, "10294-1", "N", "2024-01-20").on, "2024-01-01");
  assert.equal(latestPrice(prices, "10294-1", "N", "2023-12-01"), null);
});

await test("rendement annualisé : rien avant 6 mois", () => {
  assert.equal(annualized(100, 150, "2024-01-01", "2024-03-01"), null);
  const r = annualized(100, 121, "2022-01-01", "2024-01-01");
  assert.ok(Math.abs(r - 0.1) < 0.002, r);
});

await test("position détenue et vendue", () => {
  const prices = [R("2024-06-01", 650)];
  const held = position(P({ qty: 2 }), prices, "2024-06-02");
  assert.equal(held.value, 1300);
  assert.equal(held.gain, 300);
  assert.equal(held.pct, 0.3);
  const sold = position(P({ soldPrice: 700, soldDate: "2024-01-01" }), prices, "2024-06-02");
  assert.equal(sold.sold, true);
  assert.equal(sold.value, 700);
  assert.equal(sold.gain, 200);
  const none = position(P(), [], "2024-06-02");
  assert.equal(none.priced, false);
  assert.equal(none.gain, null);
});

await test("résumé : non valorisé compté au coût, vente réalisée à part", () => {
  const purchases = [P({ id: "a" }), P({ id: "b", setNo: "21318-1", unitPrice: 200 }), P({ id: "c", soldPrice: 650, soldDate: "2024-02-01" })];
  const s = summary(purchases, [R("2024-06-01", 600)], "2024-06-02");
  assert.equal(s.invested, 700);
  assert.equal(s.value, 800);
  assert.equal(s.unrealized, 100);
  assert.equal(s.realized, 150);
  assert.equal(s.unpriced, 1);
  assert.ok(Math.abs(s.pct - 100 / 700) < 1e-9);
});

await test("historique d'une position", () => {
  const prices = [R("2022-12-01", 400), R("2023-02-01", 520), R("2023-05-01", 560), R("2023-09-01", 600)];
  const h = positionHistory(P({ qty: 2, soldPrice: 1150, soldDate: "2023-06-01" }), prices);
  assert.deepEqual(h.map((x) => x.on), ["2023-01-01", "2023-02-01", "2023-05-01", "2023-06-01"]);
  assert.deepEqual(h.map((x) => x.value), [1000, 1040, 1120, 1150]);
});

await test("historique du portefeuille", () => {
  const purchases = [P({ id: "a" }), P({ id: "b", date: "2023-03-01", unitPrice: 300 })];
  const prices = [R("2023-02-01", 520), R("2023-04-01", 540)];
  const h = portfolioHistory(purchases, prices);
  assert.deepEqual(h, [
    { on: "2023-01-01", value: 500, invested: 500, retail: null },
    { on: "2023-02-01", value: 520, invested: 500, retail: null },
    { on: "2023-03-01", value: 1040, invested: 800, retail: null },
    { on: "2023-04-01", value: 1080, invested: 800, retail: null },
  ]);
});

await test("export CSV pour Excel (point-virgule, virgule décimale)", () => {
  const csv = toCSV([P({ unitPrice: 499.5, notes: 'boîte "abîmée"' })], [R("2024-01-01", 600)], { "10294-1": { name: "Titanic" } });
  const line = csv.split("\r\n")[1];
  assert.ok(line.startsWith('"10294-1";"Titanic";"Neuf";"1";"499,5"'), line);
  assert.ok(line.includes('"boîte ""abîmée"""'));
});

await test("valeur manuelle : utilisée si plus récente, prime le même jour", () => {
  const m = (on, value) => manualRow({ id: on, setNo: "10294-1", condition: "N", on, value });
  const prices = [R("2024-01-01", 600), m("2024-02-01", 650)];
  assert.equal(position(P(), prices, "2024-03-01").unit, 650);
  assert.equal(valueSource(latestPrice(prices, "10294-1", "N")), "manuel");
  assert.equal(position(P(), [...prices, R("2024-03-01", 620)], "2024-03-02").unit, 620);
  assert.equal(position(P(), [R("2024-03-01", 620), m("2024-03-01", 700)], "2024-03-02").unit, 700);
  assert.deepEqual(positionHistory(P(), prices).map((x) => x.value), [500, 600, 650]);
});

// ---------- Tableau de bord : tendances, statistiques, filtres, tris ----------
await test("tendance passée sur 3 mois et 1 an", () => {
  const prices = [R("2023-06-01", 500), R("2024-03-01", 540), R("2024-06-01", 600)];
  const m3 = trend(prices, "10294-1", "N", 91, "2024-06-10");
  assert.equal(m3.since, "2024-03-01");
  assert.ok(Math.abs(m3.pct - (600 / 540 - 1)) < 1e-9);
  const y1 = trend(prices, "10294-1", "N", 365, "2024-06-10");
  assert.equal(y1.since, "2023-06-01");
  assert.ok(Math.abs(y1.pct - 0.2) < 1e-9);
  assert.equal(trend(prices, "10294-1", "N", 365 * 3, "2024-06-10"), null); // historique trop court
  assert.equal(trend([R("2024-06-01", 600)], "10294-1", "N", 91, "2024-06-10"), null);
  const t = trends(prices, "10294-1", "N", "2024-06-10");
  assert.deepEqual(Object.keys(t), ["m3", "y1"]); // pas de projection
  assert.equal(t.y1.since, "2023-06-01");
});

await test("statistiques : stock, potentiel, tendance, ventes par année", () => {
  const prices = [R("2023-06-01", 500), R("2024-03-01", 540), R("2024-06-01", 600),
    R("2023-06-01", 200, null, { setNo: "21318-1" }), R("2024-06-01", 180, null, { setNo: "21318-1" })];
  const purchases = [
    P({ id: "a", qty: 2 }),
    P({ id: "b", setNo: "21318-1", unitPrice: 190, date: "2023-05-01", shop: "Fnac" }),
    P({ id: "c", soldPrice: 700, soldDate: "2024-01-01", shop: "Fnac" }),
    P({ id: "d", setNo: "99999-1", unitPrice: 50, date: "2024-05-01", condition: "U" }),
  ];
  const rows = purchases.map((p) => analyze(p, prices, { "10294-1": { name: "Titanic" } }, "2024-06-10"));
  const s = stats(rows);
  assert.equal(s.held.count, 3);
  assert.equal(s.held.invested, 1000 + 190 + 50);
  assert.equal(s.held.value, 1200 + 180 + 50);    // sans prix : compté au coût
  assert.equal(s.held.latent, 200 - 10);
  assert.equal(s.held.winners, 1);
  assert.equal(s.held.losers, 1);
  assert.equal(s.held.unpriced, 1);
  assert.equal(s.held.best.p.id, "a");
  assert.equal(s.held.worst.p.id, "b");
  assert.ok(Math.abs(s.held.y1.pct - ((1200 + 180) / (1000 + 200) - 1)) < 1e-9);
  assert.deepEqual(s.held.rising.map((r) => r.p.id), ["a"]);   // 3 mois : 540 → 600
  assert.deepEqual(s.held.falling.map((r) => r.p.id), []);      // 21318 : pas de relevé il y a 3 mois
  assert.equal(s.sold.count, 1);
  assert.equal(s.sold.profit, 200);
  assert.equal(s.sold.avgDays, 365);
  assert.deepEqual(s.sold.byYear.map((y) => [y.year, y.count, y.profit]), [["2024", 1, 200]]);
  assert.equal(s.held.projected, undefined);
});

await test("filtres et tris du tableau de bord", () => {
  const prices = [R("2024-03-01", 540), R("2024-06-01", 600), R("2024-03-01", 200, null, { setNo: "21318-1" }), R("2024-06-01", 180, null, { setNo: "21318-1" })];
  const rows = [
    P({ id: "a" }),
    P({ id: "b", setNo: "21318-1", unitPrice: 190, date: "2023-05-01", shop: "Fnac", condition: "N" }),
    P({ id: "c", setNo: "75192-1", unitPrice: 700, condition: "U", shop: "Vinted" }),
  ].map((p) => analyze(p, prices, { "10294-1": { name: "Titanic" } }, "2024-06-10"));
  const ids = (rs) => rs.map((r) => r.p.id);
  assert.deepEqual(ids(filterRows(rows, { q: "titan" })), ["a"]);
  assert.deepEqual(ids(filterRows(rows, { q: "fnac" })), ["b"]);
  assert.deepEqual(ids(filterRows(rows, { cond: "U" })), ["c"]);
  assert.deepEqual(ids(filterRows(rows, { year: "2023" })), ["a", "b", "c"]);
  assert.deepEqual(ids(filterRows(rows, { year: "2024" })), []);
  assert.deepEqual(ids(filterRows(rows, { shop: "Vinted" })), ["c"]);
  assert.deepEqual(ids(filterRows(rows, { perf: "gain" })), ["a"]);
  assert.deepEqual(ids(filterRows(rows, { perf: "loss" })), ["b"]);
  assert.deepEqual(ids(filterRows(rows, { perf: "unpriced" })), ["c"]);
  assert.deepEqual(ids(filterRows(rows, { trend: "down" })), ["b"]);
  assert.deepEqual(ids(sortRows(rows, "gain")), ["a", "b", "c"]);       // sans prix en dernier
  assert.deepEqual(ids(sortRows(rows, "gain", true)), ["c", "b", "a"]);
  assert.deepEqual(ids(sortRows(rows, "trend3")), ["a", "b", "c"]);
  assert.deepEqual(ids(sortRows(rows, "date")), ["b", "a", "c"]); // plus récent d'abord
});

await test("nom choisi prioritaire sur le catalogue, recherche dans les deux", () => {
  const sets = { "75192-1": { name: "Millennium Falcon - UCS" } };
  const a = analyze(P({ id: "a", setNo: "75192-1", name: "Faucon Millenium UCS" }), [], sets);
  const b = analyze(P({ id: "b", setNo: "75192-1", name: "  " }), [], sets);
  const c = analyze(P({ id: "c", setNo: "10294-1" }), [], sets);
  assert.equal(a.name, "Faucon Millenium UCS");
  assert.equal(b.name, "Millennium Falcon - UCS");
  assert.equal(c.name, "");
  assert.deepEqual(filterRows([a, b, c], { q: "millennium" }).map((r) => r.p.id), ["a", "b"]);
  assert.deepEqual(filterRows([a, b, c], { q: "faucon" }).map((r) => r.p.id), ["a"]);
});

await test("vente d'une partie d'un lot : partage et frais au prorata", () => {
  const lot = P({ id: "lot", qty: 3, unitPrice: 79.99, fees: 5, date: "2023-11-24", notes: "Bol" });
  const { kept, sold } = splitSale(lot, 1, 120, "2024-06-01", "new");
  assert.deepEqual([kept.id, kept.qty, kept.fees, kept.soldPrice], ["lot", 2, 3.33, null]);
  assert.deepEqual([sold.id, sold.qty, sold.fees, sold.soldPrice, sold.soldDate, sold.unitPrice], ["new", 1, 1.67, 120, "2024-06-01", 79.99]);
  assert.equal(kept.fees + sold.fees, 5);
  assert.match(sold.notes, /Bol · Vente partielle : 1 boîte sur 3/);
  assert.ok(Math.abs(cost(kept) + cost(sold) - cost(lot)) < 1e-9);
  assert.ok(Math.abs(position(sold, []).gain - (120 - 79.99 - 1.67)) < 1e-9);
  const all = splitSale(lot, 3, 400, "2024-06-01", "x");
  assert.equal(all.kept, null);
  assert.deepEqual([all.sold.id, all.sold.qty, all.sold.soldPrice], ["lot", 3, 400]);
  assert.throws(() => splitSale(lot, 4, 100, "2024-06-01", "x"), /Nombre/);
  assert.throws(() => splitSale(lot, 1, 100, "2023-01-01", "x"), /précéder/);
});

// ---------- BrickLink ----------
await test("encodage OAuth RFC 3986", () => {
  assert.equal(pct("a b!*'()~"), "a%20b%21%2A%27%28%29~");
});

await test("signature OAuth 1.0 : exemple officiel RFC 5849", async () => {
  const h = await oauthHeader("GET", "http://photos.example.net/photos?file=vacation.jpg&size=original",
    { consumerKey: "dpf43f3p2l4k3l03", consumerSecret: "kd94hf93k423kf44", token: "nnch734d00sl2jdk", tokenSecret: "pfkkdhi9sl3r4s00" },
    { nonce: "kllo9940pd9333jh", timestamp: 1191242096 });
  assert.ok(h.includes('oauth_signature="tR3%2BTy81lMeYAr%2FFid0kMTYa%2FWM%3D"'), h);
});

await test("lecture du guide des prix", () => {
  const g = parseGuide({ currency_code: "EUR", min_price: "480.0000", max_price: "720.5000", avg_price: "601.1234", qty_avg_price: "590.4567", total_quantity: 12 });
  assert.deepEqual(g, { avg: 590.46, min: 480, max: 720.5, qty: 12, currency: "EUR" });
  assert.equal(parseGuide({ min_price: "0.0000", avg_price: "0.0000", total_quantity: 0 }).avg, null);
});

await test("fiche catalogue", () => {
  assert.equal(decodeEntities("Millennium Falcon &#40;UCS&#41; &amp; co"), "Millennium Falcon (UCS) & co");
  const it = parseItem({ no: "75192-1", name: "Millennium Falcon", year_released: 2017, image_url: "//img.bricklink.com/SL/75192-1.jpg" });
  assert.equal(it.image_url, "https://img.bricklink.com/SL/75192-1.jpg");
  assert.equal(it.year, 2017);
});

await test("appel BrickLink simulé (URL, en-tête, erreurs)", async () => {
  const keys = { consumerKey: "ck", consumerSecret: "cs", token: "t", tokenSecret: "ts" };
  const calls = [];
  const fake = async (url, opts) => {
    calls.push({ url, auth: opts.headers.Authorization });
    const type = new URL(url).searchParams.get("guide_type");
    return { status: 200, json: async () => ({ meta: { code: 200 }, data: { qty_avg_price: type === "sold" ? "610.00" : "655.00", min_price: "500", max_price: "700", total_quantity: 5, currency_code: "EUR" } }) };
  };
  const row = await priceGuide("10294-1", "N", keys, { fetchFn: fake });
  assert.equal(row.avg_sold, 610);
  assert.equal(row.avg_stock, 655);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.startsWith("https://api.bricklink.com/api/store/v1/items/SET/10294-1/price?"));
  assert.ok(calls[0].url.includes("region=europe") && calls[0].url.includes("currency_code=EUR"));
  assert.ok(calls[0].auth.startsWith("OAuth ") && calls[0].auth.includes("oauth_signature="));
  const denied = async () => ({ status: 200, json: async () => ({ meta: { code: 401, description: "TOKEN_IP_MISMATCHED" } }) });
  await assert.rejects(priceGuide("10294-1", "N", keys, { fetchFn: denied }), /TOKEN_IP_MISMATCHED/);
});

// ---------- Brickset ----------
const BS = {
  setID: 26725, number: "75192", numberVariant: 1, name: "Millennium Falcon", year: 2017, theme: "Star Wars", subtheme: "Ultimate Collector Series",
  pieces: 7541, minifigs: 8, image: { imageURL: "https://images.brickset.com/sets/images/75192-1.jpg" }, bricksetURL: "https://brickset.com/sets/75192-1",
  launchDate: "2017-10-01T00:00:00Z", exitDate: null,
  LEGOCom: { DE: { retailPrice: 849.99, dateFirstAvailable: "2017-10-01T00:00:00Z", dateLastAvailable: null }, US: { retailPrice: 849.99 } },
};

await test("Brickset : appel getSets et lecture de la fiche", async () => {
  const calls = [];
  const fake = async (url, init) => { calls.push({ url, init }); return { status: 200, json: async () => ({ status: "success", matches: 1, sets: [BS] }) }; };
  const s = await bsGetSet("75192-1", "CLE", fake);
  assert.equal(calls[0].url, "https://brickset.com/api/v3.asmx/getSets");
  assert.equal(calls[0].init.method, "POST");
  const body = new URLSearchParams(calls[0].init.body);
  assert.equal(body.get("apiKey"), "CLE");
  assert.equal(body.get("userHash"), "");
  assert.deepEqual(JSON.parse(body.get("params")), { setNumber: "75192-1" });
  const row = parseBrickset(s);
  assert.equal(row.set_no, "75192-1");
  assert.equal(row.rrp_eur, 849.99);
  assert.equal(row.launch_date, "2017-10-01");
  assert.equal(row.exit_date, null);
  assert.equal(row.pieces, 7541);
  assert.equal(row.theme, "Star Wars");
  const none = async () => ({ status: 200, json: async () => ({ status: "success", matches: 0, sets: [] }) });
  assert.equal(await bsGetSet("99999-1", "CLE", none), null);
  const limit = async () => ({ status: 200, json: async () => ({ status: "error", message: "API limit exceeded" }) });
  await assert.rejects(bsGetSet("75192-1", "CLE", limit), /Brickset : API limit exceeded/);
});

await test("Brickset : fusion avec la fiche BrickLink et rafraîchissement", () => {
  const bs = parseBrickset({ ...BS, exitDate: "2024-12-31T00:00:00Z", LEGOCom: {} });
  assert.equal(bs.rrp_eur, null);
  assert.equal(bs.launch_date, "2017-10-01");
  const bl = { set_no: "75192-1", name: "Millennium Falcon - UCS (2nd edition)", year: 2017, image_url: "https://img.bricklink.com/x.png", category_id: 65 };
  const m = mergeSet(bl, bs, "2026-11-27T00:00:00Z");
  assert.equal(m.name, bl.name); // BrickLink prime pour le nom et l'image
  assert.equal(m.image_url, bl.image_url);
  assert.equal(m.exit_date, "2024-12-31");
  assert.equal(m.brickset_at, "2026-11-27T00:00:00Z");
  const only = mergeSet(null, bs, null);
  assert.equal(only.name, "Millennium Falcon");
  assert.equal(only.category_id, null);
  assert.equal(only.brickset_at, undefined);
  const notFound = mergeSet(bl, null, "2026-11-27T00:00:00Z");
  assert.equal(notFound.theme, undefined);
  assert.equal(notFound.brickset_at, "2026-11-27T00:00:00Z");
  const now = new Date("2026-11-27T12:00:00Z");
  assert.equal(needsBrickset({}, now), true);
  assert.equal(needsBrickset({ brickset_at: "2026-11-20T00:00:00Z" }, now), false);
  assert.equal(needsBrickset({ brickset_at: "2026-10-01T00:00:00Z" }, now), true);
  assert.equal(needsBrickset({ brickset_at: "2026-10-01T00:00:00Z", exit_date: "2024-12-31" }, now), false); // retiré depuis longtemps : figé
  // Autour de la date de retrait (souvent repoussée) : chaque semaine, et encore 6 mois après
  assert.equal(needsBrickset({ brickset_at: "2026-11-23T00:00:00Z", exit_date: "2026-12-31" }, now), false);
  assert.equal(needsBrickset({ brickset_at: "2026-11-20T00:00:00Z", exit_date: "2026-12-31" }, now), true);
  assert.equal(needsBrickset({ brickset_at: "2026-11-20T00:00:00Z", exit_date: "2026-10-31" }, now), true);
  assert.equal(needsBrickset({ brickset_at: "2026-11-20T00:00:00Z", exit_date: "2027-12-31" }, now), false); // loin : 30 jours
});

await test("statut LEGO, comparaison au prix d'origine, filtre", () => {
  const now = "2026-11-27";
  assert.equal(setStatus(null, now), null);
  assert.equal(setStatus({ name: "x" }, now), null);
  assert.equal(setStatus({ rrp: 100 }, now), "available");
  assert.equal(setStatus({ exitDate: "2025-12-31" }, now), "retired");
  assert.equal(setStatus({ exitDate: "2027-06-30" }, now), "retiring");
  const c = vsRetail(P({ unitPrice: 500 }), { rrp: 625 }, 750);
  assert.equal(Math.round(c.paid * 100), -20);
  assert.equal(Math.round(c.value * 100), 20);
  assert.equal(vsRetail(P({}), { rrp: null }, 750), null);
  const sets = { "10294-1": { name: "Titanic", exitDate: "2025-12-31", rrp: 629.99 }, "21318-1": { name: "Tree House", launchDate: "2019-08-01" } };
  const rows = [analyze(P({}), [], sets, now), analyze(P({ setNo: "21318-1" }), [], sets, now)];
  assert.equal(rows[0].status, "retired");
  assert.deepEqual(filterRows(rows, { status: "retired" }).map((r) => r.p.setNo), ["10294-1"]);
  assert.deepEqual(filterRows(rows, { status: "available" }).map((r) => r.p.setNo), ["21318-1"]);
  const csv = toCSV([P({})], [], sets);
  assert.ok(csv.includes('"Prix LEGO d\'origine";"Date de retrait"'));
  assert.ok(csv.includes('"629,99";"2025-12-31"'));
});

await test("historique : prix LEGO d'origine du stock", () => {
  const ps = [P({ id: "a", qty: 2, date: "2024-01-01" }), P({ id: "b", setNo: "21318-1", date: "2024-06-01" })];
  const pr = [R("2024-03-01", 600), { ...R("2024-07-01", 220), setNo: "21318-1" }];
  const h = portfolioHistory(ps, pr, { "10294-1": { rrp: 629.99 }, "21318-1": { rrp: 199.99 } });
  assert.equal(h[0].retail, 1259.98);
  assert.equal(Math.round(h.at(-1).retail * 100) / 100, 1459.97);
  const partial = portfolioHistory(ps, pr, { "10294-1": { rrp: 629.99 } });
  assert.equal(partial.at(-1).retail, null); // une boîte sans prix d'origine : pas de total
  assert.equal(portfolioHistory(ps, pr)[0].retail, null);
});

await test("message de fin de relevé : BrickLink et Brickset", () => {
  const ok = refreshSummary({ ok: 7, failed: 0, skipped: 0, brickset: 0, bricklink: true, message: "7 relevé(s) sur 7. 0 fiche(s) Brickset mise(s) à jour" });
  assert.equal(ok.text, "✓ BrickLink : 7 prix relevés\n✓ Brickset : fiches LEGO déjà à jour");
  assert.equal(ok.error, false);
  const two = refreshSummary({ ok: 1, failed: 0, brickset: 2, bricklink: true, message: "1 relevé(s) sur 1. 2 fiche(s) Brickset mise(s) à jour" });
  assert.equal(two.text, "✓ BrickLink : 1 prix relevé\n✓ Brickset : 2 fiches LEGO mises à jour");
  const bad = refreshSummary({ ok: 6, failed: 1, brickset: 0, bricklink: true,
    message: "6 relevé(s) sur 7. 0 fiche(s) Brickset mise(s) à jour. Brickset : 75397-1 : Brickset : Invalid API key ; 75192-1 : x. Échecs : 10318-1 (N) : y" });
  assert.equal(bad.text, "✗ BrickLink : 6 prix relevés, 1 échec\n✗ Brickset : erreur (75397-1 : Brickset : Invalid API key)");
  assert.equal(bad.error, true);
  const noKeys = refreshSummary({ ok: 0, failed: 0, brickset: 3, bricklink: false, message: "Prix BrickLink : clés absentes. 3 fiche(s) Brickset mise(s) à jour" });
  assert.equal(noKeys.text, "✗ BrickLink : clés absentes, prix non relevés\n✓ Brickset : 3 fiches LEGO mises à jour");
  assert.equal(refreshSummary({ ok: 2, failed: 0, brickset: 0, bricklink: true, message: "2 relevé(s) sur 2" }).text,
    "✓ BrickLink : 2 prix relevés\n✗ Brickset : clé absente, fiches LEGO non vérifiées");
  assert.equal(refreshSummary({ ok: 3, failed: 0, total: 3, message: "3 relevé(s) simulé(s)" }).text, "✓ BrickLink : 3 prix relevés"); // démo
});

console.log(`\n${n} tests réussis`);
