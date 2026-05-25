#!/usr/bin/env node

// Simple test script to verify search functionality
import { SearchEngine } from '../dist/search-engine.js';
import { BrowserPool } from '../dist/browser-pool.js';
import { Logger } from '../dist/utils.js';

const config = {
  maxContentLength: 500000,
  defaultTimeout: 15000,
  maxBrowsers: 3,
  browserHeadless: true,
  browserTypes: ['chromium'],
  browserFallbackThreshold: 0.5,
  enableRelevanceChecking: true,
  relevanceThreshold: 0.3,
  forceMultiEngineSearch: false,
  debugBrowserLifecycle: false,
  debugBingSearch: false,
  playwrightNoSandbox: true,
  rateLimitPerMinute: 10
};
const logger = new Logger(true);
const browserPool = new BrowserPool(config, logger);
const searchEngine = new SearchEngine(config, browserPool, logger);

async function testSearch() {
  console.log('Testing search functionality...');
  
  try {
    const result = await searchEngine.search({
      query: 'test search',
      numResults: 3,
      timeout: 15000  // 15 second timeout for testing
    });
    
    console.log(`Search completed with engine: ${result.engine}`);
    console.log(`Found ${result.results.length} results:`);
    
    result.results.forEach((r, i) => {
      console.log(`${i + 1}. ${r.title}`);
      console.log(`   URL: ${r.url}`);
      console.log(`   Description: ${r.description.substring(0, 100)}...`);
      console.log('');
    });
    
    // Clean up
    await browserPool.closeAll();
    
  } catch (error) {
    console.error('Search test failed:', error);
    await browserPool.closeAll();
    process.exit(1);
  }
}

testSearch().then(() => {
  console.log('Test completed successfully');
  process.exit(0);
});