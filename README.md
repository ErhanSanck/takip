# Sınav Takip (Eon Kurs)

Eon Kurs "TYT PUAN SIRALI LİSTE" PDF'lerini ekleyerek öğrencilerin sınav sonuçlarını takip eden, saf HTML/CSS/JavaScript projesi.
Veriler Firebase Realtime Database'de saklanır; giriş Firebase Authentication (e-posta/şifre) ile yapılır.

## Özellikler
- **PDF Ekle**: PDF tarayıcıda okunur (sunucuya gönderilmez), her öğrencinin satırı ad üzerinden bulunur ve ders sonuçları (Türkçe, Matematik, Geometri, diğer dersler, net, puan, sıralar) listeye eklenir.
- Eklemeden önce **önizleme**: eşleşen öğrenciler, listede olmayan (yeni) öğrenciler ve PDF'de bulunmayan öğrenciler gösterilir. Sınav adı/tarihi düzenlenebilir.
- Her öğrenci için sınav sonuçları **alt alta** tablo, özet kartları (son sınav, değişim) ve **Matematik net çizgi grafiği** (genel ortalama kesikli çizgiyle).
- Aynı sınavı tekrar eklemek sonuçları günceller (kopya oluşturmaz). **Sınavlar** penceresinden sınav silinebilir.
- **Yazdır / PDF**: seçili öğrenci veya tüm öğrenciler (her biri ayrı A4 sayfa) PDF olarak kaydedilebilir.

## Kurulum (bir kez)
Bu proje, foto galeri ile aynı Firebase projesini (`enesogrenci-91325`) kullanır; veriler `sinavTakip/` yolunda tutulur ve galeri verisine dokunmaz.

1. **Authentication**: Firebase Console → Authentication → Sign-in method → *E-posta/Şifre*'yi etkinleştirin. Users sekmesinden giriş yapacak kullanıcıyı ekleyin.
2. **Veritabanı kuralları**: Realtime Database → Rules. Mevcut kurallarınızı **silmeyin**; sadece `rules` içine `database.rules.json` dosyasındaki `sinavTakip` bloğunu ekleyin:
   ```json
   "sinavTakip": { ".read": "auth != null", ".write": "auth != null" }
   ```
   Böylece öğrenci sonuçlarını yalnızca giriş yapmış kullanıcılar okuyup yazabilir.
3. **Çalıştırma**: ES modülleri kullanıldığı için dosyayı çift tıklayarak (`file://`) açmayın; bir sunucudan açın:
   ```bash
   python -m http.server 8080
   # http://localhost:8080
   ```
   Yayına alırken (Firebase Hosting vb.) alan adını Authentication → Settings → Authorized domains'e ekleyin (`localhost` varsayılan olarak ekli).

## Deneme modu
`index.html?demo=1` Firebase'siz çalışır; veriler yalnızca o tarayıcıda (localStorage) tutulur.

## Veri yapısı
```
sinavTakip/
  sinavlar/{sinavId}            ad, tarih, sira (YYYY-MM-DD), genelKatilim, kurumKatilim, subeKatilim, ort{turkce,mat,geo,...}
  ogrenciler/{ogrenciId}        ad, sube
    sonuclar/{sinavId}          dersler{turkce,tarih,cografya,felsefe,din,mat,geo,fizik,kimya,biyo: [doğru, yanlış, net]},
                                net, puan, genel, kurum, subesira, sinif
```
Boş bırakılan dersler kayıtta yer almaz (tabloda 0 / 0 / 0,00 görünür).

## Notlar
- Beklenen PDF: Eon Kurs TYT puan sıralı / isim sıralı liste. Sütunlar sayfadaki "D Y N" başlıklarının konumundan bulunduğu için boş hücreler kaymaz. Farklı bir PDF düzeni (örn. AYT) için `js/parser.js` uyarlanmalıdır.
- Öğrenciler ad (büyük/küçük harf ve boşluktan bağımsız) ile eşleştirilir. PDF'de farklı yazılmış bir ad "listede olmayan öğrenci" olarak görünür; yanlışlıkla çift kayıt olmaması için varsayılan olarak seçili gelmez (liste boşsa hepsi seçili gelir).
- Kütüphaneler CDN'den yüklenir: Firebase 10.12.2, pdf.js 3.11.174, Chart.js 4.4.1.

## Dosyalar
```
index.html · css/style.css · database.rules.json
js/app.js (arayüz) · js/parser.js (PDF ayrıştırıcı) · js/db.js (Firebase / deneme modu) · js/firebase-config.js
```
