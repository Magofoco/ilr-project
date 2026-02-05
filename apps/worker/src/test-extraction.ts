/**
 * Test script to verify the extraction logic works correctly
 * 
 * Run with: pnpm --filter @ilr/worker run test:extract
 */

import { extractCaseData } from './extraction/extractor.js';

const testPosts = [
  // Example 1: Standard format
  `Hi All
My solicitor phoned me all good news
Applied for ILR Route : 2x3 DLR
Date application sent : 19/12/2016
Document received by HO :20/12/2016
Ack letter received (if applicable) :
Biometric Letter received :16/01/2017
Date Biometrics Enrolled :20/01/2017
Payment Debited :29/12/2016
Approval/Refusal Received :23/05/2017
BRP Card Received 24/05/2017
I Wish you all the best.`,

  // Example 2: Different format
  `Applied for ILR Route : Set (0) (Dependant)
Date application sent : 3 June 2025
Application Type : Standard
Biometrics Date: 30 July 2025
Biometrics Confirmation Email:30 July 2025
Acknowledgement email from UKVI: 1 August 2025
Approval email: 16 September 2025
E-visa Status changed to Settled`,

  // Example 3: Minimal info
  `Applied for ILR Route: SET(M) Spouse
Submitted: 15/03/2024
Still waiting for biometrics appointment`,

  // Example 4: Tier 2
  `Route: Tier 2 General
Applied: 01/02/2024
Biometrics: 20/02/2024
Decision received: 15/04/2024
Approved! BRP arrived 20/04/2024`,

  // Example 5: Refusal
  `Set(O) - 10 year route
Application sent 10/01/2024
Biometrics done 25/01/2024
Refusal received 15/03/2024
Very disappointed`,

  // Example 6: Update post (after quote is stripped) - this is what the scraper will pass
  // The quoted part would be removed, leaving only the update
  `Biometrics Confirmation 23 Sept 2025 3:20 AM
Acknowledgement email from UKVI: NOPE
Approval email: 23 Sept 2025 8:36 AM`,

  // Example 7: Super Priority with full timeline
  `Applied for ILR Route : Set (0) Skilled Worker
Date application sent : 18 Sept 2025
Application Type : Super Priority
Biometrics Date: 22 Sept 2025
Approval email: 23 Sept 2025 8:36 AM`,
];

console.log('Testing ILR extraction logic\n');
console.log('='.repeat(60));

for (let i = 0; i < testPosts.length; i++) {
  const post = testPosts[i]!;
  console.log(`\nTest Case ${i + 1}:`);
  console.log('-'.repeat(40));
  console.log('Input (first 100 chars):', post.slice(0, 100).replace(/\n/g, ' ') + '...');
  
  const result = extractCaseData(post);
  
  console.log('\nExtracted:');
  console.log('  Route:', result.applicationRoute || '-');
  console.log('  Type:', result.applicationType || '-');
  console.log('  Applied:', result.applicationDate?.toISOString().split('T')[0] || '-');
  console.log('  Biometrics:', result.biometricsDate?.toISOString().split('T')[0] || '-');
  console.log('  Decision:', result.decisionDate?.toISOString().split('T')[0] || '-');
  console.log('  Waiting Days:', result.waitingDays || '-');
  console.log('  Outcome:', result.outcome || '-');
  console.log('  Confidence:', (result.confidence * 100).toFixed(0) + '%');
  console.log('  Notes:', result.extractionNotes || '-');
}

console.log('\n' + '='.repeat(60));
console.log('Extraction tests complete');
