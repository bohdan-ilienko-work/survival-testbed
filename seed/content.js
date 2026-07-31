'use strict';

/**
 * Content generator for the survival testbed seed.
 *
 * Everything here is DETERMINISTIC: the same inputs always produce byte-identical
 * documents, which is what makes `node seed/index.js` idempotent.
 *
 * Document shapes are taken from the battleofgeniuses code, not invented:
 *   - questions-api/src/data-access/questions-db.ts  (QuestionDbEntry / Common)
 *   - questions-api/src/data-access/categories-db.ts (categories DbEntry)
 *   - questions-api/src/data-access/counters.ts      (counters DbEntry)
 *
 * Reminder about the stored answer format (questions-db.ts):
 *   choice locale    -> { language, question, correct: string, wrong: string[] }
 *   numerical locale -> { language, question, correct: number }
 *   map locale       -> { language, question, correct: [lat, lng] }
 * `documentToQuestion` rebuilds `answers = [correct, ...wrong]`, so answer index 0
 * is ALWAYS the correct one internally; what the client sees is
 * `shuffledAnswers.map(i => answers[i])` and `correct = shuffledAnswers.indexOf(0)`.
 */

// ─── ids ─────────────────────────────────────────────────────────────────────
// Reserved, non-overlapping id blocks so re-runs overwrite exactly the same docs.
const GENERAL_ID_BASE = 100000;
const SURVIVAL_ID_BASE = 200000;
// counters._id = 'question_id' is bumped past this so the editor never collides.
const QUESTION_ID_COUNTER_START = 300000;
const CATEGORY_ID_COUNTER_START = 1000;

// Marker written on every seeded document -> lets us delete only our own docs.
const SEED_MARKER = 'survival-testbed';

const TRACK = { GENERAL: 'general', SURVIVAL: 'survival' };
const TYPE = { CHOICE: 'choice', NUMERICAL: 'numerical', MAP: 'map' };
const STATUS_READY = 'ready';

// getCategoryIdFromName() in questions-api hardcodes these ids.
const ROOT_CATEGORIES = [
  { id: 1, name: 'history', en: 'History', uk: 'Історія' },
  { id: 2, name: 'geography', en: 'Geography', uk: 'Географія' },
  { id: 3, name: 'art', en: 'Art', uk: 'Мистецтво' },
  { id: 4, name: 'sport', en: 'Sport', uk: 'Спорт' },
  { id: 5, name: 'science', en: 'Science', uk: 'Наука' },
];

// Second-level categories. `get-question-set-for-fight.ts` limits questions per
// second-level category (amountPerSubcategory), so we need several of them.
const SUBCATEGORIES = {
  history: [
    ['ancient-world', 'Ancient world', 'Стародавній світ'],
    ['middle-ages', 'Middle ages', 'Середньовіччя'],
    ['modern-history', 'Modern history', 'Нова історія'],
    ['wars', 'Wars', 'Війни'],
    ['ukraine-history', 'History of Ukraine', 'Історія України'],
    ['world-leaders', 'World leaders', 'Світові лідери'],
  ],
  geography: [
    ['capitals', 'Capitals', 'Столиці'],
    ['oceans-and-seas', 'Oceans and seas', 'Океани та моря'],
    ['mountains', 'Mountains', 'Гори'],
    ['countries', 'Countries', 'Країни'],
    ['cities', 'Cities', 'Міста'],
    ['rivers', 'Rivers', 'Річки'],
  ],
  art: [
    ['painting', 'Painting', 'Живопис'],
    ['music', 'Music', 'Музика'],
    ['literature', 'Literature', 'Література'],
    ['cinema', 'Cinema', 'Кіно'],
    ['architecture', 'Architecture', 'Архітектура'],
    ['sculpture', 'Sculpture', 'Скульптура'],
  ],
  sport: [
    ['football', 'Football', 'Футбол'],
    ['olympics', 'Olympics', 'Олімпіада'],
    ['tennis', 'Tennis', 'Теніс'],
    ['basketball', 'Basketball', 'Баскетбол'],
    ['motorsport', 'Motorsport', 'Автоспорт'],
    ['winter-sports', 'Winter sports', 'Зимові види спорту'],
  ],
  science: [
    ['physics', 'Physics', 'Фізика'],
    ['chemistry', 'Chemistry', 'Хімія'],
    ['biology', 'Biology', 'Біологія'],
    ['astronomy', 'Astronomy', 'Астрономія'],
    ['mathematics', 'Mathematics', 'Математика'],
    ['technology', 'Technology', 'Технології'],
  ],
};

