# tools/build_programs.py
# Rebuilds app/data/programs.json:
#   * canonical, plain-language exercise names (TR + EN)
#   * a clearly different exercise mix per condition
#   * five new conditions (low back pain, neck pain, disc herniation,
#     scoliosis, muscle strain) with real, citable sources
#
# Run:  python tools/build_programs.py
from __future__ import annotations
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "app" / "data" / "programs.json"

# ---------------------------------------------------------------------
# The movement library. `kind` is what the detector in game.js implements.
# ---------------------------------------------------------------------
L = {
    "hand":      dict(name="Hand Open / Close",        name_tr="El Açma–Kapama",              kind="hand",      sides=["right", "left"], base_reps=12, domain="Grip & fine motor",        domain_tr="Kavrama ve ince motor"),
    "fingertap": dict(name="Thumb-to-Index Tap",       name_tr="Parmak Ucu Dokunuşu",         kind="fingertap", sides=["right", "left"], base_reps=14, domain="Finger dexterity",         domain_tr="Parmak becerisi"),
    "arm":       dict(name="Forward Arm Raise",        name_tr="Kolu Öne Kaldırma",           kind="arm",       sides=["right", "left"], base_reps=8,  domain="Shoulder flexion",         domain_tr="Omuz öne kaldırma"),
    "armabduct": dict(name="Side Arm Raise",           name_tr="Kolu Yana Kaldırma",          kind="armabduct", sides=["right", "left"], base_reps=8,  domain="Shoulder abduction",       domain_tr="Omuz yana açma"),
    "elbow":     dict(name="Elbow Curl",               name_tr="Dirsek Bükme",                kind="elbow",     sides=["right", "left"], base_reps=10, domain="Elbow strength",           domain_tr="Dirsek gücü"),
    "shrug":     dict(name="Shoulder Shrug",           name_tr="Omuz Silkme",                 kind="shrug",     sides=[None],            base_reps=10, domain="Scapular control",         domain_tr="Kürek kemiği kontrolü"),
    "neckturn":  dict(name="Head Turn",                name_tr="Başı Yana Çevirme",           kind="neckturn",  sides=[None],            base_reps=10, domain="Neck rotation",            domain_tr="Boyun dönüşü"),
    "necktilt":  dict(name="Head Tilt to Shoulder",    name_tr="Başı Omza Yaklaştırma",       kind="necktilt",  sides=["right", "left"], base_reps=8,  domain="Neck side bending",        domain_tr="Boyun yana eğilme",
                      sided={"right": "Head Tilt to Right Shoulder", "left": "Head Tilt to Left Shoulder"},
                      sided_tr={"right": "Başı Sağ Omza Yaklaştırma", "left": "Başı Sol Omza Yaklaştırma"}),
    "neckflex":  dict(name="Neck Flexion (chin to chest)", name_tr="Başı Öne Eğme",           kind="neckflex",  sides=[None],            base_reps=10, domain="Neck flexion range",       domain_tr="Boyun öne eğilme açıklığı"),
    "trunkbend": dict(name="Side Bend",                name_tr="Gövdeyi Yana Eğme",           kind="trunkbend", sides=["right", "left"], base_reps=8,  domain="Trunk mobility",           domain_tr="Gövde hareketliliği",
                      sided={"right": "Side Bend to the Right", "left": "Side Bend to the Left"},
                      sided_tr={"right": "Gövdeyi Sağa Eğme", "left": "Gövdeyi Sola Eğme"}),
    "leg":       dict(name="Side Leg Raise",           name_tr="Bacağı Yana Açma",            kind="leg",       sides=["right", "left"], base_reps=10, domain="Hip abductors",            domain_tr="Kalça yan kasları"),
    "kneeext":   dict(name="Seated Knee Extension",    name_tr="Oturarak Diz Açma",           kind="kneeext",   sides=["right", "left"], base_reps=10, domain="Quadriceps",               domain_tr="Uyluk ön kası",
                      sided_tr={"right": "Oturarak Sağ Dizi Açma", "left": "Oturarak Sol Dizi Açma"}),
    "march":     dict(name="Marching in Place",        name_tr="Yerinde Yürüyüş",             kind="march",     sides=[None],            base_reps=16, domain="Dynamic balance",          domain_tr="Dinamik denge"),
    "sitstand":  dict(name="Sit to Stand",             name_tr="Otur–Kalk",                   kind="sitstand",  sides=[None],            base_reps=10, domain="Leg strength & transfers",  domain_tr="Bacak gücü ve transfer"),
    "mouth":     dict(name="Mouth Open / Close",       name_tr="Ağız Açma–Kapama",            kind="mouth",     sides=[None],            base_reps=10, domain="Facial muscles",           domain_tr="Yüz kasları"),
    "blink":     dict(name="Eye Blink",                name_tr="Göz Kırpma",                  kind="blink",     sides=["right", "left"], base_reps=8,  domain="Eyelid control",           domain_tr="Göz kapağı kontrolü"),
}

