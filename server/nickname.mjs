// Фильтр ников. НЕСОВЕРШЕНЕН: небольшой список корней + нормализация leet/повторов/разделителей.
// Он пропустит новые формы и намеренные обходы, а иногда запретит безобидный ник
// (например, содержащий корень внутри длинного слова: 'fack' поймает и редкую фамилию Fackler).
// 'f4ck'/'f@ck' после нормализации = 'fack', 'fvck' (v вместо u) вписан отдельно. Список нужно дополнять вручную.
const LEET = {0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's'};
// Корни из 4+ букв ищем как подстроку (английский, русский/узбекский транслит).
const SUBSTRING_ROOTS = [
  'fuck', 'fvck', 'fack', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'whore', 'slut', 'dick', 'pussy', 'nigg', 'faggot', 'retard', 'porn',
  'suka', 'blyat', 'blyad', 'pidor', 'pidar', 'pizd', 'ebat', 'yebat', 'mudak', 'gandon', 'dolboeb', 'zalupa', 'shlyuh',
  'jalab', 'dalbayob', 'dalbaeb', 'haromi', 'itvachcha', 'ahmoq', 'axmoq', 'qotoq', 'siktir', 'sikish', 'sikay', 'jinni', 'tentak', 'hitler'
];
// Короткие слова запрещаем только когда ник состоит из них целиком.
const WHOLE_WORDS = ['ass', 'cock', 'sex', 'fck', 'sik', 'xuy', 'huy', 'hui', 'lox', 'loh', 'jopa', 'idiot', 'nazi', 'dumb'];
// 'gay' убрано: само слово — самоназвание, а не брань (оскорбительные формы вроде faggot ловятся корнями).
export const RESERVED = ['admin', 'administrator', 'jenius', 'moderator', 'root', 'system', 'support', 'staff', 'owner', 'null', 'undefined'];

const collapse = w => w.replace(/(.)\1+/g, '$1'); // aaa -> a
const leet = s => String(s).normalize('NFKC').toLowerCase().replace(/[0134578@$]/g, c => LEET[c]);
// Для зарезервированных и коротких слов: целый ник без разделителей, повторы схлопнуты.
export function canonicalNick(nick) { return collapse(leet(nick).replace(/[_\-.]/g, '')); }

// Безобидные имена/слова, в которых встречается корень (после leet-нормализации, без схлопывания повторов).
export const BENIGN = ['rashitov', 'rashit', 'eshitmoq', 'yoshito', 'ashita', 'asuka', 'tsukasa', 'tsukada', 'fackler', 'nigora', 'nigina', 'gulnigor', 'nigmatov', 'knight', 'night', 'midnight']
  .sort((a, b) => b.length - a.length);
const stripBenign = g => BENIGN.reduce((acc, w) => acc.split(w).join(' '), g);
const ROOT_RE = SUBSTRING_ROOTS.map(r => new RegExp([...r].map(c => c + '+').join('')));
const SHORT = 3; // сегмент ≤3 символов склеивается с соседями (f_u_c_k, fu_ck)

function groupsOf(nick) {
  const segs = leet(nick).split(/[_\-.]+/).filter(Boolean), out = [];
  let cur = '', lastLen = 0;
  for (const sg of segs) {
    if (cur && (lastLen <= SHORT || sg.length <= SHORT)) cur += sg; else { if (cur) out.push(cur); cur = sg; }
    lastLen = sg.length;
  }
  if (cur) out.push(cur);
  return out;
}

const WHOLE = WHOLE_WORDS.map(collapse), RES = RESERVED.map(collapse);
export function nicknameAllowed(nick) {
  const c = canonicalNick(nick);
  if (RES.includes(c) || WHOLE.includes(c)) return false;
  return !groupsOf(nick).some(g => { const t = stripBenign(g); return ROOT_RE.some(re => re.test(t)); });
}
