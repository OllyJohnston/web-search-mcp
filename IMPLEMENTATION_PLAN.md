# Implementation Plan: Web Search MCP Server Improvements

## Overview
This document outlines prioritized improvements to enhance reliability, maintainability, and production readiness of the Web Search MCP Server (v0.7.0).

---

## Priority 1: Critical Reliability Fixes

### 1.1 Fix Silent Error Swallowing
**File**: `src/index.ts`  
**Severity**: High - Can hide critical failures

```typescript
// CURRENT (Line ~54)
catch (err) { }

// RECOMMENDED
const notificationCallback = (level: string, message: string) => {
  logger.debug({ level, message }, 'MCP Notification');
};
this.logger.setNotificationCallback(notificationCallback);
```

**Why**: Silent failures make debugging impossible in production. Every error needs visibility.

---

### 1.2 Implement Retry Logic for Browser Launch
**File**: `src/browser-pool.ts`  
**Severity**: High - Cascading failures from transient network issues

```typescript
// Add to BrowserPool class

private async launchBrowserWithRetry(
  browserType: string, 
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<Browser> {
  const exponentialBackoff = (attempt: number) => 
    Math.min(baseDelayMs * Math.pow(2, attempt), 30000);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await this.launchBrowser(browserType);
    } catch (error) {
      if (attempt === maxRetries) {
        logger.error(
          { browserType, error }, 
          'Failed to launch browser after all retries'
        );
        throw error; // Propagate on final failure
      }
      
      logger.warn(
        { browserType, attempt, error }, 
        'Browser launch failed, retrying in ${delay}ms'
      );
      
      await new Promise(resolve => 
        setTimeout(resolve, exponentialBackoff(attempt))
      );
    }
  }
}

// Update getBrowser() to use the retry wrapper
```

**Why**: Network blips are common; retry with backoff handles transient failures gracefully.

---

### 1.3 Standardize Error Handling Across Search Engine
**File**: `src/search-engine.ts`  
**Severity**: Medium - Inconsistent behavior makes testing difficult

Create error classification utility:

```typescript
// src/utils.ts - Add new file

export enum SearchResultError {
  NO_RESULTS = 'no_results',
  CAPTCHA_BLOCKED = 'captcha_blocked',
  RATE_LIMITED = 'rate_limited',
  NETWORK_ERROR = 'network_error',
  PARSE_ERROR = 'parse_error',
  UNKNOWN = 'unknown'
}

export interface SearchError {
  type: SearchResultError;
  message: string;
  engine: string;
  retryable: boolean;
}

export function classifySearchError(
  error: any, 
  engine: string, 
  results: SearchResult[] = []
): SearchError {
  if (results.length === 0 && error?.message?.includes('challenge')) {
    return { type: SearchResultError.CAPTCHA_BLOCKED, message: 'Captcha detected', engine, retryable: true };
  }
  
  if (error?.code === 'ECONNREFUSED' || error?.message?.includes('timeout')) {
    return { type: SearchResultError.NETWORK_ERROR, message: 'Connection failed', engine, retryable: true };
  }
  
  return { 
    type: SearchResultError.UNKNOWN, 
    message: error?.message || 'Unknown error', 
    engine, 
    retryable: false 
  };
}
```

Update search methods to use consistent pattern:

```typescript
// In search-engine.ts methods
try {
  // ... search logic
} catch (error) {
  const classified = classifySearchError(error, engineName);
  
  if (classified.retryable && this.attemptCount < MAX_RETRIES) {
    await this.sleep(RETRY_DELAY);
    return this.search(options); // Retry silently
  }
  
  logger.error({ error, classified }, 'Search failed');
  return []; // Return empty on non-retryable failure
}
```

**Why**: Consistent error handling enables predictable behavior and easier testing.

---

## Priority 2: Configuration & Maintainability

### 2.1 Make Rate Limiter Configurable
**File**: `src/search-engine.ts`  
**Severity**: Medium - Hardcoded values limit deployment flexibility

