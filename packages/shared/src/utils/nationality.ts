/**
 * Nationality normalization for the forum's profile-flag alt-text strings.
 *
 * The forum surfaces nationality as an `<img class="flag_image" alt="India">`
 * tag. The alt text is human-typed by the forum admin and is inconsistent —
 * "India", "INDIA", "Hong Kong (Special Administrative Region of China)",
 * "United Kingdom", etc. We normalize to ISO-3166 alpha-2 codes so the
 * estimator can group by nationality reliably.
 *
 * Notes:
 * - The ILR product cares about nationalities applying to the UK, so the list
 *   is biased toward source-country populations (Indian, Pakistani, Nigerian,
 *   Hong Konger, Filipino, etc.) rather than every UN member state.
 * - Unknown alt strings return `undefined`; the caller keeps the raw alt
 *   so we can still group by free-text fallback if useful.
 */

interface NationalityEntry {
  /** ISO-3166 alpha-2 code, e.g. "IN", "GB", "HK". */
  code: string;
  /** Canonical display name, e.g. "India". */
  name: string;
  /** All known forum-alt strings (lowercased) that resolve to this entry. */
  aliases: string[];
}

// The list intentionally favors recall over exhaustive coverage — we want
// every common ILR-applicant nationality to map cleanly. Add as you discover
// new alt-text variants in the wild.
const NATIONALITIES: NationalityEntry[] = [
  // ----- South Asia -----
  { code: 'IN', name: 'India', aliases: ['india', 'indian'] },
  { code: 'PK', name: 'Pakistan', aliases: ['pakistan', 'pakistani'] },
  { code: 'BD', name: 'Bangladesh', aliases: ['bangladesh', 'bangladeshi'] },
  { code: 'LK', name: 'Sri Lanka', aliases: ['sri lanka', 'sri lankan', 'srilanka'] },
  { code: 'NP', name: 'Nepal', aliases: ['nepal', 'nepalese'] },

  // ----- East Asia -----
  { code: 'CN', name: 'China', aliases: ['china', 'chinese', "people's republic of china", 'prc'] },
  {
    code: 'HK',
    name: 'Hong Kong',
    aliases: [
      'hong kong',
      'hk',
      'hong kong (special administrative region of china)',
      'hong kong sar',
      'hong kong sar of china',
    ],
  },
  { code: 'TW', name: 'Taiwan', aliases: ['taiwan', 'taiwanese', 'roc'] },
  { code: 'JP', name: 'Japan', aliases: ['japan', 'japanese'] },
  { code: 'KR', name: 'South Korea', aliases: ['south korea', 'korea, south', 'korea republic of', 'korean'] },

  // ----- Southeast Asia -----
  { code: 'PH', name: 'Philippines', aliases: ['philippines', 'filipino', 'phillipines'] },
  { code: 'VN', name: 'Vietnam', aliases: ['vietnam', 'viet nam', 'vietnamese'] },
  { code: 'TH', name: 'Thailand', aliases: ['thailand', 'thai'] },
  { code: 'MY', name: 'Malaysia', aliases: ['malaysia', 'malaysian'] },
  { code: 'SG', name: 'Singapore', aliases: ['singapore', 'singaporean'] },
  { code: 'ID', name: 'Indonesia', aliases: ['indonesia', 'indonesian'] },

  // ----- Africa -----
  { code: 'NG', name: 'Nigeria', aliases: ['nigeria', 'nigerian'] },
  { code: 'GH', name: 'Ghana', aliases: ['ghana', 'ghanaian'] },
  { code: 'KE', name: 'Kenya', aliases: ['kenya', 'kenyan'] },
  { code: 'ZA', name: 'South Africa', aliases: ['south africa', 'south african'] },
  { code: 'EG', name: 'Egypt', aliases: ['egypt', 'egyptian'] },
  { code: 'ZW', name: 'Zimbabwe', aliases: ['zimbabwe', 'zimbabwean'] },
  { code: 'UG', name: 'Uganda', aliases: ['uganda', 'ugandan'] },

  // ----- Middle East -----
  { code: 'AE', name: 'United Arab Emirates', aliases: ['united arab emirates', 'uae', 'emirati'] },
  { code: 'SA', name: 'Saudi Arabia', aliases: ['saudi arabia', 'saudi', 'saudi arabian'] },
  { code: 'IR', name: 'Iran', aliases: ['iran', 'iranian'] },
  { code: 'IQ', name: 'Iraq', aliases: ['iraq', 'iraqi'] },
  { code: 'SY', name: 'Syria', aliases: ['syria', 'syrian', 'syrian arab republic'] },
  { code: 'TR', name: 'Turkey', aliases: ['turkey', 'turkish', 'türkiye', 'turkiye'] },
  { code: 'IL', name: 'Israel', aliases: ['israel', 'israeli'] },
  { code: 'JO', name: 'Jordan', aliases: ['jordan', 'jordanian'] },
  { code: 'LB', name: 'Lebanon', aliases: ['lebanon', 'lebanese'] },

  // ----- Europe (non-UK) -----
  { code: 'IT', name: 'Italy', aliases: ['italy', 'italian'] },
  { code: 'FR', name: 'France', aliases: ['france', 'french'] },
  { code: 'DE', name: 'Germany', aliases: ['germany', 'german', 'deutschland'] },
  { code: 'ES', name: 'Spain', aliases: ['spain', 'spanish'] },
  { code: 'PT', name: 'Portugal', aliases: ['portugal', 'portuguese'] },
  { code: 'PL', name: 'Poland', aliases: ['poland', 'polish'] },
  { code: 'RO', name: 'Romania', aliases: ['romania', 'romanian'] },
  { code: 'BG', name: 'Bulgaria', aliases: ['bulgaria', 'bulgarian'] },
  { code: 'GR', name: 'Greece', aliases: ['greece', 'greek'] },
  { code: 'NL', name: 'Netherlands', aliases: ['netherlands', 'dutch', 'holland'] },
  { code: 'BE', name: 'Belgium', aliases: ['belgium', 'belgian'] },
  { code: 'IE', name: 'Ireland', aliases: ['ireland', 'irish'] },
  { code: 'CH', name: 'Switzerland', aliases: ['switzerland', 'swiss'] },
  { code: 'AT', name: 'Austria', aliases: ['austria', 'austrian'] },
  { code: 'SE', name: 'Sweden', aliases: ['sweden', 'swedish'] },
  { code: 'NO', name: 'Norway', aliases: ['norway', 'norwegian'] },
  { code: 'FI', name: 'Finland', aliases: ['finland', 'finnish'] },
  { code: 'DK', name: 'Denmark', aliases: ['denmark', 'danish'] },
  { code: 'CZ', name: 'Czech Republic', aliases: ['czech republic', 'czechia', 'czech'] },
  { code: 'HU', name: 'Hungary', aliases: ['hungary', 'hungarian'] },
  { code: 'SK', name: 'Slovakia', aliases: ['slovakia', 'slovak'] },
  { code: 'HR', name: 'Croatia', aliases: ['croatia', 'croatian'] },
  { code: 'LT', name: 'Lithuania', aliases: ['lithuania', 'lithuanian'] },
  { code: 'LV', name: 'Latvia', aliases: ['latvia', 'latvian'] },
  { code: 'EE', name: 'Estonia', aliases: ['estonia', 'estonian'] },

  // ----- Russia / CIS -----
  { code: 'RU', name: 'Russia', aliases: ['russia', 'russian', 'russian federation'] },
  { code: 'UA', name: 'Ukraine', aliases: ['ukraine', 'ukrainian'] },
  { code: 'BY', name: 'Belarus', aliases: ['belarus', 'belarusian'] },

  // ----- Americas -----
  { code: 'US', name: 'United States', aliases: ['united states', 'usa', 'us', 'america', 'american'] },
  { code: 'CA', name: 'Canada', aliases: ['canada', 'canadian'] },
  { code: 'BR', name: 'Brazil', aliases: ['brazil', 'brazilian'] },
  { code: 'AR', name: 'Argentina', aliases: ['argentina', 'argentinian', 'argentine'] },
  { code: 'MX', name: 'Mexico', aliases: ['mexico', 'mexican'] },
  { code: 'CO', name: 'Colombia', aliases: ['colombia', 'colombian'] },
  { code: 'CL', name: 'Chile', aliases: ['chile', 'chilean'] },
  { code: 'PE', name: 'Peru', aliases: ['peru', 'peruvian'] },
  { code: 'VE', name: 'Venezuela', aliases: ['venezuela', 'venezuelan'] },

  // ----- Oceania -----
  { code: 'AU', name: 'Australia', aliases: ['australia', 'australian'] },
  { code: 'NZ', name: 'New Zealand', aliases: ['new zealand', 'new zealander'] },

  // ----- UK (rare in this dataset, but included for completeness) -----
  {
    code: 'GB',
    name: 'United Kingdom',
    aliases: ['united kingdom', 'uk', 'great britain', 'britain', 'british', 'england', 'scotland', 'wales', 'northern ireland'],
  },
];

