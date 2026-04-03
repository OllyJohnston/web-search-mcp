/**
 * Utility functions for the web search MCP server
 */

export function cleanText(text: string, maxLength: number = 10000): string {
  return text
    .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
    .replace(/\n\s*\n/g, '\n') // Replace multiple newlines with single newline
    .trim()
    .substring(0, maxLength);
}

export function getWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

export function getContentPreview(text: string, maxLength: number = 500): string {
  const cleaned = cleanText(text, maxLength);
  return cleaned.length === maxLength ? cleaned + '...' : cleaned;
}

export function generateTimestamp(): string {
  return new Date().toISOString();
}

export function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function sanitizeQuery(query: string): string {
  return query.trim().substring(0, 1000); // Limit query length
}

export function getRandomUserAgent(): string {
  const userAgents = [
    // Windows - Chrome
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    // Windows - Firefox
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    // macOS - Chrome
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    // macOS - Safari
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    // Edge
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0'
  ];
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isPdfUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname.toLowerCase().endsWith('.pdf');
  } catch {
    // If URL parsing fails, check the raw string as fallback
    return url.toLowerCase().endsWith('.pdf');
  }
}

/**
 * Conditional logger to suppress informational logs in environments like LM Studio
 * while keeping critical errors visible.
 * Now uses MCP protocol logging notifications for clean integration with clients.
 */
export class Logger {
  private verbose: boolean;
  private notificationCallback: ((level: string, message: string) => void) | null = null;

  constructor(verbose: boolean = false) {
    this.verbose = verbose;
  }

  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
  }

  /**
   * Set the notification callback to send logs via MCP protocol
   */
  setNotificationCallback(callback: (level: string, message: string) => void): void {
    this.notificationCallback = callback;
  }

  /**
   * Log informational progress (visible if verbose is true, otherwise suppressed)
   */
  info(message: string, ...args: any[]): void {
    if (!this.verbose) return;
    
    const fullMessage = this.formatMessage(message, args);
    if (this.notificationCallback) {
      this.notificationCallback('info', fullMessage);
    } else {
      console.error(`[INFO] ${fullMessage}`);
    }
  }

  /**
   * Log low-priority debug details (only visible if verbose is true)
   */
  debug(message: string, ...args: any[]): void {
    if (!this.verbose) return;

    const fullMessage = this.formatMessage(message, args);
    if (this.notificationCallback) {
      this.notificationCallback('debug', fullMessage);
    } else {
      console.error(`[DEBUG] ${fullMessage}`);
    }
  }

  /**
   * Log a warning (always visible)
   */
  warn(message: string, ...args: any[]): void {
    const fullMessage = this.formatMessage(message, args);
    if (this.notificationCallback) {
      this.notificationCallback('warning', fullMessage);
    } else {
      console.error(`[WARN] ${fullMessage}`);
    }
  }

  /**
   * Log a critical error (always visible)
   */
  error(message: string, ...args: any[]): void {
    const fullMessage = this.formatMessage(message, args);
    if (this.notificationCallback) {
      this.notificationCallback('error', fullMessage);
    } else {
      console.error(`[ERROR] ${fullMessage}`);
    }
  }

  /**
   * Force a log regardless of verbosity (use sparingly for protocol-level info)
   */
  force(message: string, ...args: any[]): void {
    const fullMessage = this.formatMessage(message, args);
    if (this.notificationCallback) {
      this.notificationCallback('notice', fullMessage);
    } else {
      console.error(fullMessage);
    }
  }

  private formatMessage(message: string, args: any[]): string {
    if (args.length === 0) return message;
    
    try {
      return message + ' ' + args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' ');
    } catch {
      return message + ' [Unformattable arguments]';
    }
  }
}