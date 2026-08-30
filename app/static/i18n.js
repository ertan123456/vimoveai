/* ViMove AI — lightweight client-side i18n (no build step).
   - Elements with data-i18n / data-i18n-html get text/HTML from the dictionary.
   - Elements with data-en / data-tr get their textContent swapped directly
     (used for server-rendered dynamic content like condition names).
   - Language persists in localStorage 'vimove:lang'; defaults to Turkish on
     Turkish browsers, English otherwise. A nav button (#langToggle) flips it.
   - game.js / progress.js listen for the 'vimove:lang' event to re-render. */
(function () {
  "use strict";

  const DICT = {
    en: {
      "nav.home": "Home", "nav.how": "How it works", "nav.exercises": "Exercises",
      "nav.progress": "Progress", "nav.about": "About", "nav.community": "Community", "nav.donate": "Donate", "nav.start": "Start a session",

      "footer.tagline": "AI-guided movement therapy that turns any webcam into a personal physiotherapy companion — accessible from home, at no cost.",
      "footer.product": "Product", "footer.project": "Project", "footer.aboutLink": "About ViMove AI",
      "footer.disclaimer": "<strong>Medical disclaimer.</strong> ViMove AI is an assistive movement-tracking tool and a student research project — it is not a medical device and does not provide diagnosis, treatment, or professional medical advice. Always consult a qualified healthcare professional before beginning any exercise program.",
      "footer.built": "Built by two high-school students.", "footer.made": "Made with care for accessible healthcare.",

      "home.eyebrow": "AI-powered physiotherapy",
      "home.lead": "ViMove AI turns any webcam into a personal physiotherapy companion. It builds a tailored exercise program, watches your movements with AI, and counts every repetition — so older adults can keep up with therapy from the comfort of home.",
      "home.ctaStart": "Start a free session", "home.ctaHow": "See how it works",
      "home.meta1": "No download — runs in your browser", "home.meta2": "Free to use", "home.meta3": "Private — video never leaves your device",
      "home.visualCap": "Live skeleton tracking keeps form on point and counts reps automatically.",
      "home.howEyebrow": "How it works", "home.howTitle": "Therapy in three simple steps",
      "home.howSub": "No clinic visit, no special equipment, no technical know-how. If you can open a web page, you can use ViMove.",
      "home.s1t": "Tell us about you", "home.s1p": "Enter your age, gender, and condition. ViMove AI assembles an exercise program suited to your needs.",
      "home.s2t": "Turn on your camera", "home.s2p": "Allow camera access in your browser. Everything is processed locally — your video is never uploaded.",
      "home.s3t": "Move — we count", "home.s3p": "Follow each exercise on screen. AI tracks your motion, counts your reps, and moves you to the next one.",
      "home.featEyebrow": "Why ViMove AI", "home.featTitle": "Built for real people, real homes",
      "home.featSub": "Clinical-grade motion tracking made approachable enough for daily use by older adults and their caregivers.",
      "home.title": "Movement therapy that <span class=\"grad\">guides every repetition</span>",
      "home.f1t": "AI motion tracking", "home.f1p": "Real-time hand, face, and full-body pose detection recognizes each movement and validates your form.",
      "home.f2t": "Personalized programs", "home.f2p": "Exercises are selected and dosed for your condition, then tracked rep by rep through the whole set.",
      "home.f3t": "Live feedback", "home.f3p": "An on-screen progress bar and live counter show exactly how you're doing as you move.",
      "home.f4t": "Private by design", "home.f4p": "All analysis runs in your browser. Your camera feed stays on your device and is never sent to a server.",
      "home.f5t": "Any device", "home.f5p": "Works on laptops, tablets, and phones with a camera. No app store, no installation, no setup.",
      "home.f6t": "Made for accessibility", "home.f6p": "Large type, high contrast, and big touch targets — designed first for older adults and those with tremor.",
      "home.condEyebrow": "Conditions", "home.condTitle": "Supported conditions",
      "home.condSub": "ViMove AI now offers evidence-based programs for a growing list of conditions, each grounded in published clinical guidance.",
      "home.availableNow": "Available now", "home.comingSoon": "Coming soon",
      "home.startProgram": "Start this program", "home.learnMore": "Learn more",
      "home.neckTitle": "Neck & lower back", "home.neckDesc": "Posture and mobility exercises to relieve everyday neck and lower-back stiffness.",
      "home.ctaTitle": "Ready to move with ViMove AI?",
      "home.ctaSub": "Set up your first session in under a minute. All you need is a camera and a little space to move.",
      "home.ctaTeam": "Meet the team",

      "start.eyebrow": "Set up your session", "start.title": "Let's tailor your program",
      "start.sub": "A few quick details help ViMove AI choose the right exercises for you. It takes less than a minute.",
      "start.age": "Age", "start.ageHelp": "Helps us calibrate exercise intensity and targets.",
      "start.gender": "Gender", "start.male": "Male", "start.female": "Female", "start.other": "Other",
      "start.condition": "Condition", "start.condHelp": "Each condition has its own evidence-based program. More are coming soon.",
      "start.neckOption": "Neck & lower back — coming soon",
      "start.privacy": "Your camera is used only on this device for live tracking. No video is recorded, stored, or uploaded.",
      "start.submit": "Continue to exercises",
      "start.ack": "By continuing you acknowledge that ViMove AI is not a medical device and does not replace professional care.",

      "session.h1": "Live exercise session", "session.ready": "Ready",
      "session.changeSetup": "Change setup", "session.cameraOff": "Camera is off",
      "session.cameraOffDesc": "Press “Turn on camera” and allow access to begin.",
      "session.turnOn": "Turn on camera", "session.standBack": "Stand about 2 metres back so your whole body is visible.",
      "session.current": "Current exercise", "session.reset": "Reset", "session.notStarted": "Not started",
      "session.firstHint": "Your first exercise will appear here once the camera starts.",
      "session.yourProgram": "Your program", "session.liveDetection": "Live detection",
      "session.waiting": "Waiting for camera…", "session.pressInfo": "Press “Turn on camera” and grant permission to begin.",
      "session.repsWord": "Reps",
      "session.metaProgram": "Program:", "session.metaPace": "pace", "session.metaAge": "Age", "session.metaExercises": "exercises",
      "session.metaDefault": "Follow each exercise — ViMove AI counts your reps automatically.",

      "progress.eyebrow": "Your progress", "progress.title": "Track your improvement",
      "progress.sub": "Every completed session is saved privately on this device. Watch your scores, symmetry and reps trend over time.",

      "ex.eyebrow": "Exercise library", "ex.title": "What you'll be doing",
      "ex.intro": "Every program below is built from movements ViMove AI can track with AI and counts automatically. Exercise choices and starting rep targets are grounded in published clinical guidance — shown with sources for each condition.",
      "ex.comingTitle": "More conditions on the way", "ex.comingSub": "ViMove AI is built to grow — these programs are in development.",
      "ex.approach": "Approach:", "ex.repsWord": "reps", "ex.sources": "Evidence & sources",
      "ex.repNotice": "Rep targets are evidence-informed <strong>starting points</strong> that ViMove AI adjusts for age — they are not a medical prescription. Please review your plan with a physiotherapist or doctor, especially after a recent stroke.",
      "ex.neckDetail": "Posture and mobility exercises to relieve everyday neck and lower-back stiffness — needs new neck-rotation and trunk-bend detection, which is in development.",
      "about.eyebrow": "Our mission", "about.title": "Making therapy reach everyone",
      "about.intro": "Physiotherapy works — but for many older adults, getting to a clinic regularly is hard. ViMove AI brings guided, AI-tracked exercise into the living room, so staying active doesn't depend on appointments, travel, or cost.",
      "about.a1t": "Accessible", "about.a1p": "No clinic, no app store, no special hardware. A browser and a webcam are all it takes.",
      "about.a2t": "Practical", "about.a2p": "Programs are built around real, repeatable movements that fit into an everyday routine.",
      "about.a3t": "Private", "about.a3p": "AI runs entirely in the browser. The camera feed stays on the device and is never uploaded.",
      "about.techEyebrow": "The technology", "about.techTitle": "Computer vision that understands movement",
      "about.techLead": "ViMove AI uses on-device machine-learning models to detect the landmarks of your hands, face, and full body in real time — over 500 points tracked every frame.",
      "about.techBody": "By measuring how those points move, ViMove AI recognizes each exercise, validates the motion, and counts a repetition only when it's done correctly. A short calibration step adapts the tracking to your body and your space, so it works for different heights, distances, and rooms.",
      "about.tHand": "Hand landmarks", "about.tPointsPerHand": "points / hand", "about.tFace": "Face mesh", "about.tPoints": "points",
      "about.tPose": "Body pose", "about.tProcessing": "Processing", "about.tOnDevice": "100% on-device",
      "about.teamEyebrow": "The team", "about.teamTitle": "Two students, one idea",
      "about.teamIntro": "ViMove AI began as a high-school project with a simple question: could the AI in a webcam help someone stick to their therapy at home?",
      "about.role": "Co-founder & developer",
      "about.disclaimer": "ViMove AI is a student project and an assistive tool — not a medical device. It does not diagnose or treat any condition. Please consult a healthcare professional before starting any exercise program.",
      "about.tryCta": "Try a session",

      "donate.eyebrow": "Support ViMove AI",
      "donate.title": "Keep ViMove AI free for <span class=\"grad\">everyone</span>",
      "donate.lead": "ViMove AI is free — and always will be. Two high-school students build it on evenings and weekends, and your support keeps the servers running and new exercise programs coming.",
      "donate.whyEyebrow": "Where it goes",
      "donate.whyTitle": "Your support, in good hands",
      "donate.c1t": "Keep it online", "donate.c1p": "Hosting and domain costs, so anyone can reach ViMove AI at any time of day.",
      "donate.c2t": "Build new programs", "donate.c2p": "Research and develop evidence-based exercises for more conditions.",
      "donate.c3t": "Keep it free", "donate.c3p": "No ads, no paywalls, no subscriptions — especially for older adults.",
      "donate.transTitle": "Full transparency",
      "donate.transText": "ViMove AI runs on about €6 a month for the server. Every contribution — big or small — goes straight to keeping it alive and growing.",
      "donate.methodsTitle": "Ways to give",
      "donate.methodsSub": "A quick bank transfer is all it takes — and every little bit means a lot. 💚",
      "donate.bmcTitle": "Buy us a coffee",
      "donate.bmcDesc": "International cards, in seconds.",
      "donate.ibanTitle": "Bank transfer (IBAN)",
      "donate.ibanDesc": "From Turkey, with no fees.",
      "donate.ibanHolder": "Account holder",
      "donate.copyBtn": "Copy IBAN", "donate.copiedLabel": "✓ Copied!",
      "donate.tier1": "a coffee", "donate.tier2": "a seedling", "donate.tier3": "a supporter",
      "donate.thanksTitle": "Thank you, truly 💚",
      "donate.thanksText": "Every coffee and every transfer means the world to two students trying to make therapy reachable for everyone. — Erdem & Oğuz",
      "donate.note": "ViMove AI is a student project; donations are a voluntary gift, not a payment for medical services.",

      "community.eyebrow": "From the community",
      "community.title": "ViMove AI in action",
      "community.sub": "Moments from real people using ViMove AI — moving, one rep at a time.",
      "community.close": "Close",
    },
    tr: {
      "nav.home": "Ana Sayfa", "nav.how": "Nasıl çalışır", "nav.exercises": "Egzersizler",
      "nav.progress": "İlerleme", "nav.about": "Hakkında", "nav.community": "Topluluk", "nav.donate": "Bağış", "nav.start": "Seans başlat",

      "footer.tagline": "Herhangi bir web kamerasını kişisel fizyoterapi yardımcısına dönüştüren yapay zeka destekli hareket terapisi — evden, ücretsiz erişilebilir.",
      "footer.product": "Ürün", "footer.project": "Proje", "footer.aboutLink": "ViMove AI Hakkında",
      "footer.disclaimer": "<strong>Tıbbi sorumluluk reddi.</strong> ViMove AI yardımcı bir hareket-takip aracı ve bir öğrenci araştırma projesidir — tıbbi bir cihaz değildir; teşhis, tedavi veya profesyonel tıbbi tavsiye sağlamaz. Herhangi bir egzersiz programına başlamadan önce mutlaka nitelikli bir sağlık uzmanına danışın.",
      "footer.built": "İki lise öğrencisi tarafından geliştirildi.", "footer.made": "Erişilebilir sağlık için özenle yapıldı.",

      "home.eyebrow": "Yapay zeka destekli fizyoterapi",
      "home.lead": "ViMove AI herhangi bir web kamerasını kişisel bir fizyoterapi yardımcısına dönüştürür. Size özel bir egzersiz programı oluşturur, hareketlerinizi yapay zeka ile izler ve her tekrarı sayar — böylece yaşlı bireyler terapiye evlerinin konforunda devam edebilir.",
      "home.ctaStart": "Ücretsiz seans başlat", "home.ctaHow": "Nasıl çalıştığını gör",
      "home.meta1": "İndirme yok — tarayıcıda çalışır", "home.meta2": "Ücretsiz", "home.meta3": "Gizli — video cihazından çıkmaz",
      "home.visualCap": "Canlı iskelet takibi formu korur ve tekrarları otomatik sayar.",
      "home.howEyebrow": "Nasıl çalışır", "home.howTitle": "Üç basit adımda terapi",
      "home.howSub": "Klinik ziyareti yok, özel ekipman yok, teknik bilgi gerektirmez. Bir web sayfası açabiliyorsanız ViMove AI'u kullanabilirsiniz.",
      "home.s1t": "Bize kendini tanıt", "home.s1p": "Yaş, cinsiyet ve rahatsızlığını gir. ViMove AI ihtiyacına uygun bir egzersiz programı oluşturur.",
      "home.s2t": "Kameranı aç", "home.s2p": "Tarayıcında kamera erişimine izin ver. Her şey yerel olarak işlenir — videon asla yüklenmez.",
      "home.s3t": "Hareket et — biz sayalım", "home.s3p": "Ekrandaki her egzersizi yap. Yapay zeka hareketini izler, tekrarlarını sayar ve seni bir sonrakine geçirir.",
      "home.featEyebrow": "Neden ViMove AI", "home.featTitle": "Gerçek insanlar, gerçek evler için",
      "home.featSub": "Klinik düzeyde hareket takibini, yaşlılar ve bakıcıları için günlük kullanılabilecek kadar erişilebilir hale getirdik.",
      "home.title": "Her tekrarı <span class=\"grad\">yönlendiren</span> hareket terapisi",
      "home.f1t": "Yapay zeka hareket takibi", "home.f1p": "Gerçek zamanlı el, yüz ve tüm vücut poz algılama her hareketi tanır ve formunu doğrular.",
      "home.f2t": "Kişiselleştirilmiş programlar", "home.f2p": "Egzersizler rahatsızlığına göre seçilip dozlanır, sonra set boyunca tekrar tekrar takip edilir.",
      "home.f3t": "Canlı geri bildirim", "home.f3p": "Ekrandaki ilerleme çubuğu ve canlı sayaç, hareket ederken durumunu tam olarak gösterir.",
      "home.f4t": "Tasarımdan gizli", "home.f4p": "Tüm analiz tarayıcında çalışır. Kamera görüntün cihazında kalır, asla bir sunucuya gönderilmez.",
      "home.f5t": "Her cihaz", "home.f5p": "Kameralı dizüstü, tablet ve telefonlarda çalışır. Uygulama mağazası, kurulum veya ayar yok.",
      "home.f6t": "Erişilebilirlik için yapıldı", "home.f6p": "Büyük yazı, yüksek kontrast ve geniş dokunma alanları — öncelikle yaşlılar ve titremesi olanlar için tasarlandı.",
      "home.condEyebrow": "Rahatsızlıklar", "home.condTitle": "Desteklenen rahatsızlıklar",
      "home.condSub": "ViMove AI artık her biri yayınlanmış klinik kılavuzlara dayanan, giderek büyüyen bir rahatsızlık listesi için kanıta dayalı programlar sunuyor.",
      "home.availableNow": "Şimdi mevcut", "home.comingSoon": "Yakında",
      "home.startProgram": "Bu programı başlat", "home.learnMore": "Daha fazla",
      "home.neckTitle": "Boyun & bel", "home.neckDesc": "Günlük boyun ve bel tutukluğunu hafifletmek için duruş ve hareketlilik egzersizleri.",
      "home.ctaTitle": "ViMove AI ile hareket etmeye hazır mısın?",
      "home.ctaSub": "İlk seansını bir dakikadan kısa sürede kur. Tek ihtiyacın bir kamera ve hareket edebileceğin biraz alan.",
      "home.ctaTeam": "Ekiple tanış",

      "start.eyebrow": "Seansını kur", "start.title": "Programını sana göre ayarlayalım",
      "start.sub": "Birkaç kısa bilgi, ViMove AI'un senin için doğru egzersizleri seçmesine yardım eder. Bir dakikadan az sürer.",
      "start.age": "Yaş", "start.ageHelp": "Egzersiz yoğunluğunu ve hedeflerini ayarlamamıza yardımcı olur.",
      "start.gender": "Cinsiyet", "start.male": "Erkek", "start.female": "Kadın", "start.other": "Diğer",
      "start.condition": "Rahatsızlık", "start.condHelp": "Her rahatsızlığın kendine ait, kanıta dayalı bir programı var. Daha fazlası yakında.",
      "start.neckOption": "Boyun & bel — yakında",
      "start.privacy": "Kameran yalnızca bu cihazda, canlı takip için kullanılır. Hiçbir video kaydedilmez, saklanmaz veya yüklenmez.",
      "start.submit": "Egzersizlere devam et",
      "start.ack": "Devam ederek ViMove AI'un tıbbi bir cihaz olmadığını ve profesyonel bakımın yerini tutmadığını kabul edersin.",

      "session.h1": "Canlı egzersiz seansı", "session.ready": "Hazır",
      "session.changeSetup": "Kurulumu değiştir", "session.cameraOff": "Kamera kapalı",
      "session.cameraOffDesc": "Başlamak için “Kamerayı aç”a basıp erişime izin ver.",
      "session.turnOn": "Kamerayı aç", "session.standBack": "Tüm vücudun görünsün diye yaklaşık 2 metre geride dur.",
      "session.current": "Mevcut egzersiz", "session.reset": "Sıfırla", "session.notStarted": "Başlamadı",
      "session.firstHint": "İlk egzersizin kamera başlayınca burada görünecek.",
      "session.yourProgram": "Programın", "session.liveDetection": "Canlı algılama",
      "session.waiting": "Kamera bekleniyor…", "session.pressInfo": "Başlamak için “Kamerayı aç”a basıp izin ver.",
      "session.repsWord": "Tekrar",
      "session.metaProgram": "Program:", "session.metaPace": "tempo", "session.metaAge": "Yaş", "session.metaExercises": "egzersiz",
      "session.metaDefault": "Her egzersizi ekrandan takip et — ViMove AI tekrarlarını otomatik olarak sayar.",

      "progress.eyebrow": "İlerlemen", "progress.title": "Gelişimini takip et",
      "progress.sub": "Tamamlanan her seans bu cihazda gizlice kaydedilir. Skorlarının, simetrinin ve tekrarlarının zamanla nasıl değiştiğini gör.",

      "ex.eyebrow": "Egzersiz kütüphanesi", "ex.title": "Neler yapacaksın",
      "ex.intro": "Aşağıdaki her program, ViMove AI'un yapay zeka ile takip edip otomatik saydığı hareketlerden oluşur. Egzersiz seçimleri ve başlangıç tekrar hedefleri yayınlanmış klinik kılavuzlara dayanır — her rahatsızlık için kaynaklarıyla gösterilir.",
      "ex.comingTitle": "Yolda olan diğer rahatsızlıklar", "ex.comingSub": "ViMove AI büyümek için tasarlandı — bu programlar geliştiriliyor.",
      "ex.approach": "Yaklaşım:", "ex.repsWord": "tekrar", "ex.sources": "Kanıt ve kaynaklar",
      "ex.repNotice": "Tekrar hedefleri, ViMove AI'un yaşa göre ayarladığı kanıta dayalı <strong>başlangıç noktalarıdır</strong> — tıbbi bir reçete değildir. Planını bir fizyoterapist veya doktorla gözden geçir, özellikle yakın zamanda inme geçirdiysen.",
      "ex.neckDetail": "Günlük boyun ve bel tutukluğunu hafifletmek için duruş ve hareketlilik egzersizleri — geliştirilmekte olan yeni boyun dönüşü ve gövde eğilme algılaması gerektiriyor.",
      "about.eyebrow": "Misyonumuz", "about.title": "Terapiyi herkese ulaştırmak",
      "about.intro": "Fizyoterapi işe yarar — ama birçok yaşlı için düzenli olarak kliniğe gitmek zordur. ViMove AI, yapay zeka ile takip edilen rehberli egzersizi oturma odasına getirir; böylece aktif kalmak randevuya, ulaşıma veya maliyete bağlı olmaz.",
      "about.a1t": "Erişilebilir", "about.a1p": "Klinik yok, uygulama mağazası yok, özel donanım yok. Tek gereken bir tarayıcı ve bir web kamerası.",
      "about.a2t": "Pratik", "about.a2p": "Programlar, günlük rutine kolayca sığan gerçek ve tekrarlanabilir hareketler üzerine kurulu.",
      "about.a3t": "Gizli", "about.a3p": "Yapay zeka tamamen tarayıcıda çalışır. Kamera görüntüsü cihazda kalır ve asla yüklenmez.",
      "about.techEyebrow": "Teknoloji", "about.techTitle": "Hareketi anlayan bilgisayarlı görü",
      "about.techLead": "ViMove AI, ellerinin, yüzünün ve tüm vücudunun işaret noktalarını gerçek zamanlı algılamak için cihaz üzerinde çalışan makine öğrenmesi modelleri kullanır — her karede 500'den fazla nokta takip edilir.",
      "about.techBody": "ViMove AI, bu noktaların nasıl hareket ettiğini ölçerek her egzersizi tanır, hareketi doğrular ve bir tekrarı yalnızca doğru yapıldığında sayar. Kısa bir kalibrasyon adımı, takibi bedenine ve alanına göre uyarlar; böylece farklı boy, mesafe ve odalarda çalışır.",
      "about.tHand": "El işaret noktaları", "about.tPointsPerHand": "nokta / el", "about.tFace": "Yüz ağı", "about.tPoints": "nokta",
      "about.tPose": "Vücut pozu", "about.tProcessing": "İşleme", "about.tOnDevice": "%100 cihaz üzerinde",
      "about.teamEyebrow": "Ekip", "about.teamTitle": "İki öğrenci, bir fikir",
      "about.teamIntro": "ViMove AI, basit bir soruyla lise projesi olarak başladı: bir web kamerasındaki yapay zeka, birinin evdeki terapisine devam etmesine yardımcı olabilir mi?",
      "about.role": "Kurucu ortak ve geliştirici",
      "about.disclaimer": "ViMove AI bir öğrenci projesi ve yardımcı bir araçtır — tıbbi bir cihaz değildir. Hiçbir rahatsızlığı teşhis veya tedavi etmez. Herhangi bir egzersiz programına başlamadan önce lütfen bir sağlık uzmanına danış.",
      "about.tryCta": "Bir seans dene",

      "donate.eyebrow": "ViMove AI'a Destek Ol",
      "donate.title": "ViMove AI'u <span class=\"grad\">herkes için</span> ücretsiz tut",
      "donate.lead": "ViMove AI ücretsiz — ve hep öyle kalacak. İki lise öğrencisi akşamları ve hafta sonları geliştiriyor; desteğin sunucuları ayakta tutar ve yeni egzersiz programlarının gelmesini sağlar.",
      "donate.whyEyebrow": "Bağışın nereye gidiyor",
      "donate.whyTitle": "Desteğin emin ellerde",
      "donate.c1t": "Çevrimiçi kalsın", "donate.c1p": "Hosting ve alan adı masrafları — herkes günün her saati ViMove AI'a ulaşabilsin diye.",
      "donate.c2t": "Yeni programlar geliştir", "donate.c2p": "Daha fazla rahatsızlık için kanıta dayalı egzersizler araştırıp geliştir.",
      "donate.c3t": "Ücretsiz kalsın", "donate.c3p": "Reklam yok, ücretli duvar yok, abonelik yok — özellikle yaşlılar için.",
      "donate.transTitle": "Tam şeffaflık",
      "donate.transText": "ViMove AI ayda yaklaşık €6 sunucu masrafıyla çalışıyor. Büyük küçük her katkı, doğrudan onu yaşatmaya ve büyütmeye gidiyor.",
      "donate.methodsTitle": "Destek olma yolları",
      "donate.methodsSub": "Bir banka havalesi yeter — ve her küçük katkı çok şey ifade ediyor. 💚",
      "donate.bmcTitle": "Bize bir kahve ısmarla",
      "donate.bmcDesc": "Uluslararası kart, saniyeler içinde.",
      "donate.ibanTitle": "Banka havalesi (IBAN)",
      "donate.ibanDesc": "Türkiye'den, komisyonsuz.",
      "donate.ibanHolder": "Hesap sahibi",
      "donate.copyBtn": "IBAN'ı kopyala", "donate.copiedLabel": "✓ Kopyalandı!",
      "donate.tier1": "bir kahve", "donate.tier2": "bir fidan", "donate.tier3": "bir destekçi",
      "donate.thanksTitle": "Gerçekten teşekkürler 💚",
      "donate.thanksText": "Her kahve ve her havale; terapiyi herkes için erişilebilir kılmaya çalışan iki öğrenci için çok şey ifade ediyor. — Erdem & Oğuz",
      "donate.note": "ViMove AI bir öğrenci projesidir; bağışlar bir tıbbi hizmet ödemesi değil, gönüllü bir hediyedir.",

      "community.eyebrow": "Topluluktan",
      "community.title": "Sahada ViMove AI",
      "community.sub": "ViMove AI'u gerçek hayatta kullanan insanlardan kareler — tekrar tekrar, birlikte hareket.",
      "community.close": "Kapat",
    }
  };

  function detect() {
    const saved = localStorage.getItem("vimove:lang");
    if (saved === "tr" || saved === "en") return saved;
    return (navigator.language || "").toLowerCase().startsWith("tr") ? "tr" : "en";
  }

  let lang = detect();
  function t(key) {
    return (DICT[lang] && DICT[lang][key] != null) ? DICT[lang][key]
         : (DICT.en[key] != null ? DICT.en[key] : null);
  }

  function apply() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach(el => {
      const v = t(el.getAttribute("data-i18n")); if (v != null) el.textContent = v;
    });
    document.querySelectorAll("[data-i18n-html]").forEach(el => {
      const v = t(el.getAttribute("data-i18n-html")); if (v != null) el.innerHTML = v;
    });
    document.querySelectorAll("[data-i18n-ph]").forEach(el => {
      const v = t(el.getAttribute("data-i18n-ph")); if (v != null) el.setAttribute("placeholder", v);
    });
    // server-rendered dynamic text carrying both languages
    document.querySelectorAll("[data-en]").forEach(el => {
      const v = el.getAttribute("data-" + lang); if (v != null) el.textContent = v;
    });
    const tg = document.getElementById("langToggle");
    if (tg) { tg.textContent = lang === "tr" ? "EN" : "TR"; tg.setAttribute("aria-label", lang === "tr" ? "Switch to English" : "Türkçeye geç"); }
    document.dispatchEvent(new CustomEvent("vimove:lang", { detail: { lang } }));
  }

  window.viI18n = {
    get lang() { return lang; },
    t,
    set(l) { lang = (l === "tr" ? "tr" : "en"); localStorage.setItem("vimove:lang", lang); apply(); }
  };

  function init() {
    apply();
    const tg = document.getElementById("langToggle");
    if (tg) tg.addEventListener("click", () => window.viI18n.set(lang === "tr" ? "en" : "tr"));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
