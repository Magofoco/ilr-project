import type { ExtractionResult, ExtractedEvent, ServiceTier } from '@ilr/shared';
import { normalizeNationality } from '@ilr/shared';

/**
 * Extractor version — bump this whenever the extraction logic changes
 * meaningfully. The runner stamps the version on each extracted case so we
 * can later re-extract older posts when this improves.
 *
 * 1.0 — initial release (regex-based, flat snapshot)
 * 1.2 — minor pattern improvements
 * 1.3 — first-class serviceTier; BN(O)/Skilled Worker/GTV/Tier 1;
 *       biometrics city in parens; docs_requested / docs_submitted milestones;
 *       UTC date parsing; ISO-3166 nationality codes; emit ExtractedEvent[].
 */
export const EXTRACTOR_VERSION = '1.6';

/**
 * Extract ILR case data from a forum post.
 *
 * Designed primarily against immigrationboards.com posts which loosely follow:
 *
 *   Applied for ILR Route : Set (0) (Skilled Worker)
 *   Date application sent : 4 Feb 2026
 *   Application Type : Priority (5 days)
 *   Biometrics Date: 5 Feb 2026 (Wandsworth)
 *   Acknowledgement email from UKVI: 5 Feb 2026
 *   Extra Documents requested on 04/03/2026
 *   follow up email sent 10/03/2026
 *   Approval email: 6 Feb 2026
 *   E-visa Status changed to Settled
 *
 * but every applicant types it slightly differently, so we use multiple
 * regex passes and accumulate confidence per match.
 */
export function extractCaseData(content: string, authorNationality?: string): ExtractionResult {
  const result: ExtractionResult = {
    confidence: 0,
    events: [],
  };

  const notes: string[] = [];
  const events: ExtractedEvent[] = [];

  // We score per category; each successful field has its own weight.
  // Final confidence = clamp(score / maxScore, 0, 1).
  let score = 0;
  const maxScore = 12;

  // ============ ROUTE / TYPE ============
  const route = extractRoute(content);
  if (route) {
    result.applicationRoute = route.route;
    result.applicationType = route.type;
    score += 2;
  } else if (/\b(ilr|indefinite\s+leave\s+to\s+remain)\b/i.test(content)) {
    result.applicationType = 'ILR';
    score += 0.5;
  } else if (/\b(flr|further\s+leave)\b/i.test(content)) {
    result.applicationType = 'FLR';
    score += 0.5;
  } else if (/\bnaturali[sz]ation\b/i.test(content)) {
    result.applicationType = 'Naturalization';
    score += 0.5;
  }

  // ============ SERVICE TIER ============
  const serviceTier = extractServiceTier(content);
  if (serviceTier) {
    result.serviceTier = serviceTier;
    score += 1;
  }

  // ============ DATES ============
  const applicationDate = extractDateField(content, APPLICATION_PATTERNS);
  if (applicationDate) {
    result.applicationDate = applicationDate;
    events.push({ type: 'applied', date: applicationDate, confidence: 0.95 });
    score += 1.5;
  }

  const biometricsResult = extractBiometricsDateAndLocation(content);
  if (biometricsResult.date) {
    result.biometricsDate = biometricsResult.date;
    events.push({ type: 'biometrics', date: biometricsResult.date, confidence: 0.9 });
    score += 1;
  }
  if (biometricsResult.location) {
    result.biometricsLocation = biometricsResult.location;
    score += 0.5;
  }

  const acknowledgementDate = extractDateField(content, ACKNOWLEDGEMENT_PATTERNS);
  if (acknowledgementDate) {
    events.push({ type: 'acknowledgement', date: acknowledgementDate, confidence: 0.85 });
    score += 0.25;
  }

  const docsRequestedDate = extractDateField(content, DOCS_REQUESTED_PATTERNS);
  if (docsRequestedDate) {
    result.docsRequestedDate = docsRequestedDate;
    events.push({ type: 'docs_requested', date: docsRequestedDate, confidence: 0.85 });
    score += 0.5;
  }

  const docsSubmittedDate = extractDateField(content, DOCS_SUBMITTED_PATTERNS);
  if (docsSubmittedDate) {
    result.docsSubmittedDate = docsSubmittedDate;
    events.push({ type: 'docs_submitted', date: docsSubmittedDate, confidence: 0.8 });
    score += 0.25;
  }

  const decisionDate = extractDateField(content, DECISION_PATTERNS);
  if (decisionDate) {
    result.decisionDate = decisionDate;
    events.push({ type: 'decision', date: decisionDate, confidence: 0.95 });
    score += 1.5;
  }

  // ============ WAITING DAYS (derived) ============
  if (result.applicationDate && result.decisionDate) {
    const diffMs = result.decisionDate.getTime() - result.applicationDate.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays > 0 && diffDays < 1000) {
      result.waitingDays = diffDays;
      score += 1.5;
    } else {
      notes.push('Computed waiting days outside reasonable range; ignoring.');
    }
  }

  // ============ OUTCOME ============
  result.outcome = inferOutcome(content, !!result.decisionDate);
  if (result.outcome === 'approved' || result.outcome === 'rejected') score += 1;
  else if (result.outcome === 'pending') score += 0.25;

  // isPending denormalized: true if outcome is pending OR we have an application
  // date but no decision date yet.
  result.isPending =
    result.outcome === 'pending' ||
    (!!result.applicationDate && !result.decisionDate);

  // ============ NATIONALITY ============
  if (authorNationality) {
    result.applicantNationality = authorNationality;
    const normalized = normalizeNationality(authorNationality);
    if (normalized) {
      result.applicantNationalityCode = normalized.code;
      score += 0.5;
    } else {
      notes.push(`Unrecognized nationality: "${authorNationality}"`);
    }
  }

  // ============ FINALIZE ============
  // Sort events chronologically and dedupe by (type, date).
  result.events = dedupeAndSortEvents(events);

  result.confidence = Math.min(score / maxScore, 1);

  if (result.confidence > 0 && result.confidence < 0.4) {
    notes.push('Low confidence extraction — manual review recommended');
  }

  if (notes.length > 0) {
    result.extractionNotes = notes.join('; ');
  }

  return result;
}

