import type { z } from 'zod';
import type {
  sourceForumSchema,
  createSourceForumSchema,
  updateSourceForumSchema,
  extractedCaseSchema,
  casesQuerySchema,
  overviewStatsSchema,
  scrapeRunSchema,
  triggerScrapeSchema,
  userRoleSchema,
  apiErrorSchema,
} from '../schemas/index.js';

// ============================================
// INFERRED TYPES FROM SCHEMAS
// ============================================

export type SourceForum = z.infer<typeof sourceForumSchema>;
export type CreateSourceForum = z.infer<typeof createSourceForumSchema>;
export type UpdateSourceForum = z.infer<typeof updateSourceForumSchema>;

export type ExtractedCase = z.infer<typeof extractedCaseSchema>;

export type CasesQuery = z.infer<typeof casesQuerySchema>;
export type OverviewStats = z.infer<typeof overviewStatsSchema>;

export type ScrapeRun = z.infer<typeof scrapeRunSchema>;
export type TriggerScrape = z.infer<typeof triggerScrapeSchema>;

export type UserRole = z.infer<typeof userRoleSchema>;

export type ApiError = z.infer<typeof apiErrorSchema>;

// ============================================
// ADDITIONAL TYPES
// ============================================

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface AuthUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
}

// Case with related post info (for API responses)
export interface CaseWithSource extends ExtractedCase {
  post: {
    id: string;
    content: string;
    authorName: string | null;
    postedAt: Date | null;
    thread: {
      id: string;
      title: string;
      url: string;
      source: {
        id: string;
        name: string;
        displayName: string;
      };
    };
  };
}

// ============================================
// WORKER TYPES
// ============================================

export interface ScrapedThread {
  externalId: string;
  url: string;
  title: string;
  authorName?: string;
  postedAt?: Date;
}

export interface ScrapedPost {
  externalId: string;
  authorName?: string;
  content: string;
  postedAt?: Date;
  pageNumber?: number; // Which page of the thread this post was on
}

export interface ScrapeProgress {
  lastScrapedPage: number;
  totalPages: number;
}

export interface ExtractionResult {
  applicationType?: string;
  applicationRoute?: string;
  applicationDate?: Date;
  biometricsDate?: Date;
  decisionDate?: Date;
  waitingDays?: number;
  serviceCenter?: string;
  applicantLocation?: string;
  outcome?: 'approved' | 'rejected' | 'pending' | 'unknown';
  confidence: number;
  extractionNotes?: string;
}

export interface SourceAdapter {
  name: string;
  type: 'playwright' | 'fetch';
  
  // Get list of threads to scrape
  getThreads(options: { since?: Date; maxThreads?: number }): Promise<ScrapedThread[]>;
  
  // Get posts from a thread
  // startFromPage: for resume capability - which page to start from (1-indexed)
  // Returns posts and progress info
  getPosts(
    thread: ScrapedThread, 
    options?: { startFromPage?: number; onProgress?: (progress: ScrapeProgress) => Promise<void> }
  ): Promise<{ posts: ScrapedPost[]; progress: ScrapeProgress }>;
  
  // Clean up resources (e.g., close browser)
  cleanup?(): Promise<void>;
}
