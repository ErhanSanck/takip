// Eon Kurs "TYT PUAN SIRALI LİSTE" PDF ayrıştırıcı.
// Tarayıcıda (pdf.js) ve Node'da aynı kodla çalışır: bir PDFDocumentProxy alır.
// Sütunlar, sayfadaki "D Y N" başlık satırının x konumlarından bulunur; böylece
// boş bırakılan dersler (hücre boş) yanlış sütuna kaymaz.

export const PARSER_VERSION = "2026-10-24-v4";

export const DERSLER = ["turkce", "tarih", "cografya", "felsefe", "din", "mat", "geo", "fizik", "kimya", "biyo"];

export function normalizeName(s) {
  return s
    .replace(/İ/g, "i").replace(/I/g, "ı")
    .toLocaleLowerCase("tr")
    .replace(/\s+/g, " ").trim();
}

const toNum = (t) => (t.includes(",") ? parseFloat(t.replace(/\./g, "").replace(",", ".")) : parseInt(t.replace(/\./g, ""), 10));
const isInt = (t) => /^\d+$/.test(t);
const isNet = (t) => /^-?\d+,\d{2}$/.test(t);

// pdf.js bir metin parçasında birden çok sözcük olabilir; sözcüklere bölüp x konumlarını dağıtır.
function toWords(items) {
  const out = [];
  for (const it of items) {
    const str = it.str;
    if (!str || !str.trim() || !it.transform) continue;
    const x0 = it.transform[4], y = it.transform[5], w = it.width || 0;
    if (!/\s/.test(str.trim())) {
      out.push({ s: str.trim(), x: x0, x1: x0 + w, y });
      continue;
    }
    const n = str.length;
    const re = /\S+/g;
    let m;
    while ((m = re.exec(str))) {
      out.push({ s: m[0], x: x0 + (w * m.index) / n, x1: x0 + (w * (m.index + m[0].length)) / n, y });
    }
  }
  return out;
}

// Ders sütunlarının adları, sütun sayısına göre belirlenir (başlık yazıları bazı sayfalarda harf harf
// bölünebildiği için başlık metnine güvenilmez):
//   10 sütun: Türkçe, Tarih, Coğrafya, Felsefe, Din, Mat, Geo, Fizik, Kimya, Biyoloji
//   11 sütun: ... Din, SEÇMELİ FELSEFE, Mat, Geo, ...
function namesFor(n) {
  if (n === 10) return { names: DERSLER, tahmini: false };
  if (n === 11) return { names: [...DERSLER.slice(0, 5), "secfelsefe", ...DERSLER.slice(5)], tahmini: false };
  if (n > 11) {
    const ek = Array.from({ length: n - 10 }, (_, i) => `ek${i + 1}`);
    return { names: [...DERSLER.slice(0, 5), ...ek, ...DERSLER.slice(5)], tahmini: true };
  }
  return null;
}

function findHeaderCols(words, info) {
  // "D Y N" başlıklarının bulunduğu satır: çok sayıda tek harfli D içeren satır.
  const byY = new Map();
  for (const w of words) {
    if (w.s === "D") {
      const k = Math.round(w.y / 2);
      if (!byY.has(k)) byY.set(k, []);
      byY.get(k).push(w);
    }
  }
  let best = null;
  for (const arr of byY.values()) if (arr.length >= 10 && (!best || arr.length > best.length)) best = arr;
  info.dSayisi = best ? best.length : 0;
  if (!best) { info.sorun = 'Başlık satırı bulunamadı ("D Y N" sütun başlıkları yok).'; return null; }
  best.sort((a, b) => a.x - b.x);
  // Son "D" TOPLAM sütunudur; öncekiler ders sütunlarıdır.
  const cols = best.slice(0, -1).map((w) => w.x);
  const toplamX = best[best.length - 1].x;
  info.dersSutunu = cols.length;
  const nm = namesFor(cols.length);
  if (!nm) { info.sorun = `Ders sütunu sayısı beklenenden az (${cols.length}).`; return null; }
  info.adlar = nm.names.join(",");
  if (nm.tahmini) info.uyari = `Tanınmayan sütun düzeni (${cols.length} ders sütunu): değerler hatalı olabilir.`;
  return { cols, toplamX, headerY: best[0].y, names: nm.names, tahmini: nm.tahmini };
}

