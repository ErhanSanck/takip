import { createBackend } from "./db.js";
import { parseExamPdf, normalizeName, uyarilar, taniMetni, PARSER_VERSION } from "./parser.js?v=2026-10-24-v4";

const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const $ = (sel, el = document) => el.querySelector(sel);
const collator = new Intl.Collator("tr");
const demo = new URLSearchParams(location.search).has("demo");

let backend = null;
let unsubscribe = null;
let state = { sinavlar: {}, ogrenciler: {} };
let selectedId = null;
let query = "";
let chart = null;

/* ---------- Yardımcılar ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (n == null || Number.isNaN(n) ? "–" : Number(n).toFixed(2).replace(".", ","));
const fmtSigned = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(Math.abs(n));
const trTitle = (s) =>
  String(s).split(/\s+/).filter(Boolean).map((w) => {
    const l = w.replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr");
    return l.charAt(0).toLocaleUpperCase("tr") + l.slice(1);
  }).join(" ");
const TR_ASCII = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };
const slug = (s) => normalizeName(s).replace(/[çğıöşü]/g, (c) => TR_ASCII[c]).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const studentId = (name) => slug(name) || `ogr-${Date.now()}`;
const isoFromTr = (t) => { const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(t || ""); return m ? `${m[3]}-${m[2]}-${m[1]}` : ""; };
const trFromIso = (i) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(i || ""); return m ? `${m[3]}.${m[2]}.${m[1]}` : ""; };
const clean = (v) => JSON.parse(JSON.stringify(v, (_, x) => (x === undefined || x === null || Number.isNaN(x) ? undefined : x)));

function toast(msg, ms = 3500) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), ms);
}

/* ---------- Veri okuma yardımcıları ---------- */
const examsSorted = () =>
  Object.entries(state.sinavlar || {})
    .map(([id, e]) => ({ id, ...e }))
    .sort((a, b) => (a.sira || "").localeCompare(b.sira || "") || collator.compare(a.ad || "", b.ad || ""));
const studentsAll = () => Object.entries(state.ogrenciler || {}).map(([id, o]) => ({ id, ...o }));
const resultOf = (o, examId) => o.sonuclar?.[examId] || null;
const matNet = (r) => (r ? r.dersler?.mat?.[2] ?? 0 : null);

/* ---------- Öğrenci listesi ---------- */
function renderList() {
  const q = normalizeName(query);
  const list = studentsAll().filter((o) => !q || normalizeName(o.ad).includes(q));
  const groups = new Map();
  for (const o of list) {
    const k = o.sube || "Şubesiz";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o);
  }
  const el = $("#studentList");
  if (!list.length) {
    el.innerHTML = `<div class="empty">${studentsAll().length ? "Eşleşen öğrenci yok." : "Henüz öğrenci yok."}</div>`;
    return;
  }
  el.innerHTML = [...groups.keys()].sort(collator.compare).map((k) => {
    const items = groups.get(k).sort((a, b) => collator.compare(a.ad, b.ad));
    return `<div class="group-title">${esc(k)} · ${items.length}</div>` + items.map((o) => {
      const n = Object.keys(o.sonuclar || {}).length;
      return `<button class="student ${o.id === selectedId ? "active" : ""}" data-id="${esc(o.id)}"><span>${esc(trTitle(o.ad))}</span><small>${n} sınav</small></button>`;
    }).join("");
  }).join("");
}

