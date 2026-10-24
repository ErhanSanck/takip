// Eon Kurs "TYT PUAN SIRALI LİSTE" PDF ayrıştırıcı.
// Tarayıcıda (pdf.js) ve Node'da aynı kodla çalışır: bir PDFDocumentProxy alır.
// Sütunlar, sayfadaki "D Y N" başlık satırının x konumlarından bulunur; böylece
// boş bırakılan dersler (hücre boş) yanlış sütuna kaymaz.

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
    if (!str.trim()) continue;
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

function findHeaderCols(words) {
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
  if (!best) return null;
  best.sort((a, b) => a.x - b.x);
  const headerY = best[0].y;
  // Son "D" TOPLAM sütunudur; öncekiler ders sütunlarıdır.
  const cols = best.slice(0, -1).map((w) => w.x);
  const toplamX = best[best.length - 1].x;
  // Bazı sınavlarda "SEÇ. FELSEFE" (seçmeli felsefe) ek sütunu bulunur: FELSEFE ile DİN'den sonra, MATEMATİK'ten önce.
  const hasSecFelsefe = words.some((w) => /^SEÇ\.?$/.test(w.s) && Math.abs(w.y - headerY) < 40);
  const names = hasSecFelsefe ? [...DERSLER.slice(0, 5), "secfelsefe", ...DERSLER.slice(5)] : DERSLER;
  if (names.length !== cols.length) return null; // tanınmayan düzen: yanlış okumak yerine atla
  return { cols, toplamX, headerY, names };
}

function parsePage(words) {
  const hdr = findHeaderCols(words);
  if (!hdr) return { rows: [], names: null };
  const { cols, toplamX, headerY, names } = hdr;
  const firstSubjectX = cols[0] - 6;
  const toplamStart = toplamX - 6;
  // sıra numarası: x küçük, tam sayı, başlığın altında
  const anchors = words.filter((w) => w.x < firstSubjectX - 130 && isInt(w.s) && w.y < headerY - 3);
  const rows = [];
  for (const a of anchors) {
    const rowWords = words.filter((w) => Math.abs(w.y - a.y) < 5.5).sort((p, q) => p.x - q.x);
    const nameW = rowWords.filter((w) => w.x > a.x + 4 && w.x < firstSubjectX - 55 && !/^[A-Z0-9ÇĞİÖŞÜ]{1,4}-/.test(w.s));
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
    if (!ok || !ad) continue;
    const net = Math.round(Object.values(dersler).reduce((s, v) => s + v[2], 0) * 100) / 100;
    // sağ taraf: puan (xxx,xx) ve sıralamalar; birleşik "10812105,00" gibi parçalar yüzünden
    // puanı "ondalıklı ve toplamdan sonra gelen ilk 3 haneli net" olarak ararız.
    const right = rowWords.filter((w) => w.x >= toplamStart);
    const rt = right.map((w) => w.s);
    // puan: sağ taraftaki son "xxx,xx" biçimli sözcük (toplam net ondan önce gelir; ÖSYM sıraları noktalıdır)
    let pi = -1;
    rt.forEach((t, i) => { if (/^\d{3},\d{2}$/.test(t) && rt.length - i >= 5) pi = i; });
    if (pi < 0) continue;
    const puan = toNum(rt[pi]);
    const after = rt.slice(pi + 1);
    const [genel, kurum, subesira, sinif] = after.slice(0, 4).map(toNum);
    rows.push({ ad, sube, dersler, net, puan, genel, kurum, subesira, sinif });
  }
  return { rows, names: hdr.names };
}

export async function parseExamPdf(pdf) {
  const result = { baslik: "", tarih: "", genelKatilim: null, kurumKatilim: null, subeKatilim: null, ortalamalar: null, satirlar: [] };
  const seen = new Set();
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const words = toWords(tc.items);
    const text = tc.items.map((i) => i.str).join(" ");
    if (p === 1 || !result.baslik) {
      const m = text.match(/Eon Kurs\s*[·•]\s*(.+?)\s+(?:TYT|AYT)?\s*(?:PUAN SIRALI|İSİM SIRALI)/i);
      const t = text.match(/Sınav Tarihi:\s*(\d{2}\.\d{2}\.\d{4})/);
      const b = text.match(/Eon Kurs\s*[·•]\s*(.+?)\s+(TYT PUAN|İSİM SIRALI|PUAN SIRALI)/);
      result.baslik = (b ? b[1] : m ? m[1] : "").trim();
      if (t) result.tarih = t[1];
    }
    const page_ = parsePage(words);
    if (!result.ortalamalar && page_.names) {
      const n = page_.names.length + 1; // dersler + TYT net
      const a = text.match(new RegExp("((?:-?\\d+,\\d{2}\\s+){" + n + "})(\\d+)\\s+(\\d+)\\s+(\\d+)"));
      if (a) {
        const v = a[1].trim().split(/\s+/).map(toNum);
        result.ortalamalar = Object.fromEntries(page_.names.map((d, i) => [d, v[i]]));
        result.ortalamalar.net = v[n - 1];
        result.genelKatilim = parseInt(a[2], 10);
        result.kurumKatilim = parseInt(a[3], 10);
        result.subeKatilim = parseInt(a[4], 10);
      }
    }
    for (const r of page_.rows) {
      const k = normalizeName(r.ad);
      if (seen.has(k)) continue; // puan sıralı ve isim sıralı listede aynı satır: ilki geçerli
      seen.add(k);
      result.satirlar.push(r);
    }
  }
  return result;
}
