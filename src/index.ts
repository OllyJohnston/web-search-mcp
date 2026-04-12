#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import express from 'express';
import { Command } from 'commander';
import { SearchEngine } from './search-engine.js';
import { EnhancedContentExtractor } from './enhanced-content-extractor.js';
import {
  WebSearchToolInput,
  WebSearchToolOutput,
  ServerConfig,
} from './types.js';
import { BrowserPool } from './browser-pool.js';
import { Logger } from './utils.js';
import crypto from 'node:crypto';

class WebSearchMCPServer {
  private server: McpServer;
  private searchEngine!: SearchEngine;
  private contentExtractor!: EnhancedContentExtractor;
  private config: ServerConfig;
  private browserPool!: BrowserPool;
  private logger: Logger;
  private isConnected = false;

  constructor(cliConfig?: { playwrightNoSandbox?: boolean }) {
    this.server = new McpServer({
      name: 'web-search-mcp-server',
      version: '0.7.2',
    });

    this.config = this.parseConfig(cliConfig);
    this.logger = new Logger(this.config.verboseLogging);

    // Attach MCP protocol logging with dual-stream support
    this.logger.setNotificationCallback((level, message) => {
      const prefix = level === 'notice' ? '' : `[${level.toUpperCase()}] `;
      const fullMessage = `${prefix}${message}`;

      // 1. Try MCP Protocol Notification (standard way)
      try {
        if (this.isConnected) {
          const baseServer = this.server.server;
          if (baseServer) {
            baseServer.notification({
              method: 'notifications/logging/message',
              params: {
                level: level as any,
                data: message,
                logger: 'web-search-mcp',
              },
            });
          }
        }
      } catch (err) {
        // Fallback if protocol notification fails
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(
          `[INTERNAL ERROR] Failed to send MCP notification: ${errorMsg}`
        );
      }

      // 2. Fallback or Force to StdErr (for LM Studio visibility)
      // We only fallback to stderr IF not connected, OR if ALWAYS_LOG_TO_STDERR is set
      const forceStdErr =
        this.config.alwaysLogToStdErr ||
        process.env.ALWAYS_LOG_TO_STDERR === 'true';
      if (!this.isConnected || forceStdErr) {
        // Use a standard prefix that LM Studio might not flag as a red error for non-error levels
        if (level === 'error' || level === 'warning') {
          console.error(fullMessage);
        } else {
          // Some clients treat stderr as Info if prefixed correctly, or just "uncolored"
          console.error(`[INFO] ${message}`);
        }
      }
    });

    this.setupTools();
    this.setupGracefulShutdown();
  }

  private parseConfig(cliConfig?: {
    playwrightNoSandbox?: boolean;
  }): ServerConfig {
    const maxContentLengthParsed = parseInt(
      process.env.MAX_CONTENT_LENGTH || '500000',
      10
    );

    let playwrightNoSandbox = true;
    if (cliConfig?.playwrightNoSandbox !== undefined) {
      playwrightNoSandbox = cliConfig.playwrightNoSandbox;
    } else if (process.env.PLAYWRIGHT_NO_SANDBOX === 'false') {
      playwrightNoSandbox = false;
    }

    return {
      maxContentLength:
        isNaN(maxContentLengthParsed) || maxContentLengthParsed < 0
          ? 500000
          : maxContentLengthParsed,
      defaultTimeout: parseInt(process.env.DEFAULT_TIMEOUT || '15000', 10),
      maxBrowsers: parseInt(process.env.MAX_BROWSERS || '3', 10),
      browserHeadless: process.env.BROWSER_HEADLESS !== 'false',
      browserTypes: (process.env.BROWSER_TYPES || 'chromium')
        .split(',')
        .map(type => type.trim()),
      browserFallbackThreshold: parseFloat(
        process.env.BROWSER_FALLBACK_THRESHOLD || '0.5'
      ),
      enableRelevanceChecking:
        process.env.ENABLE_RELEVANCE_CHECKING !== 'false',
      relevanceThreshold: parseFloat(process.env.RELEVANCE_THRESHOLD || '0.3'),
      forceMultiEngineSearch: process.env.FORCE_MULTI_ENGINE_SEARCH !== 'false',
      debugBrowserLifecycle: process.env.DEBUG_BROWSER_LIFECYCLE === 'true',
      debugBingSearch: process.env.DEBUG_BING_SEARCH === 'true',
      playwrightNoSandbox,
      verboseLogging: process.env.VERBOSE_LOGGING !== 'false',
      alwaysLogToStdErr: process.env.ALWAYS_LOG_TO_STDERR === 'true',
      rateLimitPerMinute: parseInt(
        process.env.RATE_LIMIT_PER_MINUTE || '10',
        10
      ),
    };
  }