/* ---------- Sonuç tablosu / özet kartları ---------- */
function resultsTable(o) {
  const exams = examsSorted();
  const head = `<thead>
    <tr><th rowspan="2">Sınav</th><th colspan="3" class="grp">Türkçe</th><th colspan="3" class="grp">Matematik</th><th colspan="3" class="grp">Geometri</th><th colspan="2" class="grp">TYT</th><th colspan="2" class="grp">Sıra</th></tr>
    <tr><th class="grp">D</th><th>Y</th><th>Net</th><th class="grp">D</th><th>Y</th><th>Net</th><th class="grp">D</th><th>Y</th><th>Net</th><th class="grp">Net</th><th>Puan</th><th class="grp">Kurum</th><th>Genel</th></tr></thead>`;
  const rows = exams.map((e) => {
    const r = resultOf(o, e.id);
    const name = `<td><div class="exam-name">${esc(e.ad)}</div><div class="exam-date">${esc(e.tarih)}</div></td>`;
    if (!r) return `<tr>${name}<td colspan="13" class="absent">Bu sınava katılmadı</td></tr>`;
    const cell = (k) => {
      const [d, y, n] = r.dersler?.[k] || [0, 0, 0];
      return `<td class="grp">${d}</td><td>${y}</td><td class="net">${fmt(n)}</td>`;
    };
    const kurum = r.kurum != null ? `${r.kurum}${e.kurumKatilim ? " / " + e.kurumKatilim : ""}` : "–";
    const genel = r.genel != null ? r.genel.toLocaleString("tr") + (e.genelKatilim ? " / " + e.genelKatilim.toLocaleString("tr") : "") : "–";
    return `<tr>${name}${cell("turkce")}${cell("mat")}${cell("geo")}<td class="grp net">${fmt(r.net)}</td><td>${fmt(r.puan)}</td><td class="grp">${kurum}</td><td>${genel}</td></tr>`;
  }).join("");
  return `<div class="table-wrap"><table class="results">${head}<tbody>${rows || `<tr><td colspan="14" class="absent">Henüz sınav eklenmedi</td></tr>`}</tbody></table></div>
    <p class="note">D: doğru · Y: yanlış · Net: doğru − yanlış/4. Sıralar kurum içi ve genel katılıma göredir.</p>`;
}

function deltaHtml(cur, prev, unit = "") {
  if (prev == null || cur == null) return `<span class="delta flat">ilk sınav</span>`;
  const d = Math.round((cur - prev) * 100) / 100;
  if (d === 0) return `<span class="delta flat">değişmedi</span>`;
  return `<span class="delta ${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${fmtSigned(d)}${unit} önceki sınava göre</span>`;
}

function statsHtml(o) {
  const taken = examsSorted().filter((e) => resultOf(o, e.id));
  if (!taken.length) return "";
  const last = taken[taken.length - 1], prev = taken[taken.length - 2];
  const r = resultOf(o, last.id), pr = prev ? resultOf(o, prev.id) : null;
  return `<div class="stats">
    <div class="stat"><div class="label">Matematik neti · ${esc(last.tarih)}</div><div class="value">${fmt(matNet(r))}</div>${deltaHtml(matNet(r), pr && matNet(pr))}</div>
    <div class="stat"><div class="label">TYT puanı · ${esc(last.tarih)}</div><div class="value">${fmt(r.puan)}</div>${deltaHtml(r.puan, pr?.puan)}</div>
    <div class="stat"><div class="label">Kurum sırası</div><div class="value">${r.kurum ?? "–"}${last.kurumKatilim ? ` <small class="muted">/ ${last.kurumKatilim}</small>` : ""}</div>${prev && pr?.kurum != null ? `<span class="delta ${r.kurum < pr.kurum ? "up" : r.kurum > pr.kurum ? "down" : "flat"}">${r.kurum === pr.kurum ? "değişmedi" : (r.kurum < pr.kurum ? "▲ " : "▼ ") + Math.abs(pr.kurum - r.kurum) + " sıra"}</span>` : `<span class="delta flat">&nbsp;</span>`}</div>
    <div class="stat"><div class="label">Katıldığı sınav</div><div class="value">${taken.length} <small class="muted">/ ${examsSorted().length}</small></div><span class="delta flat">&nbsp;</span></div>
  </div>`;
}

/* ---------- Grafik ---------- */
const valueLabels = {
  id: "valueLabels",
  afterDatasetsDraw(c) {
    const { ctx } = c;
    const meta = c.getDatasetMeta(0);
    ctx.save();
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.fillStyle = "#1f3a5f";
    ctx.textAlign = "center";
    meta.data.forEach((pt, i) => {
      const v = c.data.datasets[0].data[i];
      if (v != null) ctx.fillText(fmt(v), pt.x, pt.y - 11);
    });
    ctx.restore();
  },
};