# ---------------------------------------------------------------------
# Programs. Each entry: (library key, EN rationale, TR rationale, optional reps)
# ---------------------------------------------------------------------
PROGRAMS = {
    "parkinson": [
        ("fingertap", "Rapid thumb-to-index tapping is the classic MDS-UPDRS item and a direct target for bradykinesia and the decrement seen across a set.",
                      "Baş–işaret parmağı dokunuşu MDS-UPDRS'in klasik maddesidir; hareket yavaşlığını ve set boyunca küçülmeyi doğrudan hedefler.", 16),
        ("hand",      "Large-amplitude opening and closing works against the small, cramped movements of hypokinesia.",
                      "Geniş genlikli açma-kapama, hareketlerin küçülmesine (hipokinezi) karşı çalışır.", 12),
        ("arm",       "Big forward reaches follow the LSVT BIG principle: deliberately oversized movement recalibrates what 'normal size' feels like.",
                      "Geniş öne uzanmalar LSVT BIG ilkesini izler: bilinçli olarak büyük yapılan hareket, 'normal büyüklük' algısını yeniden ayarlar.", 8),
        ("armabduct", "Raising the arms sideways opens the chest and counters the stooped, closed posture.",
                      "Kolları yandan kaldırmak göğsü açar ve öne kapanmış duruşa karşı çalışır.", 8),
        ("trunkbend", "Axial rigidity is a core Parkinson's problem; side bending keeps the trunk mobile rather than moving 'in one block'.",
                      "Gövde katılığı Parkinson'un çekirdek sorunudur; yana eğilme gövdenin tek parça hareket etmesini önler.", 6),
        ("neckturn",  "Gentle head turns fight axial rigidity and the reduced neck rotation that makes driving and turning in bed hard.",
                      "Nazik baş çevirmeleri boyun dönüşündeki kısıtlılığa iyi gelir — araç kullanmayı ve yatakta dönmeyi kolaylaştırır.", 10),
        ("mouth",     "Orofacial movement targets hypomimia (reduced facial expression) and supports speech and swallowing muscles.",
                      "Ağız-yüz hareketi mimik azlığını (hipomimi) hedefler; konuşma ve yutma kaslarını destekler.", 10),
        ("blink",     "Deliberate blinking activates the orbicularis oculi and addresses the reduced blink rate and dry eyes.",
                      "Bilinçli göz kırpma, azalmış kırpma sıklığına ve göz kuruluğuna karşı göz çevresi kasını çalıştırır.", 8),
        ("march",     "Marching in place rehearses the stepping pattern and the big knee lift that prevents shuffling and freezing.",
                      "Yerinde yürüyüş, adım kalıbını ve donma/sürüyerek yürümeyi önleyen yüksek diz kaldırmayı çalıştırır.", 18),
        ("sitstand",  "Sit-to-stand builds the extensor strength that transfers directly to getting out of a chair or bed.",
                      "Otur–kalk, sandalyeden ve yataktan kalkmaya doğrudan yansıyan bacak gücünü artırır.", 10),
    ],
    "stroke": [
        ("hand",      "Repetitive grasp-and-release is the core of task-specific upper-limb practice; high repetition counts drive neuroplasticity.",
                      "Tekrarlı kavrama-bırakma, göreve özgü üst ekstremite çalışmasının çekirdeğidir; yüksek tekrar nöroplastisiteyi sürükler.", 14),
        ("fingertap", "Isolated thumb-to-finger tapping retrains the fine finger control needed for buttons, cutlery and keys.",
                      "Tek tek parmak dokunuşu; düğme, çatal-bıçak ve anahtar için gereken ince kontrolü yeniden öğretir.", 14),
        ("elbow",     "Bringing the hand toward the shoulder is a functional flexion pattern used in eating and grooming.",
                      "Eli omza getirmek; yemek yeme ve kendine bakımda kullanılan işlevsel bükme kalıbıdır.", 10),
        ("arm",       "Forward reaching is the most transferable upper-limb task: it is how you reach a shelf, a cup, a door.",
                      "Öne uzanma en aktarılabilir üst ekstremite görevidir: rafa, bardağa, kapıya uzanmak budur.", 8),
        ("armabduct", "Side raises work the deltoid and support the shoulder joint, which is vulnerable to subluxation after a stroke.",
                      "Yandan kaldırma deltoidi çalıştırır ve inme sonrası çıkığa açık olan omuz eklemini destekler.", 8),
        ("shrug",     "Shoulder shrugs re-activate the scapular muscles that stabilise a weak arm.",
                      "Omuz silkme, güçsüz kolu stabilize eden kürek kemiği kaslarını yeniden aktive eder.", 10),
        ("trunkbend", "Trunk control is a strong predictor of walking recovery; controlled side bending trains it safely while seated.",
                      "Gövde kontrolü yürüme iyileşmesinin güçlü bir belirleyicisidir; kontrollü yana eğilme bunu otururken güvenle çalıştırır.", 6),
        ("mouth",     "Mirror-guided, slow mouth movements are part of facial neuromuscular retraining after facial weakness.",
                      "Aynaya bakarak yapılan yavaş ağız hareketleri, yüz güçsüzlüğü sonrası nöromusküler yeniden eğitimin parçasıdır.", 10),
        ("sitstand",  "Sit-to-stand training has strong evidence for improving lower-limb strength and independent transfers after stroke.",
                      "Otur–kalk çalışmasının inme sonrası bacak gücü ve bağımsız transfer için güçlü kanıtı vardır.", 10),
        ("march",     "Marching practises hip and knee lift and weight transfer between legs — the components of walking.",
                      "Yerinde yürüyüş; kalça-diz kaldırma ve ağırlık aktarımını, yani yürümenin bileşenlerini çalıştırır.", 16),
    ],
    "arthritis": [
        ("hand",      "Range-of-motion finger movement is first-line exercise for hand osteoarthritis: it eases stiffness without loading the joints.",
                      "Parmakların açılıp kapanması el osteoartritinde ilk basamak egzersizdir; eklemi yüklemeden tutukluğu azaltır.", 12),
        ("fingertap", "Thumb-to-finger tapping keeps the small hand joints mobile and maintains pinch grip for daily tasks.",
                      "Parmak ucu dokunuşu küçük el eklemlerini hareketli tutar ve günlük işler için çimdik kavramayı korur.", 12),
        ("neckturn",  "Slow neck rotations maintain cervical range of motion and ease the stiffness of cervical spondylosis.",
                      "Yavaş boyun dönüşleri servikal hareket açıklığını korur ve boyun kireçlenmesinin tutukluğunu azaltır.", 10),
        ("arm",       "Gentle shoulder range of motion keeps the joint mobile and reduces the pain of morning stiffness.",
                      "Nazik omuz hareketi eklemi hareketli tutar ve sabah tutukluğunun ağrısını azaltır.", 8),
        ("armabduct", "Working the shoulder in a second plane prevents the capsule from tightening in one direction only.",
                      "Omzu ikinci bir düzlemde çalıştırmak, eklem kapsülünün tek yönde kısalmasını önler.", 8),
        ("kneeext",   "Seated knee extension strengthens the quadriceps — the cornerstone of OARSI/ACR recommendations for knee osteoarthritis.",
                      "Oturarak diz açma, diz osteoartritinde OARSI/ACR önerilerinin temel taşı olan uyluk ön kasını güçlendirir.", 12),
        ("leg",       "Hip abduction maintains hip range of motion and strengthens the muscles that unload the knee when walking.",
                      "Bacağı yana açmak kalça hareketini korur ve yürürken dizin yükünü azaltan kasları güçlendirir.", 10),
        ("sitstand",  "Sit-to-stand is a functional strengthening exercise recommended across osteoarthritis guidelines.",
                      "Otur–kalk, osteoartrit kılavuzlarında önerilen işlevsel güçlendirme egzersizidir.", 8),
    ],
    "balance": [
        ("sitstand",  "Sit-to-stand builds quadriceps strength — a key Otago component shown to lower fall risk.",
                      "Otur–kalk, düşme riskini azalttığı gösterilen Otago programının temel bileşeni olan uyluk kasını güçlendirir.", 12),
        ("march",     "Marching in place trains stepping, single-leg loading and dynamic balance.",
                      "Yerinde yürüyüş; adım alma, tek bacağa yüklenme ve dinamik dengeyi çalıştırır.", 20),
        ("kneeext",   "Quadriceps weakness is one of the strongest modifiable predictors of falling.",
                      "Uyluk ön kası zayıflığı, düşmenin en güçlü değiştirilebilir belirleyicilerinden biridir.", 12),
        ("leg",       "The hip abductors keep the pelvis level on one leg — the muscle group that stops a sideways stumble.",
                      "Kalça yan kasları tek ayak üzerindeyken leğeni dengede tutar — yana savrulmayı önleyen kas grubudur.", 12),
        ("trunkbend", "Controlled weight shifting to the side rehearses the balance reaction used to catch yourself.",
                      "Kontrollü yana ağırlık aktarımı, dengeyi toparlama tepkisini provasını yaptırır.", 8),
        ("arm",       "Controlled reaching trains the shoulder and postural muscles used to steady yourself on furniture.",
                      "Kontrollü uzanma; mobilyaya tutunarak dengelenirken kullanılan omuz ve duruş kaslarını çalıştırır.", 8),
    ],
    "general": [
        ("neckturn",  "Neck rotations keep the head and neck mobile for driving, checking traffic and daily life.",
                      "Boyun dönüşleri; araç kullanma ve etrafa bakma için baş-boyun hareketliliğini korur.", 10),
        ("shrug",     "Shrugs release the upper-trapezius tension that builds up from sitting and phone use.",
                      "Omuz silkme, oturmaktan ve telefon kullanımından biriken üst sırt gerginliğini gevşetir.", 10),
        ("arm",       "Shoulder strengthening maintains the upper-body function used for dressing and reaching.",
                      "Omuz güçlendirme; giyinme ve uzanma için gereken üst vücut işlevini korur.", 8),
        ("armabduct", "Side raises balance the shoulder in both planes, keeping the joint healthy as we age.",
                      "Yandan kaldırma omzu her iki düzlemde dengeler ve yaşlandıkça eklemi sağlıklı tutar.", 8),
        ("elbow",     "Elbow curls strengthen the arms for lifting and carrying shopping bags.",
                      "Dirsek bükme; alışveriş poşeti taşımak gibi işler için kolları güçlendirir.", 10),
        ("hand",      "Opening and closing the hands maintains grip strength, which predicts overall health in older adults.",
                      "El açma-kapama, yaşlılarda genel sağlığın göstergesi olan kavrama gücünü korur.", 12),
        ("march",     "Marching in place is a gentle, low-impact way to raise the heart rate toward the WHO activity target.",
                      "Yerinde yürüyüş, DSÖ aktivite hedefine ulaşmak için nazik ve düşük etkili bir yoldur.", 20),
        ("leg",       "Hip abduction strengthens the lower-limb and pelvis-stabilising muscles used in every step.",
                      "Bacağı yana açmak, her adımda kullanılan bacak ve leğen dengeleyici kasları güçlendirir.", 10),
        ("kneeext",   "Knee extension maintains the thigh strength needed for stairs and standing up.",
                      "Diz açma; merdiven ve ayağa kalkma için gereken uyluk gücünü korur.", 10),
        ("sitstand",  "Sit-to-stand maintains the leg strength needed for everyday independence.",
                      "Otur–kalk, günlük bağımsızlık için gereken bacak gücünü korur.", 10),
    ],
    "bel-agrisi": [
        ("trunkbend", "Controlled side bending restores the trunk mobility that guarding and fear of movement take away.",
                      "Kontrollü yana eğilme, ağrıdan kaçınma ve korkuyla kaybedilen gövde hareketliliğini geri kazandırır.", 8),
        ("march",     "Marching in place is gentle motor-control work: the trunk must stay steady while the legs move.",
                      "Yerinde yürüyüş nazik bir motor kontrol çalışmasıdır: bacaklar hareket ederken gövde sabit kalmalıdır.", 20),
        ("sitstand",  "Repeated sit-to-stand retrains the hip-and-leg-driven pattern of getting up, instead of pulling with the back.",
                      "Tekrarlı otur–kalk, beli zorlayarak değil kalça ve bacakla kalkma kalıbını yeniden öğretir.", 10),
        ("leg",       "Hip abductor strength reduces the sideways load the lower back has to absorb when walking.",
                      "Kalça yan kası gücü, yürürken belin karşılamak zorunda kaldığı yan yükü azaltır.", 12),
        ("kneeext",   "Strong quadriceps let you bend at the knees rather than the spine when lifting.",
                      "Güçlü uyluk kası, bir şey kaldırırken beli değil dizleri bükmeni sağlar.", 12),
        ("arm",       "Reaching overhead with a tall spine trains the upright posture that eases mechanical back pain.",
                      "Dik omurgayla yukarı uzanmak, mekanik bel ağrısını hafifleten dik duruşu çalıştırır.", 8),
    ],
    "boyun-agrisi": [
        ("neckflex",  "Active forward bending keeps cervical flexion range, usually one of the first movements people start avoiding when the neck hurts.",
                      "Başı öne eğmek boyun öne eğilme açıklığını korur; boyun ağrısında insanların ilk kaçınmaya başladığı hareketlerden biridir.", 10),
        ("necktilt",  "Side bending restores lateral cervical range of motion, usually the first direction to be lost.",
                      "Yana eğilme, genellikle ilk kaybedilen yön olan boyun yan hareket açıklığını geri kazandırır.", 8),
        ("neckturn",  "Rotation is the range you need to reverse a car or cross a road; active range-of-motion work maintains it.",
                      "Dönüş, geri manevra yaparken veya karşıdan karşıya geçerken gereken açıklıktır; aktif hareket çalışması bunu korur.", 12),
        ("shrug",     "Scapulothoracic work has the strongest evidence in the Cochrane review of exercises for mechanical neck pain.",
                      "Kürek kemiği çalışması, mekanik boyun ağrısı için Cochrane derlemesindeki en güçlü kanıta sahip gruptur.", 12),
        ("armabduct", "The neck and shoulder girdle share their load: strengthening the shoulder unloads the neck.",
                      "Boyun ve omuz kuşağı yükü paylaşır; omzu güçlendirmek boynun yükünü azaltır.", 10),
        ("arm",       "Overhead reaching keeps the whole shoulder-neck complex moving instead of stiffening in one position.",
                      "Yukarı uzanma, omuz-boyun bölgesinin tek pozisyonda katılaşmasını önler.", 8),
    ],
    "disk-fitigi": [
        ("kneeext",   "Slow seated knee extension gently mobilises the sciatic nerve (a nerve-glide pattern) and keeps the quadriceps strong.",
                      "Yavaş yapılan oturarak diz açma, siyatik siniri nazikçe hareketlendirir (sinir kaydırma) ve uyluk kasını güçlü tutar.", 10),
        ("march",     "Marching keeps the hips and spine moving without the sustained sitting that raises disc pressure.",
                      "Yerinde yürüyüş; disk basıncını artıran uzun oturmaya girmeden kalça ve omurgayı hareketli tutar.", 18),
        ("sitstand",  "Repeated standing up interrupts prolonged sitting, the position that loads a herniated disc most.",
                      "Tekrarlı ayağa kalkmak, fıtıklı diski en çok yükleyen uzun oturmayı böler.", 10),
        ("trunkbend", "Small, pain-free side bending restores confidence in movement without twisting or end-range loading.",
                      "Küçük ve ağrısız yana eğilme; dönme ya da uç noktada zorlanma olmadan harekete güveni geri kazandırır.", 6),
        ("leg",       "Hip abductors share the load with the lumbar spine when you stand on one leg.",
                      "Tek ayak üzerindeyken kalça yan kasları bel omurgasıyla yükü paylaşır.", 10),
        ("arm",       "Reaching up encourages the tall, extended spine position that many disc patients respond to.",
                      "Yukarı uzanmak, birçok disk hastasının iyi yanıt verdiği uzun ve ekstansiyondaki omurga pozisyonunu teşvik eder.", 8),
    ],
    "skolyoz": [
        ("trunkbend", "Side bending is the core of scoliosis-specific exercise: the two sides are trained deliberately unequally, toward the correction.",
                      "Yana eğilme skolyoza özgü egzersizin çekirdeğidir: iki taraf bilinçli olarak eşit olmayan şekilde, düzeltme yönünde çalıştırılır.", 10),
        ("armabduct", "Raising the arm on the concave side helps elongate that side of the trunk — the elongation principle of Schroth work.",
                      "Çukur taraftaki kolu kaldırmak gövdenin o tarafını uzatmaya yardım eder — Schroth çalışmasının uzama ilkesi.", 10),
        ("arm",       "Symmetrical overhead reaching trains the axial elongation that scoliosis-specific programs start from.",
                      "Simetrik yukarı uzanma, skolyoz programlarının başlangıç noktası olan boyuna uzamayı çalıştırır.", 8),
        ("shrug",     "Shoulder-girdle control addresses the shoulder-height asymmetry that patients notice first.",
                      "Omuz kuşağı kontrolü, hastaların ilk fark ettiği omuz yüksekliği farkına yöneliktir.", 10),
        ("march",     "Marching adds the postural endurance that scoliosis exercise programs aim to build.",
                      "Yerinde yürüyüş, skolyoz programlarının hedeflediği duruş dayanıklılığını ekler.", 18),
        ("sitstand",  "Standing up with a tall, self-corrected posture carries the correction into everyday movement.",
                      "Dik ve kendi kendine düzeltilmiş duruşla kalkmak, düzeltmeyi günlük harekete taşır.", 10),
    ],
    "kas-yaralanmasi": [
        ("kneeext",   "Pain-free range of motion comes first after a muscle strain; slow knee extension restores it before load is added.",
                      "Kas yaralanmasından sonra önce ağrısız hareket açıklığı gelir; yavaş diz açma, yük eklenmeden önce bunu geri kazandırır.", 12),
        ("elbow",     "Controlled elbow flexion re-loads the arm muscles gradually, the progressive-loading principle of strain rehab.",
                      "Kontrollü dirsek bükme kol kaslarını kademeli olarak yeniden yükler — yaralanma rehabilitasyonunun kademeli yükleme ilkesi.", 12),
        ("arm",       "Slow, full-range shoulder movement rebuilds control before speed or resistance is reintroduced.",
                      "Yavaş ve tam açıklıkta omuz hareketi, hız veya direnç eklenmeden önce kontrolü yeniden kurar.", 10),
        ("armabduct", "Working a second movement plane prevents the compensations that cause re-injury.",
                      "İkinci bir hareket düzleminde çalışmak, yeniden yaralanmaya yol açan telafi hareketlerini önler.", 10),
        ("leg",       "Hip abduction restores lateral hip control, commonly weak after lower-limb injuries.",
                      "Bacağı yana açmak, alt ekstremite yaralanmalarından sonra sık zayıflayan yan kalça kontrolünü geri kazandırır.", 12),
        ("march",     "Marching reintroduces rhythmic, symmetrical loading and shows whether the two sides still move differently.",
                      "Yerinde yürüyüş ritmik ve simetrik yüklenmeyi geri getirir; iki tarafın hâlâ farklı hareket edip etmediğini gösterir.", 18),
        ("sitstand",  "Sit-to-stand is a simple, measurable strength test you can repeat weekly to track recovery.",
                      "Otur–kalk, iyileşmeyi takip etmek için her hafta tekrarlanabilen basit ve ölçülebilir bir güç testidir.", 10),
        ("hand",      "Grip work maintains forearm strength during an upper-limb layoff.",
                      "Kavrama çalışması, üst ekstremite dinlenme döneminde ön kol gücünü korur.", 12),
    ],
}

