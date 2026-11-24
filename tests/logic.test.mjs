// node tests/logic.test.mjs
import assert from "node:assert/strict";
import {
  normalizeSetNo, cost, unitValue, latestPrice, annualized, position, summary, positionHistory, portfolioHistory, toCSV,
  manualRow, valueSource,
} from "../js/invest.js";
import { invoiceRequest, parseInvoice, INVOICE_SCHEMA } from "../supabase/functions/bricklink/facture.js";
import { pct, oauthHeader, parseGuide, parseItem, decodeEntities, priceGuide } from "../supabase/functions/bricklink/bricklink.js";

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
    { on: "2023-01-01", value: 500, invested: 500 },
    { on: "2023-02-01", value: 520, invested: 500 },
    { on: "2023-03-01", value: 1040, invested: 800 },
    { on: "2023-04-01", value: 1080, invested: 800 },
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

// ---------- Lecture de facture ----------
await test("demande de lecture : PDF en document, photo en image, format imposé", () => {
  const pdf = invoiceRequest("application/pdf", "QUJD");
  assert.equal(pdf.messages[0].content[0].type, "document");
  assert.equal(pdf.messages[0].content[0].source.data, "QUJD");
  assert.equal(invoiceRequest("image/jpeg", "x").messages[0].content[0].type, "image");
  assert.equal(pdf.output_config.format.type, "json_schema");
  assert.equal(pdf.fallbacks, "default");
  // Toutes les propriétés de chaque objet sont requises et aucune autre n'est permise.
  const check = (o) => {
    if (o.type === "object") { assert.equal(o.additionalProperties, false); assert.deepEqual([...o.required].sort(), Object.keys(o.properties).sort()); Object.values(o.properties).forEach(check); }
    if (o.type === "array") check(o.items);
    (o.anyOf || []).forEach(check);
  };
  check(INVOICE_SCHEMA);
});

await test("réponse de lecture nettoyée", () => {
  const r = parseInvoice({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({
    shop: " Fnac ", date: "2023-03-14", currency: "eur", shipping: 4.999,
    items: [{ set_no: "10294", name: "LEGO Titanic", qty: 2, unit_price: 539.994, condition: "N" },
            { set_no: "n/a ?", name: "Sac", qty: 0, unit_price: -1, condition: "X" }],
    warning: null }) }] });
  assert.equal(r.shop, "Fnac");
  assert.equal(r.currency, "EUR");
  assert.equal(r.shipping, 5);
  assert.deepEqual(r.items[0], { set_no: "10294-1", name: "LEGO Titanic", qty: 2, unit_price: 539.99, condition: "N" });
  assert.deepEqual(r.items[1], { set_no: null, name: "Sac", qty: 1, unit_price: null, condition: null });
  assert.equal(parseInvoice({ stop_reason: "end_turn", content: [{ type: "text", text: '{"date":"14/03/2023","items":[]}' }] }).date, null);
  assert.throws(() => parseInvoice({ stop_reason: "refusal", content: [] }), /refusée/);
  assert.throws(() => parseInvoice({ stop_reason: "end_turn", content: [{ type: "text", text: "pas du json" }] }), /illisible/);
});

console.log(`\n${n} tests réussis`);
