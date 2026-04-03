import { chromium, firefox, webkit, Browser } from 'playwright';
import { ServerConfig } from './types.js';
import { Logger } from './utils.js';

export class BrowserPool {
  private browsers: Map<string, Browser> = new Map();
  private launchPromises: Map<string, Promise<Browser>> = new Map();
  private maxBrowsers: number;
  private browserTypes: string[];
  private currentBrowserIndex = 0;
  private headless: boolean;
  private lastUsedBrowserType: string = '';
  private config: ServerConfig;
  private logger: Logger;
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly IDLE_TIMEOUT_MS = 120000; // 2 minutes

  constructor(config: ServerConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.maxBrowsers = config.maxBrowsers;
    this.headless = config.browserHeadless;
    this.browserTypes = config.browserTypes;
    
    this.logger.info(`[BrowserPool] Configuration: maxBrowsers=${this.maxBrowsers}, headless=${this.headless}, types=${this.browserTypes.join(',')}, noSandbox=${this.config.playwrightNoSandbox}`);
    
    // Start initial idle timer
    this.resetIdleTimer();
  }

  private resetIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(async () => {
      if (this.browsers.size > 0) {
        this.logger.info(`[BrowserPool] Idle limit reached (2m), releasing browser processes to free memory`);
        await this.closeAll();
      }
    }, this.IDLE_TIMEOUT_MS);
  }

  async getBrowser(): Promise<Browser> {
    // Activity detected, reset the idle timer
    this.resetIdleTimer();
    
    // Rotate between browser types for variety
    const browserType = this.browserTypes[this.currentBrowserIndex % this.browserTypes.length];
    this.currentBrowserIndex++;
    this.lastUsedBrowserType = browserType;

    // Check if we already have a healthy cached browser
    if (this.browsers.has(browserType)) {
      const browser = this.browsers.get(browserType)!;
      
      if (browser.isConnected()) {
        return browser;
      }

      // Browser is disconnected, clean it up
      this.logger.warn(`[BrowserPool] Browser ${browserType} is disconnected, removing from pool`);
      this.browsers.delete(browserType);
      try {
        await browser.close();
      } catch (closeError) {
        // Already disconnected, ignore
      }
    }

    // Prevent thundering herd — if a launch is already in-flight
    // for this browser type, await the existing promise instead of spawning a duplicate
    if (this.launchPromises.has(browserType)) {
      this.logger.debug(`[BrowserPool] Launch already in-flight for ${browserType}, awaiting existing promise`);
      return await this.launchPromises.get(browserType)!;
    }

    // Launch new browser and register the promise to prevent concurrent duplicates
    this.logger.info(`[BrowserPool] Launching new ${browserType} browser`);
    
    const launchPromise = this.launchBrowser(browserType);
    this.launchPromises.set(browserType, launchPromise);

    try {
      const browser = await launchPromise;
      return browser;
    } finally {
      // Always clear the in-flight promise, whether launch succeeded or failed
      this.launchPromises.delete(browserType);
    }
  }

  private async launchBrowser(browserType: string): Promise<Browser> {
    const launchOptions = {
      headless: this.headless,
      args: [
        ...(this.config.playwrightNoSandbox ? ['--no-sandbox'] : []),
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
      ],
    };

    let browser: Browser;
    try {
      switch (browserType) {
        case 'chromium':
          browser = await chromium.launch(launchOptions);
          break;
        case 'firefox':
          browser = await firefox.launch(launchOptions);
          break;
        case 'webkit':
          browser = await webkit.launch(launchOptions);
          break;
        default:
          browser = await chromium.launch(launchOptions);
      }

      // Close any old browser this replaces before storing the new one
      if (this.browsers.has(browserType)) {
        const oldBrowser = this.browsers.get(browserType)!;
        try {
          await oldBrowser.close();
        } catch (_e) {
          // Already closed, ignore
        }
      }

      this.browsers.set(browserType, browser);
      
      // Clean up old browsers if we have too many
      if (this.browsers.size > this.maxBrowsers) {
        const oldestBrowser = this.browsers.entries().next().value;
        if (oldestBrowser) {
          try {
            await oldestBrowser[1].close();
          } catch (error) {
            this.logger.error(`[BrowserPool] Error closing old browser:`, error);
          }
          this.browsers.delete(oldestBrowser[0]);
        }
      }

      return browser;
    } catch (error) {
      this.logger.error(`[BrowserPool] Failed to launch ${browserType} browser:`, error);
      throw error;
    }
  }

  async closeAll(): Promise<void> {
    if (this.browsers.size === 0) return;
    
    this.logger.info(`[BrowserPool] Closing ${this.browsers.size} browsers`);
    
    const closePromises = Array.from(this.browsers.values()).map(browser => 
      browser.close().catch((error: any) => 
        this.logger.error('Error closing browser:', error)
      )
    );
    
    await Promise.all(closePromises);
    this.browsers.clear();
    this.launchPromises.clear();
  }

  getLastUsedBrowserType(): string {
    return this.lastUsedBrowserType;
  }
}