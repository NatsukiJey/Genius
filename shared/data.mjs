export const TIERS = [
{id:'beginner',name:'Beginner',label:'Boshlang‘ich',icon:'🌱',description:'Ilk so‘zlar va kundalik tushunchalar'},
{id:'elementary',name:'Elementary',label:'Asosiy',icon:'🌿',description:'Kundalik hayot va sodda suhbatlar'},
{id:'intermediate',name:'Intermediate',label:'O‘rta',icon:'🌳',description:'Fikr bildirish va yangi mavzular'},
{id:'advanced',name:'Advanced',label:'Yuqori',icon:'🏔️',description:'Murakkab tushunchalar va iboralar'}];
const raw = [
`apple|olma;book|kitob;water|suv;house|uy;cat|mushuk;dog|it;sun|quyosh;moon|oy;bread|non;milk|sut;school|maktab;friend|do‘st;mother|ona;father|ota;sister|opa;brother|aka;red|qizil;blue|ko‘k;green|yashil;yellow|sariq;one|bir;two|ikki;three|uch;four|to‘rt;five|besh;hello|salom;goodbye|xayr;yes|ha;no|yo‘q;thank you|rahmat;morning|ertalab;night|tun;day|kun;food|ovqat;tea|choy;coffee|qahva;table|stol;chair|stul;door|eshik;window|deraza;big|katta;small|kichik;happy|xursand;sad|xafa;hot|issiq;cold|sovuq;fish|baliq;bird|qush;tree|daraxt;flower|gul`,
`travel|sayohat;ticket|chipta;airport|aeroport;station|bekat;weather|ob-havo;rain|yomg‘ir;snow|qor;cloud|bulut;breakfast|nonushta;lunch|tushlik;dinner|kechki ovqat;vegetable|sabzavot;fruit|meva;kitchen|oshxona;bedroom|yotoqxona;garden|bog‘;market|bozor;money|pul;price|narx;cheap|arzon;expensive|qimmat;doctor|shifokor;hospital|shifoxona;medicine|dori;healthy|sog‘lom;teacher|o‘qituvchi;student|talaba;homework|uy vazifasi;question|savol;answer|javob;beautiful|chiroyli;interesting|qiziqarli;difficult|qiyin;easy|oson;always|har doim;never|hech qachon;sometimes|ba’zan;usually|odatda;yesterday|kecha;tomorrow|ertaga;weekend|hafta oxiri;holiday|ta’til;busy|band;tired|charchagan;hungry|och;thirsty|chanqagan;listen|tinglamoq;speak|gapirmoq;write|yozmoq;read|o‘qimoq`,
`achieve|erishmoq;improve|yaxshilamoq;develop|rivojlantirmoq;experience|tajriba;opportunity|imkoniyat;challenge|qiyinchilik;environment|atrof-muhit;pollution|ifloslanish;education|ta’lim;knowledge|bilim;research|tadqiqot;discovery|kashfiyot;decision|qaror;solution|yechim;advantage|afzallik;disadvantage|kamchilik;responsibility|mas’uliyat;confidence|ishonch;independent|mustaqil;reliable|ishonchli;patient|sabrli;generous|saxiy;curious|qiziquvchan;creative|ijodkor;ambitious|intiluvchan;although|garchi;however|biroq;therefore|shuning uchun;instead|o‘rniga;otherwise|aks holda;increase|oshmoq;decrease|kamaymoq;support|qo‘llab-quvvatlamoq;protect|himoya qilmoq;prevent|oldini olmoq;encourage|ruhlantirmoq;suggest|taklif qilmoq;explain|tushuntirmoq;describe|tasvirlamoq;compare|taqqoslamoq;destination|manzil;accommodation|turar joy;journey|safar;appointment|uchrashuv;application|ariza;interview|suhbat;salary|maosh;profession|kasb;skill|ko‘nikma;goal|maqsad`,
`resilience|bardoshlilik;accountability|hisobdorlik;sustainability|barqarorlik;ambiguity|noaniqlik;integrity|halollik;empathy|hamdardlik;innovation|yangilik yaratish;perspective|nuqtayi nazar;implication|yashirin ma’no;assumption|taxmin;comprehensive|keng qamrovli;inevitable|muqarrar;substantial|sezilarli;controversial|bahsli;meticulous|sinchkov;pragmatic|amaliy;versatile|ko‘p qirrali;coherent|izchil;plausible|ishonarli;detrimental|zararli;nevertheless|shunga qaramay;furthermore|bundan tashqari;consequently|natijada;whereas|holbuki;notwithstanding|qat’i nazar;mitigate|yumshatmoq;facilitate|osonlashtirmoq;scrutinize|puxta tekshirmoq;undermine|putur yetkazmoq;consolidate|mustahkamlamoq;perseverance|qat’iyat;discernment|farqlay bilish;reciprocity|o‘zaro munosabat;feasibility|amalga oshirish imkoniyati;discrepancy|tafovut;take into account|hisobga olmoq;come to terms with|ko‘nikmoq;draw a conclusion|xulosa chiqarmoq;raise awareness|xabardorlikni oshirmoq;make an effort|harakat qilmoq;in the long run|uzoq muddatda;on the contrary|aksincha;by and large|umuman olganda;at stake|xavf ostida;in hindsight|ortga nazar tashlaganda;break the ice|suhbatni boshlab bermoq;keep in mind|yodda tutmoq;weigh the options|variantlarni chamalamoq;bridge the gap|tafovutni qisqartirmoq;reach a consensus|bir fikrga kelmoq`

];
// ---------------------------------------------------------------------------------------------
// Words are stored in ONE generic shape: {t, uz}. `t` = the TARGET word being learned (English or
// Russian), `uz` = its Uzbek translation. English words additionally keep the legacy `en` field
// (same value as `t`) only so old code/tests that read `word.en` keep working; nothing in the
// generic helpers below reads it.
// ---------------------------------------------------------------------------------------------
const parse = (rows, extra) => rows.map(s => s.split(';').map(pair => { const [t, uz] = pair.split('|'); return extra ? {t, en: t, uz} : {t, uz}; }));
export const WORDS_EN = parse(raw, true);
export const WORDS = WORDS_EN; // legacy name = English course