// ─── curated CHOICE questions (obvious answers, en + uk) ─────────────────────
// [en question, uk question, [en correct, en w1, en w2, en w3], [uk correct, uk w1, uk w2, uk w3]]
const CURATED_CHOICE = {
  history: [
    ['In which year did World War II end?', 'У якому році закінчилася Друга світова війна?',
      ['1945', '1918', '1939', '1963'], ['1945', '1918', '1939', '1963']],
    ['Who was the first President of the United States?', 'Хто був першим президентом США?',
      ['George Washington', 'Abraham Lincoln', 'Thomas Jefferson', 'Theodore Roosevelt'],
      ['Джордж Вашингтон', 'Авраам Лінкольн', 'Томас Джефферсон', 'Теодор Рузвельт']],
    ['Which ancient civilization built the pyramids at Giza?', 'Яка стародавня цивілізація збудувала піраміди в Гізі?',
      ['Ancient Egypt', 'Ancient Rome', 'Ancient Greece', 'The Maya'],
      ['Стародавній Єгипет', 'Стародавній Рим', 'Стародавня Греція', 'Майя']],
    ['In which year did the Berlin Wall fall?', 'У якому році впала Берлінська стіна?',
      ['1989', '1961', '1975', '1991'], ['1989', '1961', '1975', '1991']],
    ['Who was the first person to walk on the Moon?', 'Хто першим ступив на Місяць?',
      ['Neil Armstrong', 'Buzz Aldrin', 'Yuri Gagarin', 'Michael Collins'],
      ['Ніл Армстронг', 'Базз Олдрін', 'Юрій Гагарін', 'Майкл Коллінз']],
    ['Which empire was ruled by Julius Caesar?', 'Якою імперією правив Юлій Цезар?',
      ['The Roman Empire', 'The Ottoman Empire', 'The British Empire', 'The Mongol Empire'],
      ['Римська імперія', 'Османська імперія', 'Британська імперія', 'Монгольська імперія']],
  ],
  geography: [
    ['What is the capital of France?', 'Яка столиця Франції?',
      ['Paris', 'London', 'Berlin', 'Madrid'], ['Париж', 'Лондон', 'Берлін', 'Мадрид']],
    ['Which is the largest ocean on Earth?', 'Який океан найбільший на Землі?',
      ['The Pacific Ocean', 'The Atlantic Ocean', 'The Indian Ocean', 'The Arctic Ocean'],
      ['Тихий океан', 'Атлантичний океан', 'Індійський океан', 'Північний Льодовитий океан']],
    ['What is the capital of Ukraine?', 'Яка столиця України?',
      ['Kyiv', 'Lviv', 'Odesa', 'Kharkiv'], ['Київ', 'Львів', 'Одеса', 'Харків']],
    ['On which continent is Egypt located?', 'На якому континенті розташований Єгипет?',
      ['Africa', 'Asia', 'Europe', 'South America'], ['Африка', 'Азія', 'Європа', 'Південна Америка']],
    ['Which is the highest mountain in the world?', 'Яка гора найвища у світі?',
      ['Mount Everest', 'K2', 'Mont Blanc', 'Kilimanjaro'], ['Еверест', 'К2', 'Монблан', 'Кіліманджаро']],
    ['What is the capital of Japan?', 'Яка столиця Японії?',
      ['Tokyo', 'Kyoto', 'Osaka', 'Seoul'], ['Токіо', 'Кіото', 'Осака', 'Сеул']],
  ],
  art: [
    ['Who painted the Mona Lisa?', 'Хто намалював Мону Лізу?',
      ['Leonardo da Vinci', 'Michelangelo', 'Raphael', 'Vincent van Gogh'],
      ['Леонардо да Вінчі', 'Мікеланджело', 'Рафаель', 'Вінсент ван Гог']],
    ['Which artist cut off part of his own ear?', 'Який художник відрізав собі частину вуха?',
      ['Vincent van Gogh', 'Claude Monet', 'Pablo Picasso', 'Salvador Dali'],
      ['Вінсент ван Гог', 'Клод Моне', 'Пабло Пікассо', 'Сальвадор Далі']],
    ['How many strings does a standard guitar have?', 'Скільки струн у звичайної гітари?',
      ['6', '4', '5', '12'], ['6', '4', '5', '12']],
    ['Who composed "The Four Seasons"?', 'Хто написав "Пори року"?',
      ['Antonio Vivaldi', 'Johann Sebastian Bach', 'Wolfgang Amadeus Mozart', 'Ludwig van Beethoven'],
      ['Антоніо Вівальді', 'Йоганн Себастьян Бах', 'Вольфганг Амадей Моцарт', 'Людвіг ван Бетховен']],
    ['Which colour do you get by mixing blue and yellow?', 'Який колір утвориться, якщо змішати синій і жовтий?',
      ['Green', 'Purple', 'Orange', 'Brown'], ['Зелений', 'Фіолетовий', 'Помаранчевий', 'Коричневий']],
    ['Who sculpted the statue of David?', 'Хто створив скульптуру Давида?',
      ['Michelangelo', 'Donatello', 'Auguste Rodin', 'Gian Lorenzo Bernini'],
      ['Мікеланджело', 'Донателло', 'Оґюст Роден', 'Джан Лоренцо Берніні']],
  ],
  sport: [
    ['How many players from one team are on the pitch in football?', 'Скільки гравців однієї команди на полі у футболі?',
      ['11', '9', '10', '12'], ['11', '9', '10', '12']],
    ['How often are the Summer Olympic Games held?', 'Як часто проводяться літні Олімпійські ігри?',
      ['Every 4 years', 'Every 2 years', 'Every 3 years', 'Every 5 years'],
      ['Кожні 4 роки', 'Кожні 2 роки', 'Кожні 3 роки', 'Кожні 5 років']],
    ['In which sport is the term "slam dunk" used?', 'У якому виді спорту вживають термін "слем-данк"?',
      ['Basketball', 'Tennis', 'Golf', 'Swimming'], ['Баскетбол', 'Теніс', 'Гольф', 'Плавання']],
    ['How many rings are on the Olympic flag?', 'Скільки кілець на олімпійському прапорі?',
      ['5', '3', '4', '6'], ['5', '3', '4', '6']],
    ['Which sport is played at Wimbledon?', 'Який вид спорту проводять на Вімблдоні?',
      ['Tennis', 'Cricket', 'Rugby', 'Hockey'], ['Теніс', 'Крикет', 'Регбі', 'Хокей']],
    ['How many points is a touchdown worth in American football?', 'Скільки очок дає тачдаун в американському футболі?',
      ['6', '3', '7', '2'], ['6', '3', '7', '2']],
  ],
  science: [
    ['What is the chemical formula of water?', 'Яка хімічна формула води?',
      ['H2O', 'CO2', 'O2', 'NaCl'], ['H2O', 'CO2', 'O2', 'NaCl']],
    ['How many planets are in the Solar System?', 'Скільки планет у Сонячній системі?',
      ['8', '7', '9', '10'], ['8', '7', '9', '10']],
    ['Which gas do humans need to breathe to survive?', 'Який газ потрібен людині для дихання?',
      ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Helium'], ['Кисень', 'Азот', 'Вуглекислий газ', 'Гелій']],
    ['What is the closest star to Earth?', 'Яка зоря найближча до Землі?',
      ['The Sun', 'Proxima Centauri', 'Sirius', 'Polaris'], ['Сонце', 'Проксіма Центавра', 'Сіріус', 'Полярна зоря']],
    ['How many legs does a spider have?', 'Скільки ніг у павука?',
      ['8', '6', '4', '10'], ['8', '6', '4', '10']],
    ['What is the boiling point of water at sea level, in Celsius?', 'Яка температура кипіння води на рівні моря, у Цельсіях?',
      ['100', '50', '90', '212'], ['100', '50', '90', '212']],
  ],
};

// ─── curated NUMERICAL questions (answer must be a non-negative integer) ─────
const CURATED_NUMERICAL = {
  history: [
    ['In which year was the US Declaration of Independence signed?', 'У якому році підписали Декларацію незалежності США?', 1776],
    ['In which year did the first human walk on the Moon?', 'У якому році людина вперше ступила на Місяць?', 1969],
  ],
  geography: [
    ['How many continents are there on Earth?', 'Скільки континентів на Землі?', 7],
    ['How many oceans are there on Earth?', 'Скільки океанів на Землі?', 5],
  ],
  art: [
    ['How many keys does a standard piano have?', 'Скільки клавіш у стандартного фортепіано?', 88],
    ['How many strings does a standard violin have?', 'Скільки струн у звичайної скрипки?', 4],
  ],
  sport: [
    ['How many players from one team are on a basketball court?', 'Скільки гравців однієї команди на баскетбольному майданчику?', 5],
    ['How many minutes does a football match last without stoppage time?', 'Скільки хвилин триває футбольний матч без доданого часу?', 90],
  ],
  science: [
    ['How many bones are there in an adult human body?', 'Скільки кісток в організмі дорослої людини?', 206],
    ['How many degrees Celsius is the freezing point of water?', 'При скількох градусах Цельсія замерзає вода?', 0],
  ],
};

// ─── MAP places: [en name, uk name, lat, lng] ────────────────────────────────
// correct is stored as [lat, lng] — survival-server reads correct[0] as lat.
const MAP_PLACES = [
  ['Paris, France', 'Париж, Франція', 48.8566, 2.3522],
  ['London, United Kingdom', 'Лондон, Велика Британія', 51.5074, -0.1278],
  ['Kyiv, Ukraine', 'Київ, Україна', 50.4501, 30.5234],
  ['Berlin, Germany', 'Берлін, Німеччина', 52.52, 13.405],
  ['Rome, Italy', 'Рим, Італія', 41.9028, 12.4964],
  ['Madrid, Spain', 'Мадрид, Іспанія', 40.4168, -3.7038],
  ['Tokyo, Japan', 'Токіо, Японія', 35.6762, 139.6503],
  ['New York, USA', 'Нью-Йорк, США', 40.7128, -74.006],
  ['Cairo, Egypt', 'Каїр, Єгипет', 30.0444, 31.2357],
  ['Sydney, Australia', 'Сідней, Австралія', -33.8688, 151.2093],
  ['Beijing, China', 'Пекін, Китай', 39.9042, 116.4074],
  ['Rio de Janeiro, Brazil', 'Ріо-де-Жанейро, Бразилія', -22.9068, -43.1729],
  ['Cape Town, South Africa', 'Кейптаун, ПАР', -33.9249, 18.4241],
  ['Istanbul, Turkey', 'Стамбул, Туреччина', 41.0082, 28.9784],
  ['Athens, Greece', 'Афіни, Греція', 37.9838, 23.7275],
  ['Lisbon, Portugal', 'Лісабон, Португалія', 38.7223, -9.1393],
  ['Warsaw, Poland', 'Варшава, Польща', 52.2297, 21.0122],
  ['Prague, Czechia', 'Прага, Чехія', 50.0755, 14.4378],
  ['Vienna, Austria', 'Відень, Австрія', 48.2082, 16.3738],
  ['Stockholm, Sweden', 'Стокгольм, Швеція', 59.3293, 18.0686],
  ['Oslo, Norway', 'Осло, Норвегія', 59.9139, 10.7522],
  ['Helsinki, Finland', 'Гельсінкі, Фінляндія', 60.1699, 24.9384],
  ['Amsterdam, Netherlands', 'Амстердам, Нідерланди', 52.3676, 4.9041],
  ['Toronto, Canada', 'Торонто, Канада', 43.6532, -79.3832],
  ['Mexico City, Mexico', 'Мехіко, Мексика', 19.4326, -99.1332],
  ['Buenos Aires, Argentina', 'Буенос-Айрес, Аргентина', -34.6037, -58.3816],
  ['Delhi, India', 'Делі, Індія', 28.6139, 77.209],
  ['Bangkok, Thailand', 'Бангкок, Таїланд', 13.7563, 100.5018],
  ['Seoul, South Korea', 'Сеул, Південна Корея', 37.5665, 126.978],
  ['Nairobi, Kenya', 'Найробі, Кенія', -1.2921, 36.8219],
  ['Lviv, Ukraine', 'Львів, Україна', 49.8397, 24.0297],
  ['Reykjavik, Iceland', 'Рейк\'явік, Ісландія', 64.1466, -21.9426],
];

// ─── deterministic helpers ───────────────────────────────────────────────────

function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 — small deterministic PRNG */
function prng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const intIn = (rnd, min, max) => min + Math.floor(rnd() * (max - min + 1));

/**
 * Correct-answer position cycle.
 *
 * The survival payload exposes `correct = shuffledAnswers.indexOf(0)`. The known
 * bug in survival-server/src/survivalQuestionProvider.ts hardcodes `correct: 0`,
 * so if every seeded question had its correct option first the bug would be
 * invisible. This cycle keeps position 0 rare (1 in 8) and obvious to spot.
 */
const CORRECT_POSITION_CYCLE = [1, 2, 3, 1, 3, 2, 2, 0];

/** Permutation of [0,1,2,3] that puts value 0 (the correct answer) at `pos`. */
function shuffledAnswersFor(index, seed) {
  const pos = CORRECT_POSITION_CYCLE[index % CORRECT_POSITION_CYCLE.length];
  const rnd = prng(seed);
  const rest = [1, 2, 3];
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const perm = [];
  let k = 0;
  for (let i = 0; i < 4; i += 1) perm.push(i === pos ? 0 : rest[k++]);
  return perm;
}

// ─── generated arithmetic questions (answers verifiable at a glance) ─────────

function arithmetic(seed, n) {
  const rnd = prng(seed + n * 7919);
  const kind = n % 3;
  if (kind === 0) {
    const a = intIn(rnd, 11, 89);
    const b = intIn(rnd, 11, 89);
    return { en: `What is ${a} + ${b}?`, uk: `Скільки буде ${a} + ${b}?`, value: a + b };
  }
  if (kind === 1) {
    const a = intIn(rnd, 3, 19);
    const b = intIn(rnd, 3, 19);
    return { en: `What is ${a} x ${b}?`, uk: `Скільки буде ${a} x ${b}?`, value: a * b };
  }
  const a = intIn(rnd, 60, 199);
  const b = intIn(rnd, 11, 59);
  return { en: `What is ${a} - ${b}?`, uk: `Скільки буде ${a} - ${b}?`, value: a - b };
}

/** Three distinct plausible wrong numbers around `value`. */
function wrongNumbers(value, seed) {
  const rnd = prng(seed);
  const candidates = [
    value + 1, value - 1, value + 10, value - 10,
    value + 2, value - 2, value + 11, value + 9,
    value * 2, value + 100,
  ];
  const out = [];
  for (const c of candidates) {
    if (c === value || c < 0 || out.includes(c)) continue;
    out.push(c);
    if (out.length === 6) break;
  }
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, 3).map(String);
}

