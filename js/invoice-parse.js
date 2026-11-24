// Analyse du texte d'une facture (lu sur l'appareil, sans service externe) :
// vendeur, date, sets LEGO, quantités, prix payés, frais de port, remise et total.
// Ce sont des règles, pas de l'intelligence : le résultat est toujours à vérifier dans le formulaire.

const SHOPS = [
  [/amazon\.fr/i, "Amazon.fr"], [/amazon\.de/i, "Amazon.de"], [/amazon\.(?:com\.)?be/i, "Amazon.com.be"], [/amazon\.nl/i, "Amazon.nl"], [/amazon/i, "Amazon"],
  [/bol\.com/i, "Bol.com"], [/\bfnac\b/i, "Fnac"], [/dreamland/i, "Dreamland"], [/intertoys/i, "Intertoys"], [/maxi\s*toys/i, "Maxi Toys"],
  [/king\s*jouet/i, "King Jouet"], [/jou[ée]\s*club/i, "JouéClub"], [/smyths/i, "Smyths Toys"], [/vinted/i, "Vinted"], [/2ememain|2dehands/i, "2ememain"],
  [/cdiscount/i, "Cdiscount"], [/coolblue/i, "Coolblue"], [/media\s*markt/i, "MediaMarkt"], [/carrefour/i, "Carrefour"], [/colruyt/i, "Colruyt"],
  [/zavvi/i, "Zavvi"], [/kruidvat/i, "Kruidvat"], [/auchan/i, "Auchan"], [/leclerc/i, "E.Leclerc"], [/grande\s*r[ée]cr[ée]/i, "La Grande Récré"],
  [/toys\s*.?r.?\s*us/i, "Toys\"R\"Us"], [/bricklink/i, "BrickLink"], [/\bebay\b/i, "eBay"], [/brickshop/i, "BrickShop"],
  [/lego\s*(?:store|brand\s*retail|certified\s*store)|magasin\s+lego/i, "LEGO Store"], [/lego\.com|shop\s*at\s*home|lego\s*system/i, "LEGO.com"],
];

const MONTHS = {
  janvier: 1, janv: 1, january: 1, januari: 1, jan: 1, février: 2, fevrier: 2, févr: 2, fevr: 2, february: 2, februari: 2, feb: 2, fév: 2, fev: 2,
  mars: 3, march: 3, maart: 3, mar: 3, avril: 4, april: 4, avr: 4, apr: 4, mai: 5, may: 5, mei: 5, juin: 6, june: 6, juni: 6, jun: 6,
  juillet: 7, juil: 7, july: 7, juli: 7, jul: 7, août: 8, aout: 8, august: 8, augustus: 8, aug: 8, septembre: 9, september: 9, sept: 9, sep: 9,
  octobre: 10, october: 10, oktober: 10, oct: 10, okt: 10, novembre: 11, november: 11, nov: 11, décembre: 12, decembre: 12, december: 12, déc: 12, dec: 12,
};

const pad = (n) => String(n).padStart(2, "0");
const validDate = (y, m, d) => {
  if (y < 100) y += 2000;
  if (!(y >= 1999 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  return new Date(`${iso}T12:00:00Z`).getUTCDate() === d ? iso : null;
};

const DATE_RES = [
  [/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (m) => validDate(+m[1], +m[2], +m[3])],
  [/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g, (m) => validDate(+m[3], +m[2], +m[1])],
  [/\b(\d{1,2})(?:er)?\.?\s+([a-zéûôA-ZÉÛÔ]{3,9})\.?,?\s+(\d{4})\b/g, (m) => MONTHS[m[2].toLowerCase()] && validDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1])],
];
function datesIn(line) {
  const out = [];
  for (const [re, fn] of DATE_RES) for (const m of line.matchAll(re)) { const d = fn(m); if (d) out.push({ iso: d, at: m.index, len: m[0].length }); }
  return out;
}
const withoutDates = (line) => {
  let s = line;
  for (const [re] of DATE_RES) s = s.replace(re, " ");
  return s.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " "); // heures
};

