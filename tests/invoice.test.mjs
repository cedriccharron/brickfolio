// node tests/invoice.test.mjs — lecture des factures à partir de leur texte
import assert from "node:assert/strict";
import { parseInvoiceText, amountsIn } from "../js/invoice-parse.js";

let n = 0;
const test = (name, fn) => { fn(); n++; console.log("ok -", name); };
const today = "2026-11-24";

test("montants (formats belges, français, anglais)", () => {
  assert.deepEqual(amountsIn("Total 1.234,56 € TVA 21,00 %"), [1234.56]);
  assert.deepEqual(amountsIn("629,99  1 259,98"), [629.99, 1259.98]);
  assert.deepEqual(amountsIn("Price 99.99 EUR, remise -10,00"), [99.99, -10]);
  assert.deepEqual(amountsIn("Date 14.03.2023 12:31"), []);
});

test("facture LEGO.com : 2 sets, quantité, livraison offerte", () => {
  const r = parseInvoiceText(`LEGO System A/S
Facture n° 1234567890
Date de commande : 14/03/2023
Article Qté Prix unitaire Total
LEGO® Icons Titanic 10294 1 629,99 € 629,99 €
LEGO® Ideas La cabane dans l'arbre 21318 2 199,99 € 399,98 €
Frais de livraison Gratuit
Total TTC 1 029,97 €
TVA 21% incluse 178,75 €`, { today });
  assert.equal(r.shop, "LEGO.com");
  assert.equal(r.date, "2023-03-14");
  assert.equal(r.shipping, 0);
  assert.deepEqual(r.items.map((i) => [i.set_no, i.qty, i.unit_price]), [["10294-1", 1, 629.99], ["21318-1", 2, 199.99]]);
  assert.match(r.items[0].name, /Titanic/);
  assert.equal(r.warning, null);
});

test("ticket de caisse : remise globale répartie", () => {
  const r = parseInvoiceText(`DREAMLAND
Rue Neuve 111 1000 Bruxelles
Ticket 0045 Caisse 3   18-11-2026 15:42
LEGO STAR WARS 75313 AT-AT 849,99
LEGO CREATOR 10300 DELOREAN 169,99
Remise fidélité -101,99
TOTAL A PAYER 917,99
Bancontact 917,99`, { today });
  assert.equal(r.shop, "Dreamland");
  assert.equal(r.date, "2026-11-18");
  assert.deepEqual(r.items.map((i) => i.set_no), ["75313-1", "10300-1"]);
  assert.equal(r.items[0].unit_price + r.items[1].unit_price, 917.99);
  assert.match(r.warning, /Remise de 101,99/);
});

test("Amazon : numéro reconnu dans le nom, frais de port, total cohérent", () => {
  const r = parseInvoiceText(`amazon.fr
Facture
Date de la facture/Date de livraison 24 novembre 2023
Numéro de commande 402-1234567-1234567
Description Qté Prix unitaire (TTC) Total (TTC)
LEGO 10497 Icons Galaxy Explorer, Set de Construction
3 79,99 € 239,97 €
Frais de port 4,99 €
Total payable 244,96 €`, { today });
  assert.equal(r.shop, "Amazon.fr");
  assert.equal(r.date, "2023-11-24");
  assert.equal(r.shipping, 4.99);
  assert.deepEqual(r.items.map((i) => [i.set_no, i.qty, i.unit_price]), [["10497-1", 3, 79.99]]);
  assert.equal(r.warning, null);
});

test("Vinted : occasion, set connu à 4 chiffres ignoré s'il est une année", () => {
  const r = parseInvoiceText(`Vinted
Reçu de commande 12/01/2025
Lego Technic 42143 Ferrari Daytona 2022 complet
Prix de l'article 310,00 €
Frais de protection acheteurs 16,20 €
Envoi 4,59 €
Total 330,79 €`, { today });
  assert.equal(r.shop, "Vinted");
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].set_no, "42143-1");
  assert.equal(r.items[0].condition, "U");
  assert.equal(r.shipping, 20.79); // port + protection acheteurs
  assert.equal(r.warning, null);
});

test("sans numéro de set : ligne LEGO reprise avec son prix, n° de commande ignoré", () => {
  const r = parseInvoiceText(`FNAC
Commande 123456 du 02/09/2021
LEGO Ideas Cabane dans l'arbre 179,99 €
Total 179,99 €`, { today });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].set_no, null);
  assert.equal(r.items[0].unit_price, 179.99);
  assert.match(r.warning, /Numéro du set introuvable/);
});

test("set connu reconnu même sans le mot LEGO ; date future ignorée", () => {
  const r = parseInvoiceText(`Bol.com
Besteldatum 05-06-2024  Levering 01-01-2099
Icons 10294 Titanic   1   599,00
Totaal 599,00`, { knownSets: ["10294-1"], today });
  assert.equal(r.date, "2024-06-05");
  assert.equal(r.items[0].set_no, "10294-1");
  assert.equal(r.items[0].unit_price, 599);
});

test("texte d'OCR : espace après la virgule, ligne sans prix qui ne vole pas le total", () => {
  const r = parseInvoiceText(`DREAMLAND
LEGO STAR WARS 75313 AT-AT 849,99
LEGO CREATOR 10300 DELOREAN 169, 99
LEGO CITY 60337 TRAIN
Remise fidelite -101, 99
TOTAL A PAYER 917,99`, { today });
  assert.deepEqual(r.items.map((i) => [i.set_no, i.unit_price]), [["75313-1", 849.99], ["10300-1", 169.99], ["60337-1", null]]);
  assert.match(r.warning, /Remise de 101,99 € repérée/);
});

test("Smyths Toys (PDF) : référence du vendeur ignorée, prix TTC plutôt que HT, nom sur deux lignes", () => {
  const r = parseInvoiceText(`Date 24/11/2026
Smyths Toys EU HQ UC
Numéro de commande BEL111700553
Lyrr Building 1
Galway H91K4HV
Numéro de TVA intracommunautaire : BE1005911279
Facture à : Adresse de livraison :
Jean Exemple Jean Exemple
Rue de l'Exemple 1 Rue de l'Exemple 1
1000 Bruxelles
Prix Prix Sous
Remise Sous-total Eco-taxe Taux TVA
Nom Référence Quantité unitaire remise Total HT
(€) TTC (€) (€) (%)
TTC (€) TTC (€) (€)
LEGO Star Wars 75192
168282 1 599,99 0.00 599.99 599.99 0.0 21,00 495,86
UCS Faucon Millenium
Sous Total HT (€) 495,86
Sous Total TTC (€) 599,99
Frais de livraison TTC (€) 0,00
MONTANT TTC A PAYER 599,99
Dont TVA (€) 104,13
Carte Bancaire (€) 599,99`, { today });
  assert.equal(r.shop, "Smyths Toys");
  assert.equal(r.date, "2026-11-24");
  assert.equal(r.shipping, 0);
  assert.equal(r.items.length, 1);
  assert.deepEqual([r.items[0].set_no, r.items[0].qty, r.items[0].unit_price], ["75192-1", 1, 599.99]);
  assert.equal(r.items[0].name, "LEGO Star Wars UCS Faucon Millenium");
  assert.equal(r.warning, null);
});

test("texte vide", () => {
  const r = parseInvoiceText("", { today });
  assert.deepEqual(r.items, []);
  assert.match(r.warning, /Aucun set/);
});

console.log(`\n${n} tests réussis`);