/**
 * Per-category pool of CHOICE specs: curated first, then arithmetic filler.
 * `count` specs are returned, all textually distinct.
 */
function choiceSpecs(category, count) {
  const seed = hash32(`choice:${category}`);
  const curated = CURATED_CHOICE[category] || [];
  const specs = curated.map(([en, uk, ansEn, ansUk]) => ({
    en, uk, answersEn: ansEn, answersUk: ansUk,
  }));
  let n = 0;
  while (specs.length < count) {
    const a = arithmetic(seed, n);
    const wrong = wrongNumbers(a.value, seed + n);
    specs.push({
      en: a.en,
      uk: a.uk,
      answersEn: [String(a.value), ...wrong],
      answersUk: [String(a.value), ...wrong],
    });
    n += 1;
  }
  return specs.slice(0, count);
}

/** Per-category pool of NUMERICAL specs. */
function numericalSpecs(category, count) {
  const seed = hash32(`numerical:${category}`);
  const curated = CURATED_NUMERICAL[category] || [];
  const specs = curated.map(([en, uk, value]) => ({ en, uk, value }));
  let n = 0;
  while (specs.length < count) {
    const a = arithmetic(seed, n);
    specs.push({ en: a.en, uk: a.uk, value: a.value });
    n += 1;
  }
  return specs.slice(0, count);
}

