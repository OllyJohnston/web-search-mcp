# Web Search MCP Server for Local LLMs

**The high-performance, bot-evading search engine for your local AI stack.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.7.3-blue.svg)](./package.json)

Web Search MCP is a locally-hosted Model Context Protocol (MCP) server that empowers your local LLMs (like Gemini, Claude, Llama, and DeepSeek) with real-time web access. It combines advanced bot-evasion techniques, multi-engine orchestration, and high-quality content extraction to deliver faster, more reliable search results without the need for expensive API keys.

---

## ✨ Key Features

- **🕵️ Stealth Search**: Advanced bot-evasion featuring randomized `deviceScaleFactor` hardware fingerprinting, human-mimicry interaction logic (non-linear mouse jitter), and rotating User-Agents.
- **⚡ Parallel Multi-Engine Execution**: Simultaneously queries multiple providers (Bing, Startpage, DuckDuckGo) for maximum speed and fallback reliability.
- **📄 Enhanced Content Crawler**: High-performance page extraction that automatically filters out navigation, ads, and heavy resources (images/fonts) to preserve your model's context window.
- **🧠 Shared Browser Pool**: Efficiently manages Playwright instances with automatic 2-minute inactivity cleanup to keep system resource usage minimal.
- **🌐 Transport Flexibility**: Supports both standard `stdio` pipe (local) and `HTTP/SSE` transport modes (network service).
- **🛡️ Protocol Compliant**: Built on the latest Model Context Protocol for seamless integration with modern LLM clients.

---

## 🛠️ How It Works

The server provides three specialized tools designed for different research needs:

### 1. `full-web-search` (The Powerhouse)
Designed for comprehensive research. It uses an **optimized parallel strategy**:
- **Parallel Phase**: Queries multiple engines (DDG Lite & Browser Bing) simultaneously.
- **Success Switch**: If a "high-quality" result is found early, it immediately returns to minimize wait time.
- **Waterfall Fallback**: Seamlessly falls back to Startpage or Brave if initial results are blocked.
- **Deep Extraction**: Scrapes the full text of found pages using stealth-browser fallback for dynamic sites (Reddit, Twitter, etc.).

### 2. `get-web-search-summaries` (The Lite Mode)
For quick fact-checking where page scraping isn't needed. It returns the top search result snippets and titles without following links, providing near-instant results.

### 3. `get-single-web-page-content` (The Scalpel)
Targeted extraction from a specific URL. Features improved support for dynamic content, Reddit threads, and Shadow DOM elements.

---

## 💻 Compatibility

Fully tested with **LM Studio**, **Claude Desktop**, and **LibreChat**.

### Recommended Models
Prioritize models designated for "Tool Use" or "Function Calling":
- ✅ **Gemini 1.5/2.0**, **Claude 3.5/3.7**, **Gemma 3**
- ✅ **Qwen 2.5/2.0**, **Llama 3.3/3.2/3.1**
- ✅ **DeepSeek R1 / V3**

---

## 🚀 Installation

### Requirements
- Node.js 18.0.0 or higher
- npm 8.0.0 or higher

1. **Extract the Release Archive**:
   Unzip the files into your preferred folder (e.g., `E:\Utils\WebSearchMCP`).

2. **Install Dependencies & Browsers**:
   Open a terminal in the folder and run:
   ```bash
   npm install
   npx playwright install chromium firefox
   ```

3. **Verify Connection**:
   ```bash
   node dist/index.js
   ```

---

## ⚙️ Configuration

### Desktop Client Setup (mcp.json)
Standard configuration for clients like Claude Desktop or LM Studio:

```json
{
  "mcpServers": {
    "web-search": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"],
      "env": {
        "MAX_CONTENT_LENGTH": "10000",
        "BROWSER_HEADLESS": "true",
        "MAX_BROWSERS": "3"
      }
    }
  }
}
```