# ---------------------------------------------------------------------
# The five new conditions (the existing five keep their researched metadata).
# ---------------------------------------------------------------------
NEW_CONDITIONS = {
    "bel-agrisi": dict(
        name="Low back pain",
        name_tr="Bel ağrısı",
        summary="For non-specific low back pain, staying active and exercising is the treatment with the strongest guideline support — rest is not. This program keeps the trunk moving and strengthens the hips and legs that share the spine's load.",
        summary_tr="Belirli bir nedene bağlanamayan bel ağrısında kılavuzların en güçlü desteklediği tedavi hareketli kalmak ve egzersizdir — yatak istirahati değil. Bu program gövdeyi hareketli tutar ve omurganın yükünü paylaşan kalça ile bacakları güçlendirir.",
        principles="NICE NG59 recommends an exercise programme as the main component of care for low back pain, with no single exercise type proven superior; motor-control / stabilisation work has meta-analytic support. Movements here are pain-free range and hip/leg strengthening — no end-range loading, no twisting under load.",
        sources=[
            dict(label="NICE NG59 — Low back pain and sciatica: exercise and physical activity",
                 url="https://www.nice.org.uk/guidance/ng59/ifp/chapter/Exercise-and-physical-activity"),
            dict(label="Motor control / stabilisation exercise for non-specific low back pain — prospective meta-analysis",
                 url="https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7564352/"),
        ],
    ),
    "boyun-agrisi": dict(
        name="Neck pain",
        name_tr="Boyun ağrısı",
        summary="Mechanical neck pain responds to active exercise: deep neck flexor work, range of motion in every direction, and — with the strongest evidence of all — strengthening the shoulder blade muscles.",
        summary_tr="Mekanik boyun ağrısı aktif egzersize yanıt verir: derin boyun kaslarını çalıştırmak, her yöne hareket açıklığı ve — en güçlü kanıtı olan — kürek kemiği kaslarını güçlendirmek.",
        principles="The Cochrane review of exercises for mechanical neck disorders gives moderate-GRADE support to cervico-scapulothoracic and upper-extremity strengthening; active range-of-motion work is included as a lower-load starting point. Nothing here is loaded or end-range.",
        sources=[
            dict(label="Exercises for mechanical neck disorders — Cochrane review update (Manual Therapy)",
                 url="https://www.sciencedirect.com/science/article/pii/S1356689X16300078"),
            dict(label="Scapular functional and cervical isometric exercises in chronic mechanical neck pain — RCT",
                 url="https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11671652/"),
        ],
    ),
    "disk-fitigi": dict(
        name="Lumbar disc herniation",
        name_tr="Bel fıtığı (disk hernisi)",
        summary="Most disc herniations improve without surgery. Conservative care means staying mobile, interrupting long sitting, and strengthening the legs and hips — with movements that never push into pain.",
        summary_tr="Bel fıtıklarının çoğu ameliyatsız iyileşir. Konservatif tedavi; hareketli kalmak, uzun oturmayı bölmek ve bacak-kalça kaslarını güçlendirmektir — hiçbir hareket ağrıya doğru zorlanmaz.",
        principles="Systematic-review evidence supports exercise therapy in the conservative management of lumbar disc herniation, and the McKenzie / directional-preference approach for patients whose symptoms centralise. IMPORTANT: direction of preference (usually extension) must be set by your physiotherapist — a camera cannot judge it, so this program only contains neutral, pain-free movements.",
        sources=[
            dict(label="Exercise, manipulation and traction in conservative management of lumbar disc herniation — systematic review & meta-analysis",
                 url="https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12595123/"),
            dict(label="McKenzie method for low back pain with directional preference — systematic review with meta-analysis",
                 url="https://pmc.ncbi.nlm.nih.gov/articles/PMC11924268/"),
            dict(label="McKenzie back exercises — StatPearls (NCBI Bookshelf)",
                 url="https://www.ncbi.nlm.nih.gov/books/NBK539720/"),
        ],
    ),
    "skolyoz": dict(
        name="Scoliosis",
        name_tr="Skolyoz",
        summary="Scoliosis-specific exercise (PSSE, e.g. the Schroth method) is recommended alongside standard care. Its principles are elongation, asymmetric side work toward the correction, and postural endurance.",
        summary_tr="Skolyoza özgü egzersizler (PSSE, örn. Schroth yöntemi) standart bakımın yanında önerilir. İlkeleri: boyuna uzama, düzeltme yönünde asimetrik yan çalışma ve duruş dayanıklılığı.",
        principles="SOSORT recommends PSSE for smaller curves and as an add-on to bracing; randomised trials of Schroth exercises added to standard care report benefits on quality of life, muscle endurance and curve progression. CRITICAL: which side to emphasise depends on YOUR curve — a physiotherapist must set the side and the repetitions. ViMove counts and measures; it does not decide the direction.",
        sources=[
            dict(label="Schroth PSSE for adolescent idiopathic scoliosis — RCT (SOSORT 2017 Award Winner)",
                 url="https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5684768/"),
            dict(label="Schroth exercises added to standard care: quality of life and muscle endurance — RCT (SOSORT 2015 Award Winner)",
                 url="https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4582716/"),
        ],
    ),
    "kas-yaralanmasi": dict(
        name="Muscle strain recovery",
        name_tr="Kas yaralanması sonrası",
        summary="After a muscle strain, recovery is a ladder: pain-free range of motion first, then progressive loading, then speed. Skipping steps is what causes re-injury.",
        summary_tr="Kas yaralanmasından sonra iyileşme bir merdivendir: önce ağrısız hareket açıklığı, sonra kademeli yükleme, en son hız. Basamak atlamak yeniden sakatlanmanın başlıca sebebidir.",
        principles="Clinical practice guidelines for hamstring strain injury recommend early, progressive, impairment-based rehabilitation — gentle early range of motion, then strengthening as pain allows, 2-3 times a week with load and range increasing gradually. This program covers the early range-of-motion and control stage only; return to sport requires clinician assessment.",
        sources=[
            dict(label="Hamstring strain injury in athletes — clinical practice guideline summary (JOSPT 2022)",
                 url="https://www.jospt.org/doi/10.2519/jospt.2022.0501"),
            dict(label="Early introduction of high-intensity eccentric loading into hamstring strain rehabilitation",
                 url="https://pubmed.ncbi.nlm.nih.gov/35794049/"),
        ],
    ),
}


