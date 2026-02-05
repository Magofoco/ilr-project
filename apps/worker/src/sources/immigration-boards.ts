import { chromium, type Browser, type Page } from 'playwright';
import type { SourceForum } from '@ilr/db';
import type { SourceAdapter, ScrapedThread, ScrapedPost, ScrapeProgress } from '@ilr/shared';
import { delay, getJitter } from '../utils/helpers.js';

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
 * - Handles cookie consent and popups
 */
export function createImmigrationBoardsAdapter(source: SourceForum): SourceAdapter {
  let browser: Browser | null = null;

  const getConfig = () => {
    const config = source.config as {
      threadUrl?: string;
      postsPerPage?: number;
    };
    
    return {
      // The specific ILR timelines thread
      threadUrl: config.threadUrl || 'https://www.immigrationboards.com/viewtopic.php?t=231555',
      postsPerPage: config.postsPerPage || 25,
    };
  };

  const initBrowser = async (): Promise<Browser> => {
    if (!browser) {
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
        ],
      });
    }
    return browser;
  };

  const closeBrowser = async (): Promise<void> => {
    if (browser) {
      await browser.close();
      browser = null;
    }
  };

  /**
   * Handle cookie consent and other popups
   */
  const handlePopups = async (page: Page): Promise<void> => {
    try {
      // Cookie consent buttons (various phpBB themes)
      const consentSelectors = [
        'button[aria-label="Consent"]',
        '.cc-btn.cc-allow',
        '#cookie-accept',
        'button:has-text("Accept")',
        'button:has-text("I agree")',
        '.cookie-consent-accept',
      ];

      for (const selector of consentSelectors) {
        try {
          const button = page.locator(selector).first();
          if (await button.isVisible({ timeout: 1000 })) {
            await button.click();
            await delay(500);
            break;
          }
        } catch {
          // Selector not found, continue
        }
      }

      // "Do not show this again" checkbox
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
      } catch {
        // No popup
      }
    } catch (error) {
      console.log('  Note: Error handling popups (non-fatal):', error);
    }
  };

  /**
   * Get total number of pages in a thread
   */
  const getTotalPages = async (page: Page): Promise<number> => {
    try {
      // phpBB pagination: look for the last page number
      // Common patterns: "Page 1 of 161" or pagination links like "161"
      
      // Try "Page X of Y" text
      const pageText = await page.locator('.pagination').textContent();
      if (pageText) {
        const match = pageText.match(/of\s+(\d+)/i);
        if (match && match[1]) {
          return parseInt(match[1], 10);
        }
      }

      // Try finding the highest page number in pagination links
      const pageLinks = await page.locator('.pagination a, .pagination li').allTextContents();
      let maxPage = 1;
      for (const text of pageLinks) {
        const num = parseInt(text.trim(), 10);
        if (!isNaN(num) && num > maxPage) {
          maxPage = num;
        }
      }
      return maxPage;
    } catch {
      return 1;
    }
  };

  /**
   * Navigate to a specific page of the thread
   */
  const navigateToPage = async (page: Page, threadUrl: string, pageNum: number, postsPerPage: number): Promise<void> => {
    const start = (pageNum - 1) * postsPerPage;
    const url = start === 0 ? threadUrl : `${threadUrl}&start=${start}`;
    
    console.log(`  Navigating to page ${pageNum}: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await handlePopups(page);
  };

  /**
   * Remove quoted content from HTML
   * phpBB uses <blockquote> tags for quotes
   */
  const removeQuotedContent = (html: string): string => {
    // Remove blockquote elements (quoted replies)
    let cleaned = html.replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, '');
    
    // Also remove divs with quote classes
    cleaned = cleaned.replace(/<div[^>]*class="[^"]*quote[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
    
    // Remove "wrote:" citation lines that might remain
    cleaned = cleaned.replace(/[^<]+wrote:\s*↑[^<]*/gi, '');
    
    return cleaned;
  };

  /**
   * Convert HTML to plain text
   */
  const htmlToText = (html: string): string => {
    return html
      // Remove script and style tags with content
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      // Replace <br> with newlines
      .replace(/<br\s*\/?>/gi, '\n')
      // Replace block elements with newlines
      .replace(/<\/(p|div|li|tr)>/gi, '\n')
      // Remove all other HTML tags
      .replace(/<[^>]+>/g, ' ')
      // Decode common HTML entities
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // Collapse multiple spaces/newlines
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();
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
   * Extract posts from the current page
   */
  const extractPostsFromPage = async (page: Page, pageNum: number): Promise<ScrapedPost[]> => {
    const posts: ScrapedPost[] = [];
    
    // phpBB post structure
    // Posts are typically in .post or div[id^="p"] elements
    const postElements = await page.locator('.post, div[id^="p"]').all();
    console.log(`    Found ${postElements.length} post elements on page ${pageNum}`);
    
    for (const postEl of postElements) {
      try {
        // Get post ID from the element or its anchor
        // phpBB posts have id like "p1234567" or contain #p1234567 anchor
        let externalId: string | null = null;
        
        // Try to get ID from element
        const elementId = await postEl.getAttribute('id');
        if (elementId?.startsWith('p')) {
          externalId = elementId;
        }
        
        // Try to get from anchor link
        if (!externalId) {
          try {
            const anchor = postEl.locator('a[href*="#p"]').first();
            const href = await anchor.getAttribute('href');
            if (href) {
              const match = href.match(/#(p\d+)/);
              if (match && match[1]) {
                externalId = match[1];
              }
            }
          } catch {
            // No anchor found
          }
        }
        
        // Fallback: generate ID from page and position
        if (!externalId) {
          const index = postElements.indexOf(postEl);
          externalId = `page${pageNum}-post${index}`;
        }
        
        // Get post content - use innerHTML to properly strip quotes
        let content = '';
        try {
          // Try phpBB content selectors
          const contentEl = postEl.locator('.content, .postbody .content, .post-text').first();
          const rawHtml = await contentEl.innerHTML();
          
          // Strip quoted content and convert to text
          const cleanedHtml = removeQuotedContent(rawHtml);
          content = htmlToText(cleanedHtml);
        } catch {
          // Fallback to textContent
          content = (await postEl.textContent()) || '';
        }
        
        // Skip very short posts (likely empty or just quotes)
        if (content.length < 30) {
          continue;
        }
        
        // Get author name
        let authorName: string | undefined;
        try {
          // phpBB author selectors
          const authorEl = postEl.locator('.postprofile .username, .author .username, .postauthor').first();
          const authorText = (await authorEl.textContent())?.trim();
          authorName = authorText || undefined;
        } catch {
          // No author found
        }
        
        // Get post date
        let postedAt: Date | undefined;
        try {
          // phpBB date selectors
          const dateEl = postEl.locator('.postprofile time, .author time, time').first();
          const datetime = await dateEl.getAttribute('datetime');
          if (datetime) {
            postedAt = new Date(datetime);
          } else {
            const dateText = await dateEl.textContent();
            if (dateText) {
              postedAt = parsePhpBBDate(dateText);
            }
          }
        } catch {
          // No date found
        }
        
        posts.push({
          externalId,
          content,
          authorName,
          postedAt,
          pageNumber: pageNum,
        });
      } catch (error) {
        console.log(`    Warning: Error extracting post:`, error);
      }
    }
    
    return posts;
  };

  return {
    name: source.name,
    type: source.type as 'playwright' | 'fetch',

    async getThreads(options): Promise<ScrapedThread[]> {
      const config = getConfig();
      
      // For this adapter, we have a single hardcoded thread
      // In the future, you could expand this to discover threads from a forum section
      const threadUrl = config.threadUrl;
      
      // Extract thread ID from URL
      const threadIdMatch = threadUrl.match(/t=(\d+)/);
      const externalId = threadIdMatch ? `t${threadIdMatch[1]}` : 'unknown';
      
      return [{
        externalId,
        url: threadUrl,
        title: 'ILR TIMELINES- SET(O) SET(F) SET(M) (not Set(LR) PLS)',
        postedAt: new Date('2017-05-21'), // Original thread date
      }];
    },

    async getPosts(thread, options = {}): Promise<{ posts: ScrapedPost[]; progress: ScrapeProgress }> {
      const config = getConfig();
      const posts: ScrapedPost[] = [];
      const startFromPage = options.startFromPage || 1;
      
      const browser = await initBrowser();
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();

      // Block unnecessary resources for speed
      await page.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
          route.abort();
        } else {
          route.continue();
        }
      });

      let totalPages = 1;
      let currentPage = startFromPage;

      try {
        // First, navigate to get total pages
        await navigateToPage(page, thread.url, 1, config.postsPerPage);
        await page.waitForSelector('.post, div[id^="p"]', { timeout: 15000 });
        
        totalPages = await getTotalPages(page);
        console.log(`  Thread has ${totalPages} pages total`);
        
        // If starting from a specific page, navigate there
        if (startFromPage > 1) {
          console.log(`  Resuming from page ${startFromPage}`);
          await navigateToPage(page, thread.url, startFromPage, config.postsPerPage);
        }
        
        // Scrape pages from startFromPage to end
        // We scrape newest first (last page first) to get latest updates
        // But for initial scrape, go forward to support resume
        for (currentPage = startFromPage; currentPage <= totalPages; currentPage++) {
          if (currentPage > startFromPage) {
            await navigateToPage(page, thread.url, currentPage, config.postsPerPage);
          }
          
          // Wait for posts to load
          await page.waitForSelector('.post, div[id^="p"]', { timeout: 15000 });
          
          // Extract posts from this page
          const pagePosts = await extractPostsFromPage(page, currentPage);
          posts.push(...pagePosts);
          console.log(`    Extracted ${pagePosts.length} posts from page ${currentPage}`);
          
          // Report progress if callback provided
          const progress: ScrapeProgress = {
            lastScrapedPage: currentPage,
            totalPages,
          };
          
          if (options.onProgress) {
            await options.onProgress(progress);
          }
          
          // Rate limiting between pages
          if (currentPage < totalPages) {
            const waitTime = getJitter();
            console.log(`    Waiting ${Math.round(waitTime / 1000)}s before next page...`);
            await delay(waitTime);
          }
        }
        
        return {
          posts,
          progress: {
            lastScrapedPage: totalPages,
            totalPages,
          },
        };
      } catch (error) {
        console.error(`  Error scraping thread at page ${currentPage}:`, error);
        
        // Return what we have so far with current progress
        return {
          posts,
          progress: {
            lastScrapedPage: currentPage - 1, // Last successfully completed page
            totalPages,
          },
        };
      } finally {
        await context.close();
        // Don't close browser here - might be reused
      }
    },

    async cleanup(): Promise<void> {
      await closeBrowser();
    },
  };
}