### Environment Variables
| Variable | Description | Default |
| `MAX_CONTENT_LENGTH` | Max characters per extraction | `500000` |
| `DEFAULT_TIMEOUT` | Request timeout in ms | `6000` |
| `MAX_BROWSERS` | Max concurrent browser instances | `3` |
| `BROWSER_TYPES` | Branded browsers to use | `chromium,firefox` |
| `BROWSER_IDLE_TIMEOUT`| Inactivity before pool cleanup | `120000` |
| `ENABLE_PARALLEL_SEARCH`| Enable concurrent engine fetching | `true` |
| `BROWSER_FALLBACK_THRESHOLD`| Failures before using browser | `3` |
| `PLAYWRIGHT_NO_SANDBOX` | Run Playwright with --no-sandbox | `true` |
| `RELEVANCE_THRESHOLD` | Quality score (0.0 - 1.0) | `0.3` |
| `RATE_LIMIT_PER_MINUTE` | Max requests per minute | `10` |
| `VERBOSE_LOGGING` | Detailed logs (via [ERROR] tags) | `false` |
| `ALWAYS_LOG_TO_STDERR` | Force logs to stderr | `false` |
| `DEBUG_BROWSER_LIFECYCLE`| Log browser events | `false` |
| `DEBUG_BING_SEARCH` | Log Bing parsing steps | `false` |

---

### LibreChat Configuration

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

---

## 🛠️ Usage

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
By default, the server runs Playwright with `--no-sandbox` for reliability in containers.
- **CLI Flag**: `--no-sandbox` (default: true) or `--sandbox` (to force sandbox).
- **Env Var**: `PLAYWRIGHT_NO_SANDBOX=true`.

---

## 🧰 MCP Tools

### 1. `full-web-search`
Comprehensive search with content extraction.
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
```json
{
  "name": "get-single-web-page-content",
  "arguments": {
    "url": "https://example.com/article",
    "maxContentLength": 5000
  }
}
```

## 📖 Documentation
See [API.md](./docs/API.md) for complete technical details.

---

## 🔧 Troubleshooting

### 🚀 Slow Response Times
The server uses **Concurrent Processing** to extract content from multiple results at once.
- **Tip**: Keep `MAX_BROWSERS` at `3` to allow parallel browser extractions.
- **Latency**: If you need faster results, reduce `DEFAULT_TIMEOUT` to `4000`, though some slower pages may fail to load.

### 🔍 Search Failures
- **Playwright**: Most search engines require Playwright. Ensure you ran `npx playwright install`.
- **Healdess**: Always keep `BROWSER_HEADLESS=true` in server/Docker environments.
- **HTTP/2**: Some sites (Reddit) block standard requests. The server automatically retries these via browser.

### 🧠 Resource Management
The server uses a **Shared Browser Pool** with context isolation.
- **Memory**: On low-RAM systems (VPS), set `MAX_BROWSERS=1` to keep usage under 500MB.
- **Cleanup**: Every context is closed immediately after use; browsers close after 2 minutes of idle time.

---

## 📅 Changelog & Improvements

### Recent Improvements
- **Protocol Compliance**: Optimized for standard MCP notifications (`notifications/message`) for clean client output.
- **SillyTavern Parity**: Logic parity with the original search components, including hardware signature spoofing.
- **Stable Acquisition**: Refined health-checks and exponential backoff retry for browser launches.

### [0.7.3] - 2024-04-13
- **Protocol Fix**: Corrected non-standard logging notification method to resolve Pydantic validation errors in some clients.
- **Stability**: Declared `logging` capability in server constructor as required by MCP SDK v1.0+.

### [0.7.2] - 2026-04-11
- **Version Consistency**: Unified versioning across package.json and CLI.
- **Cleanup**: Implemented `prebuild` clean script to purge stale build artifacts.
- **Bundle Support**: Integrated `dist/bundle.js` support via esbuild.

### [0.6.0] - 2026-04-02
- **Protocol-First**: Delayed initialization until transport is connected to avoid early log errors.
- **Dual-Stream**: Hybrid logger support for both MCP notifications and standard `stderr`.

---

## 🤝 Contributing

We welcome contributions! Please see our [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on reporting bugs and submitting pull requests.

## 🛡️ Security & Privacy

Please see [SECURITY.md](./SECURITY.md) for our disclosure policy and safety best practices.

> [!CAUTION]
> **Do not run this server as root or administrator.** Playwright browser sandboxing is compromised when running as an elevated user, increasing the risk of exploit from malicious web content.

## 📄 License

MIT License - see [LICENSE](./LICENSE) for details.

---
**Developed by Mark Russell** | **Enhanced for Pro-sumer Stacks by Olly Johnston**
