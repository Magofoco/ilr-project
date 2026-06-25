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
  {
    label: '"Date Biometrics Enrolled: 30/08/2020 (idv app)"',
    content: `Application: Test
Date Biometrics Enrolled: 30/08/2020 (idv app)
Approval: 15/12/2020`,
  },
  {
    label: '"Biometrics appointment: 5 March 2026 (Croydon)"',
    content: `Application: Test
Biometrics appointment: 5 March 2026 (Croydon)
Approval: 10 March 2026`,
  },
  {
    label: '"Biometrics: 30 Aug 2020 (Saturday)"',
    content: `Application: Test
Biometrics: 30 Aug 2020 (Saturday)
Approval: 15 Dec 2020`,
  },
  {
    label: '"Biometrics: 30 Aug 2020 (London Wandsworth)"',
    content: `Application: Test
Biometrics: 30 Aug 2020 (London Wandsworth)
Approval: 15 Dec 2020`,
  },
  {
    label:
      '"Biometrics: 30 Aug 2020 (In-person Biometrics at UKVCAS service point)"',
    content: `Application: Test
Biometrics: 30 Aug 2020 (In-person Biometrics at UKVCAS service point)
Approval: 15 Dec 2020`,
  },
];

for (const s of samples) {
  const out = extractCaseData(s.content, 'UK');
  console.log(`${s.label}\n  -> biometricsLocation = ${JSON.stringify(out.biometricsLocation)}`);
}
