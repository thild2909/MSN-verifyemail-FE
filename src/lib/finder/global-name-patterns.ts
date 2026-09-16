/**
 * Layer 4 — culture-aware global name → email-pattern engine.
 *
 * When the standard first.last patterns (Layer 1), the alt-domain and public-
 * sources layers, and the name-correction layer (Layer 3) all fail to confirm a
 * mailbox, the real local-part is very often built from a naming convention the
 * naive Western parser gets wrong: a Vietnamese given-name-last (`ducnh`), a
 * Chinese family-first (`wang.wei`), a Hispanic double surname (`juan.garcia`),
 * a German umlaut fold (`mueller`), a Dutch surname particle (`vanderberg`), an
 * Arabic prefix (`alhassan`), and so on.
 *
 * This module implements the pipeline:
 *   FULL NAME → Normalizer → Country/Profile parser → Name components + variants
 *             → Pattern generator → Ranker → top candidates
 * The caller (people-verify) then SMTP-verifies the top candidates and keeps the
 * first the backend confirms `valid`. A learned per-domain pattern overrides the
 * generic ranking, so once one mailbox at a company is confirmed, colleagues
 * resolve on the first try.
 *
 * Design notes:
 *  - 195 countries are grouped into ~17 naming PROFILES (with country overrides
 *    where a country needs one), never modelled independently.
 *  - Precision over recall: we never *return* a guessed address; we only rank
 *    candidates. Only a backend-`valid` verdict (decided by the caller) is shown.
 *  - Original (accented) name is preserved for display; only the local-part is
 *    ASCII-folded, profile-aware (German ü→ue vs. French ü→u).
 */

/* ============================== profiles ================================= */

export type NamingProfile =
  | "western"
  | "hispanic"
  | "french"
  | "germanic"
  | "italian"
  | "dutch"
  | "nordic"
  | "slavic"
  | "south_asian"
  | "sea_malay"
  | "indonesian"
  | "vietnamese"
  | "chinese"
  | "korean"
  | "japanese"
  | "arabic"
  | "african";

/**
 * Country (name or ISO-2, lowercased) → naming profile. A free-text location is
 * matched by scanning its tokens against these keys, so "Kuala Lumpur, Malaysia"
 * and "MY" both resolve to sea_malay. Unlisted → western (a safe global base).
 */
const COUNTRY_TO_PROFILE: Record<string, NamingProfile> = {
  // Western English
  "us": "western", "usa": "western", "united states": "western", "america": "western",
  "uk": "western", "gb": "western", "united kingdom": "western", "england": "western", "scotland": "western", "wales": "western", "ireland": "western", "ie": "western",
  "canada": "western", "ca": "western", "australia": "western", "au": "western", "new zealand": "western", "nz": "western",
  // Hispanic / Lusophone / Latin America
  "spain": "hispanic", "es": "hispanic", "mexico": "hispanic", "mx": "hispanic", "argentina": "hispanic", "ar": "hispanic",
  "colombia": "hispanic", "co": "hispanic", "chile": "hispanic", "cl": "hispanic", "peru": "hispanic", "pe": "hispanic",
  "venezuela": "hispanic", "ve": "hispanic", "ecuador": "hispanic", "uruguay": "hispanic", "paraguay": "hispanic", "bolivia": "hispanic",
  "portugal": "hispanic", "pt": "hispanic", "brazil": "hispanic", "br": "hispanic",
  // French
  "france": "french", "fr": "french", "belgium": "french", "be": "french", "luxembourg": "french",
  // Germanic
  "germany": "germanic", "de": "germanic", "austria": "germanic", "at": "germanic", "switzerland": "germanic", "ch": "germanic",
  // Italian
  "italy": "italian", "it": "italian",
  // Dutch
  "netherlands": "dutch", "nl": "dutch", "holland": "dutch",
  // Nordic
  "sweden": "nordic", "se": "nordic", "norway": "nordic", "no": "nordic", "denmark": "nordic", "dk": "nordic",
  "finland": "nordic", "fi": "nordic", "iceland": "nordic", "is": "nordic",
  // Slavic / Eastern Europe
  "poland": "slavic", "pl": "slavic", "czech": "slavic", "czechia": "slavic", "cz": "slavic", "slovakia": "slavic", "sk": "slavic",
  "russia": "slavic", "ru": "slavic", "ukraine": "slavic", "ua": "slavic", "belarus": "slavic", "bulgaria": "slavic", "bg": "slavic",
  "serbia": "slavic", "rs": "slavic", "croatia": "slavic", "hr": "slavic", "slovenia": "slavic", "romania": "slavic", "ro": "slavic",
  // South Asian
  "india": "south_asian", "in": "south_asian", "pakistan": "south_asian", "pk": "south_asian",
  "bangladesh": "south_asian", "bd": "south_asian", "sri lanka": "south_asian", "nepal": "south_asian",
  // Southeast Asian (Malay world)
  "malaysia": "sea_malay", "my": "sea_malay", "singapore": "sea_malay", "sg": "sea_malay", "brunei": "sea_malay", "bn": "sea_malay",
  "indonesia": "indonesian", "id": "indonesian",
  // Vietnamese
  "vietnam": "vietnamese", "viet nam": "vietnamese", "vn": "vietnamese",
  // CJK
  "china": "chinese", "cn": "chinese", "taiwan": "chinese", "tw": "chinese", "hong kong": "chinese", "hk": "chinese", "macau": "chinese",
  "south korea": "korean", "korea": "korean", "kr": "korean",
  "japan": "japanese", "jp": "japanese",
  // Arabic / Gulf + Middle East
  "saudi arabia": "arabic", "sa": "arabic", "uae": "arabic", "united arab emirates": "arabic", "ae": "arabic",
  "qatar": "arabic", "qa": "arabic", "kuwait": "arabic", "kw": "arabic", "bahrain": "arabic", "bh": "arabic", "oman": "arabic", "om": "arabic",
  "egypt": "arabic", "eg": "arabic", "jordan": "arabic", "lebanon": "arabic", "iraq": "arabic", "syria": "arabic", "morocco": "arabic", "algeria": "arabic", "tunisia": "arabic",
  // African (English/French/Portuguese business markets) — Western email patterns + local parse
  "nigeria": "african", "ng": "african", "kenya": "african", "ke": "african", "south africa": "african", "za": "african",
  "ghana": "african", "gh": "african", "ethiopia": "african", "tanzania": "african", "uganda": "african",
  // Philippines — largely Western/Hispanic-influenced single-surname naming with
  // frequent compound given names (Kim Lecelyn Bueno → kimlecelyn.bueno).
  "philippines": "western", "ph": "western",
};

