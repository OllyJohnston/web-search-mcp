# Release v0.4.0 - Major Refactor & Performance Overhaul

This release marks a significant architectural shift to improve the reliability, performance, and scalability of the Web Search MCP Server.

## 🚀 Key Improvements

### 1. Centralized Configuration Management
- All `process.env` calls have been replaced with a centralized `ServerConfig` interface. 
- Configuration is parsed once at startup and injected into all core services, ensuring predictable behavior across different environments.

### 2. Shared Browser Pool (Critical Performance Fix)
- Replaced the "launch browser per request" model with a persistent, shared **BrowserPool**.
- The `SearchEngine` and `ContentExtractor` now share Chromium/Firefox instances while maintaining isolation via Playwright Contexts.
- This results in significantly lower RAM usage and faster content extraction.

### 3. Sliding Window Rate Limiting
- Upgraded the rate limiter to a mathematically precise rolling window of 10 requests per minute.
- Prevents burst-request blocking while maximizing throughput during research sessions.

### 4. Enhanced Content Extraction
- **Reddit Compatibility**: Optimized extraction for Reddit threads, including shadow DOM support and interaction handling.
- **Improved Reliability**: Smarter fallback logic between Axios and Browser-based extraction.
- **Detailed Error Logging**: Explicit logging for DuckDuckGo/Axios failures (HTTP status codes/payloads).

### 5. Deployment Flexibility
- **HTTP/SSE Support**: Full support for network-accessible MCP clients via the `--http` flag.
- **Sandbox Control**: Added `--no-sandbox` CLI support for containerized/Docker environments.

## 🛠 Installation & Usage
Download the attached `web-search-mcp-v0.4.0.zip`, extract it, and follow the updated **README.md** for instructions on connecting it to Claude Desktop, LM Studio, or LibreChat.

---
**Checksums:**
- `web-search-mcp-v0.4.0.zip`: (Pre-built binary bundle)
- `web-search-mcp-v0.4.0-source.zip`: (Source only)
- `web-search-mcp-v0.4.0-source.tar.gz`: (Source only)