```typescript
// In ServerConfig (src/types.ts)
export interface ServerConfig {
  maxContentLength: number;
  defaultTimeout: number;
  // ... existing config
  
  // NEW CONFIGURABLE VALUES
  rateLimitRequestsPerMinute: number;           // Default: 10
  enableQualityCheck: boolean;                  // Default: true
  maxBrowserIdleMinutes: number;               // Default: 2 (IDLE_TIMEOUT_MS / 60000)
  browserLaunchMaxRetries: number;             // Default: 3
}

// In search-engine.ts constructor
constructor(
  config: ServerConfig, 
  browserPool: BrowserPool, 
  logger: Logger
) {
  this.rateLimiter = new RateLimiter(config.rateLimitRequestsPerMinute);
  // ... rest of constructor
}
```

**Why**: Different environments (staging vs production) need different limits.

---

### 2.2 Add Named Constants for Magic Numbers
**File**: `src/search-engine.ts`  
**Severity**: Low - Improves code readability and maintainability

```typescript
// At top of search-engine.ts (after imports, before class)

export const SEARCH_CONFIG = {
  // Timeout divisions with clear intent
  PARALLEL_SEARCH_TIMEOUT_FRACTION: 0.5,      // timeout / 2 for parallel searches
  SEQUENTIAL_SEARCH_TIMEOUT_FRACTION: 0.33,   // timeout / 3 for sequential
  
  // Retry configuration
  MAX_BROWSER_LAUNCH_RETRIES: 3,
  RETRY_BASE_DELAY_MS: 1000,
  
  // Rate limiting (can be overridden by config)
  DEFAULT_RATE_LIMIT: 10,
};

// Replace magic numbers with constants
const searchTimeout = Math.floor(timeout * SEARCH_CONFIG.PARALLEL_SEARCH_TIMEOUT_FRACTION);
```

**Why**: Self-documenting code reduces cognitive load and prevents drift.

---

### 2.3 Add Zod Schema Validation for Types
**File**: `src/types.ts` (or new file `src/schemas.ts`)  
**Severity**: Medium - Runtime validation catches configuration errors early

```typescript
// src/schemas.ts

import { z } from 'zod';

export const SearchResultSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  description: z.string().optional(),
  // ... other fields
});

export const ServerConfigSchema = z.object({
  maxContentLength: z.number().int().nonnegative(),
  defaultTimeout: z.number().int().positive(),
  rateLimitRequestsPerMinute: z.number().int().positive(),
  enableQualityCheck: z.boolean(),
  maxBrowserIdleMinutes: z.number().positive(),
  browserLaunchMaxRetries: z.number().int().min(1).max(10),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

// In index.ts - validate config on startup
const parsedConfig = ServerConfigSchema.parse(serverConfig);
Object.assign(this.serverConfig, parsedConfig);
```

**Why**: Runtime validation prevents subtle bugs from bad configuration.

---

### 2.4 Implement PDF Extraction Support
**File**: `src/enhanced-content-extractor.ts`  
**Severity**: Medium - Dead code path or missing feature

Either implement or remove:

**Option A - Implement** (if needed):
```typescript
private async extractPdfContent(url: string, page: any): Promise<string> {
  // Convert PDF to text using Puppeteer's built-in support
  const base64Data = await page.pdf({ format: 'A4', printBackground: true });
  return await this.convertBase64ToText(base64Data);
}

// In extractWithBrowser - add PDF handling after route setup
const isPdfUrl = /\.pdf$/i.test(url);
if (isPdfUrl) {
  return await this.extractPdfContent(url, page);
}
```

**Option B - Remove dead code**:
```typescript
// If PDF support is not needed, remove the import and any related logic:
// DELETE: import type { UrlWithStringAuth } from './types';
// DELETE: const isPdfUrl = /\.pdf$/i.test(url);
```

**Recommendation**: Survey users first; likely Option B (remove) is sufficient.

---

### 2.5 Add Viewport Randomization Configuration
**File**: `src/enhanced-content-extractor.ts`, `src/types.ts`  
**Severity**: Low - Prevents predictable fingerprinting