/**
 * Recover a person's full name from their LinkedIn vanity slug when it is richer
 * than the stored name (the scraped/CSV `name` is often missing a token). E.g.
 * `linkedin.com/in/kim-lecelyn-bueno` → "Kim Lecelyn Bueno" even when the row
 * only stored "Lecelyn Bueno". Returns null for a single-token or id-only slug.
 */
export function nameFromLinkedinSlug(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!m) return null;
  let slug = decodeURIComponent(m[1]).toLowerCase();
  // Strip a trailing unique id LinkedIn appends (e.g. "-9b3f2a1", "-1a2b3c",
  // "-123456789"). It MUST contain a digit — otherwise a long all-letter SURNAME
  // ("gunasekera") would be wrongly stripped as an id.
  slug = slug.replace(/-(?=[a-z0-9]*[0-9])[a-z0-9]{3,}$/i, "");
  const toks = slug.split("-").filter((t) => /^[a-z][a-z']+$/i.test(t) && t.length >= 2);
  if (toks.length < 2 || toks.length > 4) return null;
  return toks.map((t) => t[0].toUpperCase() + t.slice(1)).join(" ");
}

/**
 * Pick the best full name for candidate generation: prefer the LinkedIn-slug name
 * when it is a SUPERSET of the stored name (adds a missing token like a first
 * name), else keep the stored name. Guards against an unrelated slug by requiring
 * the stored tokens to be contained in the slug's.
 */
export function bestFullName(storedName: string, linkedin?: string | null): string {
  const norm = (s: string) => new Set(s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean));
  const stored = norm(storedName);
  const title = (t: string) => t[0].toUpperCase() + t.slice(1);

  // 1) Hyphenated slug (kim-lecelyn-bueno) → prefer it when it's a superset.
  const slugName = nameFromLinkedinSlug(linkedin);
  if (slugName) {
    const slug = norm(slugName);
    if (stored.size === 0) return slugName;
    if ([...stored].every((t) => slug.has(t)) && slug.size > stored.size) return slugName;
  }
  // 2) CONCATENATED slug (kangyewjin) → segment it against the stored name tokens
  //    to recover a missing token in the slug's order (→ "Kang Yew Jin").
  if (stored.size >= 1) {
    const raw = slugAlpha(linkedin);
    if (raw.length >= 4) {
      const ordered = orderedTokensFromConcatSlug(raw, [...stored]);
      if (ordered) return ordered.map(title).join(" ");
    }
  }
  return storedName;
}

/** The LinkedIn slug as a single lowercased alpha string (trailing id stripped), or "". */
function slugAlpha(url?: string | null): string {
  if (!url) return "";
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!m) return "";
  const slug = decodeURIComponent(m[1]).toLowerCase().replace(/-(?=[a-z0-9]*[0-9])[a-z0-9]{3,}$/i, "");
  return slug.replace(/[^a-z]/g, "");
}

/**
 * Segment a CONCATENATED slug (no separators) into ordered name tokens using the
 * stored name tokens as anchors; leftover contiguous pieces are the MISSING tokens.
 * Stored ["yew","kang"] + slug "kangyewjin" → ["kang","yew","jin"] (slug order),
 * recovering "jin". Returns null unless the stored tokens tile the slug AND at
 * least one new token is discovered (so we never fabricate a split). Downstream
 * candidates are SMTP-verified anyway, so a bad segmentation just fails to confirm.
 */
export function orderedTokensFromConcatSlug(slug: string, storedTokens: string[]): string[] | null {
  const s = slug;
  if (s.length < 4) return null;
  const anchors = storedTokens.filter((t) => t.length >= 2);
  if (anchors.length === 0) return null;
  const covered: Array<{ a: number; b: number; tok: string }> = [];
  for (const tok of anchors) {
    let from = 0;
    let idx = -1;
    while (from <= s.length - tok.length) {
      const p = s.indexOf(tok, from);
      if (p < 0) break;
      if (!covered.some((c) => p < c.b && p + tok.length > c.a)) { idx = p; break; }
      from = p + 1;
    }
    if (idx < 0) return null; // a stored token isn't in the slug → not a concat of them
    covered.push({ a: idx, b: idx + tok.length, tok });
  }
  covered.sort((x, y) => x.a - y.a);
  const segs: Array<{ pos: number; tok: string }> = [];
  let cur = 0;
  for (const c of covered) {
    if (c.a > cur) segs.push({ pos: cur, tok: s.slice(cur, c.a) });
    segs.push({ pos: c.a, tok: c.tok });
    cur = Math.max(cur, c.b);
  }
  if (cur < s.length) segs.push({ pos: cur, tok: s.slice(cur) });
  segs.sort((x, y) => x.pos - y.pos);
  const toks = segs.map((x) => x.tok).filter((t) => t.length >= 2);
  if (toks.join("").length !== s.length) return null; // stored tokens didn't tile the slug
  if (toks.length <= anchors.length || toks.length > 4) return null; // must add ≥1, stay sane
  return toks;
}

