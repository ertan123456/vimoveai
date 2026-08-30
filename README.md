# ViMove AI

**Kameranı bir fizyoterapi asistanına çeviren, tarayıcıda çalışan hareket terapisi platformu.**

ViMove AI, yaşlı bireylerin evde yaptığı egzersizleri web kamerasıyla izler, tekrarları sayar,
hareket kalitesini ölçer ve sonucu hastanın fizyoterapistine iletir. Ek donanım, sensör veya
bileklik gerekmez — sadece bir kamera ve bir tarayıcı.

Canlı: **https://vimoveai.com**

Geliştiriciler: Erdem Ertan ve Oğuz Çetinkaya (lise öğrencileri).

---

## Teknik yenilik: LRV (Low-Resolution Vision) hattı

Hedef kullanıcımızın 1080p kamerası yok. Loş bir salonda, iki metre uzakta, beş yıllık bir
dizüstü bilgisayarı var. Hazır bir poz-tahmin modelini o görüntüye doğrudan bağladığında üç şey
bozulur:

1. **Kişi kadrajda küçüktür** → modelin çalışacağı piksel kalmaz.
2. **Noktalar titrer** → sayaç, yapılmayan tekrarları sayar.
3. **Kareler kaybolur** → tekrarın ortasında durum makinesi kırılır.

`app/static/game/lowres.js` bu üç sorunu MediaPipe'ın üzerine eklenen dört aşamayla çözer:

| Aşama | Ne yapar |
|---|---|
| **1 · Uyarlanır ROI** | Vücudu (ya da eli/yüzü) takip eder, etrafını kırpar ve model çalışmadan önce 512 piksele büyütür — modele giden piksel yoğunluğu ~2 katına çıkar. Kırpma kullanıcıyı kaybederse otomatik olarak tam kareye döner. |
| **2 · Kararlılık** | 5 örneklik koşan **medyan** (tek karelik büyük hataları siler) + **One Euro filtresi** (Casiez ve ark., CHI 2012 — dururken sıkı yumuşatır, hızlı harekette gevşer) + kayıp karelerde son hızla **boşluk doldurma** (6 kareye kadar). |
| **3 · Gürültüye uyarlanan sayaç** | Temizlenemeyen artık titreşimi (medyan mutlak sapma) ölçer; eşik geçişinin kaç kare sürmesi gerektiğini ve histerezis bandının ne kadar genişleyeceğini buna göre ayarlar. Eşik **asla** sinyalin ulaşabildiği aralığın dışına itilmez (yoksa egzersiz kilitlenir). |
| **4 · Kare kalitesi** | Parlaklık / kontrast / keskinlik ölçer; kullanıcıya "ortam karanlık, ışığı artır" gibi uygulanabilir geri bildirim verir. |

### İki ray

Saymak ve ölçmek zıt şeyler ister. Saymak **hızlı** sinyal ister (ağır filtrelenmiş sinyal eşiği
geç geçer, tekrar kaybolur); hareket açıklığını ölçmek **pürüzsüz** sinyal ister (gürültü tepe
değerini şişirir, klinik skoru da onunla birlikte). Bu yüzden hat ikisini birden üretir:

* **hızlı ray** (yalnız medyan, ~sıfır gecikme) → tekrar sayacını sürer
* **pürüzsüz ray** (medyan + One Euro) → rapordaki hareket açıklığını ölçer
* hareket açıklığı tek bir maksimum yerine **en iyi birkaç örneğin medyanı** olarak alınır —
  tek kötü kare kullanıcının "hareket açıklığı" olmamalı
* kamera temizse filtreleme kendiliğinden geri çekilir, iyi kamera hiçbir şey kaybetmez

### Ölçüm

```bash
node bench/lowres_bench.mjs
```

20 temiz tekrar sentezlenir; nokta koordinatları gerçek bir kameranın belirli çözünürlük ve
mesafede bozduğu gibi bozulur (piksel yuvarlama, ~1.5 piksel konum hatası, büyük sapma hataları,
art arda kaybolan kare blokları). Aynı bozuk akışı iki sayaç okur: eski ViMove sayacı ve LRV.

