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

export interface GetPostsOptions {
  /** Page to start scraping from (1-indexed). Used for resume. */
  startFromPage?: number;
  
  /** Called after each page is scraped with that page's posts.
   *  The runner should persist these immediately — the adapter does NOT accumulate them. */
  onPageData?: (posts: ScrapedPost[], pageNum: number) => Promise<void>;

  /** Called with progress info (for saving resume state). */
  onProgress?: (progress: ScrapeProgress) => Promise<void>;
}

export interface GetPostsResult {
  /** Total number of posts scraped across all pages. */
  totalPosts: number;
  /** Final progress state. */
  progress: ScrapeProgress;
}

export interface SourceAdapter {
  name: string;
  type: 'playwright' | 'fetch';
  
  /** Get list of threads to scrape. */
  getThreads(options: { since?: Date; maxThreads?: number }): Promise<ScrapedThread[]>;
  
  /** Scrape posts from a thread, streaming each page via onPageData callback.
   *  Posts are NOT accumulated in memory — the caller is responsible for persisting
   *  each page's posts as they arrive. */
  getPosts(
    thread: ScrapedThread, 
    options?: GetPostsOptions
  ): Promise<GetPostsResult>;
  
  /** Clean up resources (e.g., close browser). */
  cleanup?(): Promise<void>;
}