/** Detect the naming profile from a free-text country/location (+ name hints). */
export function detectProfile(country?: string | null, name?: string): NamingProfile {
  const loc = (country ?? "").toLowerCase().trim();
  if (loc) {
    // Longest-key-first so "south korea" wins over "korea", "united states" over "us".
    const keys = Object.keys(COUNTRY_TO_PROFILE).sort((a, b) => b.length - a.length);
    for (const k of keys) {
      const re = new RegExp(`(^|[^a-z])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i");
      if (re.test(loc)) return COUNTRY_TO_PROFILE[k];
    }
  }
  // No usable location — infer a CJK/Vietnamese profile from surname evidence so
  // family-first names still parse; otherwise fall back to the Western base.
  const toks = (name ?? "").trim().split(/\s+/).map((t) => foldToken(t, "western"));
  if (toks.length >= 2) {
    if (CHINESE_SURNAMES.has(toks[0]) || CHINESE_SURNAMES.has(toks[toks.length - 1])) return "chinese";
    if (KOREAN_SURNAMES.has(toks[0]) || KOREAN_SURNAMES.has(toks[toks.length - 1])) return "korean";
    if (VIETNAMESE_SURNAMES.has(toks[0])) return "vietnamese";
  }
  return "western";
}

/* ============================ normalization ============================== */

// Digraphs with no Unicode combining form (NFD won't touch these) — always applied.
const BASE_DIGRAPHS: [RegExp, string][] = [
  [/ß/g, "ss"], [/œ/gi, "oe"], [/æ/gi, "ae"], [/ł/gi, "l"], [/đ/gi, "d"], [/ð/gi, "d"], [/þ/gi, "th"], [/ø/gi, "o"], [/ı/gi, "i"],
];

/**
 * Fold ONE name token to an ASCII local-part token, profile-aware. German folds
 * umlauts to digraphs (ü→ue), Nordic folds its vowels (ø→oe, å→a); everyone else
 * strips diacritics generically (é→e, ü→u). The profile-specific maps run BEFORE
 * NFD so a precomposed ü is expanded to "ue" rather than stripped to "u".
 */
export function foldToken(raw: string, profile: NamingProfile): string {
  let s = (raw ?? "").toLowerCase();
  if (profile === "germanic") {
    s = s.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
  } else if (profile === "nordic") {
    s = s.replace(/å/g, "a").replace(/ä/g, "a").replace(/æ/g, "ae").replace(/ø/g, "oe").replace(/ö/g, "oe").replace(/ü/g, "u");
  }
  for (const [re, rep] of BASE_DIGRAPHS) s = s.replace(re, rep);
  s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); // strip remaining diacritics
  return s.replace(/[^a-z0-9]+/g, "");
}

/* ============================ dictionaries =============================== */

// Surname particles kept as part of the surname (Dutch/German/Romance).
const SURNAME_PARTICLES = new Set(["van", "von", "der", "den", "de", "del", "della", "di", "da", "dos", "das", "do", "la", "le", "ter", "ten", "op", "vande", "vanden", "st", "san", "mac", "mc", "ab", "ap"]);

// Malay / South-Asian patronymic connectors — the token AFTER them is a parent's
// name, NOT a family surname, so it must not lead the candidate list.
const PATRONYMIC_CONNECTORS = new Set(["bin", "binti", "binte", "bte", "bt", "ibni", "ibn", "anak", "a/l", "a/p", "al", "s/o", "d/o"]);

// Arabic surname prefixes — glued to the following token to form the family name.
const ARABIC_PREFIXES = new Set(["al", "el", "ul", "abu", "abd", "abdel", "abdul", "abdal", "ibn", "bin", "bint", "ben", "bar"]);

// South-Asian honorific/theophoric given-name prefixes — a SEGMENTATION SIGNAL,
// never auto-dropped: when one leads a 3+-token name the next token is the true
// personal given name.
const SOUTH_ASIAN_PREFIXES = new Set(["muhammad", "mohammad", "mohammed", "mohamad", "mohamed", "mohd", "md", "abdul", "abdur", "syed", "sayed", "sayyid", "sri"]);

// Common Western given names — used to spot an English given name attached to a
// CJK surname (Hong Kong / Singapore: "Jason Wong", "Tony Leung Chiu Wai").
const WESTERN_GIVEN = new Set(["james", "john", "robert", "michael", "william", "david", "richard", "joseph", "thomas", "charles", "peter", "paul", "mark", "daniel", "kevin", "brian", "jason", "eric", "steven", "andrew", "kenneth", "gary", "jason", "tony", "jeffrey", "ryan", "jacob", "gary", "nicholas", "eric", "jonathan", "larry", "justin", "scott", "brandon", "frank", "benjamin", "gregory", "samuel", "raymond", "patrick", "jack", "dennis", "jerry", "alexander", "henry", "douglas", "adam", "carl", "arthur", "ryan", "roger", "joe", "juan", "jack", "albert", "mary", "jennifer", "linda", "patricia", "elizabeth", "susan", "jessica", "sarah", "karen", "nancy", "lisa", "betty", "helen", "sandra", "donna", "carol", "ruth", "sharon", "michelle", "laura", "grace", "alice", "amy", "anna", "rose", "jean", "kelly", "vivian", "cindy", "eddie", "kenny", "jackie", "sunny", "ivan", "leon", "leo", "sam", "ken", "roy", "ray", "vincent", "victor", "simon", "alan", "alvin", "calvin", "wilson", "edwin", "edwina"]);

// Modest CJK/Vietnamese surname sets for name-order detection (not exhaustive; a
// signal, not a hard rule).
const CHINESE_SURNAMES = new Set(["wang", "li", "zhang", "liu", "chen", "yang", "huang", "zhao", "wu", "zhou", "xu", "sun", "ma", "zhu", "hu", "guo", "he", "lin", "gao", "luo", "zheng", "liang", "xie", "tang", "deng", "feng", "cao", "peng", "zeng", "xiao", "tian", "dong", "yuan", "pan", "cai", "jiang", "yu", "du", "ye", "cheng", "wei", "su", "lu", "ding", "ren", "shen", "yao", "lai", "tan", "tang",
  // common romanizations used in HK/TW/SG/MY (Chinese-Malaysian/Singaporean)
  "chan", "cheung", "wong", "lam", "lau", "leung", "ho", "ng", "tsang", "yeung", "chow", "chu", "kwok", "tam", "yip", "fung", "lee", "tan", "teo", "goh", "ong", "lim", "koh", "sim", "chua", "toh", "yeo", "seah", "ang", "chin", "hsu", "hsieh", "kao", "chiang",
  "kang", "yeoh", "khoo", "cheah", "chong", "chuah", "gan", "low", "ooi", "phua", "saw", "soon", "tay", "teoh", "thong", "yap", "choo", "foo", "hoo", "kok", "kong", "loh", "mah", "neo", "poh", "quek", "see", "sng", "teh", "wee", "yong", "chia", "khaw", "boey", "cham", "lai"]);
const KOREAN_SURNAMES = new Set(["kim", "lee", "yi", "park", "pak", "choi", "choe", "jung", "jeong", "chung", "kang", "cho", "jo", "yoon", "yun", "jang", "chang", "lim", "im", "han", "shin", "sin", "seo", "suh", "kwon", "hwang", "ahn", "an", "song", "ryu", "yoo", "yu", "hong", "ha", "moon", "mun", "yang", "son", "bae", "baek", "paik", "oh", "o", "nam", "no", "roh"]);
const VIETNAMESE_SURNAMES = new Set(["nguyen", "tran", "le", "pham", "hoang", "huynh", "phan", "vu", "vo", "dang", "bui", "do", "ho", "ngo", "duong", "ly", "dao", "dinh", "cao", "mai", "truong", "lam", "trinh", "dinh"]);

/* ============================ name components ============================ */

export interface NameComponents {
  profile: NamingProfile;
  order: "given_first" | "family_first";
  givenTokens: string[]; // folded
  middleTokens: string[]; // folded
  surnameFull: string; // folded, joined, no separators (e.g. "vanderberg", "garcialopez")
  surnameCore: string; // main distinctive surname token (e.g. "berg", "garcia")
  surnameSecond: string; // hispanic 2nd surname (e.g. "lopez"), else ""
  givenHyphen: string; // hyphenated given folded, e.g. "jean-pierre" / "min-su", else ""
  raw: string;
}

const clean = (s: string) => s.replace(/[^a-z0-9-]/gi, "");

/** Parse a full name into components according to its naming profile. */
export function parseName(rawName: string, profile: NamingProfile): NameComponents {
  const raw = (rawName ?? "").trim();
  const rawTokens = raw.split(/\s+/).filter(Boolean);
  const fold = (t: string) => foldToken(t, profile);
  const folded = rawTokens.map(fold).filter(Boolean);

  const base: NameComponents = {
    profile, order: "given_first",
    givenTokens: [], middleTokens: [], surnameFull: "", surnameCore: "", surnameSecond: "", givenHyphen: "", raw,
  };
  if (folded.length === 0) return base;
  if (folded.length === 1) { base.givenTokens = [folded[0]]; return base; } // single name (Indonesian, etc.)

  const hyphenGiven = (tok: string) =>
    /-/.test(clean(tok)) ? clean(tok).toLowerCase().split("-").map((p) => foldToken(p, profile)).filter(Boolean).join("-") : "";

  const setGivenFamily = (given: string[], middle: string[], surnameToks: string[], second = ""): NameComponents => ({
    ...base,
    givenTokens: given,
    middleTokens: middle,
    surnameFull: surnameToks.join(""),
    surnameCore: surnameToks[surnameToks.length - 1] ?? "",
    surnameSecond: second,
    givenHyphen: hyphenGiven(rawTokens[0] ?? ""),
  });

  switch (profile) {
    case "vietnamese": {
      // FAMILY + MIDDLE + GIVEN. Given name is the LAST token; family the first.
      const given = [folded[folded.length - 1]];
      const family = [folded[0]];
      const middle = folded.slice(1, -1);
      return { ...setGivenFamily(given, middle, family), surnameCore: family[0] ?? "", order: "family_first" };
    }
    case "chinese":
    case "korean":
    case "japanese": {
      // English given + CJK surname (HK/SG): "Jason Wong", "Tony Leung Chiu Wai".
      const engIdx = folded.findIndex((t) => WESTERN_GIVEN.has(t));
      const surnameSet = profile === "korean" ? KOREAN_SURNAMES : CHINESE_SURNAMES;
      if (engIdx >= 0) {
        const surnameIdx = folded.findIndex((t, i) => i !== engIdx && surnameSet.has(t));
        const famTok = surnameIdx >= 0 ? folded[surnameIdx] : folded.find((t, i) => i !== engIdx) ?? "";
        return { ...setGivenFamily([folded[engIdx]], [], [famTok]), order: "given_first" };
      }
      // Native order detection: family-first if the first token is a known
      // surname (or nothing else is), given-first if the last token is.
      const firstIsSurname = surnameSet.has(folded[0]);
      const lastIsSurname = surnameSet.has(folded[folded.length - 1]);
      if (lastIsSurname && !firstIsSurname) {
        return { ...setGivenFamily(folded.slice(0, -1), [], [folded[folded.length - 1]]), order: "given_first" };
      }
      // Default family-first (family = token 0, given = the rest, e.g. "Wang Wei",
      // "Chen Wei Ming" → given tokens [wei, ming]).
      return { ...setGivenFamily(folded.slice(1), [], [folded[0]]), order: "family_first" };
    }
    case "hispanic": {
      // given = leading token(s); surname = last TWO tokens when present.
      if (folded.length >= 4) return setGivenFamily(folded.slice(0, -2), [], [folded[folded.length - 2]], folded[folded.length - 1]);
      if (folded.length === 3) return setGivenFamily([folded[0]], [], [folded[1]], folded[2]);
      return setGivenFamily([folded[0]], [], [folded[1]]);
    }
    case "dutch": {
      const lowerTokens = rawTokens.map((t) => t.toLowerCase());
      const pIdx = lowerTokens.findIndex((t, i) => i > 0 && SURNAME_PARTICLES.has(t));
      if (pIdx > 0) {
        const surname = folded.slice(pIdx); // particles + core, e.g. [van, der, berg]
        return { ...setGivenFamily(folded.slice(0, pIdx), [], surname), surnameCore: surname[surname.length - 1] ?? "" };
      }
      return setGivenFamily([folded[0]], folded.slice(1, -1), [folded[folded.length - 1]]);
    }
    case "arabic": {
      const lowerTokens = rawTokens.map((t) => t.toLowerCase());
      const preIdx = lowerTokens.findIndex((t, i) => i > 0 && ARABIC_PREFIXES.has(t));
      if (preIdx > 0) {
        const surname = folded.slice(preIdx); // al + hassan → "alhassan"
        return { ...setGivenFamily([folded[0]], folded.slice(1, preIdx), surname), surnameCore: surname.join("") };
      }
      return setGivenFamily([folded[0]], folded.slice(1, -1), [folded[folded.length - 1]]);
    }
    case "south_asian": {
      // A leading honorific/theophoric prefix in a 3+-token name marks the NEXT
      // token as the real given name (Muhammad Usman Khan → given "usman").
      if (folded.length >= 3 && SOUTH_ASIAN_PREFIXES.has(folded[0])) {
        return setGivenFamily([folded[1]], [folded[0], ...folded.slice(2, -1)], [folded[folded.length - 1]]);
      }
      return setGivenFamily([folded[0]], folded.slice(1, -1), [folded[folded.length - 1]]);
    }
    case "sea_malay": {
      const lowerTokens = rawTokens.map((t) => t.toLowerCase());
      // Chinese-Malaysian/Singaporean name → route to the Chinese parser.
      if (folded.some((t) => CHINESE_SURNAMES.has(t)) && !lowerTokens.some((t) => PATRONYMIC_CONNECTORS.has(t))) {
        return parseName(rawName, "chinese");
      }
      const cIdx = lowerTokens.findIndex((t) => PATRONYMIC_CONNECTORS.has(t));
      if (cIdx > 0) {
        // Personal name = tokens before the connector; the token(s) after are a
        // parent's name (kept only as low-priority alt, so surname stays empty).
        const personal = folded.slice(0, cIdx);
        return setGivenFamily([personal[0]], personal.slice(1), []);
      }
      // No connector (e.g. "Ahmad Fikrizaman"): treat as given + second personal name.
      return setGivenFamily([folded[0]], folded.slice(1, -1), [folded[folded.length - 1]]);
    }
    case "indonesian": {
      if (folded.length === 2) return setGivenFamily([folded[0]], [], [folded[1]]);
      return setGivenFamily([folded[0]], folded.slice(1, -1), [folded[folded.length - 1]]);
    }
    default: {
      // western / french / germanic / italian / nordic / slavic / african
      return setGivenFamily([folded[0]], folded.slice(1, -1), [folded[folded.length - 1]]);
    }
  }
}

/* ============================ pattern library ============================ */

interface Parts {
  g: string; gFull: string; gInit: string; gi: string; givenHyphen: string;
  m: string; mAll: string; mi: string;
  family: string; fCore: string; fi: string; f2: string; f2i: string;
}
function parts(c: NameComponents): Parts {
  const g = c.givenTokens[0] ?? "";
  const gFull = c.givenTokens.join("");
  const gInit = c.givenTokens.map((t) => t[0] ?? "").join("");
  const fCore = c.surnameCore || c.surnameFull;
  return {
    g, gFull, gInit, gi: g[0] ?? "", givenHyphen: c.givenHyphen,
    m: c.middleTokens[0] ?? "", mAll: c.middleTokens.join(""), mi: c.middleTokens.map((t) => t[0] ?? "").join(""),
    family: c.surnameFull, fCore, fi: fCore[0] ?? "", f2: c.surnameSecond, f2i: (c.surnameSecond[0] ?? ""),
  };
}

/** Local-part builders keyed by a stable pattern id (also the domain-learn key). */
const BUILDERS: Record<string, (p: Parts) => string> = {
  "given.family": (p) => j(p.g, ".", p.family),
  "givenfamily": (p) => j(p.g, "", p.family),
  "given_family": (p) => j(p.g, "_", p.family),
  "given-family": (p) => j(p.g, "-", p.family),
  "ginitial.family": (p) => j(p.gi, ".", p.family),
  "ginitialfamily": (p) => j(p.gi, "", p.family), // jsmith / dnguyen
  "given.finitial": (p) => j(p.g, ".", p.fi),
  "givenfinitial": (p) => j(p.g, "", p.fi), // ducn
  "given": (p) => p.g,
  "gfull.family": (p) => j(p.gFull, ".", p.family),
  "gfullfamily": (p) => j(p.gFull, "", p.family), // juancarlosgarcia
  "gfull": (p) => p.gFull, // mariagrazia / juancarlos
  "family": (p) => p.family,
  "family.given": (p) => j(p.family, ".", p.g),
  "familygiven": (p) => j(p.family, "", p.g),
  "family.gfull": (p) => j(p.family, ".", p.gFull), // chen.weiming
  "familygfull": (p) => j(p.family, "", p.gFull), // chenweiming
  "family.ginitial": (p) => j(p.family, ".", p.gi),
  "familyginitial": (p) => j(p.family, "", p.gi),
  "finitial.gfull": (p) => j(p.fi, ".", p.gFull),
  "finitialgfull": (p) => j(p.fi, "", p.gFull), // kminsu
  "finitialginit": (p) => j(p.fi, "", p.gInit), // cwm (chen wei ming)
  "given.middle.family": (p) => j3(p.g, p.m, p.family),
  "givenmiddlefamily": (p) => p.g + p.m + p.family,
  "givenmiddle.family": (p) => (p.m ? j(`${p.g}${p.m}`, ".", p.family) : ""), // kimlecelyn.bueno
  "ginitialmiddle.family": (p) => (p.m ? j(`${p.gi}${p.m}`, ".", p.family) : ""),
  "ginitialminitialfamily": (p) => p.gi + p.mi + p.family, // jmsmith
  "given.minitial.family": (p) => j3(p.g, p.mi, p.family),
  "givenfinitialminitial": (p) => p.g + p.fi + p.mi, // ducnh  ← Vietnamese
  "givenminitial": (p) => p.g + p.mi, // ducn (via middle-initial)
  "given.middle": (p) => j(p.g, ".", p.m),
  "givenmiddle": (p) => j(p.g, "", p.m),
  "givenhyphen.family": (p) => (p.givenHyphen ? j(p.givenHyphen, ".", p.family) : ""),
  // Space-separated COMPOUND given name written hyphenated in the mailbox — very
  // common for French/Belgian/Italian double first names stored as separate tokens
  // ("Jean Charles Salvin" → jean-charles.salvin / jean-charles; "Marie Claire Dupont"
  // → marie-claire.dupont). Distinct from givenHyphen (which needs the raw token to
  // ALREADY contain a hyphen); this reconstructs the hyphen from given + middle.
  "givenhyphenmiddle.family": (p) => (p.m ? j(`${p.g}-${p.mAll}`, ".", p.family) : ""), // jean-charles.salvin
  "givenhyphenmiddle": (p) => (p.m ? `${p.g}-${p.mAll}` : ""), // jean-charles
  "giniteach.family": (p) => (p.gInit.length >= 2 ? j(p.gInit, ".", p.family) : ""), // jp.martin
  "giniteachfamily": (p) => (p.gInit.length >= 2 ? p.gInit + p.family : ""), // jpmartin
  // Hispanic double-surname
  "given.fcore": (p) => j(p.g, ".", p.fCore),
  "givenfcore": (p) => j(p.g, "", p.fCore),
  "given.fcore.fsecond": (p) => (p.f2 ? j3(p.g, p.fCore, p.f2) : ""),
  "gfull.fcore": (p) => j(p.gFull, ".", p.fCore),
  "ginitial.fcore": (p) => j(p.gi, ".", p.fCore),
  "ginitialfcore": (p) => j(p.gi, "", p.fCore),
  "giniteachfcore": (p) => (p.gInit.length >= 2 ? p.gInit + p.fCore : ""), // jcgarcia
  // Arabic family-name (prefix-glued) forms reuse given.family / given.middle.

  // Short-form / leading syllable of a long compound second name — many Malay,
  // Indonesian and South-Asian people go by part of it ("Fikrizaman" → fikri).
  // Gated to long tokens; since every candidate is SMTP-verified, a wrong prefix
  // is never shown — it simply fails to confirm. These raise recall, not risk.
  "familyshort5": (p) => (p.fCore.length >= 7 ? p.fCore.slice(0, 5) : ""), // fikri
  "familyshort6": (p) => (p.fCore.length >= 8 ? p.fCore.slice(0, 6) : ""),
  "familyshort4": (p) => (p.fCore.length >= 6 ? p.fCore.slice(0, 4) : ""),
  "ginitial.familyshort5": (p) => (p.fCore.length >= 7 ? j(p.gi, ".", p.fCore.slice(0, 5)) : ""), // a.fikri
  "given.familyshort5": (p) => (p.fCore.length >= 7 ? j(p.g, ".", p.fCore.slice(0, 5)) : ""), // ahmad.fikri
  // Leading syllable of a long GIVEN name — a very common mailbox short form
  // (Rajendra → raj, Alexander → alex, Robert → rob). Length-guarded; SMTP-gated.
  "givenshort3": (p) => (p.g.length >= 5 ? p.g.slice(0, 3) : ""), // raj, rob
  "givenshort4": (p) => (p.g.length >= 6 ? p.g.slice(0, 4) : ""), // alex, raje
  "givenshort5": (p) => (p.g.length >= 7 ? p.g.slice(0, 5) : ""),
  "givenshort3.family": (p) => (p.g.length >= 5 ? j(p.g.slice(0, 3), ".", p.family) : ""), // raj.zore
  "givenshort4.family": (p) => (p.g.length >= 6 ? j(p.g.slice(0, 4), ".", p.family) : ""),
  // Initials-only — a standard corporate/executive format (Christopher Plowman → cp, c.p).
  "ginitialfinitial": (p) => (p.gi && p.fi ? `${p.gi}${p.fi}` : ""), // cp
  "ginitial.finitial": (p) => (p.gi && p.fi ? `${p.gi}.${p.fi}` : ""), // c.p
  "ginitialminitialfinitial": (p) => (p.gi && p.mi && p.fi ? `${p.gi}${p.mi}${p.fi}` : ""), // cjp
  "finitialginitial": (p) => (p.fi && p.gi ? `${p.fi}${p.gi}` : ""), // pc (reverse, CJK/last-first)
};

// Composite two-part patterns require BOTH parts. Returning the lone non-empty
// part would let e.g. "given.family" collapse to the bare given for a
// surname-less patronymic name and masquerade as the top-scored pattern.
function j(a: string, sep: string, b: string): string {
  return a && b ? `${a}${sep}${b}` : "";
}
function j3(a: string, b: string, c: string): string {
  return [a, b, c].filter(Boolean).join(".");
}

/* ============================== rankings ================================= */

type Ranked = { id: string; score: number };

// Western baseline (also the fallback for profiles without an explicit table).
const WESTERN: Ranked[] = [
  { id: "given.family", score: 100 },
  { id: "givenfamily", score: 95 },
  { id: "ginitialfamily", score: 90 },
  { id: "given", score: 82 },
  { id: "ginitial.family", score: 78 },
  { id: "given.finitial", score: 72 },
  { id: "given_family", score: 66 },
  // Compound given / middle-name formats (Kim Lecelyn Bueno → kimlecelyn.bueno).
  { id: "givenmiddle.family", score: 64 },
  { id: "givenhyphenmiddle.family", score: 63 }, // jean-charles.salvin
  { id: "givenmiddlefamily", score: 60 },
  { id: "given.middle.family", score: 59 },
  { id: "givenhyphenmiddle", score: 41 }, // jean-charles
  { id: "ginitialminitialfamily", score: 58 },
  { id: "family.given", score: 55 },
  { id: "familygiven", score: 50 },
  { id: "familyginitial", score: 45 },
  { id: "given-family", score: 40 },
];

const PROFILE_RANKINGS: Partial<Record<NamingProfile, Ranked[]>> = {
  western: WESTERN,
  african: WESTERN,
  germanic: [
    { id: "given.family", score: 100 }, { id: "givenfamily", score: 95 }, { id: "ginitialfamily", score: 90 },
    { id: "given", score: 80 }, { id: "ginitial.family", score: 76 }, { id: "family.given", score: 55 },
  ],
  french: [
    { id: "givenhyphen.family", score: 100 }, { id: "givenhyphenmiddle.family", score: 99 }, { id: "given.family", score: 98 }, { id: "givenfamily", score: 92 },
    { id: "gfull", score: 84 }, { id: "giniteachfamily", score: 80 }, { id: "given", score: 78 },
    { id: "ginitial.family", score: 74 }, { id: "given.finitial", score: 68 }, { id: "givenhyphenmiddle", score: 60 },
  ],
  italian: [
    { id: "given.family", score: 100 }, { id: "givenfamily", score: 94 }, { id: "ginitialfamily", score: 88 },
    { id: "gfull", score: 82 }, { id: "gfull.family", score: 80 }, { id: "given", score: 76 },
    { id: "givenhyphenmiddle.family", score: 75 }, { id: "ginitial.family", score: 72 }, { id: "family.given", score: 55 },
  ],
  hispanic: [
    { id: "given.fcore", score: 100 }, { id: "given.fcore.fsecond", score: 92 }, { id: "gfull.fcore", score: 88 },
    { id: "ginitialfcore", score: 84 }, { id: "giniteachfcore", score: 80 }, { id: "givenfcore", score: 76 },
    { id: "given", score: 70 }, { id: "gfull", score: 64 },
  ],
  dutch: [
    { id: "given.family", score: 100 }, { id: "givenfamily", score: 92 }, { id: "ginitialfamily", score: 88 },
    { id: "given", score: 78 }, { id: "family.given", score: 50 },
  ],
  nordic: [
    { id: "given.family", score: 100 }, { id: "givenfamily", score: 94 }, { id: "ginitialfamily", score: 90 },
    { id: "given", score: 80 }, { id: "ginitial.family", score: 74 }, { id: "family.given", score: 52 },
  ],
  slavic: [
    { id: "given.family", score: 100 }, { id: "givenfamily", score: 94 }, { id: "ginitialfamily", score: 88 },
    { id: "given", score: 80 }, { id: "ginitial.family", score: 74 }, { id: "family.given", score: 52 },
  ],
  south_asian: [
    { id: "given.family", score: 100 }, { id: "givenfamily", score: 94 }, { id: "ginitialfamily", score: 88 },
    { id: "given.middle", score: 78 }, { id: "givenmiddle", score: 74 }, { id: "given", score: 72 },
    { id: "ginitial.family", score: 68 }, { id: "givenmiddlefamily", score: 60 },
    { id: "familyshort5", score: 56 }, { id: "familyshort6", score: 50 },
  ],
  sea_malay: [
    { id: "given.family", score: 100 }, { id: "givenfamily", score: 94 },
    // Patronymic case (bin/binti → no surname): the personal compound outranks the
    // bare given, e.g. "Ahmad Hakim bin Abdullah" → ahmad.hakim, not ahmad.
    { id: "given.middle", score: 96 }, { id: "givenmiddle", score: 90 },
    { id: "given", score: 86 }, { id: "family", score: 78 },
    // Leading-syllable short forms ("Fikrizaman" → fikri / a.fikri).
    { id: "familyshort5", score: 74 }, { id: "given.familyshort5", score: 68 },
    { id: "ginitial.familyshort5", score: 64 }, { id: "familyshort6", score: 58 }, { id: "familyshort4", score: 54 },
    { id: "ginitial.family", score: 52 }, { id: "given.finitial", score: 48 },
  ],
  indonesian: [
    { id: "given.family", score: 100 }, { id: "givenfamily", score: 92 }, { id: "given", score: 86 },
    { id: "family", score: 76 }, { id: "familyshort5", score: 66 }, { id: "familyshort6", score: 58 },
    { id: "ginitialfamily", score: 54 },
  ],
  vietnamese: [
    { id: "givenfinitialminitial", score: 100 }, // ducnh
    { id: "given.family", score: 98 }, // duc.nguyen
    { id: "given", score: 92 }, // duc
    { id: "family.given", score: 85 }, // nguyen.duc
    { id: "familygiven", score: 82 }, // nguyenduc
    { id: "ginitialfamily", score: 75 }, // dnguyen
    { id: "givenfinitial", score: 72 }, // ducn
    { id: "givenmiddle", score: 66 }, // duchoai
    { id: "familygfull", score: 58 }, // nguyenhoaiduc-ish
  ],
  chinese: [
    { id: "family.given", score: 100 }, // wang.wei
    { id: "familygiven", score: 95 }, // wangwei
    { id: "family.gfull", score: 92 }, // chen.weiming
    { id: "familygfull", score: 88 }, // chenweiming
    { id: "finitialgfull", score: 82 }, // wwei
    { id: "gfull.family", score: 80 }, // yewjin.kang (full given . family — romanized/international)
    { id: "gfullfamily", score: 76 }, // yewjinkang
    { id: "given.family", score: 72 }, // wei.wang
    { id: "gfull", score: 64 }, // wei / weiming
    { id: "family", score: 56 }, // wang
    { id: "finitialginit", score: 48 }, // cwm
  ],
  korean: [
    { id: "family.gfull", score: 100 }, // kim.minsu
    { id: "familygfull", score: 95 }, // kimminsu
    { id: "gfull.family", score: 88 }, // minsu.kim (full given . family)
    { id: "gfullfamily", score: 84 }, // minsukim
    { id: "finitialgfull", score: 80 }, // kminsu
    { id: "given.family", score: 72 }, // minsu.kim (given[0])
    { id: "gfull", score: 64 }, // minsu
    { id: "family", score: 54 },
  ],
  japanese: [
    { id: "given.family", score: 100 }, // taro.yamada (international default)
    { id: "givenfamily", score: 94 }, // taroyamada
    { id: "ginitialfamily", score: 88 }, // tyamada
    { id: "family.given", score: 80 }, // yamada.taro
    { id: "familygiven", score: 72 }, // yamadataro
    { id: "given", score: 64 },
  ],
  arabic: [
    { id: "given.middle", score: 100 }, // mohammed.ahmed
    { id: "given.family", score: 96 }, // mohammed.alhassan
    { id: "givenmiddle", score: 88 }, // mohammedahmed
    { id: "givenfamily", score: 84 }, // mohammedalhassan
    { id: "ginitialfamily", score: 78 }, // malhassan
    { id: "given", score: 70 },
    { id: "given.middle.family", score: 60 },
  ],
};

// Short-form leading-syllable candidates appended to EVERY profile except those
// whose given names are already short and family-first (CJK / Vietnamese). Low
// scores: tried after the primary patterns, still SMTP-verified by the caller so
// a wrong prefix is never shown. Dedup keeps a higher score if a profile ranking
// already lists the same id (e.g. sea_malay's familyshort5 at 74).
const SHORT_FORM_IDS: Ranked[] = [
  { id: "givenshort3", score: 46 }, // raj, rob, dan
  { id: "givenshort4", score: 44 }, // alex, raje
  { id: "givenshort3.family", score: 42 }, // raj.zore
  { id: "familyshort5", score: 40 }, // fikri
  { id: "givenshort4.family", score: 38 },
  { id: "givenshort5", score: 36 },
  { id: "familyshort6", score: 34 },
  { id: "ginitial.familyshort5", score: 32 },
  { id: "given.familyshort5", score: 30 },
];
const NO_SHORT_FORMS = new Set<NamingProfile>(["chinese", "korean", "japanese", "vietnamese"]);

// Initials-only candidates, appended to EVERY profile. Ranked ABOVE the fuzzy
// short-form truncations (a standard format) but BELOW every full-name pattern —
// so a distinctive full address is always tried first, and 2-letter initials
// (collision-prone: cp could be another CP) are only used when no full-name
// address is deliverable. Still SMTP-verified, so nothing unconfirmed shows.
const INITIALS_IDS: Ranked[] = [
  { id: "ginitialfinitial", score: 52 }, // cp
  { id: "ginitial.finitial", score: 50 }, // c.p
  { id: "finitialginitial", score: 40 }, // pc
  { id: "ginitialminitialfinitial", score: 38 }, // cjp
];

/* ============================== generator =============================== */

export interface GlobalCandidate {
  local: string;
  patternId: string;
  score: number; // 0..100 (learned-pattern hit is pinned above everything)
  email: string; // "" when no domain supplied
}

/** Collapse stray/duplicate separators a builder may leave. */
function tidyLocal(local: string): string {
  return local.replace(/[._-]{2,}/g, (mt) => mt[0]).replace(/^[._-]+|[._-]+$/g, "");
}

/**
 * Generate ranked, de-duplicated email candidates for a person, culture-aware.
 * Pass `learnedPatternId` (a builder id proven `valid` on this domain) to pin the
 * matching candidate to the top — the domain-learning override.
 */
export function generateGlobalCandidates(
  rawName: string,
  opts: { country?: string | null; profile?: NamingProfile; domain?: string | null; learnedPatternId?: string | null; limit?: number } = {},
): GlobalCandidate[] {
  const profile = opts.profile ?? detectProfile(opts.country, rawName);
  const comp = parseName(rawName, profile);
  const p = parts(comp);
  // Use the EFFECTIVE profile: parseName may re-route (e.g. a Chinese-Malaysian
  // name under a sea_malay country resolves to the Chinese parser AND ranking, so
  // "Tan Wei Ming" → tan.weiming, not the Western-order wei.tan).
  const ranking = PROFILE_RANKINGS[comp.profile] ?? PROFILE_RANKINGS[profile] ?? WESTERN;
  // Append initials-only (all profiles) + leading-syllable short forms (given +
  // family), the latter unless the naming system already uses short given names
  // (CJK / Vietnamese). Initials outrank the fuzzy short forms but sit below every
  // full-name pattern.
  const rules = NO_SHORT_FORMS.has(comp.profile)
    ? [...ranking, ...INITIALS_IDS]
    : [...ranking, ...INITIALS_IDS, ...SHORT_FORM_IDS];
  const dom = (opts.domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

  const seen = new Map<string, GlobalCandidate>();
  for (const { id, score } of rules) {
    const build = BUILDERS[id];
    if (!build) continue;
    const local = tidyLocal(build(p));
    if (!local || local.length < 2) continue;
    const boosted = opts.learnedPatternId && opts.learnedPatternId === id ? score + 1000 : score;
    const prev = seen.get(local);
    if (!prev || boosted > prev.score) {
      seen.set(local, { local, patternId: id, score: boosted, email: dom ? `${local}@${dom}` : "" });
    }
  }
  const out = [...seen.values()].sort((a, b) => b.score - a.score);
  return typeof opts.limit === "number" ? out.slice(0, opts.limit) : out;
}

/* ------------------------- per-domain pattern learning ------------------- */

interface LearnedPattern { patternId: string; at: number }
const LEARN_TTL_MS = Number(process.env.GLOBAL_PATTERN_TTL_MS ?? 7 * 24 * 3600 * 1000);
declare global {
  // eslint-disable-next-line no-var
  var __globalPatternCache: Map<string, LearnedPattern> | undefined;
}
function learnCache(): Map<string, LearnedPattern> {
  if (!globalThis.__globalPatternCache) globalThis.__globalPatternCache = new Map();
  return globalThis.__globalPatternCache;
}
/** Remember the builder id that produced a confirmed mailbox at a domain. */
export function learnGlobalPattern(domain: string, patternId: string): void {
  const d = domain.trim().toLowerCase();
  if (d && patternId) learnCache().set(d, { patternId, at: Date.now() });
}
/** The learned builder id for a domain, if still fresh. */
export function learnedGlobalPattern(domain: string): string | null {
  const f = learnCache().get(domain.trim().toLowerCase());
  if (!f) return null;
  if (Date.now() - f.at > LEARN_TTL_MS) { learnCache().delete(domain.trim().toLowerCase()); return null; }
  return f.patternId;
}
/** Clear the learned-pattern cache (used by the purge/cache-invalidate route). */
export function clearGlobalPatternCache(): number {
  const n = learnCache().size;
  learnCache().clear();
  return n;
}

/**
 * Split a full name into a Western first/last for the pattern finder (Layer 1).
 * Returns null for a single-token name (caller keeps its own first/last).
 */
export function splitFirstLast(name: string): { first: string; last: string } | null {
  const toks = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (toks.length < 2) return null;
  return { first: toks[0], last: toks[toks.length - 1] };
}

/**
 * Merge externally-proposed local-parts (e.g. from the Layer-5 LLM) with the full
 * deterministic culture-aware generator output for `name`, de-duplicated, primary
 * (LLM) first. Lets a domain the LLM discovered still get Layer-4's whole breadth.
 */
export function mergeLocals(primary: string[], name: string, opts: { country?: string | null; limit?: number } = {}): string[] {
  const limit = opts.limit ?? 14;
  const gen = generateGlobalCandidates(name, { country: opts.country, limit }).map((c) => c.local);
  return [...new Set([...(primary ?? []), ...gen])].slice(0, limit);
}

/** @internal — tooling / self-tests */
export const _globalNames = { detectProfile, parseName, parts, BUILDERS, PROFILE_RANKINGS };
