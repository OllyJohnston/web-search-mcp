# Web Search MCP Server for use with Local LLMs

A simple, locally hosted Web Search MCP server for use with Local LLMs (Refactored and Enhanced)

## Recent Improvements

- **SillyTavern Quality Parity**: Reached full logic parity with the original SillyTavern search component, including advanced hardware fingerprinting and human-mimicry interaction logic.
- **Enhanced Bot-Evasion**: Implemented `deviceScaleFactor` randomization and `hasTouch: false` viewport enforcement to bypass advanced anti-bot measures.
- **Robust Challenge Handling**: Added non-linear mouse jitter and improved frame-polling for anti-bot challenges.
- **Protocol Compliance**: All internal logging migrated from `stdout` to `stderr` to ensure the MCP protocol stream remains clean.

## Changelog

### [0.7.1] - 2026-04-03 (Code Review Refinements)
- **Observability**: Resolved a critical "silent error" bug where protocol notification failures were hidden. Added stderr fallback for logs.
- **Browser Robustness**: Implemented exponential backoff retry for Chromium/Firefox launches to handle transient system errors.
- **Configurable Throttling**: The search rate limit is no longer hardcoded and can be tuned via `RATE_LIMIT_PER_MINUTE`.
- **Maintainability**: Replaced magic number timeouts with a formal `SEARCH_CONFIG` constant.
- **Security Audit**: Added critical safety warnings in the README for root/administrator deployment.

### [0.7.0] - 2026-04-03 (SillyTavern Quality Parity)
- **Advanced Fingerprinting**: Added `deviceScaleFactor` randomization and enforced `hasTouch: false` to ensure desktop-class parsing.
- **Human-Mimicry Interaction**: Added non-linear mouse movement jitter during anti-bot challenge bypass.
- **Stable Browser Acquisition**: Refined health-checks to use `isConnected()` only, eliminating "target closed" race conditions.
- **Async Signal Safety**: Ensured all Playwright route signals and Axios AbortControllers are properly awaited/cancelled.
- **Expanded UA Pool**: Significantly updated the User-Agent database with modern strings for all major browsers.

### [0.6.0] - 2026-04-02 (MCP Stability & Logging)
- **Protocol-First Initialization**: Delayed core component startup until the MCP transport is connected, preventing LM Studio from misidentifying early logs as "Errors".
- **Dual-Stream Logging**: Implemented a hybrid logger that routes to MCP notifications with a mirrored fallback to `stderr` for better client visibility.
- **Chromium-First Strategy**: Standardized the browser pool to use Chromium exclusively by default, matching SillyTavern's anti-bot reliability standards.
- **Parallel Search by Default**: Enabled `FORCE_MULTI_ENGINE_SEARCH=true` by default to ensure fast response times across multiple providers.

### [0.5.0] - 2026-04-02 (SillyTavern Search Features Integration)
- **Parallel Search Orchestration**: Refactored the search engine to execute multiple providers concurrently. Initial results are weighted by relevance, with an "early exit" success switch to prioritize speed.
- **New Search Engines**: Added DuckDuckGo Lite and Startpage as high-performance Axios-based fallback engines, significantly improving reliability without browser overhead.
- **Improved Stealth & Interaction**: Implemented human-like mouse jitters, wheel scrolls, and randomized delays during content extraction to bypass bot detection on dynamic sites like Reddit and Twitter.
- **Shared Browser Idle Timeout**: Implemented an automatic cleanup timer that closes all browser instances after 2 minutes of inactivity (configurable) to reclaim system resources.

### [0.4.0] - 2026-03-28 (Major Refactor & Performance Boost)

## Features

- **Stealth Search**: Advanced bot-evasion with randomized fingerprints, human-mimicry interaction logic (non-linear mouse jitter), and rotating User-Agents.
- **Parallel Multi-Engine Execution**: Simultaneously queries multiple search engines (Bing, Startpage, DuckDuckGo) for maximum speed and reliability.
- **Enhanced Content Crawler**: High-performance page extraction with resource filtering (blocking images/fonts) and global deadline awareness.
- **Shared Browser Pool**: Efficiently manages Playwright instances across all engines with automatic 2-minute inactivity cleanup.
- **Protocol-Compliant Logging**: Detailed search progress and diagnostic info routed via standard MCP notifications or optional dual-stream stderr.
- **Transport Flexibility**: Support for both standard `stdio` pipe and `HTTP/SSE` transport modes.

## How It Works

The server provides three specialised tools for different web search needs:

### 1. `full-web-search` (Main Tool)
When a comprehensive search is requested, the server uses an **optimised search strategy**:
1. **Parallel Execution Phase**: Simultaneously queries the top 2 engines (DDG Lite & Browser Bing) to minimize latency.
2. **Success Switch Logic**: Evaluates results against a relevance threshold. If a "high quality" result is found early, it returns immediately and cancels remaining requests.
3. **Multi-Engine Waterfall**: If parallel phase fails, it falls back to Axios Startpage and Browser Brave.
4. **Shared Browser Pool & Idle Cleanup**: Efficiently reuses browser instances and automatically closes them after `BROWSER_IDLE_TIMEOUT` to save memory.
5. **Stealth Content Extraction**: Tries axios first, then falls back to browser with human behavior simulation (jitter/scroll) and targeted site selectors.
6. **Concurrent processing**: Extracts content from multiple pages simultaneously with timeout protection and a sliding window rate limiter
7. **HTTP/2 error recovery**: Automatically falls back to HTTP/1.1 when protocol errors occur

