import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { SourceForum } from '@ilr/db';
import type { SourceAdapter, ScrapedThread, ScrapedPost, ScrapeProgress, GetPostsResult } from '@ilr/shared';
import { retryWithBackoff, stripHtmlWithQuotes, delay as sharedDelay } from '@ilr/shared';
import { getJitter } from '../utils/helpers.js';

// Use shared delay
const delay = sharedDelay;

// Fast timeout for element queries (2 seconds instead of default 30s)
const FAST_TIMEOUT = 2_000;

// Maximum time to spend on a single page (navigation + extraction)
const PAGE_TIMEOUT_MS = 45_000; // 45 seconds (extraction is fast via page.evaluate)

// Maximum consecutive page failures before aborting the thread
const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * Strip session IDs from URLs to avoid stale/expired session parameters.
 * phpBB appends &sid=xxx or ?sid=xxx which expire and can cause redirects.
 */
function stripSessionId(url: string): string {
  return url
    .replace(/[?&]sid=[a-f0-9]+/gi, '')
    .replace(/\?&/, '?')     // Fix ?& left after stripping
    .replace(/&&+/g, '&')    // Fix double &&
    .replace(/[?&]$/, '');   // Fix trailing ? or &
}

/**
 * Adapter for immigrationboards.com (phpBB forum)
 * 
 * Specifically designed to scrape the ILR timelines thread:
 * https://www.immigrationboards.com/viewtopic.php?t=231555
 * 
 * Features:
 * - Extracts actual phpBB post IDs for stable deduplication
 * - Strips quoted content to avoid extracting old data
 * - Supports resume from a specific page
 * - Handles cookie consent and popups (with state tracking)
 * - Browser crash recovery with automatic relaunch
 * - Per-page timeout to prevent hangs
 * - Progress logging with ETA
 */
