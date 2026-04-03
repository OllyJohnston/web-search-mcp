import axios from 'axios';
import * as cheerio from 'cheerio';
import { SearchOptions, SearchResult, SearchResultWithMetadata, ServerConfig, SEARCH_CONFIG } from './types.js';
import { generateTimestamp, sanitizeQuery, getRandomUserAgent, Logger } from './utils.js';
import { RateLimiter } from './rate-limiter.js';
import { BrowserPool } from './browser-pool.js';

interface ParallelStatus {
  resultsFound: boolean;
}

export class SearchEngine {
  private readonly rateLimiter: RateLimiter;
  private browserPool: BrowserPool;
  private config: ServerConfig;
  private logger: Logger;

  constructor(config: ServerConfig, browserPool: BrowserPool, logger: Logger) {
    this.config = config;
    this.rateLimiter = new RateLimiter(this.config.rateLimitPerMinute); 
    this.browserPool = browserPool;
    this.logger = logger;
  }

  async search(options: SearchOptions): Promise<SearchResultWithMetadata> {
    const { query, numResults = 5, timeout = 10000 } = options;
    const sanitizedQuery = sanitizeQuery(query);

    this.logger.info(`[SearchEngine] Starting search for query: "${sanitizedQuery}"`);

    try {
      return await this.rateLimiter.execute(async () => {
        // Configuration from options with fallbacks to environment config
        const enableQualityCheck = this.config.enableRelevanceChecking;
        const qualityThreshold = this.config.relevanceThreshold;
        // Use per-request override if available, otherwise use global config
        const forceMultiEngine = options.forceMultiEngine !== undefined ? options.forceMultiEngine : this.config.forceMultiEngineSearch;
        
        this.logger.info(`[SearchEngine] Starting search with multiple engines...`, { 
          enableQualityCheck, 
          qualityThreshold, 
          forceMultiEngine, 
          preferredEngine: options.preferredEngine 
        });

        // Create the list of all available engines
        const allApproaches = [
          { method: this.tryBrowserBingSearch.bind(this), name: 'Browser Bing', id: 'bing' },
          { method: this.tryDuckDuckGoSearch.bind(this), name: 'Axios DuckDuckGo', id: 'duckduckgo' },
          { method: this.tryStartpageSearch.bind(this), name: 'Axios Startpage', id: 'startpage' }
        ];

        // Determine the waterfall order
        let approaches = [];
        const preferredId = options.preferredEngine || 'auto';
        
        if (preferredId === 'auto') {
          this.logger.debug(`[SearchEngine] Engine set to "auto". Shuffling all providers for maximum stealth...`);
          approaches = this.shuffleArray([...allApproaches]);
        } else {
          this.logger.debug(`[SearchEngine] Prioritizing preferred engine ID: "${preferredId}". Shuffling fallbacks...`);
          const main = allApproaches.find(a => a.id === preferredId);
          const others = this.shuffleArray(allApproaches.filter(a => a.id !== preferredId));
          approaches = main ? [main, ...others] : others;
        }
        
        this.logger.info(`[SearchEngine] Effective randomized waterfall: ${approaches.map(a => a.name).join(' -> ')}`);

        let bestResults: SearchResult[] = [];
        let bestEngine = 'None';
        let bestQuality = 0;

        // PARALLEL EXECUTION: If forcing multi-engine, launch 1st and 2nd in parallel
        // This ensures results in ~2s even if the primary (like Bing) is slow
        if (forceMultiEngine && approaches.length >= 2) {
          this.logger.info(`[SearchEngine] Multi-engine enabled. Launching parallel search: ${approaches[0].name} + ${approaches[1].name}...`);
          
          const sharedStatus: ParallelStatus = { resultsFound: false };
          const parallelResults = await Promise.allSettled([
            approaches[0].method(sanitizedQuery, numResults, Math.min(timeout * SEARCH_CONFIG.PARALLEL_SEARCH_TIMEOUT_FRACTION, 10000), sharedStatus),
            approaches[1].method(sanitizedQuery, numResults, Math.min(timeout * SEARCH_CONFIG.PARALLEL_SEARCH_TIMEOUT_FRACTION, 8000), sharedStatus)
          ]);

          parallelResults.forEach((result, idx) => {
            if (result.status === 'fulfilled' && result.value.length > 0) {
              const res = result.value;
              const name = approaches[idx].name;
              const quality = enableQualityCheck ? this.assessResultQuality(res, sanitizedQuery) : 1.0;
              this.logger.info(`[SearchEngine] Found ${res.length} results from parallel engine: ${name} (Quality: ${quality.toFixed(2)}/1.0)`);

              // Merge logic: Combine and deduplicate by URL
              res.forEach(item => {
                if (!bestResults.some(existing => existing.url === item.url)) {
                  bestResults.push(item);
                }
              });
              
              if (quality > bestQuality) {
                bestQuality = quality;
                bestEngine = name;
              }
            } else if (result.status === 'rejected') {
              this.logger.error(`[SearchEngine] Parallel engine ${approaches[idx].name} failed:`, result.reason);
            }
          });

          // If we have any high-quality results from the parallel phase, return early
          if (bestResults.length > 0 && bestQuality >= qualityThreshold) {
            const isHighQuality = bestQuality >= 0.8;
            const hasEnoughResults = bestResults.length >= numResults / 2;
            
            if (isHighQuality || hasEnoughResults) {
              this.logger.info(`[SearchEngine] Parallel phase successful with ${bestResults.length} merged results (Quality: ${bestQuality.toFixed(2)})`);
              return { results: bestResults, engine: `Merged (${bestEngine})` };
            }
          }
          
          this.logger.info(`[SearchEngine] Parallel phase results insufficient (Quality: ${bestQuality.toFixed(2)} < Threshold: ${qualityThreshold}), continuing waterfall...`);
        }

        // SEQUENTIAL WATERFALL (for remaining engines or if parallel skipped)
        const startIndex = (forceMultiEngine && approaches.length >= 2) ? 2 : 0;
        for (let i = startIndex; i < approaches.length; i++) {
          const approach = approaches[i];
          try {
            this.logger.info(`[SearchEngine] [${i + 1}/${approaches.length}] Attempting ${approach.name}...`);

            const approachTimeout = Math.min(timeout * SEARCH_CONFIG.SEQUENTIAL_SEARCH_TIMEOUT_FRACTION, 10000); 
            const results = await approach.method(sanitizedQuery, numResults, approachTimeout);
            
            if (results && results.length > 0) {
              this.logger.info(`[SearchEngine] Found ${results.length} results with ${approach.name}`);

              const qualityScore = enableQualityCheck ? this.assessResultQuality(results, sanitizedQuery) : 1.0;
              this.logger.info(`[SearchEngine] ${approach.name} quality score: ${qualityScore.toFixed(2)}/1.0`);

              if (qualityScore > bestQuality) {
                bestResults = results;
                bestEngine = approach.name;
                bestQuality = qualityScore;
              }

              // Fast exit logic for sequential phase
              if (qualityScore >= 0.95) {
                this.logger.info(`[SearchEngine] Ultra-high quality results from ${approach.name}, returning...`);
                return { results, engine: approach.name };
              }

              if (qualityScore >= qualityThreshold && !forceMultiEngine) {
                return { results, engine: approach.name };
              }
            }
          } catch (error) {
            this.logger.error(`[SearchEngine] ${approach.name} approach failed:`, error);
            await this.handleBrowserError(error, approach.name);
          }
        }

        if (bestResults.length > 0) {
          return { results: bestResults, engine: bestEngine };
        }

        return { results: [], engine: 'None' };
      });
    } catch (error) {
      this.logger.error('[SearchEngine] Search error:', error);
      throw new Error(`Failed to perform search: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private shuffleArray<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  private async tryStartpageSearch(query: string, numResults: number, timeout: number, status?: ParallelStatus): Promise<SearchResult[]> {
    this.logger.info(`[SearchEngine] Trying Startpage (Axios) as high-quality fallback...`);
    try {
      const userAgent = getRandomUserAgent();
      const searchUrl = 'https://www.startpage.com/sp/search';
      const response = await axios.get(searchUrl, {
        params: {
          query: query,
          cat: 'web',
          sc: 'xkl08PIP6K7120',
          lui: 'english',
          language: 'english',
          t: 'device'
        },
        headers: {
          'User-Agent': userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Referer': 'https://www.startpage.com/',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        timeout,
        validateStatus: (status: number) => status === 200,
      });

      this.logger.debug(`[SearchEngine] Startpage got response with status: ${response.status}`);
      const results = this.parseStartpageResults(response.data, numResults);
      if (results.length > 0) {
        this.logger.debug(`[SearchEngine] Startpage parsed ${results.length} results`);
        if (status) status.resultsFound = true;
      }
      return results;
    } catch (error: any) {
      this.logger.warn(`[SearchEngine] Startpage search failed: ${error.message}`);
      return [];
    }
  }

  private parseStartpageResults(html: string, maxResults: number): SearchResult[] {
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];
    const timestamp = generateTimestamp();

    $('.w-gl .result, .result').each((_index, element) => {
      if (results.length >= maxResults) return false;

      const $element = $(element);
      const $titleLink = $element.find('a.result-title').first();
      
      if ($titleLink.length) {
        let title = $titleLink.find('.wgl-title').text().trim();
        if (!title) title = $titleLink.text().trim();
        
        const url = $titleLink.attr('href') || '';
        const snippet = $element.find('.description').text().trim();

        if (title && url && url.startsWith('http')) {
          results.push({
            title,
            url,
            description: snippet || 'No description available',
            fullContent: '',
            contentPreview: '',
            wordCount: 0,
            timestamp,
            fetchStatus: 'success'
          });
        }
      }
    });

    return results;
  }

  private async tryBrowserBingSearch(query: string, numResults: number, timeout: number, status?: ParallelStatus): Promise<SearchResult[]> {
    this.logger.info(`[SearchEngine] BING: Starting browser-based search with shared browser for query: "${query}"`);
    
    for (let attempt = 1; attempt <= 2; attempt++) {
      let browser;
      try {
        this.logger.info(`[SearchEngine] BING: Attempt ${attempt}/2 - Getting browser from pool...`);
        const startTime = Date.now();
        browser = await this.browserPool.getBrowser();
        const launchTime = Date.now() - startTime;
        this.logger.info(`[SearchEngine] BING: Browser acquired successfully in ${launchTime}ms, connected: ${browser.isConnected()}`);
        
        const results = await this.tryBrowserBingSearchInternal(browser, query, numResults, timeout, status);
        
        if (results.length > 0) {
          this.logger.info(`[SearchEngine] BING: Search completed successfully with ${results.length} results`);
          if (status) status.resultsFound = true;
          return results;
        }
        
        if (attempt === 1) {
          if (status?.resultsFound) {
            this.logger.info(`[SearchEngine] BING: Cold-start detected (0 results), but results exist from other engines. Skipping retry.`);
            return [];
          }
          this.logger.info(`[SearchEngine] BING: Cold-start detected (0 results). Retrying with warmed session...`);
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
        
        this.logger.info(`[SearchEngine] BING: Search finished with 0 results after ${attempt} attempts`);
        return results;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`[SearchEngine] BING: Attempt ${attempt}/2 FAILED with error: ${errorMessage}`);
        if (attempt === 2) {
          this.logger.error(`[SearchEngine] BING: All attempts exhausted, giving up`);
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    return [];
  }

  private async tryBrowserBingSearchInternal(browser: any, query: string, numResults: number, timeout: number, status?: ParallelStatus): Promise<SearchResult[]> {
    if (!browser.isConnected()) {
      this.logger.error(`[SearchEngine] BING: Browser is not connected`);
      throw new Error('Browser is not connected');
    }
    
    this.logger.info(`[SearchEngine] BING: Creating browser context with enhanced fingerprinting...`);
    let context;
    try {
      const { viewport, hasTouch, isMobile } = this.getRandomViewportAndDevice();
      context = await browser.newContext({
        userAgent: getRandomUserAgent(),
        viewport,
        hasTouch,
        isMobile,
        locale: 'en-US',
        timezoneId: 'America/New_York',
        colorScheme: 'light',
        deviceScaleFactor: Math.random() > 0.5 ? 2 : 1,
        extraHTTPHeaders: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none'
        }
      });
      this.logger.info(`[SearchEngine] BING: Context created, opening new page...`);
      let page = await context.newPage();
      this.logger.info(`[SearchEngine] BING: Page opened successfully`);

      let results: SearchResult[] = [];
      try {
        if (status?.resultsFound) {
          this.logger.info(`[SearchEngine] BING: Parallel result found during internal start. Aborting.`);
          return [];
        }
        
        this.logger.info(`[SearchEngine] BING: Attempting enhanced search (homepage → form submission)...`);
        results = await this.tryEnhancedBingSearch(page, query, numResults, timeout, status);
      } catch (enhancedError) {
        this.logger.warn(`[SearchEngine] BING: Enhanced search failed, will try direct search if no results.`);
      }

      if (results.length === 0) {
        this.logger.info(`[SearchEngine] BING: Enhanced search empty or failed, closing page and trying direct URL search...`);
        await page.close().catch((e: any) => this.logger.error(`[SearchEngine] BING: Error closing page:`, e));
        page = await context.newPage();

        if (status?.resultsFound) {
          this.logger.info(`[SearchEngine] BING: Parallel result found before direct search. Aborting.`);
          return [];
        }
        
        results = await this.tryDirectBingSearch(page, query, numResults, timeout, status);
      }

      return results;
    } catch (error) {
      this.logger.error(`[SearchEngine] BING: Internal search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    } finally {
      if (context) {
        await context.close().catch((e: any) => this.logger.error(`[SearchEngine] BING: Error closing context:`, e));
      }
    }
  }

  private async tryEnhancedBingSearch(page: any, query: string, numResults: number, timeout: number, status?: ParallelStatus): Promise<SearchResult[]> {
    this.logger.info(`[SearchEngine] BING: Enhanced search - navigating to Bing homepage...`);
    const startTime = Date.now();
    await page.goto('https://www.bing.com', { waitUntil: 'domcontentloaded', timeout: Math.max(timeout * 0.8, 5000) });
    const loadTime = Date.now() - startTime;
    this.logger.info(`[SearchEngine] BING: Homepage loaded in ${loadTime}ms`);
    
    await this.dismissConsent(page);
    await page.waitForTimeout(500);

    try {
      this.logger.info(`[SearchEngine] BING: Looking for search form elements...`);
      try {
        await page.waitForSelector('#sb_form_q', { timeout: 4000 });
      } catch (timeoutError) {
        const handled = await this.handleBingCaptcha(page);
        if (handled) {
          this.logger.info(`[SearchEngine] BING: Captcha handled, retrying search box detection...`);
          await page.waitForSelector('#sb_form_q', { timeout: 5000 });
        } else {
          throw timeoutError;
        }
      }
      
      this.logger.info(`[SearchEngine] BING: Search box found, filling with query: "${query}"`);
      await page.fill('#sb_form_q', query);
      
      const jitter = Math.floor(Math.random() * 1500 + 500);
      if (status?.resultsFound) {
        this.logger.info(`[SearchEngine] BING: Parallel results found. Aborting before human-thought wait.`);
        return [];
      }
      
      this.logger.info(`[SearchEngine] BING: Mimicking human thought, waiting ${jitter}ms before clicking search...`);
      await page.waitForTimeout(jitter);
      
      this.logger.info(`[SearchEngine] BING: Clicking search button and waiting for navigation...`);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: timeout }),
        page.click('#search_icon')
      ]);
      const searchLoadTime = Date.now() - startTime;
      this.logger.info(`[SearchEngine] BING: Search completed in ${searchLoadTime}ms total`);
    } catch (formError) {
      this.logger.error(`[SearchEngine] BING: Search form submission failed: ${formError instanceof Error ? formError.message : 'Unknown error'}`);
      throw formError;
    }

    try {
      this.logger.info(`[SearchEngine] BING: Waiting for search results to appear...`);
      await page.waitForSelector('.b_algo, .b_result', { timeout: 3000 });
      this.logger.info(`[SearchEngine] BING: Search results selector found`);
    } catch {
      this.logger.info(`[SearchEngine] BING: Search results selector not found, proceeding anyway`);
    }

    const html = await page.content();
    this.logger.info(`[SearchEngine] BING: Got page HTML with length: ${html.length} characters`);
    const results = this.parseBingResults(html, numResults);
    
    this.logger.info(`[SearchEngine] BING: Enhanced search parsed ${results.length} results`);
    return results;
  }

  private async tryDirectBingSearch(page: any, query: string, numResults: number, timeout: number, status?: ParallelStatus): Promise<SearchResult[]> {
    this.logger.info(`[SearchEngine] BING: Direct search with enhanced parameters...`);
    const cvid = this.generateConversationId();
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.min(numResults, 10)}&form=QBLH&sp=-1&qs=n&cvid=${cvid}`;
    const startTime = Date.now();
    try {
      this.logger.info(`[SearchEngine] BING: Navigating to direct URL: ${searchUrl}`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: timeout });
      const loadTime = Date.now() - startTime;
      this.logger.info(`[SearchEngine] BING: Direct page loaded in ${loadTime}ms URL: ${page.url().substring(0, 50)}...`);
      
      if (page.url().includes('rdr=1') || page.url().includes('rdrig=')) {
        this.logger.info(`[SearchEngine] BING: Direct search hit redirect/interstitial. Waiting for stability...`);
        await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1000);
      }

      await this.dismissConsent(page);

      const hasChallenge = await page.evaluate(() => {
        const text = document.body.innerText;
        return !!(document.querySelector('.captcha') || 
                 document.querySelector('#turnstile-wrapper') || 
                 document.querySelector('#challenge-stage') ||
                 text.includes('Verify you are human') ||
                 text.includes('One last step') ||
                 text.includes('Checking your browser'));
      });

      if (hasChallenge) {
        this.logger.info(`[SearchEngine] BING: Direct search hit a challenge page. Attempting bypass...`);
        await this.handleBingCaptcha(page);
      }
    } catch (e) {
      this.logger.error(`[SearchEngine] BING: Direct search navigation error:`, e);
    }
    try {
      this.logger.info(`[SearchEngine] BING: Waiting for search results to appear...`);
      await page.waitForSelector('.b_algo, .b_result', { timeout: 3000 });
      this.logger.info(`[SearchEngine] BING: Search results selector found`);
    } catch {
      this.logger.info(`[SearchEngine] BING: Search results selector not found, proceeding anyway`);
    }
    const html = await page.content();
    const results = this.parseBingResults(html, numResults);
    this.logger.info(`[SearchEngine] BING: Direct search parsed ${results.length} results`);
    return results;
  }

  private generateConversationId(): string {
    const chars = '0123456789ABCDEF';
    let cvid = '';
    for (let i = 0; i < 32; i++) {
      cvid += chars[Math.floor(Math.random() * chars.length)];
    }
    return cvid;
  }

  private async tryDuckDuckGoSearch(query: string, numResults: number, timeout: number, status?: ParallelStatus): Promise<SearchResult[]> {
    this.logger.info(`[SearchEngine] Trying DuckDuckGo (HTML Lite) as fallback...`);
    try {
      const userAgent = getRandomUserAgent();
      const response = await axios.get('https://html.duckduckgo.com/html/', {
        params: { q: query },
        headers: {
          'User-Agent': userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Referer': 'https://duckduckgo.com/',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'same-origin',
        },
        timeout,
        validateStatus: (status: number) => status < 400,
      });
      this.logger.debug(`[SearchEngine] DuckDuckGo got response with status: ${response.status}`);
      const results = this.parseDuckDuckGoResults(response.data, numResults);
      if (results.length > 0) {
        this.logger.debug(`[SearchEngine] DuckDuckGo parsed ${results.length} results`);
        if (status) status.resultsFound = true;
      }
      return results;
    } catch (error: unknown) {
      this.logger.warn(`[SearchEngine] DuckDuckGo search failed`);
      return [];
    }
  }

  private parseBingResults(html: string, maxResults: number): SearchResult[] {
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];
    const timestamp = generateTimestamp();
    const resultSelectors = ['.b_algo', '.b_result', '.b_card'];
    for (const selector of resultSelectors) {
      if (results.length >= maxResults) break;
      const elements = $(selector);
      elements.each((_index, element) => {
        if (results.length >= maxResults) return false;
        const $element = $(element);
        const $titleElement = $element.find('h2 a, .b_title a, a[data-seid]').first();
        const title = $titleElement.text().trim();
        const url = $titleElement.attr('href') || '';
        const snippet = $element.find('.b_caption p, .b_snippet, .b_descript, p').first().text().trim();
        if (title && url && url.startsWith('http')) {
          results.push({
            title,
            url: this.cleanUrl(url),
            description: snippet || 'No description available',
            fullContent: '', contentPreview: '', wordCount: 0, timestamp, fetchStatus: 'success',
          });
        }
      });
    }
    return results;
  }

  private parseDuckDuckGoResults(html: string, maxResults: number): SearchResult[] {
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];
    const timestamp = generateTimestamp();
    $('.result').each((_index, element) => {
      if (results.length >= maxResults) return false;
      const $element = $(element);
      const $titleElement = $element.find('.result__title a');
      const title = $titleElement.text().trim();
      const url = $titleElement.attr('href');
      const snippet = $element.find('.result__snippet').text().trim();
      if (title && url) {
        results.push({
          title,
          url: this.cleanDuckDuckGoUrl(url),
          description: snippet || 'No description available',
          fullContent: '', contentPreview: '', wordCount: 0, timestamp, fetchStatus: 'success',
        });
      }
    });
    return results;
  }

  private cleanUrl(url: string): string { return url.startsWith('//') ? 'https:' + url : url; }
  private cleanDuckDuckGoUrl(url: string): string {
    if (url.startsWith('//duckduckgo.com/l/')) {
      try {
        const urlParams = new URLSearchParams(url.substring(url.indexOf('?') + 1));
        const actualUrl = urlParams.get('uddg');
        if (actualUrl) return decodeURIComponent(actualUrl);
      } catch (e) {
        // Silently ignore URL parsing errors for DuckDuckGo redirects
      }
    }
    return this.cleanUrl(url);
  }

  private assessResultQuality(results: SearchResult[], originalQuery: string): number {
    if (results.length === 0) return 0;
    const queryWords = originalQuery.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    let totalScore = 0;
    for (const result of results) {
      const text = `${result.title} ${result.description}`.toLowerCase();
      let matches = 0;
      for (const word of queryWords) { if (text.includes(word)) matches++; }
      totalScore += matches / (queryWords.length || 1);
    }
    return totalScore / results.length;
  }

  private async handleBrowserError(error: any, engineName: string): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorMessage.includes('closed')) {
      await this.browserPool.closeAll();
    }
  }

  private async handleBingCaptcha(page: any): Promise<boolean> {
    const url = page.url();
    const isRedirect = url.includes('rdr=1') || url.includes('rdrig=');
    
    if (isRedirect) {
      this.logger.info(`[SearchEngine] BING: Detected redirect state ($rdr=1). Waiting for stability...`);
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(1000);
    }

    this.logger.info(`[SearchEngine] BING: Anti-bot challenge detected. Attempting bypass with 8s polling...`);
    
    try {
      const checkboxSelector = '.ctp-checkbox-label, #challenge-stage, input[type="checkbox"]';
      let targetFrame = null;
      let box = null;

      for (let attempt = 1; attempt <= 8; attempt++) {
        const frames = page.frames();
        if (await page.isVisible(checkboxSelector)) {
          targetFrame = page;
          box = await page.$(checkboxSelector);
        } else {
          for (const frame of frames) {
            try {
              if (await frame.isVisible(checkboxSelector)) {
                targetFrame = frame;
                box = await frame.$(checkboxSelector);
                break;
              }
            } catch (fErr) { /* Ignore frame access errors */ }
          }
        }

        if (box) {
          this.logger.info(`[SearchEngine] BING: Interaction point found on attempt ${attempt}!`);
          break;
        }

        if (attempt % 4 === 0) this.logger.info(`[SearchEngine] BING: Still polling for captcha elements... (${attempt}/8)`);
        await page.waitForTimeout(1000);
      }

      if (!box || !targetFrame) {
        this.logger.info(`[SearchEngine] BING: Could not find captcha interaction point after 8s.`);
        return false;
      }

      const boundingBox = await box.boundingBox();
      if (boundingBox) {
        this.logger.info(`[SearchEngine] BING: Performing human-like click on verification box...`);
        const centerX = boundingBox.x + boundingBox.width / 2;
        const centerY = boundingBox.y + boundingBox.height / 2;
        
        // Move mouse in a slightly non-linear way with randomized jitter
        await page.mouse.move(centerX - 100 + Math.random() * 50, centerY - 100 + Math.random() * 50);
        await page.waitForTimeout(100 + Math.random() * 200);
        await page.mouse.move(centerX, centerY, { steps: 10 });
        await page.mouse.click(centerX, centerY);
        
        this.logger.info(`[SearchEngine] BING: Click performed, waiting for challenge to clear...`);
        await page.waitForTimeout(4000);
        
        const stillBlocked = await page.evaluate(() => {
          return !!(document.querySelector('.captcha') || 
                   document.querySelector('#turnstile-wrapper') ||
                   document.body.innerText.includes('Verify you are human') ||
                   document.body.innerText.includes('One last step'));
        });

        if (!stillBlocked) {
          this.logger.info(`[SearchEngine] BING: Challenge appears to be cleared!`);
          return true;
        } else {
          this.logger.info(`[SearchEngine] BING: Challenge still present after click.`);
        }
      }
      
      return false;
    } catch (error) {
      this.logger.error(`[SearchEngine] BING: Error during captcha detection/handling:`, error);
      return false;
    }
  }

  private async dismissConsent(page: any): Promise<void> {
    try {
      const selectors = ['#bnp_btn_accept', '#adlt_set_save', '.bnp_btn_accept'];
      for (const selector of selectors) {
        if (await page.isVisible(selector)) {
          this.logger.info(`[SearchEngine] BING: Dismissing consent banner (${selector})`);
          await page.click(selector).catch(() => {});
          await page.waitForTimeout(500);
        }
      }
    } catch (e) {
      // Ignore consent dismissal errors
    }
  }

  private getRandomViewportAndDevice(): { viewport: { width: number; height: number }; hasTouch: boolean; isMobile: boolean } {
    const viewports = [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1536, height: 864 },
      { width: 1440, height: 900 },
      { width: 1280, height: 720 },
    ];
    const viewport = viewports[Math.floor(Math.random() * viewports.length)];
    const hasTouch = false;
    const isMobile = false; 
    
    return { viewport, hasTouch, isMobile };
  }
}