function makeChart(canvas, o, print = false) {
  if (typeof Chart === "undefined") { canvas.parentElement.innerHTML = '<p class="muted">Grafik kitaplığı (Chart.js) yüklenemedi.</p>'; return { destroy() {} }; }
  const exams = examsSorted();
  const mine = exams.map((e) => matNet(resultOf(o, e.id)));
  const avg = exams.map((e) => e.ort?.mat ?? null);
  return new Chart(canvas, {
    type: "line",
    data: {
      labels: exams.map((e) => [e.ad, e.tarih]),
      datasets: [
        { label: "Öğrenci", data: mine, borderColor: "#1f3a5f", backgroundColor: "#1f3a5f", borderWidth: 2.5, pointRadius: 5, pointHoverRadius: 7, tension: 0.15, spanGaps: true },
        { label: "Genel ortalama", data: avg, borderColor: "#9aa5b4", backgroundColor: "#9aa5b4", borderWidth: 1.5, borderDash: [6, 4], pointRadius: 3, pointStyle: "rectRot", spanGaps: true },
      ],
    },
    options: {
      responsive: !print,
      maintainAspectRatio: false,
      animation: print ? false : { duration: 300 },
      devicePixelRatio: print ? 2 : undefined,
      layout: { padding: { top: 18, right: 14 } },
      plugins: {
        legend: { position: "top", align: "end", labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8 } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y)}` } },
      },
      scales: {
        y: { grace: "12%", title: { display: true, text: "Matematik neti" }, grid: { color: "#e6eaf0" } },
        x: { offset: true, grid: { display: false } },
      },
    },
    plugins: [valueLabels],
  });
}

/* ---------- Öğrenci detayı ---------- */
function renderDetail() {
  const el = $("#detail");
  if (chart) { chart.destroy(); chart = null; }
  const all = studentsAll();
  if (!all.length) {
    el.innerHTML = `<div class="card empty"><h2>Henüz veri yok</h2><p>Eon Kurs "TYT puan sıralı liste" PDF'ini eklediğinizde öğrenciler ve sonuçlar burada görünür.</p><button class="btn primary" id="emptyAdd">PDF Ekle</button></div>`;
    return;
  }
  const o = all.find((s) => s.id === selectedId);
  if (!o) { el.innerHTML = `<div class="card empty">Soldaki listeden bir öğrenci seçin.</div>`; return; }
  el.innerHTML = `
    <div class="card"><div class="head"><div><h1>${esc(trTitle(o.ad))}</h1><span class="pill">${esc(o.sube || "Şubesiz")}</span></div>
      <button class="btn danger" id="btnDelStudent">Öğrenciyi sil</button></div></div>
    ${statsHtml(o)}
    <div class="card"><h2>Sınav sonuçları</h2>${resultsTable(o)}</div>
    <div class="card"><h2>Matematik net değişimi</h2><div class="chart-box"><canvas id="mathChart"></canvas></div></div>`;
  chart = makeChart($("#mathChart"), o);
}

function render() {
  const ids = studentsAll().map((s) => s.id);
  if (!ids.includes(selectedId)) {
    const first = studentsAll().sort((a, b) => (a.sube || "").localeCompare(b.sube || "") || collator.compare(a.ad, b.ad))[0];
    selectedId = first ? first.id : null;
  }
  renderList();
  renderDetail();
}

/* ---------- Modal ---------- */
function openModal({ title, body, footer, dismissable = true }) {
  const root = $("#modalRoot");
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2></header><div class="body">${body}</div><footer>${footer}</footer></div>`;
  root.appendChild(bg);
  const close = () => { bg.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape" && dismissable) close(); };
  document.addEventListener("keydown", onKey);
  if (dismissable) bg.addEventListener("mousedown", (e) => { if (e.target === bg) close(); });
  return { el: bg, close };
}

/* ---------- PDF ekleme ---------- */
async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = PDFJS; s.onload = resolve; s.onerror = () => reject(new Error("pdf.js yüklenemedi (internet bağlantısını kontrol edin)"));
    document.head.appendChild(s);
  });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  return window.pdfjsLib;
}

async function handleFiles(files) {
  for (const file of files) {
    try {
      toast(`"${file.name}" okunuyor…`, 20000);
      const lib = await loadPdfJs();
      const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      const parsed = await parseExamPdf(pdf);
      if (!parsed.satirlar.length) {
        toast("", 1);
        openDiag(parsed, file.name);
        continue;
      }
      toast("", 1);
      await reviewImport(buildPreview(parsed, file.name));
    } catch (err) {
      console.error(err);
      toast(`"${file.name}" okunamadı: ${err.message || err}`, 6000);
    }
  }
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("Tanı bilgisi kopyalandı."); return; } catch { /* eski tarayıcı */ }
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); toast("Tanı bilgisi kopyalandı."); } catch { toast("Kopyalanamadı; metni elle seçip kopyalayın.", 5000); }
  ta.remove();
}

function openDiag(parsed, fileName) {
  const txt = taniMetni(parsed, fileName);
  const m = openModal({
    title: "PDF'ten öğrenci satırı okunamadı",
    body: `<p>Bu dosyada beklenen Eon Kurs "TYT puan sıralı liste" düzeni bulunamadı. Doğru PDF'i seçtiğinizden emin olun. Sorun sürerse aşağıdaki tanı bilgisini kopyalayıp gönderin.</p>
           <pre class="diag">${esc(txt)}</pre>`,
    footer: `<button class="btn" id="dgCopy">Tanı bilgisini kopyala</button><button class="btn primary" id="dgClose">Kapat</button>`,
  });
  $("#dgCopy", m.el).addEventListener("click", () => copyText(txt));
  $("#dgClose", m.el).addEventListener("click", m.close);
}

function buildPreview(parsed, fileName) {
  const existing = new Map(studentsAll().map((o) => [normalizeName(o.ad), o.id]));
  const matched = [], fresh = [];
  const inPdf = new Set();
  for (const r of parsed.satirlar) {
    const k = normalizeName(r.ad);
    inPdf.add(k);
    const id = existing.get(k);
    (id ? matched : fresh).push({ id: id || studentId(r.ad), r });
  }
  const missing = studentsAll().filter((o) => !inPdf.has(normalizeName(o.ad)));
  return { parsed, fileName, matched, fresh, missing, emptyDb: studentsAll().length === 0 };
}

function reviewImport(p) {
  return new Promise((resolve) => {
    const { parsed, matched, fresh, missing } = p;
    const uyar = uyarilar(parsed);
    const exists = (id) => !!state.sinavlar?.[id];
    const miniRow = ({ r }) => `<tr><td>${esc(trTitle(r.ad))}</td><td>${esc(r.sube)}</td><td>${fmt(r.dersler.turkce?.[2] ?? 0)}</td><td>${fmt(r.dersler.mat?.[2] ?? 0)}</td><td>${fmt(r.dersler.geo?.[2] ?? 0)}</td><td>${fmt(r.net)}</td><td>${fmt(r.puan)}</td></tr>`;
    const miniTable = (rows) => `<table class="mini"><thead><tr><th>Öğrenci</th><th>Şube</th><th>Türkçe</th><th>Mat.</th><th>Geo.</th><th>TYT net</th><th>Puan</th></tr></thead><tbody>${rows.map(miniRow).join("")}</tbody></table>`;
    const body = `
      <div class="row2">
        <label>Sınav adı<input type="text" id="impAd" value="${esc(parsed.baslik || p.fileName.replace(/\.pdf$/i, ""))}"></label>
        <label>Sınav tarihi<input type="date" id="impTarih" value="${isoFromTr(parsed.tarih) || new Date().toISOString().slice(0, 10)}"></label>
      </div>
      <div id="impWarn"></div>
      ${uyar.length ? `<div class="warnbox"><b>Dikkat:</b><ul class="list-plain">${uyar.map((u) => `<li>${esc(u)}</li>`).join("")}</ul></div>` : ""}
      <details class="sec"><summary>Tanı bilgisi · ayrıştırıcı ${esc(PARSER_VERSION)}</summary><div class="inner"><pre class="diag">${esc(taniMetni(parsed, p.fileName))}</pre><button class="btn" id="impCopy">Kopyala</button></div></details>
      <div class="chips">
        <span class="chip ok">${matched.length} öğrenci listeyle eşleşti</span>
        ${fresh.length ? `<span class="chip warn">${fresh.length} öğrenci listede yok</span>` : ""}
        ${missing.length ? `<span class="chip">${missing.length} öğrenci bu PDF'de yok</span>` : ""}
      </div>
      ${matched.length ? `<details class="sec" ${p.emptyDb ? "" : "open"}><summary>Eşleşen öğrenciler (${matched.length})</summary><div class="inner">${miniTable(matched)}</div></details>` : ""}
      ${fresh.length ? `<details class="sec" open><summary>${p.emptyDb ? "Eklenecek öğrenciler" : "Listede olmayan öğrenciler — eklemek istediklerinizi işaretleyin"} (${fresh.length})</summary><div class="inner">
        <div class="checklist"><label><input type="checkbox" id="impAll" ${p.emptyDb ? "checked" : ""}> <b>Tümünü seç</b></label>
        ${fresh.map((f, i) => `<label><input type="checkbox" class="impNew" data-i="${i}" ${p.emptyDb ? "checked" : ""}> ${esc(trTitle(f.r.ad))} <span class="muted">· ${esc(f.r.sube)}</span></label>`).join("")}</div></div></details>` : ""}
      ${missing.length ? `<details class="sec"><summary>Bu PDF'de bulunamayan öğrenciler (${missing.length})</summary><div class="inner"><ul class="list-plain">${missing.map((o) => `<li>${esc(trTitle(o.ad))} <span class="muted">· ${esc(o.sube || "")}</span></li>`).join("")}</ul><p class="note">Bu öğrenciler sınava katılmadı olarak gösterilir.</p></div></details>` : ""}`;
    const m = openModal({ title: `PDF önizleme · ${p.fileName}`, dismissable: false, body, footer: `<button class="btn" id="impCancel">Vazgeç</button><button class="btn primary" id="impOk">Listeye ekle</button>` });
    const $m = (s) => $(s, m.el);
    $m("#impCopy")?.addEventListener("click", () => copyText(taniMetni(parsed, p.fileName)));

    const examId = () => `${$m("#impTarih").value}-${slug($m("#impAd").value).slice(0, 40)}`;
    const refreshWarn = () => {
      $m("#impWarn").innerHTML = exists(examId()) ? `<div class="warnbox">Bu sınav (aynı ad ve tarih) daha önce eklenmiş. Devam ederseniz aynı öğrencilerin sonuçları güncellenir.</div>` : "";
    };
    $m("#impAd").addEventListener("input", refreshWarn);
    $m("#impTarih").addEventListener("input", refreshWarn);
    refreshWarn();
    const all = $m("#impAll");
    if (all) all.addEventListener("change", () => m.el.querySelectorAll(".impNew").forEach((c) => (c.checked = all.checked)));

    $m("#impCancel").addEventListener("click", () => { m.close(); resolve(false); });
    $m("#impOk").addEventListener("click", async () => {
      const ad = $m("#impAd").value.trim(), iso = $m("#impTarih").value;
      if (!ad || !iso) { toast("Sınav adı ve tarihi gerekli."); return; }
      if (uyar.length && !confirm("Önizlemede uyarılar var; veriler yanlış okunmuş olabilir. Yine de eklensin mi?")) return;
      const picked = [...m.el.querySelectorAll(".impNew")].filter((c) => c.checked).map((c) => fresh[+c.dataset.i]);
      const targets = [...matched, ...picked];
      if (!targets.length) { toast("Eklenecek öğrenci yok."); return; }
      const id = examId();
      const updates = {};
      updates[`sinavlar/${id}`] = clean({
        ad, tarih: trFromIso(iso), sira: iso,
        genelKatilim: parsed.genelKatilim, kurumKatilim: parsed.kurumKatilim, subeKatilim: parsed.subeKatilim,
        ort: parsed.ortalamalar,
      });
      for (const { id: sid, r } of targets) {
        updates[`ogrenciler/${sid}/ad`] = r.ad;
        updates[`ogrenciler/${sid}/sube`] = r.sube;
        updates[`ogrenciler/${sid}/sonuclar/${id}`] = clean({ dersler: r.dersler, net: r.net, puan: r.puan, genel: r.genel, kurum: r.kurum, subesira: r.subesira, sinif: r.sinif });
      }
      const btn = $m("#impOk");
      btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>Kaydediliyor…`;
      try {
        await backend.applyUpdates(updates);
        m.close();
        toast(`${targets.length} öğrencinin "${ad}" sonucu kaydedildi.`);
        selectedId = selectedId && state.ogrenciler[selectedId] ? selectedId : targets[0].id;
        resolve(true);
      } catch (err) {
        console.error(err);
        btn.disabled = false; btn.textContent = "Listeye ekle";
        toast(`Kaydedilemedi: ${err.message || err}`, 6000);
      }
    });
  });
}