  private setupTools(): void {
    this.server.tool(
      'full-web-search',
      'Search the web and fetch complete page content. Features parallel execution and quality-aware fallbacks.',
      {
        query: z.string().describe('Search query to execute'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(5)
          .describe('Number of results to return with content'),
        includeContent: z
          .boolean()
          .default(true)
          .describe('Whether to fetch full page content'),
        maxContentLength: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Maximum characters per result content'),
      },
      async args => {
        this.logger.info(
          `[MCP] Tool call received: full-web-search`,
          JSON.stringify(args)
        );

        try {
          const validatedArgs = args as WebSearchToolInput;
          const GLOBAL_TIMEOUT = 25000;
          const toolDeadline = Date.now() + GLOBAL_TIMEOUT;

          const resultPromise = this.handleWebSearch(
            validatedArgs,
            toolDeadline
          );

          const timeoutPromise = new Promise<WebSearchToolOutput>(resolve => {
            setTimeout(() => {
              this.logger.warn(
                `[MCP] Global tool deadline hit. Returning partial results.`
              );
              resolve({
                results: [],
                total_results: 0,
                search_time_ms: GLOBAL_TIMEOUT,
                query: validatedArgs.query,
                status: 'Global tool execution deadline reached.',
              });
            }, GLOBAL_TIMEOUT);
          });

          const result = await Promise.race([resultPromise, timeoutPromise]);

          let responseText = `Search completed for "${result.query}" (${result.results.length} results):\n\n`;
          if (result.status) responseText += `**Status:** ${result.status}\n\n`;

          const maxLength =
            validatedArgs.maxContentLength || this.config.maxContentLength;
          result.results.forEach((searchResult, idx) => {
            responseText += `**${idx + 1}. ${searchResult.title}**\nURL: ${searchResult.url}\nDescription: ${searchResult.description}\n`;
            if (searchResult.fullContent) {
              let content = searchResult.fullContent;
              if (maxLength && content.length > maxLength) {
                content = content.substring(0, maxLength) + `... [Truncated]`;
              }
              responseText += `\n**Full Content:**\n${content}\n`;
            } else if (searchResult.fetchStatus === 'error') {
              responseText += `\n**Content Extraction Failed:** ${searchResult.error}\n`;
            }
            responseText += `\n---\n\n`;
          });

          return { content: [{ type: 'text' as const, text: responseText }] };
        } catch (error) {
          this.logger.error(`[MCP] Error in tool handler:`, error);
          throw error;
        }
      }
    );

    this.server.tool(
      'get-web-search-summaries',
      'Search the web and return only snippets.',
      {
        query: z.string().describe('Search query'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(5)
          .describe('Number of results'),
      },
      async args => {
        const { query, limit } = args as { query: string; limit: number };
        const result = await this.searchEngine.search({
          query,
          numResults: limit,
        });
        let responseText = `Search summaries for "${query}":\n\n`;
        result.results.forEach((item, i) => {
          responseText += `**${i + 1}. ${item.title}**\nURL: ${item.url}\nDescription: ${item.description}\n---\n\n`;
        });
        return { content: [{ type: 'text' as const, text: responseText }] };
      }
    );

    this.server.tool(
      'get-single-web-page-content',
      'Extract full content from a URL.',
      {
        url: z.string().url().describe('The URL to extract'),
        maxContentLength: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Content limit'),
      },
      async args => {
        const { url, maxContentLength } = args as {
          url: string;
          maxContentLength?: number;
        };
        const content = await this.contentExtractor.extractContent({
          url,
          maxContentLength: maxContentLength || this.config.maxContentLength,
        });
        return { content: [{ type: 'text' as const, text: content }] };
      }
    );
  }

  private async handleWebSearch(
    input: WebSearchToolInput,
    deadline?: number
  ): Promise<WebSearchToolOutput> {
    const startTime = Date.now();
    const { query, limit = 5, includeContent = true } = input;

    const searchResponse = await this.searchEngine.search({
      query,
      numResults: limit,
      forceMultiEngine: this.config.forceMultiEngineSearch,
    });

    let results = searchResponse.results;
    if (includeContent) {
      results = await this.contentExtractor.extractContentForResults(
        results,
        limit,
        deadline
      );
    }

    const successCount = results.filter(
      r => r.fetchStatus === 'success'
    ).length;
    return {
      results,
      total_results: results.length,
      search_time_ms: Date.now() - startTime,
      query,
      status: `Engine: ${searchResponse.engine}; Success: ${successCount}/${results.length}`,
    };
  }

  private setupGracefulShutdown(): void {
    const shutdown = async () => {
      this.logger.force('Shutting down gracefully...');
      if (this.browserPool) await this.browserPool.closeAll();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  async run(options: {
    transport: 'stdio' | 'http';
    port?: number;
  }): Promise<void> {
    const startInitialization = async () => {
      // 1. Mark as connected so the logger can use the protocol
      this.isConnected = true;

      this.logger.force(
        `Web Search MCP Server (v0.7.2) initialization starting...`
      );

      // 2. Initialize core components AFTER protocol is up
      // This ensures initialization info logs are sent via protocol notifications
      this.browserPool = new BrowserPool(this.config, this.logger);
      this.searchEngine = new SearchEngine(
        this.config,
        this.browserPool,
        this.logger
      );
      this.contentExtractor = new EnhancedContentExtractor(
        this.config,
        this.browserPool,
        this.logger
      );

      this.logger.info('Core components successfully initialized.');
    };

    if (options.transport === 'http') {
      const app = express();
      const port = options.port || 8000;
      app.use(express.json());
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
      });
      await this.server.connect(transport);
      await startInitialization();
      app.all('/mcp', (req, res) =>
        transport.handleRequest(req, res, req.body)
      );
      app.listen(port, () => {
        this.logger.force(
          `Web Search MCP Server (HTTP) started on port ${port}`
        );
      });
    } else {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      await startInitialization();
      this.logger.force('Web Search MCP Server (stdio) started');
    }
  }
}

const program = new Command();
program
  .name('web-search-mcp')
  .description('Web Search MCP server for local LLMs')
  .version('0.7.2')
  .option('--http', 'Run in HTTP/SSE mode')
  .option('--port <number>', 'Port for HTTP mode', '8000')
  .option('--no-sandbox', 'Disable Playwright sandbox', true)
  .action(async options => {
    const server = new WebSearchMCPServer({
      playwrightNoSandbox: options.sandbox,
    });
    server
      .run({
        transport: options.http ? 'http' : 'stdio',
        port: parseInt(options.port, 10),
      })
      .catch(err => {
        console.error('[FATAL] Bootstrap failed:', err);
        process.exit(1);
      });
  });

program.parse();