def build_exercises(slug: str) -> tuple[list, list]:
    order, exercises, seen = [], [], set()
    for key, rationale, rationale_tr, reps in PROGRAMS[slug]:
        base = L[key]
        ex_id = key
        assert ex_id not in seen, f"{slug}: duplicate {ex_id}"
        seen.add(ex_id)
        order.append(ex_id)
        entry = {
            "id": ex_id,
            "name": base["name"],
            "name_tr": base["name_tr"],
            "kind": base["kind"],
            "sides": list(base["sides"]),
            "base_reps": reps or base["base_reps"],
            "domain": base["domain"],
            "domain_tr": base["domain_tr"],
            "rationale": rationale,
            "rationale_tr": rationale_tr,
        }
        if base.get("sided"): entry["sided"] = base["sided"]
        if base.get("sided_tr"): entry["sided_tr"] = base["sided_tr"]
        exercises.append(entry)
    return order, exercises


def main() -> None:
    db = json.loads(DATA.read_text(encoding="utf-8"))
    conditions = db["conditions"]

    for slug, meta in NEW_CONDITIONS.items():
        conditions[slug] = dict(meta)

    for slug in PROGRAMS:
        cond = conditions[slug]
        cond["order"], cond["exercises"] = build_exercises(slug)

    # keep a stable, sensible order in the file / on the site
    wanted = ["parkinson", "stroke", "arthritis", "balance", "bel-agrisi",
              "boyun-agrisi", "disk-fitigi", "skolyoz", "kas-yaralanmasi", "general"]
    db["conditions"] = {s: conditions[s] for s in wanted if s in conditions}

    DATA.write_text(json.dumps(db, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    total = sum(len(c["exercises"]) for c in db["conditions"].values())
    print(f"{len(db['conditions'])} kosul, {total} egzersiz tanimi yazildi -> {DATA}")


if __name__ == "__main__":
    main()