// ============================================================================
// ROUTE EXTRACTION
// ============================================================================

interface RouteMatch {
  route: string;
  type: string;
}

function extractRoute(content: string): RouteMatch | undefined {
  // First try the explicit "Applied for ILR Route : ..." line and look at
  // the values in parens / after the SET label, since that's where the
  // sub-route hides (e.g. "Set (O) (Skilled Worker)").
  const fieldMatch = content.match(/applied\s+for\s+ilr\s+route\s*[:\-]?\s*([^\n\r]+)/i);
  const fieldValue = fieldMatch?.[1] ?? '';
  const haystack = (fieldValue + ' ' + content).toLowerCase();

  // Sub-route detection (more specific first).
  if (/\bbn\s*\(?o\)?|british\s+national\s*\(\s*overseas\s*\)/i.test(haystack)) {
    return { route: 'BN(O)', type: 'ILR' };
  }
  if (/\bglobal\s+talent|\bgtv\b/i.test(haystack)) {
    return { route: 'Global Talent', type: 'ILR' };
  }
  if (/\bskilled\s+worker\b/i.test(haystack)) {
    return { route: 'Skilled Worker', type: 'ILR' };
  }
  if (/\btier\s*1\s+entrepreneur/i.test(haystack)) {
    return { route: 'Tier 1 Entrepreneur', type: 'ILR' };
  }
  if (/\btier\s*2\b/i.test(haystack)) {
    return { route: 'Tier 2', type: 'ILR' };
  }
  if (/\bset\s*\(?\s*m\s*\)?|british\s+spouse|spouse\s+of\s+a?\s*british/i.test(haystack)) {
    return { route: 'SET(M)', type: 'ILR' };
  }
  if (/\bset\s*\(?\s*f\s*\)?/i.test(haystack)) {
    return { route: 'SET(F)', type: 'ILR' };
  }
  // 10-year long residence is more specific than the generic SET(O) form,
  // so it wins when the post mentions both (e.g. "Set(O) - 10 year route").
  if (/\b10[\s\-]?year|long.?residence|2\s*x\s*3|\bdlr\b/i.test(haystack)) {
    return { route: '10-year', type: 'ILR' };
  }
  if (/\bset\s*\(?\s*[o0]\s*\)?/i.test(haystack)) {
    // SET(O) is a catch-all for work routes; we already checked for sub-routes
    // above (Skilled Worker, GTV, 10-year, etc.) so anything reaching here is generic.
    return { route: 'SET(O)', type: 'ILR' };
  }
  if (/\b(dependent|dependant)\b/i.test(haystack)) {
    return { route: 'Dependant', type: 'ILR' };
  }

  return undefined;
}

