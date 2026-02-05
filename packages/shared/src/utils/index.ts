/**
 * Shared utility functions
 */

export interface RetryOptions {
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number;
  /** Initial delay in ms before first retry (default: 2000) */
  initialDelayMs?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Maximum delay between retries in ms (default: 30000) */
  maxDelayMs?: number;
  /** Optional callback for logging retries */
  onRetry?: (attempt: number, error: Error, nextDelayMs: number) => void;
  /** Optional function to determine if error is retryable (default: all errors) */
  isRetryable?: (error: Error) => boolean;
}

/**
 * Execute an async function with retry logic and exponential backoff
 * 
 * @example
 * ```ts
 * const result = await retryWithBackoff(
 *   () => fetchData(),
 *   { 
 *     maxAttempts: 3,
 *     onRetry: (attempt, err) => console.log(`Retry ${attempt}: ${err.message}`)
 *   }
 * );
 * ```
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 2000,
    backoffMultiplier = 2,
    maxDelayMs = 30000,
    onRetry,
    isRetryable = () => true,
  } = options;

  let lastError: Error | null = null;
  let currentDelay = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if this is the last attempt or if error is not retryable
      if (attempt === maxAttempts || !isRetryable(lastError)) {
        throw lastError;
      }

      // Calculate next delay with jitter (±20%)
      const jitter = 0.8 + Math.random() * 0.4;
      const delayWithJitter = Math.min(currentDelay * jitter, maxDelayMs);

      // Call retry callback if provided
      if (onRetry) {
        onRetry(attempt, lastError, delayWithJitter);
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delayWithJitter));

      // Increase delay for next attempt
      currentDelay = Math.min(currentDelay * backoffMultiplier, maxDelayMs);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError || new Error('Retry failed');
}

/**
 * Simple delay function
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Strip HTML tags and decode entities, removing nested blockquotes
 */
export function stripHtmlWithQuotes(html: string): string {
  let cleaned = html;

  // Recursively remove blockquotes (handles nested quotes)
  let previousLength: number;
  do {
    previousLength = cleaned.length;
    // Remove innermost blockquotes first
    cleaned = cleaned.replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, '');
  } while (cleaned.length !== previousLength);

  // Remove divs with quote classes
  do {
    previousLength = cleaned.length;
    cleaned = cleaned.replace(/<div[^>]*class="[^"]*quote[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  } while (cleaned.length !== previousLength);

  // Remove "wrote:" citation lines
  cleaned = cleaned.replace(/[^<\n]+wrote:\s*↑[^\n<]*/gi, '');

  // Convert to plain text
  return htmlToPlainText(cleaned);
}

/**
 * Convert HTML to plain text
 */
export function htmlToPlainText(html: string): string {
  return html
    // Remove script and style tags with content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    // Replace <br> with newlines
    .replace(/<br\s*\/?>/gi, '\n')
    // Replace block elements with newlines
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    // Remove all other HTML tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    // Collapse multiple spaces/newlines
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}