| Senaryo | Sayım doğruluğu (eski → LRV) | Hareket açıklığı hatası (eski → LRV) |
|---|---|---|
| 1280x720 · yakın | %100 → %100 | %0.9 → %1.1 |
| 640x480 · yakın | %100 → %100 | %1.4 → %1.6 |
| 640x480 · uzak | %100 → %99.9 | %3.3 → %3.2 |
| 320x240 · yakın | %100 → %100 | %3.3 → %3.0 |
| 320x240 · uzak | %99.0 → %99.1 | %8.8 → %6.9 |
| **160x120 · uzak** | %95.8 → **%96.0** | %28.1 → **%14.9** |

Zor senaryolarda (kullanıcı kameradan uzakta) hareket açıklığı ölçüm hatası **%13.4'ten %8.3'e**
düşüyor; tekrar sayımı ise en kötü durumda bile geriye gitmiyor. Bu önemli, çünkü rapordaki
klinik göstergeler (tutarlılık, yorulma azalması, sağ-sol simetri) doğrudan bu ölçümden türüyor.

> **Dürüst okuma:** Bu sayılar kamera bozulmasının **simülasyonundan** gelir, klinik bir denemeden
> değil. ROI büyütme aşaması tabloya bilerek dahil edilmedi: o aşama matematiği değil sinir ağının
> gördüğü görüntüyü değiştirir ve onu simüle ediyormuş gibi yapmak sonucu kurgulamak olurdu.
> Sıradaki adım, gerçek cihazda elle sayılan tekrarlarla doğrulama.

---

## Hareket dedektörleri

16 hareket ailesi, hepsi ölçek ve mesafeden bağımsız (vücut/el/yüz boyutuna normalize) metriklerle:

`hand` · `fingertap` · `arm` (öne kaldırma) · `armabduct` (yana kaldırma) · `elbow` · `shrug` ·
`neckturn` · `necktilt` · `neckflex` · `trunkbend` · `leg` · `kneeext` · `march` · `sitstand` ·
`mouth` · `blink`

Duruşa bağlı olanlar (`neckflex`, `shrug`) sabit eşik yerine **kullanıcının kendi dinlenme
değerine göre** çalışır: taban çizgisi son ~5 saniyenin yüzdeliğinden sürekli güncellenir, yani
vücut tipi ya da sandalyede kayma sayımı bozmaz.

## Egzersiz programları

`app/data/programs.json` — 10 durum, 76 egzersiz tanımı, her biri kaynaklı:
Parkinson, inme sonrası, osteoartrit, denge/düşme önleme, **bel ağrısı**, **boyun ağrısı**,
**bel fıtığı**, **skolyoz**, **kas yaralanması sonrası**, genel yaşlı kondisyonu.

Kural: **uydurma egzersiz yok.** Her programın gerekçesi ve kaynağı (NICE, Cochrane, SOSORT,
JOSPT, Otago, OARSI/ACR…) veri dosyasında ve `/exercises` sayfasında yazılıdır.
Programı yeniden üretmek için: `python tools/build_programs.py`

---

## Mimari

```
FastAPI + Jinja2  ──  build adımı yok, vanilla CSS/JS
        │
        ├── app/static/game/game.js     16 dedektör, seans akışı, rapor
        ├── app/static/game/lowres.js   LRV hattı (bu dosya bağımsız ve test edilebilir)
        ├── app/program_engine.py       kanıta dayalı program üretici (yaşa göre ölçekleme)
        └── Supabase                    auth + Postgres (RLS) + video depolama
```

Üç rol: **hasta** (`/hasta`), **uzman/fizyoterapist** (`/uzman`), **yönetici** (`/admin`).
Uzman hastasına hesap açar, reçete verir, seans videolarını izler ve uygulama içinden mesajlaşır.

Android: siteyi saran bir **TWA** paketi (`com.vimoveai.twa`) — uygulama sitenin kendisini açar,
bu yüzden web tarafındaki her güncelleme anında uygulamada da görünür.

## Çalıştırma

```bash
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
```

Kamera `getUserMedia` için güvenli bağlam ister: `http://localhost:8000` veya HTTPS.

---

## Sorumluluk reddi

ViMove AI bir **wellness ve egzersiz** aracıdır, tıbbi cihaz değildir. Teşhis veya tedavi
iddiası taşımaz. Rapordaki ölçümler kamera tabanlı tahminlerdir ve kişinin kendi geçmiş
seanslarıyla karşılaştırıldığında anlamlıdır. Egzersiz programına başlamadan önce bir sağlık
uzmanına danışın.

## Lisans

MIT — bkz. [LICENSE](LICENSE).
