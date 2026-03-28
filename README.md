# Web Search MCP Server for use with Local LLMs

A simple, locally hosted Web Search MCP server for use with Local LLMs (Refactored and Enhanced)

## Recent Improvements

- **Protocol Compliance**: All internal logging migrated from `stdout` to `stderr` to ensure the MCP protocol stream remains clean and connections stay stable.
- **Improved LLM Compatibility**: Simplified Zod schemas and enhanced parameter handling for better compatibility with Gemini 3.5, Claude 4.6, and other strict JSON schema validators.
- **Streamable HTTP Support**: Added support for network-accessible operation using the MCP Streamable HTTP (SSE) standard.
- **Shared Browser Pool**: Efficiently manages Playwright instances across all search engines and extractors, reducing memory overhead and improving performance.
- **Centralized Configuration**: All environment variables are parsed once at startup into a strict `ServerConfig` object.
- **Playwright Sandbox Control**: Added `--no-sandbox` CLI flag and `PLAYWRIGHT_NO_SANDBOX` environment variable to support containerized/Docker environments.
- **Sliding Window Rate Limiter**: Implemented a mathematically accurate rolling window for API/search rate limiting.
- **Enhanced Extraction Reliability**: Significant improvements to content extraction for dynamic sites like Reddit, including shadow DOM support and interaction handling.

## Changelog

### [0.4.0] - 2026-03-28 (Major Refactor)
- **Centralized Configuration**: Moved all environment variable parsing to a dedicated `ServerConfig` object initialized at startup.
- **Shared Browser Pool**: Replaced per-request browser launches with a managed pool. `SearchEngine` and `ContentExtractor` now share the same browser instances, significantly reducing memory and CPU spikes.
- **Sliding Window Rate Limiting**: Migrated to a mathematically precise rolling window for API rate limiting (10 requests/minute).
- **HTTP/SSE Transport**: Full support for network-accessible MCP clients via `--http`.
- **Enhanced Reddit Extraction**: Added shadow DOM selectors and "See more" click handling for dynamic Reddit threads.
- **Improved DuckDuckGo Reliability**: Added explicit status code logging for Axios-based search failures.
- **Playwright Sandbox Control**: Added `--no-sandbox` CLI flag and `PLAYWRIGHT_NO_SANDBOX` env var for containerized environments.
- **Premium Documentation**: Completely overhauled Troubleshooting and Installation guides.

## Features

- **Multi-Engine Web Search**: Prioritises Bing > Brave > DuckDuckGo for optimal reliability and performance
- **Full Page Content Extraction**: Fetches and extracts complete page content from search results
- **Multiple Search Tools**: Three specialised tools for different use cases
- **Smart Request Strategy**: Switches between playwright browesrs and fast axios requests to ensure results are returned
- **Concurrent Processing**: Extracts content from multiple pages simultaneously
- **Transport Flexibility**: Support for both standard `stdio` pipe and `HTTP/SSE` transport modes.

## How It Works

The server provides three specialised tools for different web search needs:

### 1. `full-web-search` (Main Tool)
When a comprehensive search is requested, the server uses an **optimised search strategy**:
1. **Browser-based Bing Search** - Primary method using shared Chromium instance
2. **Browser-based Brave Search** - Secondary option using shared Firefox instance
3. **Axios DuckDuckGo Search** - Final fallback using traditional HTTP with detailed error logging
4. **Shared Browser Pool**: Efficiently reuses browser instances while maintaining request isolation via Playwright Contexts
5. **Content extraction**: Tries axios first, then falls back to browser with human behavior simulation and targeted Reddit selectors
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

1. **Clone or Download the repo**
2. **Open a terminal in the folder and run:**
   ```bash
   npm install
   npx playwright install chromium
   npm run build
   ```
   This will install all required dependencies, Playwright browsers, and build the project.

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
- **`BROWSER_FALLBACK_THRESHOLD`**: Number of axios failures before using browser (default: 3)
- **`PLAYWRIGHT_NO_SANDBOX`**: Run Playwright with `--no-sandbox` (default: true)
- **`ENABLE_RELEVANCE_CHECKING`**: Enable search result quality validation (default: true)
- **`RELEVANCE_THRESHOLD`**: Minimum quality score, 0.0 to 1.0 (default: 0.3)
- **`FORCE_MULTI_ENGINE_SEARCH`**: Always search multiple engines (default: false)
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

## License
MIT License - see [LICENSE](./LICENSE) for details.

## Feedback
This is an open source project and we welcome feedback! If you encounter any issues or have suggestions:
- Open an issue on GitHub
- Submit a pull request
