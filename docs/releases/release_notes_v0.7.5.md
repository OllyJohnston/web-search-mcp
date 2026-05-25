# Release v0.7.5 - Isolated Scraper Proxy & Bing Search Optimizations

This release integrates isolated scraper proxy support and extensive performance optimizations for Bing search queries, aligning the server's scraping and stealth features with the latest upstream capabilities.

## 🚀 Key Improvements

### 1. 🔒 Isolated Scraper Proxy (Axios & Playwright)
- Added dynamic, per-request proxy routing support to all MCP tools via the optional `proxyUrl?: string` argument.
- **Axios Searches & Extractions**: Outgoing HTTP requests (DuckDuckGo, Startpage, and standard Axios page crawling) automatically route traffic through the requested HTTP/HTTPS proxy using `https-proxy-agent`.
- **Stealth Browser Extractions**: Playwright browser contexts for Bing searches and dynamic browser-based page extraction route seamlessly through the proxy config.

### 2. ⚡ Direct Bing Search Priority (Waterfall Swap)
- Optimized the Bing search execution strategy by prioritizing direct query URL requests (`https://www.bing.com/search?q=QUERY`) as the primary approach.
- Direct search requests load and parse in **under 500ms**, saving 4–8 seconds by bypassing home-page rendering, form input simulations, and click delays.
- Fallback form-filling search is only executed if the direct search fails or is challenged by captchas.

### 3. ⌨️ Robust Form-Filling Fallback
- Replaced rigid search input selectors with a robust, fallback-group selector (`#sb_form_q, input[name="q"], textarea[name="q"]`) to support standard input fields as well as new Copilot textareas.
- Replaced button-clicking with keyboard-event submission (`page.press(selector, 'Enter')`) to bypass frequently changing button class names and IDs.

### 4. 🛡️ Strict-Mode Safe Consent Dismissal
- Rewrote the cookie consent dismissal mechanism to target the first matching element (`page.locator().first()`). This prevents Playwright strict-mode locator exceptions when multiple consent or accept selectors exist on the page.

### 5. 📦 Modern Package Resolution (NodeNext ESM)
- Upgraded the TypeScript configuration to utilize `"module": "NodeNext"` and `"moduleResolution": "NodeNext"`.
- This ensures clean, native ES Module package resolution for new dynamic dependencies (such as `https-proxy-agent`) under modern Node.js runtimes.

## 🛠 Installation & Usage
Download the attached `web-search-mcp-v0.7.5-deployment.zip`, extract it, and follow the updated **README.md** for instructions on connecting it to Claude Desktop, LM Studio, or LibreChat.