// ─── document builders ───────────────────────────────────────────────────────

function buildCategories() {
  const docs = [];
  for (const root of ROOT_CATEGORIES) {
    docs.push({
      _id: root.id,
      name: root.name,
      parentId: null,
      ancestors: [],
      locales: [
        { language: 'en', value: root.en },
        { language: 'uk', value: root.uk },
      ],
      seedBatch: SEED_MARKER,
    });
    SUBCATEGORIES[root.name].forEach(([name, en, uk], i) => {
      docs.push({
        _id: root.id * 10 + i + 1,
        name,
        parentId: root.id,
        // add-category.ts: ancestors = [...parent.ancestors, parent.id]
        ancestors: [root.id],
        locales: [
          { language: 'en', value: en },
          { language: 'uk', value: uk },
        ],
        seedBatch: SEED_MARKER,
      });
    });
  }
  return docs;
}

function subcategoryIds(categoryName) {
  const root = ROOT_CATEGORIES.find((c) => c.name === categoryName);
  return SUBCATEGORIES[categoryName].map((_, i) => root.id * 10 + i + 1);
}

function commonFields({ id, categoryId, track, difficulty, languages, authorId }) {
  return {
    _id: id,
    isValid: true,
    status: STATUS_READY,
    track,
    categoryId,
    difficulty,
    source: 'survival-testbed seed',
    needUpdate: null,
    requiredLanguages: [...languages],
    imageId: null,
    audioId: null,
    authorId,
    updatorId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: null,
    rating: 0,
    winRate: 0.5,
    counter: 0,
    reports: [],
    reportsCount: 0,
    tags: ['testbed'],
    // getQuestionsForGame sorts by { rand: 1, lastTouch: 1 }; production reshuffles
    // `rand` on a timer, we just spread it deterministically.
    rand: hash32(`rand:${id}`) % 1000000,
    seedBatch: SEED_MARKER,
  };
}

