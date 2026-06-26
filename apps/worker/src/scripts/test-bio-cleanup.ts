/**
 * One-off diagnostic: feed canned post content to the live extractor and
 * print what biometricsLocation comes out. If the regex is doing its job,
 * the noisy parenthetical inputs should all yield `undefined` — but the
 * DB after the v1.4 reextract still shows "Idv App", "Saturday" etc.
 * This script answers "is the extractor module I think is loaded the one
 * that actually ran?" without depending on the network at all.
 */
import { extractCaseData, EXTRACTOR_VERSION } from '../extraction/extractor.js';

console.log(`EXTRACTOR_VERSION = ${EXTRACTOR_VERSION}\n`);

const samples: Array<{ label: string; content: string }> = [
  // ---- v1.5 regression tests (must still behave) ----
  {
    label: 'v1.5: "(idv app)" must be rejected',
    content: `Application: Test
Date Biometrics Enrolled: 30/08/2020 (idv app)
Approval: 15/12/2020`,
  },
  {
    label: 'v1.5: "(Croydon)" parens-capture must still work',
    content: `Application: Test
Biometrics appointment: 5 March 2026 (Croydon)
Approval: 10 March 2026`,
  },
  {
    label: 'v1.5: "(Saturday)" weekday rejected',
    content: `Application: Test
Biometrics: 30 Aug 2020 (Saturday)
Approval: 15 Dec 2020`,
  },
  {
    label: 'v1.5: "(London Wandsworth)" passes (clean compound)',
    content: `Application: Test
Biometrics: 30 Aug 2020 (London Wandsworth)
Approval: 15 Dec 2020`,
  },
  {
    label: 'v1.5: "(In-person Biometrics at UKVCAS service point)" rejected',
    content: `Application: Test
Biometrics: 30 Aug 2020 (In-person Biometrics at UKVCAS service point)
Approval: 15 Dec 2020`,
  },
  // ---- v1.6 new captures ----
  {
    label: 'v1.6: "Biometrics in Croydon on 30/8/2020" (city before date)',
    content: `Application: Test
Biometrics in Croydon on 30/8/2020.
Approval: 15/12/2020`,
  },
  {
    label: 'v1.6: "Did biometrics at Mark Lane: 28/02/2024"',
    content: `Did biometrics at Mark Lane: 28/02/2024.
Decision: 10/06/2024`,
  },
  {
    label: 'v1.6: "Biometrics scheduled for 30/8/2020" (no city — must stay null)',
    content: `Application: Test
Biometrics scheduled for 30/8/2020.
Approval: 15/12/2020`,
  },
  {
    label: 'v1.6: "Biometrics: 30/8/2020. Approved (Croydon)" must NOT pull Croydon across the period',
    content: `Biometrics: 30/8/2020. Approved on 1/12/2020 (Croydon).`,
  },
];

for (const s of samples) {
  const out = extractCaseData(s.content, 'UK');
  console.log(`${s.label}\n  -> biometricsLocation = ${JSON.stringify(out.biometricsLocation)}`);
}