```typescript
// In ServerConfig
export interface ServerConfig {
  // ... existing config
  
  // NEW: Viewport randomization for anti-bot measures
  viewportRandomizationEnabled: boolean;    // Default: true
  viewportMinWidth: number;                 // Default: 1280 (min)
  viewportMaxWidth: number;                 // Default: 1920 (max)
}

// In enhanced-content-extractor.ts constructor
constructor(
  config: ServerConfig, 
  browserPool: BrowserPool, 
  logger: Logger
) {
  this.viewportMin = config.viewportMinWidth || 1280;
  this.viewportMax = config.viewportMaxWidth || 1920;
}

// In extractWithBrowser - replace hardcoded viewport
private getRandomViewport(): Viewport {
  const width = Math.floor(
    Math.random() * (this.viewportMax - this.viewportMin + 1) + this.viewportMin
  );
  
  // Maintain aspect ratio for desktop viewports
  const height = Math.floor(width * 0.75);
  
  return { width, height };
}
```

**Why**: Predictable viewport sizes are one of many signals browsers use to detect automation.

---

## Priority 3: Code Quality & Documentation

### 3.1 Add Missing Type Definitions
**Command**: Run once during setup
```bash
npm install -D @types/cheerio@1.0.0
```

Then update `tsconfig.json`:
```json
{
  "compilerOptions": {
    "typeRoots": ["./node_modules/@types", "./src/types"]
  }
}
```

**Why**: Cheerio is heavily used but lacks TypeScript definitions.

---

### 3.2 Add Test Suite Setup
**File**: `tests/setup.ts` (new file)

```typescript
import { test as base } from '@playwright/test';
import type { ServerConfig, Logger } from '../src/types';

export const test = base.extend<{ server: typeof base.extend['server'] }>({
  server: [
    async ({}, use) => {
      // Mock logger and config for tests
      const mockLogger = {
        debug: (...args) => console.debug('[MOCK]', ...args),
        info: (...args) => console.info('[MOCK]', ...args),
        warn: (...args) => console.warn('[MOCK]', ...args),
        error: (...args) => console.error('[MOCK]', ...args),
      };
      
      const mockConfig: ServerConfig = {
        maxContentLength: 1024 * 1024, // 1MB for tests
        defaultTimeout: 5000,
        rateLimitRequestsPerMinute: 100,
        enableQualityCheck: false,
      };
      
      await use({ mockLogger, mockConfig });
    },
    { auto: true }
  ]
});

export type { Page, Browser, Context } from '@playwright/test';
```

Add to `package.json`:
```json
{
  "devDependencies": {
    "@types/node": "^20.10.0",
    "@playwright/test": "^1.48.0"
  },
  "scripts": {
    "test": "npx playwright test",
    "test:unit": "jest",
    "test:coverage": "npx playwright test --reporter=html"
  }
}
```

**Why**: Without tests, refactoring introduces regressions silently.

---

### 3.3 Add Security Documentation to README
**Append to existing README.md**:

```markdown
## Security Considerations

### Running as Root User
⚠️ **Do not run Playwright as root/administrator.** Browser sandboxing is significantly weaker when running as elevated user, increasing risk of privilege escalation attacks.

### Environment Variables & Secrets
- Never commit `.env` files to version control
- Use Docker secrets or cloud provider secret management for production deployments
- Rotate API keys regularly if using third-party search APIs

### Rate Limit Abuse
This server includes built-in rate limiting to protect target websites. However, users deploying this should:
1. Implement additional rate limiting at the infrastructure level
2. Monitor outbound traffic patterns for anomalies
3. Respect robots.txt and web scraping policies of target sites

### Browser Fingerprinting
The randomization features (viewport, user-agent, device scale factor) help reduce detection risk but do not eliminate it. For high-visibility use cases:
- Use dedicated browser profiles per session
- Consider rotating IP addresses via proxy services
- Limit concurrent browser instances

## License and Compliance
This software is provided as-is for legitimate research and development purposes. Users are responsible for ensuring their use complies with applicable laws, terms of service, and ethical guidelines.
```

**Why**: Security documentation prevents misuse and liability issues.

---

### 3.4 Add Contribution Guidelines
**New file**: `CONTRIBUTING.md`

```markdown
# Contributing to Web Search MCP Server

## Development Setup

### Prerequisites
- Node.js >= 20 LTS
- npm >= 10 or yarn >= 1.22
- Playwright browsers (installed via `npx playwright install`)

### Local Development

```bash
# Install dependencies
npm install

# Run linting and formatting checks
npm run lint
npm run format:check

# Run tests
npm test

