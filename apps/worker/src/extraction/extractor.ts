import type { ExtractionResult } from '@ilr/shared';

/**
 * Extractor version - bump this when extraction logic changes significantly.
 * Stored alongside each extracted case so you can re-extract old posts
 * when the extractor improves.
 */
export const EXTRACTOR_VERSION = '1.1';

/**
 * Extract ILR case data from immigrationboards.com post content
 * 
 * The posts follow a semi-structured format like:
 * 
 * Applied for ILR Route : Set(O)
 * Date application sent : 19/12/2016
 * Biometric Letter received : 16/01/2017
 * Date Biometrics Enrolled : 20/01/2017
 * Approval/Refusal Received : 23/05/2017
 * BRP Card Received : 24/05/2017
 * 
 * But formats vary between users. This extractor handles variations.
 */
export function extractCaseData(content: string): ExtractionResult {
  const result: ExtractionResult = {
    confidence: 0,
  };

  const notes: string[] = [];
  let confidenceScore = 0;
  const maxScore = 10;

  // Normalize content - preserve line breaks for parsing
  const lines = content.split(/\n|\r/).map(l => l.trim()).filter(Boolean);
  const text = content.toLowerCase();

  // ============================================
  // APPLICATION TYPE/ROUTE EXTRACTION
  // ============================================
  
  // Look for "Applied for ILR Route" or similar patterns
  const routePatterns = [
    // Exact field matches
    /(?:applied\s+for\s+)?ilr\s+route\s*[:\-]?\s*(.+)/i,
    /route\s*[:\-]?\s*(set\s*\([omf]\)|tier\s*\d|spouse|partner|10.?year|5.?year|long.?res)/i,
    /application\s+type\s*[:\-]?\s*(.+)/i,
  ];

  for (const pattern of routePatterns) {
    const match = content.match(pattern);
    if (match?.[1]) {
      const routeRaw = match[1].trim().toLowerCase();
      
      // Normalize route names
      if (routeRaw.includes('set(o)') || routeRaw.includes('set (o)')) {
        result.applicationRoute = 'SET(O)';
        result.applicationType = 'ILR';
      } else if (routeRaw.includes('set(m)') || routeRaw.includes('set (m)')) {
        result.applicationRoute = 'SET(M)';
        result.applicationType = 'ILR';
      } else if (routeRaw.includes('set(f)') || routeRaw.includes('set (f)')) {
        result.applicationRoute = 'SET(F)';
        result.applicationType = 'ILR';
      } else if (routeRaw.includes('2x3') || routeRaw.includes('dlr')) {
        result.applicationRoute = '10-year';
        result.applicationType = 'ILR';
      } else if (routeRaw.includes('tier 2') || routeRaw.includes('tier2')) {
        result.applicationRoute = 'Tier 2';
        result.applicationType = 'ILR';
      } else if (routeRaw.includes('spouse')) {
        result.applicationRoute = 'Spouse';
        result.applicationType = 'ILR';
      } else if (routeRaw.includes('dependent') || routeRaw.includes('dependant')) {
        result.applicationRoute = 'Dependant';
        result.applicationType = 'ILR';
      } else {
        result.applicationRoute = match[1].trim().slice(0, 50); // Cap length
        result.applicationType = 'ILR';
      }
      confidenceScore += 2;
      break;
    }
  }

  // ============================================
  // DATE EXTRACTION
  // ============================================
  
  // Application date patterns
  const applicationDatePatterns = [
    /(?:date\s+)?application\s+sent\s*[:\-]?\s*(\d{1,2}[\s\/\-\.]+\w+[\s\/\-\.]+\d{2,4}|\d{1,2}[\s\/\-\.]+\d{1,2}[\s\/\-\.]+\d{2,4})/i,
    /(?:date\s+)?applied\s*[:\-]?\s*(\d{1,2}[\s\/\-\.]+\w+[\s\/\-\.]+\d{2,4}|\d{1,2}[\s\/\-\.]+\d{1,2}[\s\/\-\.]+\d{2,4})/i,
    /submitted\s*(?:on)?\s*[:\-]?\s*(\d{1,2}[\s\/\-\.]+\w+[\s\/\-\.]+\d{2,4}|\d{1,2}[\s\/\-\.]+\d{1,2}[\s\/\-\.]+\d{2,4})/i,
    /application\s+date\s*[:\-]?\s*(\d{1,2}[\s\/\-\.]+\w+[\s\/\-\.]+\d{2,4}|\d{1,2}[\s\/\-\.]+\d{1,2}[\s\/\-\.]+\d{2,4})/i,
  ];

  for (const pattern of applicationDatePatterns) {
    const match = content.match(pattern);
    if (match?.[1]) {
      const parsed = parseFlexibleDate(match[1]);
      if (parsed) {
        result.applicationDate = parsed;
        confidenceScore += 1.5;
        break;
      }
    }
  }

  // Biometrics date patterns
  const biometricsPatterns = [
    /biometrics?\s+(?:date|enrolled|done|completed)\s*[:\-]?\s*(\d{1,2}[\s\/\-\.]+\w+[\s\/\-\.]+\d{2,4}|\d{1,2}[\s\/\-\.]+\d{1,2}[\s\/\-\.]+\d{2,4})/i,
    /(?:date\s+)?biometrics?\s*[:\-]?\s*(\d{1,2}[\s\/\-\.]+\w+[\s\/\-\.]+\d{2,4}|\d{1,2}[\s\/\-\.]+\d{1,2}[\s\/\-\.]+\d{2,4})/i,
    /bio(?:metrics?)?\s+letter\s+received\s*[:\-]?\s*(\d{1,2}[\s\/\-\.]+\w+[\s\/\-\.]+\d{2,4}|\d{1,2}[\s\/\-\.]+\d{1,2}[\s\/\-\.]+\d{2,4})/i,
  ];

  for (const pattern of biometricsPatterns) {
    const match = content.match(pattern);
    if (match?.[1]) {
      const parsed = parseFlexibleDate(match[1]);
      if (parsed) {
        result.biometricsDate = parsed;
        confidenceScore += 0.5;
        break;
      }
    }
  }

  // Decision date patterns
  const decisionPatterns = [
    /(?:approval|decision|approved?)\s*(?:\/\s*refusal)?\s*(?:received|date|email)?\s*[:\-]?\s*(\d{1,2}[\s\/\-\.]+\w+[\s\/\-\.]+\d{2,4}|\d{1,2}[\s\/\-\.]+\d{1,2}[\s\/\-\.]+\d{2,4})/i,
    /(?:refusal|refused|rejected)\s*(?:received|date)?\s*[:\-]?\s*(\d{1,2}[\s\/\-\.]+\w+[\s\/\-\.]+\d{2,4}|\d{1,2}[\s\/\-\.]+\d{1,2}[\s\/\-\.]+\d{2,4})/i,
    /brp\s+(?:card\s+)?received\s*[:\-]?\s*(\d{1,2}[\s\/\-\.]+\w+[\s\/\-\.]+\d{2,4}|\d{1,2}[\s\/\-\.]+\d{1,2}[\s\/\-\.]+\d{2,4})/i,
    /e-?visa\s+(?:status\s+)?(?:changed|updated)\s*[:\-]?\s*(\d{1,2}[\s\/\-\.]+\w+[\s\/\-\.]+\d{2,4}|\d{1,2}[\s\/\-\.]+\d{1,2}[\s\/\-\.]+\d{2,4})/i,
    /settled\s*[:\-]?\s*(\d{1,2}[\s\/\-\.]+\w+[\s\/\-\.]+\d{2,4}|\d{1,2}[\s\/\-\.]+\d{1,2}[\s\/\-\.]+\d{2,4})/i,
  ];

  for (const pattern of decisionPatterns) {
    const match = content.match(pattern);
    if (match?.[1]) {
      const parsed = parseFlexibleDate(match[1]);
      if (parsed) {
        result.decisionDate = parsed;
        confidenceScore += 1.5;
        break;
      }
    }
  }

  // Calculate waiting days if we have both dates
  if (result.applicationDate && result.decisionDate) {
    const diffMs = result.decisionDate.getTime() - result.applicationDate.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays > 0 && diffDays < 1000) {
      result.waitingDays = diffDays;
      confidenceScore += 2;
    } else {
      notes.push('Calculated waiting days seem invalid');
    }
  }

  // ============================================
  // OUTCOME EXTRACTION
  // ============================================
  
  // Look for explicit outcome mentions
  // Be careful about "Approval/Refusal Received" which is just a field label
  
  // Check for BRP received first - this is a strong indicator of approval
  const hasBrpReceived = /brp\s+(?:card\s+)?received\s*[:\-]?\s*\d/i.test(content);
  const hasEvisaSettled = /e-?visa.*settled/i.test(content);
  const hasApprovalEmail = /approval\s+email\s*[:\-]?\s*\d/i.test(content);
  
  // Check for refusal (but not just "Approval/Refusal" label)
  const hasRefusal = /\b(refused|rejected|denied|unsuccessful)\b/i.test(content) ||
    /refusal\s+received\s*[:\-]?\s*\d/i.test(content);
  
  // Check for explicit approval words
  const hasApproval = /\b(approved!?|granted!?|successful!?)\b/i.test(content) ||
    /\bgot\s+my\s+ilr\b/i.test(content) ||
    /\bilr\s+granted\b/i.test(content);
  
  // Check for pending status
  const isPending = /\b(still\s+waiting|awaiting\s+decision|no\s+decision\s+yet)\b/i.test(content);
  
  // Determine outcome with priority
  if (hasBrpReceived || hasEvisaSettled || hasApprovalEmail || hasApproval) {
    result.outcome = 'approved';
    confidenceScore += 1;
  } else if (hasRefusal) {
    result.outcome = 'rejected';
    confidenceScore += 1;
  } else if (isPending) {
    result.outcome = 'pending';
    confidenceScore += 0.5;
  }

  // ============================================
  // SERVICE CENTER EXTRACTION
  // ============================================
  
  const centerPatterns = [
    { pattern: /sheffield/i, center: 'Sheffield' },
    { pattern: /liverpool/i, center: 'Liverpool' },
    { pattern: /croydon/i, center: 'Croydon' },
    { pattern: /cardiff/i, center: 'Cardiff' },
    { pattern: /belfast/i, center: 'Belfast' },
    { pattern: /glasgow/i, center: 'Glasgow' },
    { pattern: /ukvcas/i, center: 'UKVCAS' },
  ];

  for (const { pattern, center } of centerPatterns) {
    if (pattern.test(content)) {
      result.serviceCenter = center;
      confidenceScore += 0.5;
      break;
    }
  }

  // ============================================
  // APPLICATION TYPE/ROUTE DETECTION (if not already set)
  // ============================================
  
  // Try to extract route if not already set - look for standalone mentions
  if (!result.applicationRoute) {
    // Check for Set(O), Set(M), Set(F) anywhere in the text
    if (/\bset\s*\(?o\)?/i.test(content)) {
      result.applicationRoute = 'SET(O)';
      result.applicationType = 'ILR';
      confidenceScore += 1;
    } else if (/\bset\s*\(?m\)?/i.test(content)) {
      result.applicationRoute = 'SET(M)';
      result.applicationType = 'ILR';
      confidenceScore += 1;
    } else if (/\bset\s*\(?f\)?/i.test(content)) {
      result.applicationRoute = 'SET(F)';
      result.applicationType = 'ILR';
      confidenceScore += 1;
    } else if (/\b10[\s\-]?year/i.test(content)) {
      result.applicationRoute = '10-year';
      result.applicationType = 'ILR';
      confidenceScore += 0.5;
    }
  }
  
  if (!result.applicationType) {
    if (/\b(ilr|indefinite\s+leave\s+to\s+remain)\b/i.test(content)) {
      result.applicationType = 'ILR';
      confidenceScore += 0.5;
    } else if (/\b(flr|further\s+leave)\b/i.test(content)) {
      result.applicationType = 'FLR';
      confidenceScore += 0.5;
    } else if (/\bnaturali[sz]ation\b/i.test(content)) {
      result.applicationType = 'Naturalization';
      confidenceScore += 0.5;
    }
  }

  // ============================================
  // ADDITIONAL CONTEXT
  // ============================================
  
  // Check for standard/premium service
  if (/\bstandard\b/i.test(content)) {
    notes.push('Standard service');
  }
  if (/\bpremium\b/i.test(content)) {
    notes.push('Premium service');
  }
  if (/\bsuper\s*priority\b/i.test(content)) {
    notes.push('Super priority service');
  }
  if (/\bpriority\b/i.test(content)) {
    notes.push('Priority service');
  }

  // ============================================
  // FINAL CONFIDENCE SCORE
  // ============================================
  
  result.confidence = Math.min(confidenceScore / maxScore, 1);
  
  if (notes.length > 0) {
    result.extractionNotes = notes.join('; ');
  }

  // Add note if confidence is low but we found something
  if (result.confidence > 0 && result.confidence < 0.4) {
    result.extractionNotes = (result.extractionNotes ? result.extractionNotes + '; ' : '') + 
      'Low confidence extraction - manual review recommended';
  }

  return result;
}