/* ---------- Sınavlar penceresi ---------- */
function openExams() {
  const exams = examsSorted();
  const count = (id) => studentsAll().filter((o) => resultOf(o, id)).length;
  const body = exams.length
    ? `<table class="mini"><thead><tr><th>Sınav</th><th>Tarih</th><th>Öğrenci</th><th></th></tr></thead><tbody>${exams.map((e) => `<tr><td>${esc(e.ad)}</td><td>${esc(e.tarih)}</td><td>${count(e.id)}</td><td><button class="btn danger" data-del="${esc(e.id)}">Sil</button></td></tr>`).join("")}</tbody></table><p class="note">Bir sınavı silmek, tüm öğrencilerin o sınava ait sonuçlarını kaldırır.</p>`
    : `<p class="muted">Henüz sınav eklenmedi.</p>`;
  const m = openModal({ title: "Sınavlar", body, footer: `<button class="btn" id="exClose">Kapat</button>` });
  $("#exClose", m.el).addEventListener("click", m.close);
  m.el.addEventListener("click", async (e) => {
    const id = e.target.dataset?.del;
    if (!id) return;
    const ex = state.sinavlar[id];
    if (!confirm(`"${ex.ad}" (${ex.tarih}) sınavı tüm öğrencilerden silinsin mi?`)) return;
    const updates = { [`sinavlar/${id}`]: null };
    studentsAll().forEach((o) => { if (resultOf(o, id)) updates[`ogrenciler/${o.id}/sonuclar/${id}`] = null; });
    try { await backend.applyUpdates(updates); toast("Sınav silindi."); m.close(); } catch (err) { toast(`Silinemedi: ${err.message || err}`, 6000); }
  });
}

