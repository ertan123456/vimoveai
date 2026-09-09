-- =====================================================================
-- ViMove AI — sunum öncesi veri temizliği
-- Supabase → SQL Editor'de blokları SIRAYLA çalıştır.
--
-- Ne yapar: bütün hasta hesaplarını, reçeteleri, mesajları, seans
-- kayıtlarını ve seans videolarını siler. Uzman/yönetici hesapları
-- (senin ve Oğuz'un hesabı) DURUR.
--
-- Geri dönüşü yoktur. Önce 1. bloğu çalıştırıp ne sileceğini gör.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) ÖNİZLEME — hiçbir şey silmez, sadece sayar
-- ---------------------------------------------------------------------
select 'seans kaydi'  as tablo, count(*) from public.sessions
union all select 'mesaj',        count(*) from public.messages
union all select 'recete',       count(*) from public.prescriptions
union all select 'hasta hesabi', count(*) from public.profiles where role = 'hasta'
union all select 'video',        count(*) from storage.objects where bucket_id = 'session-videos';

-- kimler silinecek / kimler kalacak?
select p.role, u.email, p.username, p.full_name
from public.profiles p
join auth.users u on u.id = p.id
order by p.role, u.email;


-- ---------------------------------------------------------------------
-- 2) TEMİZLİK — hasta verisi ve tüm seans/mesaj/reçete geçmişi
-- ---------------------------------------------------------------------
begin;

-- seans videoları (Storage kayıtları)
delete from storage.objects where bucket_id = 'session-videos';

-- seans kayıtları, mesajlar, reçeteler: herkes için sıfırla
delete from public.sessions;
delete from public.messages;
delete from public.prescriptions;

-- hasta hesaplarını tamamen sil (profiles satırı cascade ile gider)
delete from auth.users u
using public.profiles p
where p.id = u.id and p.role = 'hasta';

-- uzman hesaplarında kalan hasta bağlantısını temizle (varsa)
update public.profiles set specialist_id = null where specialist_id is not null;

commit;


-- ---------------------------------------------------------------------
-- 3) OĞUZ'U UZMAN YAP
--    ÖNEMLİ: Oğuz önce https://vimoveai.com/giris adresinden Google ile
--    BİR KEZ giriş yapmalı ki hesabı oluşsun. Sonra burayı çalıştır.
-- ---------------------------------------------------------------------

-- hesap oluşmuş mu? (0 satır dönerse önce giriş yapması gerekiyor)
select u.id, u.email, p.role
from auth.users u
left join public.profiles p on p.id = u.id
where u.email = 'oguzcetinkaya1903@gmail.com';

-- rolü yükselt (tetikleyici rol değişimini geri aldığı için geçici kapatıyoruz)
alter table public.profiles disable trigger profiles_guard_role;

update public.profiles p
set role = 'uzman',
    title = coalesce(nullif(p.title, ''), 'Fizyoterapist'),
    full_name = coalesce(nullif(p.full_name, ''), 'Oğuz Çetinkaya')
from auth.users u
where u.id = p.id and u.email = 'oguzcetinkaya1903@gmail.com';

alter table public.profiles enable trigger profiles_guard_role;

-- DOĞRULA: role sütunu 'uzman' görünmeli
select u.email, p.role, p.full_name, p.title
from public.profiles p join auth.users u on u.id = p.id
where u.email = 'oguzcetinkaya1903@gmail.com';


-- ---------------------------------------------------------------------
-- 4) SON KONTROL — hepsi 0 olmalı (hasta hesabı dahil)
-- ---------------------------------------------------------------------
select 'seans kaydi'  as tablo, count(*) from public.sessions
union all select 'mesaj',        count(*) from public.messages
union all select 'recete',       count(*) from public.prescriptions
union all select 'hasta hesabi', count(*) from public.profiles where role = 'hasta'
union all select 'video',        count(*) from storage.objects where bucket_id = 'session-videos';
