import { createHash } from 'node:crypto';

// Rate limiting configuration from environment
// Default: 3-6 seconds between requests to be respectful
const RATE_LIMIT_MIN = parseInt(process.env.SCRAPE_JITTER_MIN || '3000', 10);
const RATE_LIMIT_MAX = parseInt(process.env.SCRAPE_JITTER_MAX || '6000', 10);

/**
 * Create a hash of content for deduplication
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 32);
}

/**
 * Get a random jitter value between min and max
 */
export function getJitter(): number {
  return RATE_LIMIT_MIN + Math.random() * (RATE_LIMIT_MAX - RATE_LIMIT_MIN);
}

/**
 * Delay execution for a specified number of milliseconds
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Clean HTML content, removing tags but keeping text
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Truncate content to a maximum length, preserving word boundaries
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  
  return lastSpace > maxLength * 0.8 
    ? truncated.slice(0, lastSpace) + '...'
    : truncated + '...';
}

/**
 * Parse relative dates like "2 days ago", "1 week ago"
 */
export function parseRelativeDate(text: string): Date | undefined {
  const now = new Date();
  
  const patterns = [
    { regex: /(\d+)\s*min(?:ute)?s?\s*ago/i, unit: 'minutes' },
    { regex: /(\d+)\s*hours?\s*ago/i, unit: 'hours' },
    { regex: /(\d+)\s*days?\s*ago/i, unit: 'days' },
    { regex: /(\d+)\s*weeks?\s*ago/i, unit: 'weeks' },
    { regex: /(\d+)\s*months?\s*ago/i, unit: 'months' },
    { regex: /yesterday/i, unit: 'yesterday' },
    { regex: /today/i, unit: 'today' },
  ];

  for (const { regex, unit } of patterns) {
    const match = text.match(regex);
    if (match) {
      const value = match[1] ? parseInt(match[1], 10) : 1;
      const date = new Date(now);
      
      switch (unit) {
        case 'minutes':
          date.setMinutes(date.getMinutes() - value);
          break;
        case 'hours':
          date.setHours(date.getHours() - value);
          break;
        case 'days':
          date.setDate(date.getDate() - value);
          break;
        case 'weeks':
          date.setDate(date.getDate() - value * 7);
          break;
        case 'months':
          date.setMonth(date.getMonth() - value);
          break;
        case 'yesterday':
          date.setDate(date.getDate() - 1);
          break;
        case 'today':
          break;
      }
      
      return date;
    }
  }

  return undefined;
}