/* ---------- Yazdır / PDF ---------- */
function printStudents(list) {
  if (!list.length) { toast("Yazdırılacak öğrenci yok."); return; }
  const root = $("#printRoot");
  root.innerHTML = list.map((o) => `<section class="print-page">
      <div class="card"><h1 style="margin:0;color:#1f3a5f">${esc(trTitle(o.ad))}</h1><span class="pill">${esc(o.sube || "")}</span></div>
      <div class="card"><h2>Sınav sonuçları</h2>${resultsTable(o)}</div>
      <div class="card"><h2>Matematik net değişimi</h2><canvas width="720" height="320" style="width:100%;max-width:720px"></canvas></div>
    </section>`).join("");
  const charts = [...root.querySelectorAll("canvas")].map((c, i) => makeChart(c, list[i], true));
  const done = () => {
    window.removeEventListener("afterprint", done);
    document.body.classList.remove("printing");
    charts.forEach((c) => c.destroy());
    root.innerHTML = "";
  };
  window.addEventListener("afterprint", done);
  document.body.classList.add("printing");
  setTimeout(() => window.print(), 50);
}

function openPrintChoice() {
  const cur = studentsAll().find((s) => s.id === selectedId);
  const m = openModal({
    title: "Yazdır / PDF olarak kaydet",
    body: `<p>Açılan yazdırma penceresinde hedef olarak <b>"PDF olarak kaydet"</b> seçerek PDF dosyası alabilirsiniz. Her öğrenci ayrı bir sayfada yer alır.</p>`,
    footer: `<button class="btn" id="pcCancel">Vazgeç</button>${cur ? `<button class="btn" id="pcOne">Sadece ${esc(trTitle(cur.ad))}</button>` : ""}<button class="btn primary" id="pcAll">Tüm öğrenciler (${studentsAll().length})</button>`,
  });
  $("#pcCancel", m.el).addEventListener("click", m.close);
  $("#pcOne", m.el)?.addEventListener("click", () => { m.close(); printStudents([cur]); });
  $("#pcAll", m.el).addEventListener("click", () => {
    m.close();
    printStudents(studentsAll().sort((a, b) => (a.sube || "").localeCompare(b.sube || "") || collator.compare(a.ad, b.ad)));
  });
}

