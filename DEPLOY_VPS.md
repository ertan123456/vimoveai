# ViMove — Kendi Sunucuna (VPS) Kurulum

Ubuntu 22.04 / 24.04 bir VPS (DigitalOcean, Hetzner, Linode vb.) için adım adım kurulum.
Mimari: **nginx (ters proxy + HTTPS) → gunicorn (Uvicorn worker) → FastAPI**.

> ⚠️ Kamera (getUserMedia) **yalnızca HTTPS** üzerinde çalışır. 8. adımdaki Let's Encrypt şarttır.

---

## 1) DNS
Domain sağlayıcında iki **A kaydı** ekle (yayılması birkaç dk–saat sürebilir):

| Tip | Ad   | Değer (VPS IP) |
|-----|------|----------------|
| A   | @    | 203.0.113.10   |
| A   | www  | 203.0.113.10   |

## 2) Sunucu hazırlığı
SSH ile bağlan, paketleri kur:
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3-venv python3-pip nginx git
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw --force enable
```

## 3) Kodu sunucuya al
```bash
sudo mkdir -p /opt/vimove && sudo chown $USER:$USER /opt/vimove
# Seçenek A: git
git clone <REPO_URL> /opt/vimove
# Seçenek B: yerelden yükle (kendi bilgisayarında çalıştır):
#   scp -r C:/Users/ASUS/vimovefinal/* kullanici@SUNUCU_IP:/opt/vimove/
cd /opt/vimove
```

## 4) Sanal ortam + bağımlılıklar
```bash
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
```

## 5) Çalışıyor mu? (hızlı test)
```bash
.venv/bin/gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w 2 -b 127.0.0.1:8000
# Başka bir terminalde: curl -s localhost:8000/health  -> {"status":"ok"}
# Onayladıktan sonra Ctrl+C
```

## 6) systemd servisi (otomatik başlat + çökerse kalkar)
Dosya oluştur: `sudo nano /etc/systemd/system/vimove.service`
```ini
[Unit]
Description=ViMove (FastAPI via Gunicorn)
After=network.target

[Service]
User=www-data
Group=www-data
WorkingDirectory=/opt/vimove
ExecStart=/opt/vimove/.venv/bin/gunicorn app.main:app \
  -k uvicorn.workers.UvicornWorker -w 2 -b 127.0.0.1:8000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```
Dosya sahipliğini servis kullanıcısına ver, sonra başlat:
```bash
sudo chown -R www-data:www-data /opt/vimove
sudo systemctl daemon-reload
sudo systemctl enable --now vimove
sudo systemctl status vimove          # active (running) görmelisin
```

## 7) nginx ters proxy
Dosya oluştur: `sudo nano /etc/nginx/sites-available/vimove`
(`server_name`'i kendi domaininle değiştir)
```nginx
server {
    listen 80;
    server_name vimove.example.com www.vimove.example.com;

    client_max_body_size 5m;

    # Statik dosyaları doğrudan nginx servis etsin (daha hızlı)
    location /static/ {
        alias /opt/vimove/app/static/;
        expires 7d;
        access_log off;
    }

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Etkinleştir:
```bash
sudo ln -s /etc/nginx/sites-available/vimove /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## 8) HTTPS (Let's Encrypt) — kamera için ŞART
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d vimove.example.com -d www.vimove.example.com
```
Certbot 443'ü yapılandırır, 80→443 yönlendirmesini ekler ve **otomatik yeniler**.

✅ Bitti: **https://vimove.example.com**

---

## Güncelleme (kod değişince)
```bash
cd /opt/vimove
git pull            # ya da scp ile yeni dosyaları yükle
.venv/bin/pip install -r requirements.txt
sudo systemctl restart vimove
```

## Sorun giderme
- **Loglar:** `sudo journalctl -u vimove -f`
- **502 Bad Gateway:** gunicorn çalışmıyordur → `sudo systemctl status vimove`
- **Kamera açılmıyor:** HTTPS yok ya da tarayıcı izni engelli (adres çubuğundaki kilit → kamerayı izin ver).
- **İzin hatası:** dosya sahipliği → `sudo chown -R www-data:www-data /opt/vimove`

## Notlar
- Uygulama **durumsuz (stateless)**: seçim URL üzerinden taşınır, paylaşılan dosya yok → çok kullanıcı ve çok worker (`-w 2/4`) güvenli.
- `requirements.txt` içinde `gunicorn`, `uvicorn[standard]`, `python-multipart` mevcut.
- Güvenlik başlıkları + CSP uygulama tarafında ayarlı; proxy arkasında sorunsuz çalışır.
- Analytics: `app/templates/base.html` içindeki Google tag (`G-4SV7FE09C2`) — kendi domaininde kendi ID'ni kullanmak istersen değiştir.