// ============================================================================
// SERVICE TIER EXTRACTION
// ============================================================================

function extractServiceTier(content: string): ServiceTier | undefined {
  // Try the explicit field first — most reliable.
  const field = content.match(/application\s+type\s*[:\-]?\s*([^\n\r]+)/i)?.[1];
  if (field) {
    const tier = matchServiceTierString(field);
    if (tier) return tier;
  }

  // Fallback: search whole content.
  return matchServiceTierString(content);
}

function matchServiceTierString(s: string): ServiceTier | undefined {
  const lower = s.toLowerCase();

  // Order matters: super-priority must come before priority.
  if (/\bsuper[\s\-]*priority\b/.test(lower)) return 'super_priority';
  if (/\b(priority|5[\s\-]?day)\b/.test(lower)) return 'priority';
  if (/\bstandard\b/.test(lower)) return 'standard';

  return undefined;
}

// ============================================================================
// DATE FIELD EXTRACTION
// ============================================================================

// Matches numeric (DD/MM/YYYY etc.) and textual ("3 March 2026", "March 3, 2026") dates.
// Captured group is the whole date substring.
const DATE_REGEX_FRAGMENT =
  String.raw`(\d{1,2}\s+\w+\s+\d{2,4}|\w+\s+\d{1,2},?\s+\d{4}|\d{1,2}[\s\/\-\.]+\d{1,2}[\s\/\-\.]+\d{2,4})`;

function buildPatterns(prefixes: string[]): RegExp[] {
  return prefixes.map(
    (prefix) => new RegExp(prefix + String.raw`\s*[:\-]?\s*` + DATE_REGEX_FRAGMENT, 'i')
  );
}

const APPLICATION_PATTERNS = buildPatterns([
  String.raw`(?:date\s+)?application\s+sent`,
  String.raw`application\s+submitted\s+online`,
  String.raw`application\s+date`,
  String.raw`(?:date\s+)?applied`,
  String.raw`submitted(?:\s+on)?`,
]);

const ACKNOWLEDGEMENT_PATTERNS = buildPatterns([
  String.raw`acknowledgement\s+email(?:\s+from\s+ukvi)?`,
  String.raw`(?:application\s+)?receipt\s+confirmation\s+email`,
  String.raw`biometrics?\s+confirmation\s+email`,
]);

const DOCS_REQUESTED_PATTERNS = buildPatterns([
  String.raw`extra\s+documents?\s+requested(?:\s+on)?`,
  String.raw`additional\s+documents?\s+requested(?:\s+on)?`,
  String.raw`(?:more\s+)?documents?\s+requested(?:\s+on)?`,
  String.raw`ho\s+exceptional\s+circumstances\s+email(?:\s+on)?`,
  String.raw`further\s+information\s+request(?:ed)?(?:\s+on)?`,
]);

const DOCS_SUBMITTED_PATTERNS = buildPatterns([
  String.raw`follow\s+up\s+email\s+sent`,
  String.raw`additional\s+documents?\s+(?:submitted|sent|provided)(?:\s+on)?`,
  String.raw`extra\s+documents?\s+(?:submitted|sent|provided)(?:\s+on)?`,
  String.raw`response\s+sent(?:\s+on)?`,
]);

// Decision is the trickiest because the forum has many phrasings.
// Strict order: a single "approved" / "BRP received" line is enough.
const DECISION_PATTERNS = buildPatterns([
  String.raw`approval\s+(?:email|received|date)`,
  String.raw`approval[\/\s]+refusal\s+received`,
  String.raw`(?:refusal|refused|rejected|denied)\s+(?:email|received|date|on)?`,
  String.raw`decision\s+(?:received|date|email|made|on)`,
  String.raw`brp\s+(?:card\s+)?received`,
  String.raw`e-?visa\s+(?:status\s+)?(?:changed|updated)\s+to\s+settled\s+on`,
]);

function extractDateField(content: string, patterns: RegExp[]): Date | undefined {
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match?.[1]) {
      const parsed = parseFlexibleDate(match[1]);
      if (parsed) return parsed;
    }
  }
  return undefined;
}

// ============================================================================
// BIOMETRICS (date + city in parens)
// ============================================================================

interface BiometricsResult {
  date?: Date;
  location?: string;
}