// Russian: 4 tiers x 50 curated pairs, 200 unique. Only Cyrillic letters and single spaces, no stress marks.
// A1 everyday words -> A2 daily life -> B1 abstract words, verbs, linkers -> B2 abstract words and set phrases.
const rawRu = [
`привет|salom;пока|xayr;да|ha;нет|yo‘q;спасибо|rahmat;пожалуйста|iltimos;мама|ona;папа|ota;сестра|opa;брат|aka;друг|do‘st;дом|uy;книга|kitob;вода|suv;хлеб|non;молоко|sut;чай|choy;кофе|qahva;яблоко|olma;кошка|mushuk;собака|it;солнце|quyosh;луна|oy;школа|maktab;стол|stol;стул|stul;дверь|eshik;окно|deraza;красный|qizil;синий|ko‘k;зелёный|yashil;жёлтый|sariq;один|bir;два|ikki;три|uch;четыре|to‘rt;пять|besh;большой|katta;маленький|kichik;горячий|issiq;холодный|sovuq;утро|ertalab;ночь|tun;день|kun;рыба|baliq;птица|qush;дерево|daraxt;цветок|gul;еда|ovqat;ложка|qoshiq`,
`билет|chipta;аэропорт|aeroport;вокзал|vokzal;погода|ob-havo;дождь|yomg‘ir;снег|qor;облако|bulut;завтрак|nonushta;обед|tushlik;ужин|kechki ovqat;овощи|sabzavotlar;фрукты|mevalar;кухня|oshxona;спальня|yotoqxona;сад|bog‘;рынок|bozor;деньги|pul;цена|narx;дешёвый|arzon;дорогой|qimmat;врач|shifokor;больница|shifoxona;лекарство|dori;здоровый|sog‘lom;учитель|o‘qituvchi;студент|talaba;домашнее задание|uy vazifasi;вопрос|savol;ответ|javob;красивый|chiroyli;интересный|qiziqarli;трудный|qiyin;лёгкий|oson;всегда|har doim;никогда|hech qachon;иногда|ba’zan;обычно|odatda;вчера|kecha;завтра|ertaga;выходные|dam olish kunlari;отпуск|ta’til;занятой|band;усталый|charchagan;голодный|och;слушать|tinglamoq;говорить|gapirmoq;писать|yozmoq;читать|o‘qimoq;магазин|do‘kon;улица|ko‘cha`,
`достигать|erishmoq;улучшать|yaxshilamoq;развивать|rivojlantirmoq;опыт|tajriba;возможность|imkoniyat;трудность|qiyinchilik;окружающая среда|atrof-muhit;загрязнение|ifloslanish;образование|ta’lim;знание|bilim;исследование|tadqiqot;открытие|kashfiyot;решение|qaror;ответственность|mas’uliyat;доверие|ishonch;уверенность|o‘ziga ishonch;самостоятельный|mustaqil;надёжный|ishonchli;терпеливый|sabrli;щедрый|saxiy;любопытный|qiziquvchan;творческий|ijodkor;хотя|garchi;однако|biroq;поэтому|shuning uchun;вместо|o‘rniga;иначе|aks holda;увеличиваться|oshmoq;уменьшаться|kamaymoq;поддерживать|qo‘llab-quvvatlamoq;защищать|himoya qilmoq;предотвращать|oldini olmoq;предлагать|taklif qilmoq;объяснять|tushuntirmoq;описывать|tasvirlamoq;сравнивать|taqqoslamoq;путешествие|safar;встреча|uchrashuv;заявление|ariza;собеседование|suhbat;зарплата|maosh;профессия|kasb;навык|ko‘nikma;цель|maqsad;преимущество|afzallik;недостаток|kamchilik;общество|jamiyat;правило|qoida;привычка|odat;совет|maslahat`,
`неопределённость|noaniqlik;честность|halollik;сочувствие|hamdardlik;точка зрения|nuqtayi nazar;предположение|taxmin;всесторонний|keng qamrovli;неизбежный|muqarrar;существенный|sezilarli;спорный|bahsli;кропотливый|sinchkov;практичный|amaliy;многогранный|ko‘p qirrali;последовательный|izchil;правдоподобный|ishonarli;вредный|zararli;тем не менее|shunga qaramay;кроме того|bundan tashqari;следовательно|natijada;в то время как|holbuki;смягчать|yumshatmoq;облегчать|osonlashtirmoq;подрывать|putur yetkazmoq;укреплять|mustahkamlamoq;упорство|qat’iyat;различие|tafovut;принимать во внимание|hisobga olmoq;смириться|ko‘nikmoq;делать вывод|xulosa chiqarmoq;повышать осведомлённость|xabardorlikni oshirmoq;прилагать усилия|harakat qilmoq;в долгосрочной перспективе|uzoq muddatda;наоборот|aksincha;в целом|umuman olganda;поставлено на карту|xavf ostida;оглядываясь назад|ortga nazar tashlaganda;сломать лёд|suhbatni boshlab bermoq;иметь в виду|yodda tutmoq;взвесить варианты|variantlarni chamalamoq;преодолеть разрыв|tafovutni qisqartirmoq;прийти к согласию|bir fikrga kelmoq;нововведение|yangilik;обязательство|majburiyat;ограничение|cheklov;тщательный|puxta;перспектива|istiqbol;достоверный|asosli;зависимость|qaramlik;убедительный|ishontiruvchi;устойчивость|barqarorlik;взаимность|o‘zaro munosabat`
];
export const WORDS_RU = parse(rawRu, false);
export const RU_PATTERN = /^[А-Яа-яЁё]+(?: [А-Яа-яЁё]+)*$/;