/* ---------- Oturum / başlatma ---------- */
const AUTH_ERRORS = {
  "auth/invalid-credential": "E-posta veya şifre hatalı.",
  "auth/invalid-email": "E-posta adresi geçersiz.",
  "auth/user-disabled": "Bu hesap devre dışı.",
  "auth/too-many-requests": "Çok fazla deneme yapıldı. Biraz bekleyip tekrar deneyin.",
  "auth/network-request-failed": "Ağ hatası. İnternet bağlantınızı kontrol edin.",
  "auth/operation-not-allowed": "Firebase'de E-posta/Şifre girişi etkin değil.",
};

function showLogin(msg = "") {
  document.getElementById("boot")?.remove();
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  $("#appView").hidden = true;
  $("#loginView").hidden = false;
  $("#loginError").textContent = msg;
}

function showApp() {
  document.getElementById("boot")?.remove();
  $("#loginView").hidden = true;
  $("#appView").hidden = false;
  $("#demoBadge").hidden = backend.mode !== "demo";
  if (unsubscribe) unsubscribe();
  unsubscribe = backend.subscribe((data) => {
    state = { sinavlar: data.sinavlar || {}, ogrenciler: data.ogrenciler || {} };
    render();
  }, (err) => {
    console.error(err);
    toast("Veriler okunamadı: yetki yok. Firebase veritabanı kurallarını kontrol edin.", 8000);
  });
}