function extractBiometricsDateAndLocation(content: string): BiometricsResult {
  // Look for the biometrics line first to capture optional location in parens.
  // Examples seen in the wild:
  //   Biometrics appointment: 3 March 2026 (Nottingham) - Free Appointment
  //   Biometrics Date: 5 Feb 2026 (Anytime walk in appointment - £175 fees paid)
  //   Biometrics Confirmation Email:5 Feb 2026
  //   Date Biometrics Enrolled :20/01/2017
  //
  // The "Confirmation Email" line is acknowledgement, not the appointment, so
  // we deliberately exclude it here — it's caught separately in
  // ACKNOWLEDGEMENT_PATTERNS.
  //
  // Note on the trailing "lenient" pattern: it allows up to 60 chars of
  // arbitrary content between the `biometrics` keyword and the date — needed
  // for natural-language phrasings like "Biometrics in Croydon on 30/8". The
  // `[^.\n]` guard prevents it from greedily crossing sentence boundaries.
  const linePatterns = [
    new RegExp(
      String.raw`biometrics?\s+appointment\s*[:\-]?\s*` +
        DATE_REGEX_FRAGMENT +
        String.raw`(?:\s*\(([^)]+)\))?`,
      'i'
    ),
    new RegExp(
      String.raw`biometrics?\s+(?:date|enrolled|done|completed)\s*[:\-]?\s*` +
        DATE_REGEX_FRAGMENT +
        String.raw`(?:\s*\(([^)]+)\))?`,
      'i'
    ),
    new RegExp(
      String.raw`bio(?:metrics?)?\s+letter\s+received\s*[:\-]?\s*` + DATE_REGEX_FRAGMENT,
      'i'
    ),
    new RegExp(
      String.raw`(?:date\s+)?biometrics?\s*[:\-]?\s*` +
        DATE_REGEX_FRAGMENT +
        String.raw`(?:\s*\(([^)]+)\))?`,
      'i'
    ),
    // Lenient fallback: allow free-text between "biometrics" and the date, but
    // never across a period or newline. Only used to capture an in-line city
    // via the whitelist below — `cleanBiometricsLocation` is never called on
    // match[2] here, so the loose phrasing can't pollute the field.
    new RegExp(
      String.raw`biometrics?[^.\n]{0,60}?` + DATE_REGEX_FRAGMENT,
      'i'
    ),
  ];

  for (const pattern of linePatterns) {
    const match = content.match(pattern);
    if (match?.[1]) {
      const parsed = parseFlexibleDate(match[1]);
      if (parsed) {
        let location = match[2] ? cleanBiometricsLocation(match[2]) : undefined;
        // Whitelist fallback: if the parens didn't carry a clean city, scan
        // the matched substring (NOT the whole post — keeps false positives
        // bounded) for any known UK biometrics centre city.
        if (!location) location = findKnownUkBiometricsCity(match[0]);
        return { date: parsed, location };
      }
    }
  }

  return {};
}

/**
 * Curated whitelist of UK biometrics-centre cities used by Sopra Steria
 * (UKVCAS) and TLS. Order matters: longer / more specific entries first so
 * "Newcastle Upon Tyne" wins over "Newcastle", "Mark Lane" beats "Mark", etc.
 *
 * Deliberately omitted: ambiguous short tokens that double as common English
 * words ("Bath", "Stoke" on its own, "Hull" — too risky in a free-text scan).
 */