function parsePage(words, info) {
  const hdr = findHeaderCols(words, info);
  if (!hdr) return { rows: [], names: null };
  const { cols, toplamX, headerY, names } = hdr;
  const firstSubjectX = cols[0] - 6;
  const toplamStart = toplamX - 6;
  // sıra numarası: x küçük, tam sayı, başlığın altında
  const anchors = words.filter((w) => w.x < firstSubjectX - 130 && isInt(w.s) && w.y < headerY - 3);
  info.satirAnkoru = anchors.length;
  info.atlanan = [];
  const rows = [];
  for (const a of anchors) {
    const rowWords = words.filter((w) => Math.abs(w.y - a.y) < 5.5).sort((p, q) => p.x - q.x);
    const left = rowWords.filter((w) => w.x > a.x + 4 && w.x < firstSubjectX);
    // şube: tire içeren kod (MZ-C1-SAY, 12-A3-EA, MZ-DNM KUL ...)
    let subeIdx = left.findIndex((w) => /^[A-Z0-9ÇĞİÖŞÜ]+-/.test(w.s));
    if (subeIdx < 0) subeIdx = left.length;
    const ad = left.slice(0, subeIdx).map((w) => w.s).join(" ");
    const sube = left.slice(subeIdx).map((w) => w.s).join(" ");
    const toks = rowWords.filter((w) => w.x >= firstSubjectX && w.x < toplamStart);
    const dersler = {};
    let ok = true;
    for (let i = 0; i + 2 < toks.length; i += 3) {
      const [D, Y, N] = [toks[i], toks[i + 1], toks[i + 2]];
      if (!isInt(D.s) || !isInt(Y.s) || !isNet(N.s)) { ok = false; break; }
      let c = 0;
      for (let j = 1; j < cols.length; j++) if (Math.abs(cols[j] - D.x) < Math.abs(cols[c] - D.x)) c = j;
      dersler[names[c]] = [parseInt(D.s, 10), parseInt(Y.s, 10), toNum(N.s)];
    }
    if (!ad) { info.atlanan.push(`#${a.s}: ad okunamadı`); continue; }
    if (!ok) { info.atlanan.push(`${ad}: ders hücreleri okunamadı (${toks.map((t) => t.s).join(" ")})`); continue; }
    const net = Math.round(Object.values(dersler).reduce((s, v) => s + v[2], 0) * 100) / 100;
    const rt = rowWords.filter((w) => w.x >= toplamStart).map((w) => w.s);
    // puan: sağ taraftaki son "xxx,xx" biçimli sözcük (toplam net ondan önce gelir; ÖSYM sıraları noktalıdır)
    let pi = -1;
    rt.forEach((t, i) => { if (/^\d{3},\d{2}$/.test(t) && rt.length - i >= 5) pi = i; });
    if (pi < 0) { info.atlanan.push(`${ad}: puan bulunamadı (${rt.join(" ")})`); continue; }
    const puan = toNum(rt[pi]);
    const [genel, kurum, subesira, sinif] = rt.slice(pi + 1, pi + 5).map(toNum);
    // PDF'teki TOPLAM net ile kendi hesabımızı karşılaştır (birleşik yazılmış hücrelerde karşılaştırma atlanır)
    let pdfNet = null;
    for (let i = 2; i < pi; i++) if (isNet(rt[i]) && isInt(rt[i - 1]) && isInt(rt[i - 2])) { pdfNet = toNum(rt[i]); break; }
    const netUyumsuz = pdfNet !== null && Math.abs(pdfNet - net) > 0.011;
    rows.push({ ad, sube, dersler, net, puan, genel, kurum, subesira, sinif, ...(netUyumsuz ? { netUyumsuz: true, pdfNet } : {}) });
  }
  info.satir = rows.length;
  return { rows, names, tahmini: hdr.tahmini };
}