function bindUi() {
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#loginError").textContent = "";
    try { await backend.signIn($("#loginEmail").value.trim(), $("#loginPass").value); }
    catch (err) { $("#loginError").textContent = AUTH_ERRORS[err.code] || `Giriş yapılamadı: ${err.message || err}`; }
  });
  $("#btnLogout").addEventListener("click", () => backend.signOut());
  $("#btnAddPdf").addEventListener("click", () => $("#pdfInput").click());
  $("#pdfInput").addEventListener("change", (e) => { const f = [...e.target.files]; e.target.value = ""; if (f.length) handleFiles(f); });
  $("#btnExams").addEventListener("click", openExams);
  $("#btnPrint").addEventListener("click", openPrintChoice);
  $("#search").addEventListener("input", (e) => { query = e.target.value; renderList(); });
  $("#studentList").addEventListener("click", (e) => {
    const b = e.target.closest(".student");
    if (b) { selectedId = b.dataset.id; renderList(); renderDetail(); window.scrollTo({ top: 0, behavior: "smooth" }); }
  });
  $("#detail").addEventListener("click", async (e) => {
    if (e.target.id === "emptyAdd") $("#pdfInput").click();
    if (e.target.id === "btnDelStudent") {
      const o = state.ogrenciler[selectedId];
      if (!o || !confirm(`${trTitle(o.ad)} ve tüm sınav sonuçları silinsin mi?`)) return;
      try { await backend.applyUpdates({ [`ogrenciler/${selectedId}`]: null }); toast("Öğrenci silindi."); }
      catch (err) { toast(`Silinemedi: ${err.message || err}`, 6000); }
    }
  });
}

(async function main() {
  bindUi();
  try {
    backend = await createBackend({ demo });
  } catch (err) {
    console.error(err);
    showLogin("Firebase yüklenemedi. İnternet bağlantınızı kontrol edip sayfayı yenileyin.");
    return;
  }
  backend.onAuth((user) => (user ? showApp() : showLogin()));
})();
