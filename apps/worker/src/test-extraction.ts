/**
 * Lightweight assertion-based tests for the extractor.
 *
 * Run with: pnpm --filter @ilr/worker run test:extract
 *
 * Each TEST_CASE has expected fields that MUST be set by the extractor.
 * The script exits with code 1 if any assertion fails — usable in CI.
 */

import { extractCaseData, EXTRACTOR_VERSION } from './extraction/extractor.js';
import type { ExtractionResult, ServiceTier } from '@ilr/shared';

interface TestCase {
  name: string;
  content: string;
  authorNationality?: string;
  expect: Partial<{
    applicationType: string;
    applicationRoute: string;
    serviceTier: ServiceTier;
    applicationDateIso: string; // YYYY-MM-DD
    biometricsDateIso: string;
    docsRequestedDateIso: string;
    docsSubmittedDateIso: string;
    decisionDateIso: string;
    biometricsLocation: string;
    waitingDays: number;
    outcome: 'approved' | 'rejected' | 'pending' | 'unknown';
    isPending: boolean;
    applicantNationalityCode: string;
    minConfidence: number;
    eventTypes: string[]; // expected subset, in chronological order
  }>;
}

const TESTS: TestCase[] = [
  // ----- Live forum sample: Skilled Worker, Priority -----
  {
    name: 'Skilled Worker Priority — full timeline',
    content: `Applied for ILR Route : Set (0) (Skilled Worker)
Date application sent : 4 Feb 2026
Application Type : Priority (5 days)
Biometrics Date: 5 Feb 2026 (Wandsworth)
Biometrics Confirmation Email:5 Feb 2026
Acknowledgement email from UKVI: None, got direct approval email
Approval email: 6 Feb 2026
E-visa Status changed to Settled immediately`,
    authorNationality: 'India',
    expect: {
      applicationType: 'ILR',
      applicationRoute: 'Skilled Worker',
      serviceTier: 'priority',
      applicationDateIso: '2026-02-04',
      biometricsDateIso: '2026-02-05',
      biometricsLocation: 'Wandsworth',
      decisionDateIso: '2026-02-06',
      waitingDays: 2,
      outcome: 'approved',
      isPending: false,
      applicantNationalityCode: 'IN',
      minConfidence: 0.6,
      eventTypes: ['applied', 'biometrics', 'decision'],
    },
  },

  // ----- Live forum sample: SET(M) Super Priority -----
  {
    name: 'SET(M) Super Priority',
    content: `Applied for ILR Route: SET M Spouse of a British Citizen
Application Type: Super Priority
Application submitted online: 10/02/2026
Biometrics appointment: 12/02/2026 (London Wandsworth)
Acknowledgement email: 12/02/2026 (TLScontact Biometric Collection confirmation)
Approval Received: 16/02/2026
ILR Granted`,
    authorNationality: 'Pakistan',
    expect: {
      applicationRoute: 'SET(M)',
      serviceTier: 'super_priority',
      applicationDateIso: '2026-02-10',
      biometricsDateIso: '2026-02-12',
      biometricsLocation: 'London Wandsworth',
      decisionDateIso: '2026-02-16',
      waitingDays: 6,
      outcome: 'approved',
      isPending: false,
      applicantNationalityCode: 'PK',
      eventTypes: ['applied', 'biometrics', 'acknowledgement', 'decision'],
    },
  },

  // ----- Live forum sample: Docs requested -----
  {
    name: 'SET(M) with extra documents requested',
    content: `Applied for ILR Route: SET M Spouse of a British Citizen
Application Type: Super Priority
Application submitted online: 01/03/2026
Biometrics appointment: 03/03/2026 (London Wandsworth)
Acknowledgement email: 03/03/2026
Extra Documents requested on 04/03/2026
follow up email sent 10/03/2026
Approval Received: 11/03/2026
ILR Granted`,
    authorNationality: 'Nigeria',
    expect: {
      applicationRoute: 'SET(M)',
      serviceTier: 'super_priority',
      applicationDateIso: '2026-03-01',
      biometricsDateIso: '2026-03-03',
      docsRequestedDateIso: '2026-03-04',
      docsSubmittedDateIso: '2026-03-10',
      decisionDateIso: '2026-03-11',
      outcome: 'approved',
      isPending: false,
      applicantNationalityCode: 'NG',
      eventTypes: ['applied', 'biometrics', 'acknowledgement', 'docs_requested', 'docs_submitted', 'decision'],
    },
  },

  // ----- Live forum sample: BN(O) -----
  {
    name: 'BN(O) Priority',
    content: `Applied for ILR Route:SET(O) - BN(O) route
No. of Applications: 4 (2 adults & 2 children)
Application Type: 5-day Priority
Application submitted online: 18/01/2026
Biometrics appointment: 18/02/2026
Acknowledgement email: 18/02/2026 (TLScontact)
Approval Received: 20/02/2026 (3 applications) and 24/02/2026 (1 child application)
ILR Granted!!`,
    authorNationality: 'Hong Kong (Special Administrative Region of China)',
    expect: {
      applicationRoute: 'BN(O)',
      serviceTier: 'priority',
      applicationDateIso: '2026-01-18',
      biometricsDateIso: '2026-02-18',
      // First decision date should win
      decisionDateIso: '2026-02-20',
      outcome: 'approved',
      applicantNationalityCode: 'HK',
    },
  },

  // ----- Live forum sample: GTV Dependant -----
  {
    name: 'Global Talent Dependant Priority',
    content: `Applied for ILR Route : Set(O) - GTV Dependant (partner) - 5 years residency
Application Type : Priority (5 days)
Application submitted online: 22 February 2026
Biometrics appointment: 3 March 2026 (Nottingham) - Free Appointment
Biometrics Confirmation Email: 3 March 2026 (TLScontact Biometric Collection confirmation)
Approval Received: 5 March 2026 (ILR granted in just 2 days)
E-visa Status changed to "Settled" immediately`,
    authorNationality: 'Italy',
    expect: {
      applicationRoute: 'Global Talent',
      serviceTier: 'priority',
      applicationDateIso: '2026-02-22',
      biometricsDateIso: '2026-03-03',
      biometricsLocation: 'Nottingham',
      decisionDateIso: '2026-03-05',
      outcome: 'approved',
      applicantNationalityCode: 'IT',
    },
  },

  // ----- Pending case (still waiting) -----
  {
    name: 'Pending — biometrics done, no decision yet',
    content: `Applied for ILR Route: SET(M) Spouse
Application Type: Standard
Submitted: 15/03/2024
Biometrics Date: 02/04/2024
Still waiting for a decision`,
    authorNationality: 'Pakistan',
    expect: {
      applicationRoute: 'SET(M)',
      serviceTier: 'standard',
      applicationDateIso: '2024-03-15',
      biometricsDateIso: '2024-04-02',
      outcome: 'pending',
      isPending: true,
      applicantNationalityCode: 'PK',
      eventTypes: ['applied', 'biometrics'],
    },
  },

  // ----- Refusal -----
  {
    name: 'Refusal',
    content: `Set(O) - 10 year route
Application sent 10/01/2024
Biometrics done 25/01/2024
Refusal received 15/03/2024
Very disappointed`,
    expect: {
      applicationRoute: '10-year',
      applicationDateIso: '2024-01-10',
      biometricsDateIso: '2024-01-25',
      decisionDateIso: '2024-03-15',
      outcome: 'rejected',
      isPending: false,
    },
  },

  // ----- Legacy 2x3 DLR (10-year) format -----
  {
    name: 'Legacy 2x3 DLR / SET(O)',
    content: `Hi All
My solicitor phoned me all good news
Applied for ILR Route : 2x3 DLR
Date application sent : 19/12/2016
Document received by HO :20/12/2016
Biometric Letter received :16/01/2017
Date Biometrics Enrolled :20/01/2017
Approval/Refusal Received :23/05/2017
BRP Card Received 24/05/2017
I Wish you all the best.`,
    expect: {
      applicationRoute: '10-year',
      applicationDateIso: '2016-12-19',
      biometricsDateIso: '2017-01-20',
      decisionDateIso: '2017-05-23',
      outcome: 'approved',
      isPending: false,
      // "Document received by HO :20/12/2016" should now be captured as
      // acknowledgement; existing extractor missed it entirely.
      eventTypes: ['applied', 'acknowledgement', 'biometrics', 'decision'],
    },
  },

  // ----- v1.7: Approval/Refusal Received with phrase prefix -----
  // Real-world post (user deedee44, immigrationboards p1676081). The decision
  // line is "Approval/Refusal Received : receive it 31/08/2018 dated 28/08/2018"
  // — v1.6 returned outcome=unknown and missed the decision date entirely.
  {
    name: 'v1.7: Approval/Refusal Received with verbose value',
    content: `Applied for ILR Route :DLR, set o, main and 2 dependant.. 3+3 years
Date application sent : mar 13, 2018
Document received by HO : mar 15,2018
Ack letter received (if applicable) :26/03/2018, 23/04/2018, 23/05/2018, 25/06/2018, 23/07/2018, 24/08/2018
Biometric Letter received : 23/03/2018
Date Biometrics Enrolled :25/03/2018
Payment Debited : 30/03/2018
Approval/Refusal Received : receive it 31/08/2018 dated 28/08/2018
BRP Card Received :receive one brp.. the rest is on its way...`,
    expect: {
      applicationRoute: '10-year',
      // First date the regex sees after the label is "31/08/2018"
      decisionDateIso: '2018-08-31',
      applicationDateIso: '2018-03-13',
      biometricsDateIso: '2018-03-25',
      outcome: 'approved',
      isPending: false,
    },
  },

  // ----- v1.7: Approval/Refusal Received : waiting → pending -----
  {
    name: 'v1.7: Approval/Refusal Received : waiting',
    content: `Applied for ILR Route : Set (O)
Date application sent : 22/01/2018
Date Biometrics Enrolled : 25/01/2018
Approval/Refusal Received : still waiting`,
    expect: {
      applicationRoute: 'SET(O)',
      applicationDateIso: '2018-01-22',
      biometricsDateIso: '2018-01-25',
      outcome: 'pending',
      isPending: true,
      // No decision date expected — the value is "still waiting", not a date.
      decisionDateIso: undefined,
    },
  },

  // ----- v1.7: Approval/Refusal Received : Rejected on <date> -----
  {
    name: 'v1.7: Approval/Refusal Received : Rejected on date',
    content: `Applied for ILR Route : Set (O)
Date application sent : 20/12/2017
Date Biometrics Enrolled : 25/12/2017
Approval/Refusal Received : Rejected on 07/02/2018`,
    expect: {
      applicationRoute: 'SET(O)',
      applicationDateIso: '2017-12-20',
      biometricsDateIso: '2017-12-25',
      decisionDateIso: '2018-02-07',
      outcome: 'rejected',
      isPending: false,
    },
  },

  // ----- v1.7: date formats -----
  {
    name: 'v1.7: DD-Mon-YYYY hyphenated text date',
    content: `Applied for ILR postal Route
Date application sent : 15-Feb-2018
Date Biometrics Enrolled :16-Mar-2018`,
    expect: {
      applicationDateIso: '2018-02-15',
      biometricsDateIso: '2018-03-16',
    },
  },

  {
    name: 'v1.7: 2-digit year textual date',
    content: `Applied for ILR Route : ILR (SET O) Tier 1 G
Date application sent : 08 Feb 17
Date Biometrics Enrolled : 20 Feb 17`,
    expect: {
      applicationRoute: 'SET(O)',
      applicationDateIso: '2017-02-08',
      biometricsDateIso: '2017-02-20',
    },
  },

  {
    name: 'v1.7: ordinal suffix and no-space month-year',
    content: `Finally received an approval for my ILR application.
ILR SET(O) application
application sent: 19th oct 2016
biometrics done: 10th nov16
Approval received: 5 Dec 2016`,
    expect: {
      applicationRoute: 'SET(O)',
      applicationDateIso: '2016-10-19',
      biometricsDateIso: '2016-11-10',
      decisionDateIso: '2016-12-05',
      outcome: 'approved',
    },
  },

  // ----- v1.7: "On-Line application submitted" prefix -----
  {
    name: 'v1.7: On-Line application submitted prefix',
    content: `Applying from : Florida, USA
Type of visa applied for : Settlement—Wife
Priority / Non-Priority : non priority
Date On-Line application submitted : 15 March 2018
Date biometrics enrolled : 20 March 2018`,
    expect: {
      applicationRoute: 'SET(M)',
      serviceTier: 'standard',
      applicationDateIso: '2018-03-15',
      biometricsDateIso: '2018-03-20',
    },
  },
];

