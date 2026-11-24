// Lecture d'une facture par Claude : consigne, format de réponse et contrôle du résultat.
// Partagé entre la fonction Supabase (Deno) et les tests Node.

export const INVOICE_MODEL = "claude-opus-5-5";
export const INVOICE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"];
export const INVOICE_MAX_BYTES = 8 * 1024 * 1024; // fichier encodé reçu par la fonction

const nullable = (type) => ({ anyOf: [{ type }, { type: "null" }] });

export const INVOICE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["shop", "date", "currency", "shipping", "items", "warning"],
  properties: {
    shop: nullable("string"),
    date: nullable("string"),
    currency: nullable("string"),
    shipping: nullable("number"),
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["set_no", "name", "qty", "unit_price", "condition"],
        properties: {
          set_no: nullable("string"),
          name: { type: "string" },
          qty: { type: "integer" },
          unit_price: nullable("number"),
          condition: { anyOf: [{ type: "string", enum: ["N", "U"] }, { type: "null" }] },
        },
      },
    },
    warning: nullable("string"),
  },
};

export const INVOICE_PROMPT = `Voici une facture, un ticket de caisse ou une confirmation de commande. Relève les achats de sets LEGO qu'elle contient.

- shop : le vendeur, en quelques mots (ex. « LEGO Store Bruxelles », « Amazon.fr », « Fnac », « Vinted »).
- date : la date d'achat ou de commande, au format AAAA-MM-JJ.
- currency : la devise (code ISO, ex. EUR).
- shipping : le total des frais de port ou de livraison, sinon 0 s'ils sont indiqués gratuits, sinon null.
- items : un élément par set LEGO (ignore les sacs, cartes cadeaux, produits non LEGO et lignes de remise).
  - set_no : le numéro du set LEGO (souvent 4 à 6 chiffres dans le nom ou la référence, ex. 10294), sans tiret. null si absent.
  - name : le nom tel qu'il apparaît.
  - qty : le nombre de boîtes.
  - unit_price : le prix réellement payé pour UNE boîte, TVA comprise, après les remises de la ligne. Si une remise porte sur toute la commande (code promo, réduction en caisse), répartis-la entre les sets au prorata de leur prix. Sans les frais de port.
  - condition : "U" si l'achat est clairement d'occasion (Vinted, 2ememain, « occasion »), "N" si neuf, null si on ne sait pas.
- warning : une phrase courte en français s'il y a un doute (montant illisible, plusieurs devises, document qui n'est pas une facture…), sinon null.

N'invente rien : mets null pour ce qui n'est pas lisible.`;

// Paramètres de l'appel à l'API Messages (le fichier est envoyé en base64).
export function invoiceRequest(mediaType, data) {
  const file = mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: mediaType, data } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data } };
  return {
    model: INVOICE_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // si le modèle refuse, l'API relance la demande sur le modèle de repli recommandé
    output_config: { effort: "low", format: { type: "json_schema", schema: INVOICE_SCHEMA } },
    messages: [{ role: "user", content: [file, { type: "text", text: INVOICE_PROMPT }] }],
  };
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null);
const isoDate = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
const setNo = (v) => {
  const s = String(v ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[0-9A-Z]{3,10}(-\d+)?$/.test(s)) return null;
  return s.includes("-") ? s : `${s}-1`;
};

// Réponse du modèle → résultat propre pour l'app.
export function parseInvoice(response) {
  if (response.stop_reason === "refusal") throw new Error("La lecture de cette facture a été refusée");
  if (response.stop_reason === "max_tokens") throw new Error("Facture trop longue à lire");
  const text = (response.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error("Réponse illisible, réessaie"); }
  const items = (Array.isArray(raw.items) ? raw.items : []).map((it) => ({
    set_no: setNo(it.set_no),
    name: String(it.name || "").trim().slice(0, 200),
    qty: Number.isInteger(it.qty) && it.qty > 0 ? it.qty : 1,
    unit_price: num(it.unit_price),
    condition: it.condition === "U" || it.condition === "N" ? it.condition : null,
  }));
  return {
    shop: typeof raw.shop === "string" ? raw.shop.trim().slice(0, 80) || null : null,
    date: isoDate(raw.date),
    currency: typeof raw.currency === "string" ? raw.currency.trim().toUpperCase().slice(0, 3) || null : null,
    shipping: num(raw.shipping),
    items,
    warning: typeof raw.warning === "string" ? raw.warning.trim().slice(0, 300) || null : null,
  };
}