/**
 * Parse various date formats commonly used in forum posts
 * 
 * Handles:
 * - DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
 * - D Month YYYY, DD Month YYYY
 * - Month DD, YYYY
 */
function parseFlexibleDate(dateStr: string): Date | undefined {
  const str = dateStr.trim();

  // Try DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const numericMatch = str.match(/(\d{1,2})[\s\/\-\.](\d{1,2})[\s\/\-\.](\d{2,4})/);
  if (numericMatch) {
    const [, dayStr, monthStr, yearStr] = numericMatch;
    const day = parseInt(dayStr!, 10);
    const month = parseInt(monthStr!, 10) - 1; // 0-indexed
    let year = parseInt(yearStr!, 10);
    if (year < 100) year += 2000;

    // Validate UK date format (DD/MM/YYYY)
    if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
      const date = new Date(year, month, day);
      if (!isNaN(date.getTime()) && isReasonableDate(date)) {
        return date;
      }
    }
  }

  // Try D(D) Month YYYY
  const monthNames: Record<string, number> = {
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

  const textDateMatch = str.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/i);
  if (textDateMatch) {
    const [, dayStr, monthStr, yearStr] = textDateMatch;
    const day = parseInt(dayStr!, 10);
    const monthKey = monthStr!.toLowerCase();
    const month = monthNames[monthKey] ?? monthNames[monthKey.slice(0, 3)];
    const year = parseInt(yearStr!, 10);

    if (month !== undefined && day >= 1 && day <= 31) {
      const date = new Date(year, month, day);
      if (!isNaN(date.getTime()) && isReasonableDate(date)) {
        return date;
      }
    }
  }

  // Try Month DD, YYYY (US format, sometimes used)
  const usDateMatch = str.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/i);
  if (usDateMatch) {
    const [, monthStr, dayStr, yearStr] = usDateMatch;
    const monthKey = monthStr!.toLowerCase();
    const month = monthNames[monthKey] ?? monthNames[monthKey.slice(0, 3)];
    const day = parseInt(dayStr!, 10);
    const year = parseInt(yearStr!, 10);

    if (month !== undefined && day >= 1 && day <= 31) {
      const date = new Date(year, month, day);
      if (!isNaN(date.getTime()) && isReasonableDate(date)) {
        return date;
      }
    }
  }

  return undefined;
}

/**
 * Check if date is reasonable (not too far in past or future)
 */
function isReasonableDate(date: Date): boolean {
  const now = new Date();
  const minDate = new Date(2010, 0, 1); // ILR data before 2010 unlikely useful
  const maxDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days in future
  
  return date >= minDate && date <= maxDate;
}
