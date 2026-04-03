import axios from 'axios';
import * as cheerio from 'cheerio';
import { ContentExtractionOptions, SearchResult, ServerConfig } from './types.js';
import { cleanText, getWordCount, getContentPreview, generateTimestamp, isPdfUrl, Logger, getRandomUserAgent } from './utils.js';
import { BrowserPool } from './browser-pool.js';

export class EnhancedContentExtractor {
  private readonly defaultTimeout: number;
  private readonly maxContentLength: number;
  private browserPool: BrowserPool;
  private fallbackThreshold: number;
  private config: ServerConfig;
  private logger: Logger;

  constructor(config: ServerConfig, browserPool: BrowserPool, logger: Logger) {
    this.config = config;
    this.defaultTimeout = config.defaultTimeout || 30000;
    this.maxContentLength = config.maxContentLength || 20000;
    this.browserPool = browserPool;
    this.fallbackThreshold = config.browserFallbackThreshold || 0.5;
    this.logger = logger;
    this.logger.info(`[EnhancedContentExtractor] Configuration: timeout=${this.defaultTimeout}, maxContentLength=${this.maxContentLength}, fallbackThreshold=${this.fallbackThreshold}`);
  }

  async extractContent(options: ContentExtractionOptions): Promise<string> {
    const { url } = options;
    this.logger.info(`[EnhancedContentExtractor] Starting extraction for: ${url}`);
    try {
      const content = await this.extractWithAxios(options);
      this.logger.info(`[EnhancedContentExtractor] Successfully extracted with axios: ${content.length} chars`);
      return content;
    } catch (error) {
      this.logger.warn(`[EnhancedContentExtractor] Axios failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      if (this.shouldUseBrowser(error, url)) {
        this.logger.info(`[EnhancedContentExtractor] Falling back to headless browser for: ${url}`);
        try {
          const content = await this.extractWithBrowser(options);
          this.logger.info(`[EnhancedContentExtractor] Successfully extracted with browser: ${content.length} chars`);
          return content;
        } catch (browserError) {
          this.logger.error(`[EnhancedContentExtractor] Browser extraction also failed:`, browserError);
          throw new Error(`Both axios and browser extraction failed for ${url}`);
        }
      } else {
        throw error;
      }
    }
  }

  private async extractWithAxios(options: ContentExtractionOptions): Promise<string> {
    const { url, timeout = this.defaultTimeout, maxContentLength = this.maxContentLength } = options;
    const controller = new AbortController();
    try {
      const response = await axios.get(url, {
        headers: this.getRandomHeaders(),
        timeout,
        signal: controller.signal,
        validateStatus: (status: number) => status < 400,
      });
      let content = this.parseContent(response.data);
      if (maxContentLength && content.length > maxContentLength) {
        content = content.substring(0, maxContentLength);
      }
      if (this.isLowQualityContent(content)) {
        throw new Error('Low quality content detected - likely bot detection');
      }
      return content;
    } catch (error) {
      controller.abort();
      throw error;
    }
  }

  private async extractWithBrowser(options: ContentExtractionOptions): Promise<string> {
    const { url, timeout = this.defaultTimeout } = options;
    const browser = await this.browserPool.getBrowser();
    let context;
    try {
      context = await browser.newContext({
        userAgent: getRandomUserAgent(),
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
      });
      const page = await context.newPage();
      
      // Filter out heavy resources
      await page.route('**/*', async (route) => {
        const resourceType = route.request().resourceType();
        if (['image', 'font', 'media'].includes(resourceType)) {
          await route.abort();
        } else {
          await route.continue();
        }
      });

      this.logger.info(`[BrowserExtractor] Navigating to ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.min(timeout, 12000) });
      
      // Random human-like interaction
      await page.mouse.move(Math.random() * 100, Math.random() * 100);
      await page.waitForTimeout(500 + Math.random() * 1000);

      const extractedData = await page.evaluate(() => {
        const selectorsToRemove = ['nav', 'header', 'footer', 'script', 'style', 'noscript', 'iframe'];
        selectorsToRemove.forEach(selector => { document.querySelectorAll(selector).forEach(el => el.remove()); });
        const contentSelectors = ['shreddit-post', 'article', 'main', '[role="main"]', '.content', '.post-content'];
        for (const selector of contentSelectors) {
          const element = document.querySelector(selector);
          if (element && element.textContent && element.textContent.trim().length > 200) {
            return { text: (element as HTMLElement).innerText, selectorUsed: selector };
          }
        }
        return { text: document.body.innerText, selectorUsed: 'body' };
      });

      const content = this.cleanTextContent(extractedData.text);
      return content;
    } catch (error) {
      this.logger.error(`[BrowserExtractor] Browser extraction failed for ${url}:`, error);
      throw error;
    } finally {
      if (context) {
        await context.close().catch((e: any) => this.logger.error(`[BrowserExtractor] Error closing context:`, e));
      }
    }
  }

  private shouldUseBrowser(error: any, url: string): boolean {
    const indicators = [
      error.response?.status === 403,
      error.response?.status === 429,
      error.message?.includes('timeout'),
      error.message?.includes('Low quality content'),
      url.includes('reddit.com'),
      url.includes('twitter.com')
    ];
    return indicators.some(indicator => indicator === true);
  }

  private isLowQualityContent(content: string): boolean {
    return content.length < 100 || content.includes('JavaScript') || content.includes('robot');
  }

  private getRandomHeaders(): Record<string, string> {
    return {
      'User-Agent': getRandomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };
  }

  async extractContentForResults(results: SearchResult[], targetCount: number = results.length, deadline?: number): Promise<SearchResult[]> {
    const nonPdfResults = results.filter(result => !isPdfUrl(result.url));
    const resultsToProcess = nonPdfResults.slice(0, Math.min(targetCount * 2, 10));
    
    const extractionPromises = resultsToProcess.map(async (result): Promise<SearchResult> => {
      // Handle the global tool deadline
      let effectiveTimeout = 8000;
      if (deadline) {
        const remaining = deadline - Date.now();
        if (remaining < 2000) {
          return {
            ...result,
            fullContent: '',
            contentPreview: '',
            wordCount: 0,
            timestamp: generateTimestamp(),
            fetchStatus: 'timeout',
            error: 'Deadline reached before extraction started'
          };
        }
        effectiveTimeout = Math.min(8000, remaining - 1000);
      }

      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      try {
        const content = await new Promise<string>((resolve, reject) => {
          let settled = false;
          timeoutHandle = setTimeout(() => {
            if (!settled) {
              settled = true;
              reject(new Error('Extraction timeout'));
            }
          }, effectiveTimeout + 1000);

          this.extractContent({ url: result.url, timeout: effectiveTimeout })
            .then((content) => {
              if (!settled) {
                settled = true;
                if (timeoutHandle) clearTimeout(timeoutHandle);
                resolve(content);
              }
            })
            .catch((err) => {
              if (!settled) {
                settled = true;
                if (timeoutHandle) clearTimeout(timeoutHandle);
                reject(err);
              }
            });
        });

        const cleanedContent = cleanText(content, this.maxContentLength);
        return {
          ...result,
          fullContent: cleanedContent,
          contentPreview: getContentPreview(cleanedContent),
          wordCount: getWordCount(cleanedContent),
          timestamp: generateTimestamp(),
          fetchStatus: 'success',
        };
      } catch (error) {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        return {
          ...result,
          fullContent: '',
          contentPreview: '',
          wordCount: 0,
          timestamp: generateTimestamp(),
          fetchStatus: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });

    return await Promise.all(extractionPromises);
  }

  private parseContent(html: string): string {
    const $ = cheerio.load(html);
    $('script, style, nav, header, footer').remove();
    const mainContent = $('article, main, .content, .post-content, body').first().text().trim();
    return this.cleanTextContent(mainContent);
  }

  private cleanTextContent(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }
}