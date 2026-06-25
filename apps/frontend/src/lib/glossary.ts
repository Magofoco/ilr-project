/**
 * Single source of truth for plain-language definitions of immigration jargon.
 *
 * Rule: every term shown to a non-expert in the UI should also live here,
 * so a hover/tap reveals the same explanation everywhere. Keep `short` to one
 * sentence and `long` to ~2 sentences of plain English.
 */

export interface GlossaryEntry {
  term: string;
  short: string;
  long: string;
}

export const GLOSSARY = {
  ilr: {
    term: 'ILR',
    short: 'Indefinite Leave to Remain — UK permanent residency.',
    long: 'The right to live, work and study in the UK without time limit. You apply online, attend a fingerprint appointment, then wait for a Home Office decision.',
  },
  biometrics: {
    term: 'Biometrics appointment',
    short: 'The fingerprint + photo appointment after you apply.',
    long: 'Booked at a UKVCAS centre after your online application. For most people this is the moment the waiting clock effectively starts.',
  },
  route: {
    term: 'Route',
    short: 'Which set of rules you applied under.',
    long: 'For example, SET(O) covers the Skilled Worker / former Tier 2 route, SET(M) covers spouse and partner, and the 10-year route is the long-residence one. We label by the form name where possible.',
  },
  serviceTier: {
    term: 'Service tier',
    short: 'Standard, Priority or Super Priority — how much you paid to be processed faster.',
    long: 'Standard (no extra fee), Priority (£500, ~5 working days target) and Super Priority (£1,000, next working day target). Most people are on Standard.',
  },
  median: {
    term: 'Typical wait (median)',
    short: 'Half waited less, half waited longer.',
    long: 'Half of comparable applicants got a decision in this time or sooner; half waited longer. We use a survival-curve method that also counts people still waiting, so the number doesn\u2019t look artificially short.',
  },
  pending: {
    term: 'Still waiting',
    short: 'No decision reported yet.',
    long: 'The applicant hasn\u2019t reported a decision. We don\u2019t drop these cases — they\u2019re built into the typical wait so the numbers reflect reality, not just the people who finished fastest.',
  },
  approvalRate: {
    term: 'Approval rate',
    short: 'Of decided cases, the share that were approved.',
    long: 'Out of cases where someone reported an outcome on a forum. Refusals are less likely to be shared publicly, so this is probably optimistic — read it as a soft upper bound.',
  },
  confidence: {
    term: 'Confidence',
    short: 'How sure we are this case was extracted correctly.',
    long: 'Each forum post is read by our extractor. Higher confidence means more dates and labels were found unambiguously. Below 70% means we got only partial information.',
  },
  cohort: {
    term: 'Cohort',
    short: 'A group of similar applicants compared to you.',
    long: 'When we estimate your wait, we compare you only to people with the same route, location and service tier from roughly the last 2 years. If too few match, we relax filters and tell you which.',
  },
  serviceStandard: {
    term: 'Service standard',
    short: 'The Home Office\u2019s public target — 6 months for most ILR routes.',
    long: 'A published target, not a promise. Real waits frequently exceed it; this dashboard shows what people actually experience, not the target.',
  },
  outcome: {
    term: 'Outcome',
    short: 'Approved, refused, or still waiting.',
    long: 'Approved = ILR granted. Refused = ILR refused (can be appealed). Still waiting = the applicant hasn\u2019t posted a decision yet.',
  },
  percentiles: {
    term: 'P10 / P25 / P75 / P90',
    short: 'The fast and slow ends of the wait, not just the middle.',
    long: 'P25 means a quarter waited less than this. P75 means three quarters waited less. The gap between them tells you how spread out the experience is — a wide gap means the wait is unpredictable.',
  },
  survivalCurve: {
    term: 'Wait-time curve',
    short: 'For each day, the share of people still waiting.',
    long: 'Starts at 100% on day 0 and falls as decisions arrive. Where it crosses 50% is the typical wait. The shape after that shows how heavy the long tail is.',
  },
  conditional: {
    term: 'Where you are now',
    short: 'Re-asks the question given that you\u2019ve already waited X days.',
    long: 'A typical wait can be misleading if you\u2019ve already passed it. We re-compute the median based on cases that hadn\u2019t been decided by your current day — so the answer accounts for the fact that the people who got fast decisions are no longer in your reference group.',
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;