function localesFor(languages, textEn, textUk, extraEn, extraUk) {
  const byLang = { en: [textEn, extraEn], uk: [textUk, extraUk] };
  return languages.map((language) => {
    const [question, extra] = byLang[language] || byLang.en;
    return { language, question, ...extra };
  });
}

/**
 * Builds every question document.
 *
 * counts = {
 *   generalChoicePerCategory, generalNumericalPerCategory, generalMap,
 *   survivalChoicePerCategory, survivalNumericalPerCategory, survivalMap,
 * }
 */
function buildQuestions({ languages, counts, authorId }) {
  const docs = [];
  const difficulties = [1, 2, 3, 4, 5];

  // Question text is player-facing: no track/category tags in it.
  const tag = () => '';

  // ── CHOICE ────────────────────────────────────────────────────────────────
  for (const root of ROOT_CATEGORIES) {
    const subs = subcategoryIds(root.name);
    const generalCount = counts.generalChoicePerCategory;
    const survivalCount = counts.survivalChoicePerCategory;
    // One shared pool so general and survival never repeat the same text.
    // Survival takes the head of the pool (the hand-written, obviously-answerable
    // ones) because it is what this testbed exists to exercise.
    const specs = choiceSpecs(root.name, generalCount + survivalCount);

    const emit = (spec, i, track, id) => {
      const perm = shuffledAnswersFor(docs.length, hash32(`perm:${id}`));
      const prefix = tag(track, root.name);
      docs.push({
        ...commonFields({
          id,
          categoryId: subs[i % subs.length],
          track,
          difficulty: difficulties[i % difficulties.length],
          languages,
          authorId,
        }),
        type: TYPE.CHOICE,
        shuffledAnswers: perm,
        locales: localesFor(
          languages,
          prefix + spec.en,
          prefix + spec.uk,
          { correct: spec.answersEn[0], wrong: spec.answersEn.slice(1) },
          { correct: spec.answersUk[0], wrong: spec.answersUk.slice(1) },
        ),
      });
    };

    for (let i = 0; i < survivalCount; i += 1) {
      emit(specs[i], i, TRACK.SURVIVAL, SURVIVAL_ID_BASE + root.id * 1000 + i + 1);
    }
    for (let i = 0; i < generalCount; i += 1) {
      emit(specs[survivalCount + i], i, TRACK.GENERAL, GENERAL_ID_BASE + root.id * 1000 + i + 1);
    }
  }

  // ── NUMERICAL ─────────────────────────────────────────────────────────────
  for (const root of ROOT_CATEGORIES) {
    const subs = subcategoryIds(root.name);
    const generalCount = counts.generalNumericalPerCategory;
    const survivalCount = counts.survivalNumericalPerCategory;
    const specs = numericalSpecs(root.name, generalCount + survivalCount);

    const emit = (spec, i, track, id) => {
      const prefix = tag(track, root.name);
      docs.push({
        ...commonFields({
          id,
          categoryId: subs[i % subs.length],
          track,
          difficulty: difficulties[i % difficulties.length],
          languages,
          authorId,
        }),
        type: TYPE.NUMERICAL,
        locales: localesFor(
          languages,
          prefix + spec.en,
          prefix + spec.uk,
          { correct: spec.value },
          { correct: spec.value },
        ),
      });
    };

    for (let i = 0; i < survivalCount; i += 1) {
      emit(specs[i], i, TRACK.SURVIVAL, SURVIVAL_ID_BASE + 100 + root.id * 1000 + i + 1);
    }
    for (let i = 0; i < generalCount; i += 1) {
      emit(specs[survivalCount + i], i, TRACK.GENERAL, GENERAL_ID_BASE + 100 + root.id * 1000 + i + 1);
    }
  }

  // ── MAP (geography only — fight-server only ever asks geography for map) ──
  {
    const geo = ROOT_CATEGORIES.find((c) => c.name === 'geography');
    const subs = subcategoryIds('geography');

    const emit = (place, i, track, id) => {
      const [en, uk, lat, lng] = place;
      const prefix = tag(track, 'geography');
      docs.push({
        ...commonFields({
          id,
          categoryId: subs[i % subs.length],
          track,
          difficulty: difficulties[i % difficulties.length],
          languages,
          authorId,
        }),
        type: TYPE.MAP,
        locales: localesFor(
          languages,
          `${prefix}Show ${en} on the map`,
          `${prefix}Покажіть на карті ${uk}`,
          { correct: [lat, lng] },
          { correct: [lat, lng] },
        ),
      });
    };

    for (let i = 0; i < counts.survivalMap; i += 1) {
      emit(MAP_PLACES[i % MAP_PLACES.length], i, TRACK.SURVIVAL, SURVIVAL_ID_BASE + 200 + geo.id * 1000 + i + 1);
    }
    for (let i = 0; i < counts.generalMap; i += 1) {
      const place = MAP_PLACES[(counts.survivalMap + i) % MAP_PLACES.length];
      emit(place, i, TRACK.GENERAL, GENERAL_ID_BASE + 200 + geo.id * 1000 + i + 1);
    }
  }

  return docs;
}

module.exports = {
  SEED_MARKER,
  TRACK,
  TYPE,
  STATUS_READY,
  ROOT_CATEGORIES,
  SUBCATEGORIES,
  MAP_PLACES,
  QUESTION_ID_COUNTER_START,
  CATEGORY_ID_COUNTER_START,
  buildCategories,
  buildQuestions,
  subcategoryIds,
};
