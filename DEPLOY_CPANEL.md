# ViMove — cPanel Paylaşımlı Hosting Kurulumu (GüzelHosting vb.)

ViMove **Python/FastAPI** uygulamasıdır. cPanel paylaşımlı hosting'de **"Setup Python App"
(Python Selector / Phusion Passenger)** üzerinden çalışır.

> ⚠️ **ÖN KOŞUL — önce doğrula:** Planın cPanel'inde **"Setup Python App"** olmalı.
> Yoksa (yalnız PHP destekliyorsa) bu uygulama burada çalışmaz; VPS ya da Python destekli
> bir plan gerekir. Satın almadan önce hosting firmasına sor:
> *"Bu pakette Setup Python App / Python Selector ile bir Python (FastAPI/ASGI) uygulaması çalıştırabilir miyim?"*

> ⚠️ Kamera (getUserMedia) **yalnızca HTTPS**'te çalışır → 6. adımdaki AutoSSL şart.

Passenger WSGI konuşur, FastAPI ise ASGI'dir; köprüyü kökteki **`passenger_wsgi.py`**
(`a2wsgi` ile) kurar — ekstra bir şey yapman gerekmez.

---

## 1) Domaini bağla
`vimoveai.com`'u hesabına ekle (siparişte domain de var). Birincil domain değilse
cPanel → **Domains / Addon Domains** ile ekle.

## 2) Setup Python App → uygulama oluştur
cPanel → **Setup Python App** → **Create Application**:
- **Python version:** 3.10 veya üzeri (listedeki en güncel 3.x)
- **Application root:** `vimoveai`  (örn. `/home/KULLANICI/vimoveai`)
- **Application URL:** `vimoveai.com`  (domaini seç)
- **Application startup file:** `passenger_wsgi.py`
- **Application Entry point:** `application`
- **Create** de.

## 3) Proje dosyalarını yükle
Tüm proje dosyalarını **Application root** klasörüne koy (File Manager → Upload,
ya da FTP/Git). Şu yapı olmalı:
```
vimoveai/
├── passenger_wsgi.py        <-- kökte
├── requirements.txt
└── app/
    ├── main.py, program_engine.py, __init__.py
    ├── data/programs.json
    ├── templates/...
    └── static/...
```
> `game.py`, `run.bat`, `run.sh`, `last_selection.json`, `DEPLOY_*.md` gerekmez (zararsız ama silebilirsin).

## 4) Bağımlılıkları kur
Setup Python App ekranında uygulamanı aç:
- **Configuration files** alanına `requirements.txt` ekle → **Run Pip Install**.
- Alternatif (Terminal varsa): ekranda gösterilen *"Enter to the virtual environment"*
  komutunu çalıştır, sonra:
  ```bash
  pip install -r requirements.txt
  ```

## 5) Uygulamayı yeniden başlat
Setup Python App → **Restart**. (Her dosya değişikliğinden sonra Restart gerekir.)

## 6) HTTPS (AutoSSL / Let's Encrypt) — ŞART
cPanel → **SSL/TLS Status** → domaini seç → **Run AutoSSL**.
Sonra cPanel → **Domains** → `vimoveai.com` için **Force HTTPS Redirect** aç.

✅ Bitti: **https://vimoveai.com**

---

## Güncelleme (kod değişince)
1. Değişen dosyaları Application root'a yükle.
2. Setup Python App → **Restart**.
(requirements değiştiyse önce **Run Pip Install**.)

## Sorun giderme
- **500 / hata:** Setup Python App ekranındaki **log** dosyasına bak; ya da
  `stderr.log` / Passenger log. Çoğu zaman eksik paket veya yanlış Python sürümü.
- **Pip install hata veriyor:** Python sürümünü 3.10+ yap, tekrar dene.
- **Statik dosyalar (CSS/JS) gelmiyor:** uygulama `/static`'i kendisi servis eder;
  gelmiyorsa Restart at, dosya yollarının `app/static/` altında olduğunu doğrula.
- **Kamera açılmıyor:** AutoSSL tamam mı? Adres `https://` mi? Tarayıcı kamera izni verilmiş mi?

## Notlar
- `passenger_wsgi.py` + `a2wsgi` ASGI→WSGI köprüsünü kurar; **uvicorn/gunicorn cPanel'de
  kullanılmaz** (Passenger sunucu görevini görür) ama requirements'ta kalması zararsız.
- Uygulama durumsuz (stateless) — paylaşılan dosya yok, çok kullanıcı güvenli.
- Analytics: `app/templates/base.html` içindeki Google tag ID'sini kendi hesabınla değiştirebilirsin.