// Build a fast lookup map at module load.
const ALIAS_MAP = new Map<string, NationalityEntry>();
for (const entry of NATIONALITIES) {
  for (const alias of entry.aliases) {
    ALIAS_MAP.set(alias, entry);
  }
}

/**
 * Normalize a forum nationality string (typically the `alt` of a flag image)
 * to an ISO-3166 alpha-2 code. Returns `undefined` if no match.
 *
 * The match is case-insensitive and trims whitespace. It strips trailing
 * punctuation and extra parenthetical noise like "(Special Administrative
 * Region of China)".
 */
export function normalizeNationality(raw: string | null | undefined): { code: string; name: string } | undefined {
  if (!raw) return undefined;

  const cleaned = raw
    .trim()
    .toLowerCase()
    // Strip trailing punctuation
    .replace(/[.,;]+$/g, '')
    .trim();

  if (!cleaned) return undefined;

  // 1. Direct hit
  const direct = ALIAS_MAP.get(cleaned);
  if (direct) return { code: direct.code, name: direct.name };

  // 2. Try with parenthetical content removed: "Hong Kong (SAR)" → "Hong Kong"
  const withoutParens = cleaned.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  if (withoutParens && withoutParens !== cleaned) {
    const stripped = ALIAS_MAP.get(withoutParens);
    if (stripped) return { code: stripped.code, name: stripped.name };
  }

  // 3. Try treating the FIRST whitespace-separated token as the alias
  // (helps with strings like "Hong Kong (Special Administrative Region of China)" → "Hong Kong"
  //  when the parenthetical strip didn't already match).
  for (const entry of NATIONALITIES) {
    for (const alias of entry.aliases) {
      // Match alias as a complete token at the start of the string, followed by a non-letter or end.
      // Avoids substring false-positives like "indian" matching "Indian Ocean".
      const re = new RegExp(`^${escapeRegex(alias)}(\\b|$)`, 'i');
      if (re.test(cleaned) || re.test(withoutParens)) {
        return { code: entry.code, name: entry.name };
      }
    }
  }

  return undefined;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reverse-lookup: ISO-3166 alpha-2 code → canonical display name.
 * Returns the input unchanged if the code isn't in our list, so callers
 * can use it as a safe fallback for arbitrary 2-letter strings.
 */
const CODE_TO_NAME = new Map(NATIONALITIES.map((n) => [n.code, n.name]));

export function getCountryName(code: string | null | undefined): string | undefined {
  if (!code) return undefined;
  return CODE_TO_NAME.get(code.toUpperCase());
}