const UK_BIOMETRICS_CITIES: string[] = [
  // Compound names first
  'Newcastle Upon Tyne',
  'Stoke-on-Trent',
  'Milton Keynes',
  'London Mark Lane',
  'London Gee Street',
  'Mark Lane',
  'Gee Street',
  // Core (free) UKVCAS centres
  'Croydon',
  'Manchester',
  'Birmingham',
  'Cardiff',
  'Glasgow',
  'Belfast',
  // Enhanced / premium centres + commonly-cited cities
  'Wandsworth',
  'Stratford',
  'Wembley',
  'Hounslow',
  'Liverpool',
  'Sheffield',
  'Leeds',
  'Nottingham',
  'Bristol',
  'Reading',
  'Cambridge',
  'Oxford',
  'Edinburgh',
  'Aberdeen',
  'Dundee',
  'Brighton',
  'Norwich',
  'Northampton',
  'Solihull',
  'Coventry',
  'Southampton',
  'Plymouth',
  'Exeter',
  'Peterborough',
  'Guildford',
  'Sunderland',
  'Middlesbrough',
  'Doncaster',
  'Bradford',
  'Bolton',
  'Preston',
  'Carlisle',
  'Chester',
  'Worcester',
  'Wolverhampton',
  'Derby',
  'Leicester',
  'Luton',
  'Slough',
  'Watford',
  'Romford',
  'Enfield',
  'Swansea',
  'Newcastle',
  // Generic "London" last — Mark Lane / Gee Street already took precedence
  'London',
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findKnownUkBiometricsCity(text: string): string | undefined {
  for (const city of UK_BIOMETRICS_CITIES) {
    const re = new RegExp(`\\b${escapeRegExp(city)}\\b`, 'i');
    if (re.test(text)) return city;
  }
  return undefined;
}

/**
 * The parens after a biometrics line frequently contain a city name, but
 * sometimes they contain a whole sentence describing the appointment
 * ("Anytime walk in - £175 fees paid", "In-person biometrics at UKVCAS
 * service point", "Opted out of app, submitted biometrics in Croydon").
 *
 * We deliberately bias toward false negatives — better to leave the field
 * null than to pollute the cohort with sentence fragments masquerading as
 * cities. Returns undefined on anything that doesn't look like a clean
 * place-name token of 1-3 words.
 */
function cleanBiometricsLocation(raw: string): string | undefined {
  const trimmed = raw.trim();

  if (trimmed.length < 2 || trimmed.length > 40) return undefined;

  // Reject content that contains digits, currency, slashes, commas — these
  // never appear in a UK place name and almost always signal a sentence.
  if (/[£$€\d,/]/.test(trimmed)) return undefined;

  // Reject if more than 3 words: real UK locations are short ("Croydon",
  // "Mark Lane", "Cardiff City Centre"). Anything longer is a sentence.
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount > 3) return undefined;

  // Reject jargon — biometrics-process tokens, app/IDV tokens, sentence
  // glue words. If any of these appear, this is a description, not a place.
  // Kept as one alternation for cheap matching.
  const NOISE_RE =
    /\b(walk|free|paid|fee|fees|slot|slots|appointment|booked|cancel|reschedule|biometrics?|service|point|centre|center|ukvcas|ukvi|tls|idv|app|in-person|in|out|submitted|opted|dual|submission|ignored|advised|available|across|near|nearest|same|day|hour|hours|min|minutes|of|at|the|by|from|to|off|with|via|using|free-of-charge)\b/i;
  if (NOISE_RE.test(trimmed)) return undefined;

  // A weekday or month name on its own is never a place — these come from
  // dates like "(Saturday)" or "(March)" that leaked through the date parser.
  const TEMPORAL_RE =
    /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)$/i;
  if (TEMPORAL_RE.test(trimmed)) return undefined;

  // Must be mostly letters (allow internal hyphen / apostrophe for names like
  // "Stoke-on-Trent" — though it'd be filtered above for stop words, leave
  // the door open in case someone writes "St Albans" or "King's Cross").
  if (!/^[A-Za-z][A-Za-z\-' ]+$/.test(trimmed)) return undefined;

  // Title-case the first letter of each word.
  return trimmed
    .split(/\s+/)
    .map((w) => (w.length === 0 ? w : w[0]!.toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

// ============================================================================
// OUTCOME INFERENCE
// ============================================================================

function inferOutcome(content: string, hasDecisionDate: boolean): 'approved' | 'rejected' | 'pending' | 'unknown' {
  const text = content;

  // Strong approval signals — these specifically indicate a decided positive case.
  const strongApproval =
    /\bilr\s+granted\b/i.test(text) ||
    /\bgranted\s+ilr\b/i.test(text) ||
    /\bgot\s+my\s+ilr\b/i.test(text) ||
    /\b(approved!|granted!|successful!)\b/i.test(text) ||
    /\bapproval\s+email\s*[:\-]?\s*\d/i.test(text) ||
    /\bapproval\s+received\s*[:\-]?\s*\d/i.test(text) ||
    /\bbrp\s+(?:card\s+)?received\s*[:\-]?\s*\d/i.test(text) ||
    /\be-?visa\s+status\s+changed\s+to\s+settled/i.test(text);

  // Refusal signals — careful not to match the field label "Approval/Refusal Received".
  // We accept either an unambiguous verb ("refused", "rejected", "denied",
  // "unsuccessful") OR the noun "refusal" when it's clearly the outcome
  // ("Refusal received <date>").
  const refusalAsNounWithDate = /\brefusal\s+received\s*[:\-]?\s*\d/i.test(text);
  const refusedVerbs =
    /\b(refused|rejected|denied|unsuccessful)\b/i.test(text) &&
    !/approval\s*\/\s*refusal/i.test(text);
  const refused = refusalAsNounWithDate || refusedVerbs;

  const pending =
    /\b(still\s+waiting|awaiting\s+decision|no\s+decision\s+yet|no\s+update|in\s+progress)\b/i.test(text);

  if (strongApproval) return 'approved';
  if (refused) return 'rejected';
  if (pending) return 'pending';

  // If we have a decision date but no clear approve/reject signal, default to approved.
  // The vast majority of forum-posted "decision came on date X" with no negative
  // language is in fact an approval; calling it "unknown" silently drops too many.
  if (hasDecisionDate) return 'approved';

  return 'unknown';
}

// ============================================================================
// EVENT DEDUPE / SORT
// ============================================================================

function dedupeAndSortEvents(events: ExtractedEvent[]): ExtractedEvent[] {
  const seen = new Set<string>();
  const out: ExtractedEvent[] = [];
  for (const e of events) {
    const key = `${e.type}|${e.date.toISOString()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

// ============================================================================
// FLEXIBLE DATE PARSING (UTC, UK-first DD/MM)
// ============================================================================

const MONTH_NAMES: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

/**
 * Parse forum date strings into UTC-midnight Date objects.
 *
 * Bias: UK-first ordering. "03/04/2025" is interpreted as 3 April 2025, not
 * March 4. We disambiguate using the day field exceeding 12 (e.g. "13/04/2025"
 * is unambiguously day=13). The unambiguous cases give us strong UK signal,
 * and forum templates ("Date application sent : DD/MM/YYYY") consistently use
 * UK format.
 *
 * Returns undefined for clearly invalid or out-of-range dates.
 */
export function parseFlexibleDate(dateStr: string): Date | undefined {
  const str = dateStr.trim();
  if (!str) return undefined;

  // 1. DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY (UK format, default).
  const numericMatch = str.match(/^(\d{1,2})[\s\/\-\.](\d{1,2})[\s\/\-\.](\d{2,4})$/);
  if (numericMatch) {
    const day = parseInt(numericMatch[1]!, 10);
    const month = parseInt(numericMatch[2]!, 10) - 1;
    let year = parseInt(numericMatch[3]!, 10);
    if (year < 100) year += 2000;

    if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
      const date = new Date(Date.UTC(year, month, day));
      if (!isNaN(date.getTime()) && isReasonableDate(date)) {
        return date;
      }
    }
  }

  // 2. "D Month YYYY" — UK textual format, e.g. "3 March 2026".
  const ukTextMatch = str.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/i);
  if (ukTextMatch) {
    const day = parseInt(ukTextMatch[1]!, 10);
    const monthKey = ukTextMatch[2]!.toLowerCase();
    const month = MONTH_NAMES[monthKey] ?? MONTH_NAMES[monthKey.slice(0, 3)];
    const year = parseInt(ukTextMatch[3]!, 10);

    if (month !== undefined && day >= 1 && day <= 31) {
      const date = new Date(Date.UTC(year, month, day));
      if (!isNaN(date.getTime()) && isReasonableDate(date)) {
        return date;
      }
    }
  }

  // 3. "Month D, YYYY" — US textual format, occasionally used.
  const usTextMatch = str.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (usTextMatch) {
    const monthKey = usTextMatch[1]!.toLowerCase();
    const month = MONTH_NAMES[monthKey] ?? MONTH_NAMES[monthKey.slice(0, 3)];
    const day = parseInt(usTextMatch[2]!, 10);
    const year = parseInt(usTextMatch[3]!, 10);

    if (month !== undefined && day >= 1 && day <= 31) {
      const date = new Date(Date.UTC(year, month, day));
      if (!isNaN(date.getTime()) && isReasonableDate(date)) {
        return date;
      }
    }
  }

  return undefined;
}

function isReasonableDate(date: Date): boolean {
  const now = new Date();
  // ILR data before 2010 is unlikely useful; cases beyond ~30 days in the future
  // are almost certainly typos.
  const minDate = new Date(Date.UTC(2010, 0, 1));
  const maxDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return date >= minDate && date <= maxDate;
}