export async function parseExamPdf(pdf) {
  const result = {
    baslik: "", tarih: "", genelKatilim: null, kurumKatilim: null, subeKatilim: null, ortalamalar: null, satirlar: [],
    tani: { surum: PARSER_VERSION, sayfaSayisi: pdf.numPages, sayfalar: [] },
  };
  const seen = new Set();
  for (let p = 1; p <= pdf.numPages; p++) {
    const info = { sayfa: p };
    result.tani.sayfalar.push(info);
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const words = toWords(tc.items);
    info.kelime = words.length;
    const text = tc.items.map((i) => i.str).join(" ");
    if (p === 1 || !result.baslik) {
      const m = text.match(/Eon Kurs\s*[·•]\s*(.+?)\s+(?:TYT|AYT)?\s*(?:PUAN SIRALI|İSİM SIRALI)/i);
      const t = text.match(/Sınav Tarihi:\s*(\d{2}\.\d{2}\.\d{4})/);
      const b = text.match(/Eon Kurs\s*[·•]\s*(.+?)\s+(TYT PUAN|İSİM SIRALI|PUAN SIRALI)/);
      result.baslik = (b ? b[1] : m ? m[1] : "").trim();
      if (t) result.tarih = t[1];
    }
    const pg = parsePage(words, info);
    if (!result.ortalamalar && pg.names) {
      const n = pg.names.length + 1; // dersler + TYT net
      const a = text.match(new RegExp("((?:-?\\d+,\\d{2}\\s+){" + n + "})(\\d+)\\s+(\\d+)\\s+(\\d+)"));
      if (a) {
        const v = a[1].trim().split(/\s+/).map(toNum);
        result.ortalamalar = Object.fromEntries(pg.names.map((d, i) => [d, v[i]]));
        result.ortalamalar.net = v[n - 1];
        result.genelKatilim = parseInt(a[2], 10);
        result.kurumKatilim = parseInt(a[3], 10);
        result.subeKatilim = parseInt(a[4], 10);
      } else {
        info.ortalamaBulunamadi = true;
      }
    }
    for (const r of pg.rows) {
      const k = normalizeName(r.ad);
      if (seen.has(k)) continue; // puan sıralı ve isim sıralı listede aynı satır: ilki geçerli
      seen.add(k);
      result.satirlar.push(r);
    }
  }
  return result;
}

// Önizlemede gösterilecek uyarılar: yanlış okunmuş olabilecek durumları yakalar.
export function uyarilar(result) {
  const out = [];
  const rows = result.satirlar;
  for (const s of result.tani.sayfalar) if (s.uyari) out.push(`Sayfa ${s.sayfa}: ${s.uyari}`);
  const bad = rows.filter((r) => r.netUyumsuz);
  if (bad.length) out.push(`${bad.length} öğrencinin hesaplanan toplam neti PDF'tekiyle uyuşmuyor (örn. ${bad[0].ad}). Sütunlar yanlış okunmuş olabilir.`);
  if (rows.length >= 5 && rows.every((r) => !r.dersler.mat || (r.dersler.mat[0] === 0 && r.dersler.mat[1] === 0)))
    out.push("Matematik sütunu tüm öğrencilerde boş görünüyor. Sütunlar yanlış okunmuş olabilir.");
  return out;
}

// Kopyalanabilir tanı metni (hata ayıklama için).
export function taniMetni(result, dosyaAdi = "") {
  const t = result.tani;
  const L = [`Ayrıştırıcı sürümü: ${t.surum}`, dosyaAdi && `Dosya: ${dosyaAdi}`, `Sayfa sayısı: ${t.sayfaSayisi}`,
    `Başlık: ${result.baslik || "-"} | Tarih: ${result.tarih || "-"} | Okunan öğrenci: ${result.satirlar.length}`];
  for (const s of t.sayfalar) {
    L.push(`— Sayfa ${s.sayfa}: kelime=${s.kelime} D-başlığı=${s.dSayisi ?? "-"} ders-sütunu=${s.dersSutunu ?? "-"} satır-ankoru=${s.satirAnkoru ?? "-"} okunan=${s.satir ?? 0}`);
    if (s.adlar) L.push(`   sütunlar: ${s.adlar}`);
    if (s.sorun) L.push(`   SORUN: ${s.sorun}`);
    if (s.uyari) L.push(`   UYARI: ${s.uyari}`);
    if (s.ortalamaBulunamadi) L.push("   ortalama satırı bulunamadı");
    for (const a of (s.atlanan || []).slice(0, 8)) L.push(`   atlandı → ${a}`);
  }
  return L.filter(Boolean).join("\n");
}
