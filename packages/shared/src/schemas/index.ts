import { z } from 'zod';

// ============================================
// SOURCE FORUM SCHEMAS
// ============================================

export const sourceForumSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(50),
  displayName: z.string().min(1).max(100),
  baseUrl: z.string().url(),
  type: z.enum(['playwright', 'fetch']),
  config: z.record(z.unknown()).default({}),
  isActive: z.boolean().default(true),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const createSourceForumSchema = sourceForumSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateSourceForumSchema = createSourceForumSchema.partial();

// ============================================
// EXTRACTED CASE SCHEMAS
// ============================================

export const extractedCaseSchema = z.object({
  id: z.string(),
  postId: z.string(),
  applicationType: z.string().nullable(),
  applicationRoute: z.string().nullable(),
  applicationDate: z.coerce.date().nullable(),
  biometricsDate: z.coerce.date().nullable(),
  decisionDate: z.coerce.date().nullable(),
  waitingDays: z.number().int().nullable(),
  serviceCenter: z.string().nullable(),
  applicantLocation: z.string().nullable(),
  outcome: z.enum(['approved', 'rejected', 'pending', 'unknown']).nullable(),
  confidence: z.number().min(0).max(1),
  extractionNotes: z.string().nullable(),
  extractedAt: z.coerce.date(),
  extractorVersion: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// ============================================
// QUERY SCHEMAS
// ============================================

export const casesQuerySchema = z.object({
  // Filters
  applicationRoute: z.string().optional(),
  applicationType: z.string().optional(),
  serviceCenter: z.string().optional(),
  outcome: z.enum(['approved', 'rejected', 'pending', 'unknown']).optional(),
  sourceId: z.string().optional(),
  
  // Date range
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  
  // Confidence threshold
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  
  // Pagination
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  
  // Sorting
  sortBy: z.enum(['applicationDate', 'decisionDate', 'waitingDays', 'createdAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ============================================
// STATS SCHEMAS
// ============================================

export const overviewStatsSchema = z.object({
  totalCases: z.number(),
  casesLast30Days: z.number(),
  medianWaitingDays: z.number().nullable(),
  averageWaitingDays: z.number().nullable(),
  approvalRate: z.number().nullable(), // Percentage
  byRoute: z.array(z.object({
    route: z.string(),
    count: z.number(),
    medianDays: z.number().nullable(),
  })),
  byMonth: z.array(z.object({
    month: z.string(), // YYYY-MM format
    count: z.number(),
    medianDays: z.number().nullable(),
  })),
});

// ============================================
// SCRAPE RUN SCHEMAS
// ============================================

export const scrapeRunSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  status: z.enum(['running', 'completed', 'failed']),
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable(),
  threadsFound: z.number(),
  threadsScraped: z.number(),
  postsFound: z.number(),
  postsScraped: z.number(),
  casesExtracted: z.number(),
  errorMessage: z.string().nullable(),
});

export const triggerScrapeSchema = z.object({
  sourceId: z.string(),
  since: z.coerce.date().optional(),
  maxThreads: z.number().int().positive().optional(),
});

// ============================================
// AUTH SCHEMAS
// ============================================

export const userRoleSchema = z.object({
  id: z.string(),
  userId: z.string(),
  role: z.enum(['user', 'admin']),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// ============================================
// API RESPONSE SCHEMAS
// ============================================

export const paginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    pagination: z.object({
      page: z.number(),
      limit: z.number(),
      total: z.number(),
      totalPages: z.number(),
    }),
  });

export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  statusCode: z.number(),
});