export const LEVEL_COUNT = 50;
export const LESSON_SIZE = 5, EXAM_SIZE = 10, EXAM_PASS = 8; // 8/10 = 80%

export const RU_TIERS = [
{id:'a1',name:'A1',label:'Kundalik so‘zlar',icon:'🌱',description:'Eng oddiy kundalik so‘zlar (A1 yo‘nalishidagi mashq)'},
{id:'a2',name:'A2',label:'Kundalik hayot',icon:'🌿',description:'Xarid, ovqat, sayohat, vaqt va tez-tez uchraydigan so‘zlar (A2 yo‘nalishi)'},
{id:'b1',name:'B1',label:'Fikr va faoliyat',icon:'🌳',description:'Mavhum so‘zlar, fe’llar va bog‘lovchilar (B1 yo‘nalishi)'},
{id:'b2',name:'B2',label:'Murakkab iboralar',icon:'🏔️',description:'Murakkab so‘zlar va turg‘un iboralar (B2 yo‘nalishi)'}];
export const PRACTICE_NOTE = 'A1–B2 — bu mashq darajalari, rasmiy sertifikat yoki imtihon (TORFL) emas.';

// One entry per course. Everything course specific (words, tiers, texts, instructions) hangs off it.
export const COURSES = {
 en: {id:'en', lang:'en', name:'Ingliz tili', short:'EN', flag:'🇬🇧', tiers:TIERS, words:WORDS_EN, official:false,
  adjective:'inglizcha', chapters:['Hammasi birinchi qadamdan','Kundalik hayotni kashf et','Fikrlaringga qanot ber','Yangi cho‘qqilar sari'],
  instructions:{'choice':'Inglizcha so‘zning o‘zbekcha tarjimasini toping','assemble':'Harflardan inglizcha so‘zni yig‘ing','write-en':'Ingliz tilida yozing','choice-reverse':'O‘zbekcha so‘zning inglizcha tarjimasini toping','write-uz':'O‘zbek tilida yozing'}},
 ru: {id:'ru', lang:'ru', name:'Rus tili', short:'RU', flag:'🇷🇺', tiers:RU_TIERS, words:WORDS_RU, official:false,
  adjective:'ruscha', chapters:['Birinchi so‘zlar','Kundalik hayot','Fikr va harakat','Murakkab iboralar'],
  instructions:{'choice':'Ruscha so‘zning o‘zbekcha tarjimasini toping','assemble':'Harflardan ruscha so‘zni yig‘ing','write-en':'Rus tilida yozing','choice-reverse':'O‘zbekcha so‘zning ruscha tarjimasini toping','write-uz':'O‘zbek tilida yozing'}}
};
export const COURSE_IDS = Object.keys(COURSES);
export const isCourse = c => typeof c === 'string' && Object.hasOwn(COURSES, c);
export const DEFAULT_COURSE = 'en';
const wordsOf = (course, tier) => COURSES[course].words[tier];

