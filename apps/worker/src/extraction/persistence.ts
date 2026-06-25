/**
 * Shared helpers for persisting an ExtractionResult to the DB.
 *
 * Both the scraper runner (new posts) and the re-extract command (existing
 * posts) need to build the same `ExtractedCase` create/update payload from
 * the same ExtractionResult shape. We keep that mapping in one place so
 * the two pipelines can't drift.
 *
 * IMPORTANT (Prisma quirk): on `update`, passing `undefined` for a column
 * means "leave it alone", whereas passing `null` actually clears it. The
 * extractor returns `undefined` for fields it couldn't find — without the
 * coercion in `nullify()` below, a re-extract that no longer matches
 * a noisy biometricsLocation would silently keep the old bad value.
 */
import { Prisma } from '@ilr/db';
import { EXTRACTOR_VERSION } from './extractor.js';
import type { ExtractionResult } from '@ilr/shared';

/** Coerce undefined to null so Prisma writes the null instead of skipping the column. */
function nullify<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

/**
 * Build the `data` payload for ExtractedCase create/update.
 * Centralized so the scraper runner and re-extract pipeline stay in sync.
 */
export function caseDataFromExtraction(extraction: ExtractionResult) {
  return {
    applicationType: nullify(extraction.applicationType),
    applicationRoute: nullify(extraction.applicationRoute),
    serviceTier: nullify(extraction.serviceTier),
    applicationDate: nullify(extraction.applicationDate),
    biometricsDate: nullify(extraction.biometricsDate),
    docsRequestedDate: nullify(extraction.docsRequestedDate),
    docsSubmittedDate: nullify(extraction.docsSubmittedDate),
    decisionDate: nullify(extraction.decisionDate),
    waitingDays: nullify(extraction.waitingDays),
    biometricsLocation: nullify(extraction.biometricsLocation),
    decisionCenter: nullify(extraction.decisionCenter),
    applicantNationality: nullify(extraction.applicantNationality),
    applicantNationalityCode: nullify(extraction.applicantNationalityCode),
    outcome: nullify(extraction.outcome),
    isPending: extraction.isPending ?? false,
    confidence: extraction.confidence,
    extractionNotes: nullify(extraction.extractionNotes),
    extractorVersion: EXTRACTOR_VERSION,
  };
}

/**
 * Replace the events for a case with a fresh set from the extractor.
 * Idempotent: safe to call on re-extraction.
 */
export async function syncCaseEvents(
  tx: Prisma.TransactionClient,
  caseId: string,
  extraction: ExtractionResult,
): Promise<void> {
  await tx.caseEvent.deleteMany({ where: { caseId } });

  if (extraction.events.length === 0) return;

  await tx.caseEvent.createMany({
    data: extraction.events.map((e) => ({
      caseId,
      type: e.type,
      eventDate: e.date,
      confidence: e.confidence,
    })),
    skipDuplicates: true,
  });
}