export function createImmigrationBoardsAdapter(source: SourceForum): SourceAdapter {
  let browser: Browser | null = null;

  // Track which popups we've already dismissed in this session.
  // Once a popup is dismissed (and cookies saved), it typically won't reappear.
  const popupState = {
    consent: false,
    notifications: false,
    login: false,
    doNotShow: false,
  };

  const getConfig = () => {
    const config = source.config as {
      threadUrl?: string;
      postsPerPage?: number;
    };

    const rawUrl = config.threadUrl || 'https://www.immigrationboards.com/viewtopic.php?t=231555';
    
    return {
      threadUrl: stripSessionId(rawUrl),
      postsPerPage: config.postsPerPage || 25,
    };
  };

  const initBrowser = async (): Promise<Browser> => {
    if (browser?.isConnected()) {
      return browser;
    }
    
    // Close stale browser reference if disconnected
    if (browser) {
      try { await browser.close(); } catch { /* already dead */ }
      browser = null;
    }

    console.log('  Launching browser...');
    browser = await chromium.launch({
      headless: process.env.HEADLESS !== 'false',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--single-process',
      ],
    });

    // Auto-cleanup on unexpected disconnect
    browser.on('disconnected', () => {
      console.warn('  Browser disconnected unexpectedly');
      browser = null;
    });

    return browser;
  };

  /**
   * Create a browser context with consistent settings.
   * Keeping the context alive across pages preserves cookies (popup dismissals).
   */
  const createContext = async (browserInstance: Browser): Promise<BrowserContext> => {
    return browserInstance.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'en-GB',
      timezoneId: 'Europe/London',
    });
  };

  const closeBrowser = async (): Promise<void> => {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Already closed
      }
      browser = null;
    }
  };

  /**
   * Handle cookie consent and other popups.
   * Tracks state so we skip popups already dismissed in this session.
   */
  const handlePopups = async (page: Page): Promise<void> => {
    // If all popups already dismissed, skip entirely
    if (popupState.consent && popupState.notifications && popupState.login && popupState.doNotShow) {
      return;
    }

    try {
      // Brief wait for CMP to load (only on first page or if consent not yet handled)
      if (!popupState.consent) {
        await delay(2000);
      } else {
        await delay(500); // Shorter wait for subsequent popups
      }

      // 1. Google Funding Choices CMP (iframe-based consent)
      if (!popupState.consent) {
        let dismissed = false;
        for (const frame of page.frames()) {
          try {
            const consentBtn = frame.locator('button.fc-cta-consent').first();
            if (await consentBtn.isVisible({ timeout: 1500 })) {
              console.log('  Dismissing Funding Choices consent popup...');
              await consentBtn.click();
              await delay(1000);
              popupState.consent = true;
              dismissed = true;
              break;
            }
          } catch {
            // Not in this frame
          }
        }

        // Fallback: other CMP implementations
        if (!dismissed) {
          const consentSelectors = [
            'button[aria-label="Consent"]',
            'button:has-text("Consent")',
            '.cc-btn.cc-allow',
            '#cookie-accept',
            'button:has-text("Accept")',
            'button:has-text("I agree")',
            '.cookie-consent-accept',
          ];

          for (const selector of consentSelectors) {
            try {
              const button = page.locator(selector).first();
              if (await button.isVisible({ timeout: 500 })) {
                console.log(`  Dismissing consent popup (${selector})...`);
                await button.click();
                await delay(500);
                popupState.consent = true;
                break;
              }
            } catch {
              // Selector not found, continue
            }
          }
        }

        // If we checked all selectors and none visible, assume no consent needed
        if (!dismissed) {
          popupState.consent = true;
        }
      }

      // 2. Dismiss "allow notifications" overlay
      if (!popupState.notifications) {
        try {
          const closeBtn = page.locator('#close, div#close').first();
          if (await closeBtn.isVisible({ timeout: 1000 })) {
            console.log('  Dismissing notifications popup...');
            await closeBtn.click();
            await delay(500);
          }
          popupState.notifications = true;
        } catch {
          popupState.notifications = true; // Don't check again
        }
      }

      // 3. Dismiss login popup (click "Do not show")
      if (!popupState.login) {
        try {
          const loginClose = page.locator('#login_popup_close').first();
          if (await loginClose.isVisible({ timeout: 1000 })) {
            console.log('  Dismissing login popup...');
            await loginClose.click();
            await delay(500);
          }
          popupState.login = true;
        } catch {
          popupState.login = true; // Don't check again
        }
      }

      // 4. "Do not show this again" checkbox (phpBB-specific)
      if (!popupState.doNotShow) {
        try {
          const doNotShow = page.locator('input[name="popup_no_show"]');
          if (await doNotShow.isVisible({ timeout: 500 })) {
            await doNotShow.check();
            const submitBtn = page.locator('input[type="submit"][value="OK"]');
            if (await submitBtn.isVisible({ timeout: 500 })) {
              await submitBtn.click();
              await delay(500);
            }
          }
          popupState.doNotShow = true;
        } catch {
          popupState.doNotShow = true;
        }
      }
    } catch (error) {
      console.log('  Note: Error handling popups (non-fatal):', (error as Error).message);
    }
  };

  /**
   * Get total number of pages in a thread
   */
  const getTotalPages = async (page: Page): Promise<number> => {
    try {
      // Method 1: phpBB sr-only span "Page X of Y"
      try {
        const srOnly = await page.locator('.pagination .sr-only').first().textContent({ timeout: FAST_TIMEOUT });
        if (srOnly) {
          const match = srOnly.match(/of\s+(\d+)/i);
          if (match && match[1]) {
            return parseInt(match[1], 10);
          }
        }
      } catch {
        // No sr-only element
      }

      // Method 2: Find the last numbered page link in pagination
      try {
        const pageLinks = await page.locator('.pagination li a.button').allTextContents();
        let maxPage = 1;
        for (const text of pageLinks) {
          const num = parseInt(text.trim(), 10);
          if (!isNaN(num) && num > maxPage) {
            maxPage = num;
          }
        }
        if (maxPage > 1) return maxPage;
      } catch {
        // No pagination links
      }

      // Method 3: Full pagination text fallback
      try {
        const pageText = await page.locator('.pagination').textContent({ timeout: FAST_TIMEOUT });
        if (pageText) {
          const match = pageText.match(/of\s+(\d+)/i);
          if (match && match[1]) {
            return parseInt(match[1], 10);
          }
        }
      } catch {
        // No pagination
      }

      return 1;
    } catch {
      return 1;
    }
  };

  /**
   * Build a clean pagination URL for the given page number.
   * Strips session IDs and constructs the URL deterministically.
   */
  const buildPageUrl = (threadUrl: string, pageNum: number, postsPerPage: number): string => {
    const cleanUrl = stripSessionId(threadUrl);
    const start = (pageNum - 1) * postsPerPage;
    return start === 0 ? cleanUrl : `${cleanUrl}&start=${start}`;
  };

  /**
   * Navigate to a specific page of the thread with retry logic
   */
  const navigateToPage = async (page: Page, threadUrl: string, pageNum: number, postsPerPage: number): Promise<void> => {
    const url = buildPageUrl(threadUrl, pageNum, postsPerPage);
    
    await retryWithBackoff(
      async () => {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      },
      {
        maxAttempts: 3,
        initialDelayMs: 2000,
        onRetry: (attempt, error, nextDelay) => {
          console.log(`    Retry ${attempt}/3 for page ${pageNum} after ${Math.round(nextDelay / 1000)}s: ${error.message}`);
        },
        isRetryable: (error) => {
          const message = error.message.toLowerCase();
          return message.includes('timeout') || 
                 message.includes('network') || 
                 message.includes('connection') ||
                 message.includes('econnreset') ||
                 message.includes('enotfound') ||
                 message.includes('econnrefused') ||
                 message.includes('err_') ||
                 message.includes('target closed');
        },
      }
    );
    
    await handlePopups(page);
  };

  /**
   * Parse phpBB date formats
   * Examples: "Mon Sep 22, 2025 5:23 pm", "Tue Sep 23, 2025 9:11 am"
   */
  const parsePhpBBDate = (dateStr: string): Date | undefined => {
    if (!dateStr) return undefined;
    
    const str = dateStr.trim();
    
    // Try direct Date parsing first
    const direct = new Date(str);
    if (!isNaN(direct.getTime())) {
      return direct;
    }
    
    // Parse phpBB format: "Mon Sep 22, 2025 5:23 pm"
    const phpbbMatch = str.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)?/i);
    if (phpbbMatch) {
      const [, monthStr, dayStr, yearStr, hourStr, minuteStr, ampm] = phpbbMatch;
      
      const months: Record<string, number> = {
        jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
        jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
      };
      
      const month = months[monthStr!.toLowerCase().slice(0, 3)];
      if (month === undefined) return undefined;
      
      const day = parseInt(dayStr!, 10);
      const year = parseInt(yearStr!, 10);
      let hour = parseInt(hourStr!, 10);
      const minute = parseInt(minuteStr!, 10);
      
      if (ampm?.toLowerCase() === 'pm' && hour < 12) hour += 12;
      if (ampm?.toLowerCase() === 'am' && hour === 12) hour = 0;
      
      return new Date(year, month, day, hour, minute);
    }
    
    return undefined;
  };

  /**
   * Extract all posts from the current page in a single page.evaluate() call.
   * This is dramatically faster than per-element Playwright locators because
   * it runs as a single IPC round-trip to the browser instead of hundreds.
   */
  const extractPostsFromPage = async (page: Page, pageNum: number): Promise<ScrapedPost[]> => {
    // Run extraction entirely in the browser context — one call, no locator timeouts
    // The callback runs in the browser, so DOM types are available at runtime.
    // We use explicit return type to satisfy TypeScript without needing 'dom' lib.
    const rawPosts = await page.evaluate((pgNum) => {
      const results: Array<{
        externalId: string;
        contentHtml: string;
        authorName: string | null;
        dateIso: string | null;
        dateText: string | null;
      }> = [];

      const postElements = document.querySelectorAll('.post, div[id^="p"]');

      postElements.forEach((postEl: Element, i: number) => {
        // 1. Get post ID
        let externalId: string | null = null;

        const elId = postEl.getAttribute('id');
        if (elId?.startsWith('p')) {
          externalId = elId;
        }

        if (!externalId) {
          const anchor = postEl.querySelector('a[href*="#p"]');
          if (anchor) {
            const href = anchor.getAttribute('href') || '';
            const match = href.match(/#(p\d+)/);
            if (match?.[1]) {
              externalId = match[1];
            }
          }
        }

        if (!externalId) {
          externalId = `page${pgNum}-post${i}`;
        }

        // 2. Get content HTML (to be stripped in Node)
        const contentEl = postEl.querySelector('.content, .postbody .content, .post-text');
        const contentHtml = contentEl ? contentEl.innerHTML : (postEl.textContent || '');

        // 3. Get author name
        const authorEl = postEl.querySelector('.postprofile .username, .author .username, .postauthor');
        const authorName = authorEl ? authorEl.textContent?.trim() || null : null;

        // 4. Get date
        const dateEl = postEl.querySelector('.postprofile time, .author time, time');
        const dateIso = dateEl ? dateEl.getAttribute('datetime') : null;
        const dateText = (!dateIso && dateEl) ? dateEl.textContent?.trim() || null : null;

        results.push({ externalId, contentHtml, authorName, dateIso, dateText });
      });

      return results;
    }, pageNum);

    // Process raw posts in Node (strip HTML, parse dates, filter)
    const posts: ScrapedPost[] = [];

    for (const raw of rawPosts) {
      try {
        const content = stripHtmlWithQuotes(raw.contentHtml);

        // Skip very short posts (likely empty or just quotes)
        if (content.length < 30) {
          continue;
        }

        let postedAt: Date | undefined;
        if (raw.dateIso) {
          postedAt = new Date(raw.dateIso);
          if (isNaN(postedAt.getTime())) postedAt = undefined;
        } else if (raw.dateText) {
          postedAt = parsePhpBBDate(raw.dateText);
        }

        posts.push({
          externalId: raw.externalId,
          content,
          authorName: raw.authorName || undefined,
          postedAt,
          pageNumber: pageNum,
        });
      } catch (error) {
        console.log(`    Warning: Error processing post ${raw.externalId} on page ${pageNum}:`, (error as Error).message);
      }
    }

    return posts;
  };

  /**
   * Process a single page with timeout protection.
   * Returns null if the page fails after retries (caller should skip and continue).
   */
  const processPageWithTimeout = async (
    page: Page,
    threadUrl: string,
    pageNum: number,
    postsPerPage: number,
    isFirstPage: boolean,
  ): Promise<ScrapedPost[] | null> => {
    return Promise.race([
      (async () => {
        if (!isFirstPage) {
          await navigateToPage(page, threadUrl, pageNum, postsPerPage);
          await page.waitForSelector('.post, div[id^="p"]', { timeout: 15_000 });
        }
        return extractPostsFromPage(page, pageNum);
      })(),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error(`Page ${pageNum} timed out after ${PAGE_TIMEOUT_MS / 1000}s`)), PAGE_TIMEOUT_MS)
      ),
    ]);
  };

  /**
   * Format seconds into human-readable duration
   */
  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  };

  return {
    name: source.name,
    type: source.type as 'playwright' | 'fetch',

    async getThreads(): Promise<ScrapedThread[]> {
      const config = getConfig();
      const threadUrl = config.threadUrl;
      
      const threadIdMatch = threadUrl.match(/t=(\d+)/);
      const externalId = threadIdMatch ? `t${threadIdMatch[1]}` : 'unknown';
      
      return [{
        externalId,
        url: threadUrl,
        title: 'ILR TIMELINES- SET(O) SET(F) SET(M) (not Set(LR) PLS)',
        postedAt: new Date('2017-05-21'),
      }];
    },

    async getPosts(thread, options = {}): Promise<GetPostsResult> {
      const config = getConfig();
      const startFromPage = options.startFromPage || 1;
      let totalPostsScraped = 0;
      
      // Reset popup state for new scrape session
      popupState.consent = false;
      popupState.notifications = false;
      popupState.login = false;
      popupState.doNotShow = false;
      
      let currentBrowser = await initBrowser();
      let context = await createContext(currentBrowser);
      let page = await context.newPage();

      // Block heavy resources for speed, but keep stylesheets
      const setupResourceBlocking = async (p: Page) => {
        await p.route('**/*', (route) => {
          const resourceType = route.request().resourceType();
          if (['image', 'font', 'media'].includes(resourceType)) {
            route.abort();
          } else {
            route.continue();
          }
        });
      };
      await setupResourceBlocking(page);

      let totalPages = 1;
      let currentPage = startFromPage;
      let consecutiveFailures = 0;
      const startTime = Date.now();
      let pagesCompleted = 0;

      try {
        // Navigate to starting page to get total pages
        const cleanThreadUrl = stripSessionId(thread.url);
        await navigateToPage(page, cleanThreadUrl, startFromPage, config.postsPerPage);
        await page.waitForSelector('.post, div[id^="p"]', { timeout: 15_000 });
        
        totalPages = await getTotalPages(page);
        const totalPagesToScrape = totalPages - startFromPage + 1;
        console.log(`  Thread has ${totalPages} pages total, scraping ${totalPagesToScrape} pages (${startFromPage} to ${totalPages})`);
        
        // Scrape pages — stream each page's posts to the caller immediately
        for (currentPage = startFromPage; currentPage <= totalPages; currentPage++) {
          const isFirstPage = currentPage === startFromPage;

          try {
            const pagePosts = await processPageWithTimeout(
              page, cleanThreadUrl, currentPage, config.postsPerPage, isFirstPage
            );

            if (pagePosts && pagePosts.length > 0) {
              // Stream posts to caller for immediate DB persistence
              if (options.onPageData) {
                await options.onPageData(pagePosts, currentPage);
              }

              totalPostsScraped += pagePosts.length;
              consecutiveFailures = 0;
              pagesCompleted++;
              
              // Progress logging with ETA
              const elapsed = (Date.now() - startTime) / 1000;
              const avgPerPage = elapsed / pagesCompleted;
              const remaining = (totalPages - currentPage) * avgPerPage;
              
              if (currentPage === startFromPage || currentPage % 10 === 0 || currentPage === totalPages) {
                console.log(
                  `    Page ${currentPage}/${totalPages}: ${pagePosts.length} posts` +
                  ` | ${pagesCompleted}/${totalPagesToScrape} done` +
                  ` | ETA: ${formatDuration(remaining)}` +
                  ` | Total posts: ${totalPostsScraped}`
                );
              }
            } else {
              console.warn(`    Page ${currentPage}: No posts extracted (skipping)`);
              consecutiveFailures++;
            }
          } catch (error) {
            consecutiveFailures++;
            const errMsg = error instanceof Error ? error.message : String(error);
            console.error(`    Page ${currentPage} failed (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${errMsg}`);

            // If browser crashed, try to recover
            if (errMsg.includes('Target closed') || errMsg.includes('browser has been closed') || errMsg.includes('Protocol error')) {
              console.log('    Browser appears crashed, attempting recovery...');
              try {
                await context.close().catch(() => {});
                await closeBrowser();
                
                currentBrowser = await initBrowser();
                context = await createContext(currentBrowser);
                page = await context.newPage();
                await setupResourceBlocking(page);
                
                // Reset popup state since we have a new context
                popupState.consent = false;
                popupState.notifications = false;
                popupState.login = false;
                popupState.doNotShow = false;
                
                console.log('    Browser recovered, resuming from page', currentPage);
                consecutiveFailures = 0;
                currentPage--; // Retry this page
                continue;
              } catch (recoveryError) {
                console.error('    Browser recovery failed:', (recoveryError as Error).message);
              }
            }
          }

          // Abort if too many consecutive failures
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            console.error(`  Aborting: ${MAX_CONSECUTIVE_FAILURES} consecutive page failures`);
            break;
          }
          
          // Report progress (for saving resume state in DB)
          if (options.onProgress) {
            await options.onProgress({ lastScrapedPage: currentPage, totalPages });
          }
          
          // Rate limiting between pages
          if (currentPage < totalPages) {
            const waitTime = getJitter();
            await delay(waitTime);
          }
        }
        
        // Final summary
        const totalElapsed = (Date.now() - startTime) / 1000;
        console.log(
          `  Scrape complete: ${totalPostsScraped} posts from ${pagesCompleted} pages in ${formatDuration(totalElapsed)}` +
          (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ? ' (aborted due to failures)' : '')
        );
        
        return {
          totalPosts: totalPostsScraped,
          progress: {
            lastScrapedPage: consecutiveFailures >= MAX_CONSECUTIVE_FAILURES
              ? currentPage - consecutiveFailures
              : totalPages,
            totalPages,
          },
        };
      } catch (error) {
        const totalElapsed = (Date.now() - startTime) / 1000;
        console.error(`  Error scraping thread at page ${currentPage} after ${formatDuration(totalElapsed)}:`, error);
        
        return {
          totalPosts: totalPostsScraped,
          progress: {
            lastScrapedPage: Math.max(currentPage - 1, startFromPage),
            totalPages,
          },
        };
      } finally {
        try {
          await context.close();
        } catch {
          // Context may already be closed
        }
      }
    },

    async cleanup(): Promise<void> {
      await closeBrowser();
    },
  };
}