// Question direction, single source of truth. 'target' = the language being learned (English or Russian).
// Order of this object is the order of question types inside a lesson. Names are kept from the English-only
// version ('write-en' means "write in the TARGET language") so stored lessons/clients stay compatible.
export const TYPE_SPECS = {
 'choice':{promptLang:'target',answerLang:'uz'},
 'assemble':{promptLang:'uz',answerLang:'target'},
 'write-en':{promptLang:'uz',answerLang:'target'},
 'choice-reverse':{promptLang:'uz',answerLang:'target'},
 'write-uz':{promptLang:'target',answerLang:'uz'}};
export const TYPE_ORDER = Object.keys(TYPE_SPECS);
// Legacy English-only view (old tests and English readers): 'target' is spelled 'en'.
export const QUESTION_TYPES = Object.fromEntries(Object.entries(TYPE_SPECS).map(([k, s]) => [k, {
 promptLang: s.promptLang === 'target' ? 'en' : 'uz', answerLang: s.answerLang === 'target' ? 'en' : 'uz', instruction: COURSES.en.instructions[k]}]));
const fieldOf = lang => lang === 'uz' ? 'uz' : 't';
export const promptOf = (type, word) => word[fieldOf(TYPE_SPECS[type].promptLang)];
export const answerOf = (type, word) => word[fieldOf(TYPE_SPECS[type].answerLang)];
export const instructionOf = (type, course = DEFAULT_COURSE) => COURSES[course].instructions[type];
// true when the learner has to produce / see the TARGET language word for this slot
export const promptIsTarget = type => TYPE_SPECS[type].promptLang === 'target';
export const answerIsTarget = type => TYPE_SPECS[type].answerLang === 'target';

export function courseLessonWords(course, tier, level) { const words = wordsOf(course, tier); return Array.from({length: LESSON_SIZE}, (_, i) => words[((level - 1) * 3 + i) % words.length]); }
export function courseQuestions(course, tier, level, exam = false) {
 const pool = wordsOf(course, tier);
 const selected = exam ? Array.from({length: EXAM_SIZE}, (_, i) => pool[(i * 7 + level) % pool.length]) : courseLessonWords(course, tier, level);
 return selected.map((word, i) => {
  const type = TYPE_ORDER[i % 5], field = fieldOf(TYPE_SPECS[type].answerLang);
  const choices = [word[field], ...pool.filter(w => w.t !== word.t).filter((_, j) => j % 7 === i % 7).slice(0, 3).map(w => w[field])];
  const offset = (level + i) % 4;
  return {word, type, choices: choices.slice(offset).concat(choices.slice(0, offset))};
 });
}
// Legacy English-only signatures (tier, level[, exam]) still work.
export const lessonWords = (tier, level) => courseLessonWords('en', tier, level);
export const questions = (tier, level, exam = false) => courseQuestions('en', tier, level, exam);