interface AssertionFailure {
  test: string;
  field: string;
  expected: unknown;
  actual: unknown;
}

function isoDate(d?: Date): string | undefined {
  return d ? d.toISOString().slice(0, 10) : undefined;
}

function runOne(test: TestCase, result: ExtractionResult): AssertionFailure[] {
  const failures: AssertionFailure[] = [];
  const e = test.expect;

  const check = (field: string, actual: unknown, expected: unknown) => {
    if (expected === undefined) return;
    if (actual !== expected) failures.push({ test: test.name, field, expected, actual });
  };

  check('applicationType', result.applicationType, e.applicationType);
  check('applicationRoute', result.applicationRoute, e.applicationRoute);
  check('serviceTier', result.serviceTier, e.serviceTier);
  check('applicationDate', isoDate(result.applicationDate), e.applicationDateIso);
  check('biometricsDate', isoDate(result.biometricsDate), e.biometricsDateIso);
  check('docsRequestedDate', isoDate(result.docsRequestedDate), e.docsRequestedDateIso);
  check('docsSubmittedDate', isoDate(result.docsSubmittedDate), e.docsSubmittedDateIso);
  check('decisionDate', isoDate(result.decisionDate), e.decisionDateIso);
  check('biometricsLocation', result.biometricsLocation, e.biometricsLocation);
  check('outcome', result.outcome, e.outcome);
  check('isPending', result.isPending, e.isPending);
  check('applicantNationalityCode', result.applicantNationalityCode, e.applicantNationalityCode);
  if (e.waitingDays !== undefined) check('waitingDays', result.waitingDays, e.waitingDays);

  if (e.minConfidence !== undefined && result.confidence < e.minConfidence) {
    failures.push({
      test: test.name,
      field: 'confidence',
      expected: `>= ${e.minConfidence}`,
      actual: result.confidence,
    });
  }

  if (e.eventTypes) {
    const actualTypes = result.events.map((ev) => ev.type);
    const missing = e.eventTypes.filter((t) => !actualTypes.includes(t as never));
    if (missing.length > 0) {
      failures.push({
        test: test.name,
        field: 'eventTypes',
        expected: e.eventTypes,
        actual: actualTypes,
      });
    }
  }

  return failures;
}

console.log(`Extractor v${EXTRACTOR_VERSION} — running ${TESTS.length} test cases\n`);
console.log('='.repeat(70));

let totalFailures = 0;
for (const test of TESTS) {
  const result = extractCaseData(test.content, test.authorNationality);
  const failures = runOne(test, result);

  if (failures.length === 0) {
    console.log(`  PASS  ${test.name}  (confidence ${(result.confidence * 100).toFixed(0)}%, ${result.events.length} events)`);
  } else {
    totalFailures += failures.length;
    console.log(`  FAIL  ${test.name}  (confidence ${(result.confidence * 100).toFixed(0)}%)`);
    for (const f of failures) {
      console.log(`        ${f.field}: expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.actual)}`);
    }
  }
}

console.log('='.repeat(70));

if (totalFailures > 0) {
  console.log(`${totalFailures} assertion failure(s) across ${TESTS.length} cases.`);
  process.exit(1);
} else {
  console.log(`All ${TESTS.length} tests passed.`);
}