// Montants : 629,99 · 1.234,56 · 1 234,56 · 629.99 · -30,00 · 30,00- (pas les pourcentages).
// Sur une ligne d'article, « 1 629,99 » se lit « quantité 1, 629,99 » : l'espace n'y sépare pas les milliers.
const AMOUNT_RE = /(?<![\d.,])(-?\s?)(\d{1,3}(?:[ .\u00a0\u202f']\d{3})+[.,]\d{2}|\d+[.,]\d{2})(-?)(?![\d%]|\s?%)/g;
const AMOUNT_ITEM_RE = /(?<![\d.,])(-?\s?)(\d{1,3}(?:[.']\d{3})+[.,]\d{2}|\d+[.,]\d{2})(-?)(?![\d%]|\s?%)/g;
export function amountsIn(line, { item = false } = {}) {
  const out = [];
  for (const m of withoutDates(line).matchAll(item ? AMOUNT_ITEM_RE : AMOUNT_RE)) {
    const raw = m[2].replace(/[ \u00a0\u202f']/g, "");
    const dec = raw.slice(-3, -2);
    const v = Number(raw.slice(0, -3).replace(/[.,]/g, "") + "." + raw.slice(-2));
    if (dec !== "." && dec !== ",") continue;
    out.push((m[1].trim() === "-" || m[3] === "-") ? -v : v);
  }
  return out;
}

const NOT_ITEM = /(n[°ºo]\.?\s|num[ée]ro|commande|order|facture|invoice|tva|btw|vat|iban|bic|t[ée]l[ée]?phone|\btel\b|client|klant|kunde|\bean\b|siret|siren|kbo|onderneming|bestel|transaction|caisse|kassa|ticket|terminal|carte|card|visa|mastercard|bancontact|code postal|postcode|adresse|address|adres|rue\b|straat|avenue|chauss[ée]e|bo[iî]te postale)/i;
// Frais comptés avec l'achat : port / livraison et frais de service (protection acheteurs Vinted…)
const SHIPPING = /(frais\s+(?:de\s+)?(?:port|livraison|envoi|d'exp[ée]dition)|livraison|exp[ée]dition|\benvoi\b|verzend|bezorg|shipping|versand|\bport\b|frais\s+de\s+(?:protection|service)|protection\s+acheteur|servicekosten|kopersbescherming|service\s+fee)/i;
const FREE = /(gratuit|gratis|free|offert|kostenlos)/i;
const DISCOUNT = /(remise|r[ée]duction|korting|promo|rabais|discount|coupon|bon\s+de\s+r[ée]duction|avantage|rabatt|actie)/i;
const TOTAL = /(total|[àa]\s+payer|te\s+betalen|totaal|montant\s+d[uû]|gesamt|bedrag)/i;
const NOT_TOTAL = /(sous[-\s]?total|subtotal|tussentotaal|tva|btw|vat|hors|htva|excl|\bht\b|articles|items|aantal)/i;
const USED = /(vinted|2ememain|2dehands|d'occasion|\boccasion\b|tweedehands|gebruikt|seconde\s+main)/i;

const QTY_RES = [/(?:^|\s)(\d{1,2})\s+(?:€\s?)?\d+[.,]\d{2}\b/, /(?:qt[ée]|qty|quantit[ée]|aantal|menge|nombre)\s*[:.]?\s*(\d{1,2})\b/i, /(?:^|\s)(\d{1,2})\s?[x×]\s/i, /\s[x×]\s?(\d{1,2})\b/i];

function setCandidates(line, known) {
  const clean = withoutDates(line).replace(AMOUNT_ITEM_RE, " ");
  const out = [];
  for (const m of clean.matchAll(/(?<![\d.,/-])(\d{4,6})(?:-(\d{1,2}))?(?![\d.,/%])/g)) {
    const no = `${m[1]}-${m[2] || 1}`;
    out.push({ no, digits: m[1], known: known.has(no) });
  }
  return out;
}

const round2 = (v) => Math.round(v * 100) / 100;

export function parseInvoiceText(text, { knownSets = [], today = new Date().toISOString().slice(0, 10) } = {}) {
  const known = new Set(knownSets);
  const lines = String(text || "").split(/\r?\n/)
    .map((l) => l.replace(/[ \t\u00a0\u202f]+/g, " ").replace(/(\d) ?([.,]) (\d{2})(?!\d)/g, "$1$2$3").trim()) // OCR : « 169, 99 » → « 169,99 »
    .filter(Boolean);
  const all = lines.join("\n");
  const warnings = [];

  // Vendeur
  let shop = null;
  for (const [re, name] of SHOPS) if (re.test(all)) { shop = name; break; }

  // Date : de préférence sur une ligne « date / commande / facture… »
  let date = null;
  const dated = lines.flatMap((l, i) => datesIn(l).map((d) => ({ ...d, i, key: /(date|datum|command|order|factur|invoice|bestel|achat|aankoop|emis|émis|vente|ticket)/i.test(l) })))
    .filter((d) => d.iso <= today);
  date = (dated.find((d) => d.key) || dated[0])?.iso || null;

  // Devise
  const currency = /€|\bEUR\b/i.test(all) ? "EUR" : /£|\bGBP\b/.test(all) ? "GBP" : /\$|\bUSD\b/.test(all) ? "USD" : null;

  // Frais (port + service), remise, total
  let shipping = null, discount = 0, total = null;
  for (const l of lines) {
    const a = amountsIn(l);
    if (SHIPPING.test(l) && !/adresse|address|adres|d[ée]lai|date/i.test(l) && !TOTAL.test(l)) {
      if (a.length) shipping = round2((shipping || 0) + Math.abs(a.at(-1))); else if (FREE.test(l)) shipping = shipping ?? 0;
    }
    if (DISCOUNT.test(l) && a.length && !setCandidates(l, known).some((c) => c.known || /lego/i.test(l))) discount += Math.abs(a.at(-1));
    if (TOTAL.test(l) && !NOT_TOTAL.test(l) && a.length) total = Math.max(total ?? 0, ...a.map(Math.abs));
  }

  // Sets
  const items = [];
  const used = new Set(); // lignes déjà rattachées à un set (prix, référence du vendeur, suite du nom)
  const isLego = (x) => /lego/i.test(x || "");
  // Ligne qui peut porter le prix d'un set : pas un autre set LEGO, pas un total, une remise ou des frais.
  const plain = (x) => x && !isLego(x) && !setCandidates(x, known).some((c) => c.known) && !TOTAL.test(x) && !DISCOUNT.test(x) && !SHIPPING.test(x);
  const texty = (x) => x && /[a-zà-ÿ]{3}/i.test(x) && !amountsIn(x).length && !/\d{4}/.test(x) && x.length < 60
    && !TOTAL.test(x) && !SHIPPING.test(x) && !DISCOUNT.test(x) && !NOT_ITEM.test(x) && !/(prix|price|prijs|quantit|remise|sous|taux|nom\b|r[ée]f[ée]rence|total|ttc|htva|\(€\))/i.test(x);

  lines.forEach((l, i) => {
    if (used.has(i)) return;
    const lego = isLego(l) || isLego(lines[i - 1]);
    const cands = setCandidates(l, known).filter((c) => {
      if (c.known) return true;
      const year = c.digits.length === 4 && +c.digits >= 1990 && +c.digits <= 2040;
      if (lego) return !year && !NOT_ITEM.test(l.replace(/lego/ig, ""));
      if (c.digits.length !== 5 || NOT_ITEM.test(l)) return false; // hors ligne « LEGO » : seulement 5 chiffres (6 = souvent une référence du vendeur)
      return amountsIn(l).length > 0 || amountsIn(lines[i + 1] || "").length > 0;
    });
    if (!cands.length) return;
    const c = cands[0];
    if (items.some((it) => it.set_no === c.no)) return; // déjà vu (récapitulatif, ligne répétée)

    // Montants de la ligne, sinon des deux lignes suivantes
    let amounts = amountsIn(l, { item: true });
    let src = l;
    for (let k = 1; !amounts.length && k <= 2 && plain(lines[i + k]); k++) {
      src = lines[i + k]; amounts = amountsIn(src, { item: true });
      used.add(i + k);
    }
    const neg = amounts.filter((v) => v < 0).reduce((s, v) => s - v, 0);
    const pos = amounts.filter((v) => v > 0);
    const near = (x, y) => Math.abs(x - y) < 0.02;
    const count = (v) => pos.filter((a) => near(a, v)).length;

    let qty = null;
    for (const re of QTY_RES) { const m = withoutDates(src).replace(c.digits, " ").match(re); if (m && +m[1] > 0) { qty = +m[1]; break; } }
    let unit = null;
    if (!qty) { // quantité déduite d'un couple prix unitaire / total de ligne
      for (const a of pos) {
        const k = pos.map((b) => b / a).find((r) => r > 1.5 && r <= 50 && Math.abs(r - Math.round(r)) < 0.005);
        if (k) { qty = Math.round(k); unit = a; break; }
      }
    }
    qty = qty || 1;
    if (unit == null && pos.length) {
      // prix unitaire = celui dont on retrouve le total de ligne (ou qui revient deux fois), sinon le premier
      unit = pos.find((a) => (qty > 1 ? pos.some((b) => near(b, a * qty)) : count(a) >= 2)) ?? pos[0];
    }
    if (unit != null && neg) unit = Math.max(0, unit - neg / qty);

    let name = l.replace(AMOUNT_ITEM_RE, " ").replace(c.digits, " ").replace(/[€®™]|\bEUR\b/g, " ")
      .replace(/(?:qt[ée]|qty|quantit[ée]|aantal)\s*[:.]?\s*\d+/i, " ").replace(/\s[x×]\s?\d{1,2}\b/i, " ")
      .replace(/\s+\d{1,2}\s*$/, " ").replace(/\s+/g, " ").replace(/^[\s\-–:|*.]+|[\s\-–:|*.]+$/g, "").trim();
    // Suite du nom sur la ligne suivante (après la ligne de prix éventuelle)
    for (let k = 1; k <= 3; k++) {
      if (used.has(i + k)) continue;
      if (texty(lines[i + k])) { name = `${name} ${lines[i + k]}`.trim(); used.add(i + k); }
      break;
    }
    items.push({ set_no: c.no, name: name.slice(0, 120) || `Set ${c.no}`, qty, unit_price: unit == null ? null : round2(unit), condition: USED.test(all) ? "U" : null, _amounts: pos });
  });

  // Un seul set : si le total le confirme, on retient le montant qui donne ce total (TTC plutôt que HT…)
  if (items.length === 1 && total != null) {
    const it = items[0];
    const fit = (v) => Math.abs(v * it.qty + (shipping || 0) - total) < 0.06;
    if (!(it.unit_price != null && fit(it.unit_price))) {
      const better = it._amounts.find(fit);
      if (better != null) it.unit_price = round2(better);
    }
  }
  for (const it of items) delete it._amounts;

  // Aucun numéro : une ligne « LEGO » avec un prix devient un set sans numéro
  if (!items.length) {
    const l = lines.find((x) => /lego/i.test(x) && amountsIn(x).some((v) => v > 0) && !TOTAL.test(x));
    if (l) {
      const unit = amountsIn(l).filter((v) => v > 0)[0];
      items.push({ set_no: null, name: l.replace(AMOUNT_RE, " ").replace(/[€®™]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120), qty: 1, unit_price: round2(unit), condition: USED.test(all) ? "U" : null });
    }
  }

  // Remise globale et contrôle du total
  const sum = items.reduce((s, it) => s + (it.unit_price || 0) * it.qty, 0);
  const ship = shipping || 0;
  if (items.length && total != null && items.every((it) => it.unit_price != null)) {
    if (discount && Math.abs(sum + ship - discount - total) < 0.06 && sum > 0) {
      const k = (sum - discount) / sum; // remise répartie au prorata
      for (const it of items) it.unit_price = round2(it.unit_price * k);
      warnings.push(`Remise de ${discount.toFixed(2).replace(".", ",")} € répartie entre les sets.`);
    } else if (Math.abs(sum + ship - total) > 0.06) {
      warnings.push(`Total de la facture : ${total.toFixed(2).replace(".", ",")} € ; la somme lue fait ${(sum + ship).toFixed(2).replace(".", ",")} €. Vérifie les prix.`);
    }
  } else if (discount && items.length) {
    warnings.push(`Remise de ${discount.toFixed(2).replace(".", ",")} € repérée : vérifie les prix.`);
  }
  if (!items.length) warnings.push("Aucun set LEGO reconnu : complète le formulaire à la main.");
  else if (items.some((it) => !it.set_no)) warnings.push("Numéro du set introuvable sur la facture : entre-le à la main.");
  if (currency && currency !== "EUR") warnings.push(`Montants en ${currency} : convertis-les en euros.`);

  return { shop, date, currency, shipping, items, warning: warnings.join(" ") || null };
}