# Start development server
npm start
```

## Code Style Guidelines

### TypeScript
- Use strict mode (enabled by default in `tsconfig.json`)
- Prefer interfaces over types for value types
- Use Zod schemas for runtime validation
- Avoid `any` - use `unknown` with type guards when necessary

### Error Handling
- Throw on hard failures (database errors, missing configuration)
- Return empty results on soft failures (rate limited, no results)
- Log all errors with context using structured logging:
  ```typescript
  logger.error({ error, userId, query }, 'Search failed');
  ```

### Testing
- Write tests before refactoring (TDD approach)
- Mock external dependencies (search engines, browser pool)
- Aim for >80% code coverage on core logic
- Document test scenarios in comments when necessary

## Pull Request Process

1. Create feature branch from `main`:
   ```bash
   git checkout -b feat/descriptive-title
   ```

2. Make changes and ensure all checks pass:
   ```bash
   npm run lint
   npm test
   npm run format
   ```

3. Write/update tests for new functionality
4. Update documentation (README, type definitions)
5. Commit with descriptive messages following Conventional Commits:
   ```
   feat: Add viewport randomization configuration
   fix: Resolve silent error swallowing in MCP notification
   refactor: Extract error classification utility
   docs: Update security considerations
   ```

6. Submit PR with:
   - Clear description of changes and rationale
   - Screenshots for UI changes
   - Links to related issues (if applicable)

## Code Review Requirements
- Minimum 1 approving review from maintainer
- All CI checks must pass
- No new warnings introduced by linter
- Tests added/updated as appropriate

## Reporting Security Issues
Found a security vulnerability? Please email the maintainers directly rather than creating a public issue. We respond within 48 hours.
```

**Why**: Clear guidelines reduce friction for contributors and ensure code quality.

---

## Implementation Checklist

### Phase 1: Critical Fixes (Week 1)
- [ ] Fix silent error swallowing in MCP notification callback
- [ ] Implement retry logic with exponential backoff for browser launch
- [ ] Standardize error classification across search engine
- [ ] Add named constants for magic numbers

### Phase 2: Configuration Improvements (Week 2)
- [ ] Make rate limiter configurable via ServerConfig
- [ ] Add Zod schema validation for all types
- [ ] Implement viewport randomization configuration
- [ ] Decide on PDF extraction: implement or remove

### Phase 3: Quality & Documentation (Week 3)
- [ ] Install missing type definitions (`@types/cheerio`)
- [ ] Set up test suite with Playwright Test
- [ ] Add security documentation to README
- [ ] Create CONTRIBUTING.md guide

### Phase 4: Refinement (Week 4)
- [ ] Run full test suite, fix regressions
- [ ] Update version to 0.8.0 in package.json
- [ ] Generate changelog for release notes
- [ ] Performance benchmark before/after changes

---

## Verification Commands

After implementation, run these commands to verify improvements:

```bash
# Verify type safety
npm run build                    # Should compile without errors
npm run lint                     # Should pass all linting rules
npm test                         # All tests should pass

# Verify runtime behavior
npm start                        # Server should start without warnings
npm run test -- --grep "retry"   # Verify retry logic works

# Performance check (optional)
time npx playwright test         # Compare execution time
```

---

## Rollback Plan

If issues arise after deployment:

1. **Immediate rollback**: Revert to previous tagged version
   ```bash
   git checkout tags/v0.7.0
   npm install
   ```

2. **Debug mode**: Enable verbose logging for investigation
   ```json
   // Add to mcp.json
   {
     "verbose": true,
     "logLevel": "debug"
   }
   ```

3. **Hot fix process**: For critical bugs, create emergency hotfix branch from current production tag with clear changelog entry.

---

## Appendix: Impact Assessment

| Change | Risk Level | Performance Impact | Breaking Changes |
|--------|------------|-------------------|------------------|
| Fix error swallowing | Low | None | No |
| Retry logic | Medium | +15% on failure paths | No |
| Configurable rate limiter | Low | None | No |
| Zod validation | Low | Minimal startup cost | No |
| Viewport randomization | Low | +2-5% CPU overhead | No |
| Test suite addition | None | Slight build time increase | No |

---

*Generated: 2026-04-03*  
*Based on code review of Web Search MCP Server v0.7.0*
