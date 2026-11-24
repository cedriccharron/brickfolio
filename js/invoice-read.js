// Lecture d'une facture sur l'appareil, sans service payant :
//  - PDF avec du texte (factures en ligne) : texte extrait par pdf.js ;
//  - photo, ou PDF scanné : reconnaissance de caractères (OCR) par Tesseract.
// Les deux bibliothèques ne sont téléchargées qu'à la première lecture (environ 5 Mo, ensuite en cache).
import { parseInvoiceText } from "./invoice-parse.js";

// Version « legacy » de pdf.js : compatible avec les Safari / iPhone plus anciens.
const PDFJS_BASE = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38";
const PDFJS = `${PDFJS_BASE}/legacy/build/pdf.min.mjs`;
const PDFJS_WORKER = `${PDFJS_BASE}/legacy/build/pdf.worker.min.mjs`;
const TESSERACT = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const OCR_LANGS = "fra+eng"; // français + anglais (chiffres, factures en ligne)
const MAX_PAGES = 3;

let pdfjsP = null;
const loadPdfjs = () => (pdfjsP ??= import(PDFJS).then((m) => { m.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; return m; })
  .catch((e) => { pdfjsP = null; throw new Error(`Outil de lecture PDF indisponible (${e.message || "réseau ?"})`); }));

let tessP = null;
const loadTesseract = () => (tessP ??= new Promise((resolve, reject) => {
  if (window.Tesseract) return resolve(window.Tesseract);
  const s = document.createElement("script");
  s.src = TESSERACT;
  s.onload = () => resolve(window.Tesseract);
  s.onerror = () => { tessP = null; reject(new Error("Outil de reconnaissance de texte indisponible (réseau ?)")); };
  document.head.appendChild(s);
}));

// Reconnaissance de texte sur une ou plusieurs images (canvas).
async function ocr(canvases, onProgress) {
  const T = await loadTesseract();
  onProgress?.("Préparation de la lecture…");
  const worker = await T.createWorker(OCR_LANGS, 1, {
    logger: (m) => {
      if (m.status === "recognizing text") onProgress?.(`Lecture du texte… ${Math.round(m.progress * 100)} %`);
      else if (/loading|initializ/i.test(m.status)) onProgress?.("Téléchargement de l'outil de lecture (première fois seulement)…");
    },
  });
  try {
    const parts = [];
    for (const c of canvases) parts.push((await worker.recognize(c)).data.text);
    return parts.join("\n");
  } finally { await worker.terminate(); }
}

// Photo → canvas en niveaux de gris, côté le plus long ramené vers 2400 px (bon compromis vitesse / netteté).
async function imageCanvas(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((ok, ko) => { img.onload = ok; img.onerror = ko; img.src = url; });
    const k = Math.min(2.5, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const ctx = c.getContext("2d");
    ctx.filter = "grayscale(1) contrast(1.3)";
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } catch {
    throw new Error("Photo illisible par le navigateur : fais une capture d'écran de la facture, ou joins-la sans lecture");
  } finally { URL.revokeObjectURL(url); }
}

// Texte d'un PDF, ligne par ligne (les morceaux de même hauteur sont réunis, de gauche à droite).
async function pdfText(pdf) {
  const lines = [];
  for (let p = 1; p <= Math.min(pdf.numPages, MAX_PAGES); p++) {
    const { items } = await (await pdf.getPage(p)).getTextContent();
    const rows = [];
    for (const it of items) {
      if (!it.str?.trim()) continue;
      const y = it.transform[5], x = it.transform[4];
      let row = rows.find((r) => Math.abs(r.y - y) < 3);
      if (!row) rows.push(row = { y, parts: [] });
      row.parts.push({ x, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) lines.push(r.parts.sort((a, b) => a.x - b.x).map((q) => q.s.trim()).join(" "));
  }
  return lines.join("\n");
}

async function pdfCanvases(pdf) {
  const out = [];
  for (let p = 1; p <= Math.min(pdf.numPages, MAX_PAGES); p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 2.5 });
    const c = document.createElement("canvas");
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    out.push(c);
  }
  return out;
}

// Fichier → { invoice: { shop, date, currency, shipping, items, warning }, text }
export async function readInvoiceFile(file, { knownSets = [], onProgress } = {}) {
  let text;
  if (file.type === "application/pdf") {
    onProgress?.("Ouverture du PDF…");
    const pdfjs = await loadPdfjs();
    let pdf;
    try {
      pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), standardFontDataUrl: `${PDFJS_BASE}/standard_fonts/` }).promise;
    } catch (e) {
      throw new Error(/password/i.test(e?.name || e?.message) ? "PDF protégé par un mot de passe" : `PDF illisible (${e?.message || e})`);
    }
    text = await pdfText(pdf);
    if (text.replace(/\s/g, "").length < 40) text = await ocr(await pdfCanvases(pdf), onProgress); // PDF scanné
  } else {
    text = await ocr([await imageCanvas(file)], onProgress);
  }
  return { invoice: parseInvoiceText(text, { knownSets }), text };
}