### 2. `get-web-search-summaries` (Lightweight Alternative)
For quick search results without full content extraction:
1. Performs the same optimised multi-engine search as `full-web-search`
2. Returns only the search result snippets/descriptions
3. Does not follow links to extract full page content

### 3. `get-single-web-page-content` (Utility Tool)
For extracting content from a specific webpage:
1. Takes a single URL as input
2. Follows the URL and extracts the main page content
3. Removes navigation, ads, and other non-content elements. Now with improved support for dynamic content and shadow DOM.

## Compatibility

This MCP server has been developed and tested with **LM Studio**, **LibreChat**, and standard MCP clients.

### Model Compatibility
**Important:** Prioritise using more recent models designated for tool use. 

- ✅ Works perfectly with: **Gemini 3.5/2.0**, **Claude 4.6/3.5**, **Gemma 3**
- ✅ Works well with: **Qwen 3.5/2.5**
- ✅ Works with: Recent **Llama 3.2/3.1** (with auto-detecting parameter support)
- ✅ Works with: Recent **Deepseek R1**

## Installation

**Requirements:**
- Node.js 18.0.0 or higher
- npm 8.0.0 or higher

1. **Extract the ZIP** (if you've downloaded the release):
   Unzip the archive into your preferred deployment folder (e.g., `E:\Utils\WebSearchMCP`).

2. **Open a terminal in that folder and run:**
   ```bash
   npm install
   npx playwright install chromium firefox
   ```
   **Important**: This step is required even if you have the `dist/` folder, as it installs the MCP SDK and the necessary browser binaries used for searching.

3. **Verify the build**:
   If you are a developer and want to rebuild from source:
   ```bash
   npm run build
   ```

### Configuration (mcp.json)

Standard MCP configuration for desktop clients (e.g., Claude Desktop, LM Studio):

```json
{
  "mcpServers": {
    "web-search": {
      "command": "node",
      "args": ["/path/to/web-search-mcp/dist/index.js"],
      "env": {
        "MAX_CONTENT_LENGTH": "10000",
        "BROWSER_HEADLESS": "true",
        "MAX_BROWSERS": "3"
      }
    }
  }
}
```

### LibreChat configuration

To use this with LibreChat (Docker), include it in your `librechat.yaml`. You must first mount your local directory in `docker-compose.override.yml`:

**In `docker-compose.override.yml`**:
```yaml
services:
  api:
    volumes:
    - type: bind
      source: /path/to/your/mcp/directory
      target: /app/mcp
```

**In `librechat.yaml`**:
```yaml
mcpServers:
  web-search:
    type: stdio
    command: node
    args:
    - /app/mcp/web-search-mcp/dist/index.js
    serverInstructions: true
```

## Usage

### Stdio Mode (Default)
Standard way to connect to local tools.
```bash
node dist/index.js
```

### HTTP Mode (SSE)
Runs the server as a network service.
```bash
node dist/index.js --http --port 8000
```
**Endpoint**: `http://localhost:8000/mcp`

### Playwright Sandbox Control
By default, the server runs Playwright with `--no-sandbox` for maximum compatibility in containerized environments.
- **CLI Flag**: Use `--no-sandbox` (default: true) or `--sandbox` (to force sandbox).
- **Env Var**: Set `PLAYWRIGHT_NO_SANDBOX=true` (or `false` to enable sandbox).

## Environment Variables

- **`MAX_CONTENT_LENGTH`**: Maximum content length in characters (default: 500000)
- **`DEFAULT_TIMEOUT`**: Default timeout for requests in milliseconds (default: 6000)
- **`MAX_BROWSERS`**: Maximum number of browser instances in the shared pool (default: 3)
- **`BROWSER_TYPES`**: Comma-separated list of browser types (default: 'chromium,firefox')
- **`BROWSER_IDLE_TIMEOUT`**: Idle time (ms) before browser pool cleanup (default: 120000)
- **`ENABLE_PARALLEL_SEARCH`**: Enable concurrent engine fetching (default: true)
- **`BROWSER_FALLBACK_THRESHOLD`**: Number of axios failures before using browser (default: 3)
- **`PLAYWRIGHT_NO_SANDBOX`**: Run Playwright with `--no-sandbox` (default: true)
- **`ENABLE_RELEVANCE_CHECKING`**: Enable search result quality validation (default: true)
- **`RELEVANCE_THRESHOLD`**: Minimum quality score, 0.0 to 1.0 (default: 0.3)
- **`RATE_LIMIT_PER_MINUTE`**: Maximum number of search requests per minute (default: 10).
- **`VERBOSE_LOGGING`**: Enable detailed search progress logs in LM Studio (default: false). If true, logs will appear as [ERROR] tags but contain useful progress info.
- **`ALWAYS_LOG_TO_STDERR`**: Force all logs to `stderr` even if the MCP protocol is connected (default: false). Useful for debugging in environments like LM Studio that capture `stderr`.
- **`DEBUG_BROWSER_LIFECYCLE`**: Log detailed browser open/close events (default: false)
- **`DEBUG_BING_SEARCH`**: Log detailed Bing search parsing steps (default: false)

## Troubleshooting

### 🚀 Slow Response Times

> [!TIP]
> **Concurrent processing** is already built-in. The server extracts content from multiple results simultaneously.

- **Optimized Timeouts**: The default `DEFAULT_TIMEOUT` is 6000ms. If you need lightning-fast results, try setting it to `4000`, though this may reduce the content extraction success rate on slower websites.
- **Shared Browser Pool**: Ensure `MAX_BROWSERS` is at least `2` or `3` to allow concurrent browser-based searches and extractions without waiting for a single instance.
- **Sliding Window**: If you see "Rate limit exceeded," the server is protecting against multi-engine search bans. Wait a few seconds for the sliding window to clear.

### 🔍 Search Failures

> [!IMPORTANT]
> **Playwright is required** for Bing and Brave searches. If these fail, the server will fallback to DuckDuckGo (Axios).

- **Browser Installation**: Ensure you've run `npx playwright install chromium firefox`.
- **Headless Mode**: Always use `BROWSER_HEADLESS=true` (default) for server or CI environments (like Docker) where no UI is available.
- **HTTP/2 Protocol Errors**: Some sites (like Reddit) block standard HTTP requests. The server automatically detects `ERR_HTTP2_PROTOCOL_ERROR` and re-attempts with a browser-based extraction.
- **Sandbox Issues**: In Docker or Linux environments, try the `--no-sandbox` CLI flag if Playwright fails to launch.

### 🧠 Memory and Resource Usage

> [!NOTE]
> The server uses a **Shared Browser Pool** with request-level context isolation to minimize memory leaks.

- **Limit Browsers**: If your host system is memory-constrained (e.g., a small VPS), set `MAX_BROWSERS=1`. This forces sequential browser usage but keeps memory usage below 500MB.
- **Automatic Cleanup**: Every Playwright `Context` and `Page` is closed immediately after use. Persistent browsers are only closed when the MCP server shuts down.
- **EventEmitter Warnings**: Our pooling logic correctly manages listeners, resolving "MaxListenersExceededWarning" from older versions.

### ✨ Search Quality Issues
- **Relevance Validation**: If you receive irrelevant results, increase `RELEVANCE_THRESHOLD` (e.g., to `0.5`). 
- **Force Multi-Engine**: If one engine is consistently failing or blocked, set `FORCE_MULTI_ENGINE_SEARCH=true` to force the server to aggregate results from all sources every time.

## For Development

```bash
npm run dev    # Development with hot reload
npm run build  # Build TypeScript to JavaScript
npm run lint   # Run ESLint
npm run format # Run Prettier
```

## MCP Tools

### 1. `full-web-search`
Comprehensive search with content extraction.
**Example Usage:**
```json
{
  "name": "full-web-search",
  "arguments": {
    "query": "TypeScript MCP server",
    "limit": 3,
    "includeContent": true
  }
}
```

### 2. `get-web-search-summaries`
Fast search without following links.
**Example Usage:**
```json
{
  "name": "get-web-search-summaries",
  "arguments": {
    "query": "TypeScript MCP server",
    "limit": 5
  }
}
```

### 3. `get-single-web-page-content`
Extract content from a specific URL. Improved support for Reddit and Shadow DOM.
**Example Usage:**
```json
{
  "name": "get-single-web-page-content",
  "arguments": {
    "url": "https://example.com/article",
    "maxContentLength": 5000
  }
}
```

## Documentation
See [API.md](./docs/API.md) for complete technical details.

## Security Considerations

> [!CAUTION]
> **Do not run this server as root or administrator.** Playwright browser sandboxing is significantly compromised when running as an elevated user, which increases the risk of privilege escalation attacks from malicious web content.

- **Sandboxing**: Always prefer `BROWSER_HEADLESS=true` and standard user accounts.
- **Secrets Management**: Do not hardcode API keys or credentials in the source code. Use environment variables or a secure secret manager.

## Contribution Guidelines

We welcome contributions! To contribute:
1. Fork the repository.
2. Create a feature branch (`git checkout -b feature/amazing-feature`).
3. Commit your changes (`git commit -m 'Add some amazing feature'`).
4. Push to the branch (`git push origin feature/amazing-feature`).
5. Open a Pull Request.

Please ensure your code passes linting (`npm run lint`) and builds successfully (`npm run build`) before submitting.

## License
MIT License - see [LICENSE](./LICENSE) for details.

## Feedback
This is an open source project and we welcome feedback! If you encounter any issues or have suggestions:
- Open an issue on GitHub
- Submit a pull request
