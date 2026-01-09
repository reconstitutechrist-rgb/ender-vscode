/**
 * Context7 client for Ender
 * Fetches up-to-date library documentation
 */

import { logger } from '../utils';

// Declare globals for VS Code Node environment
declare const fetch: any;
declare const URL: any;

export interface LibraryMatch {
  id: string;
  name: string;
  description: string;
  codeSnippetCount: number;
  trustScore: number;
}

export interface Documentation {
  libraryId: string;
  content: string;
  topic?: string;
  tokens: number;
  source: string;
}

export interface Context7Config {
  maxTokens: number;
  cacheEnabled: boolean;
  cacheTtlMinutes: number;
  baseUrl?: string;
  apiKey?: string;
}

interface CacheEntry {
  documentation: Documentation;
  cachedAt: Date;
}

export class Context7Client {
  private config: Context7Config;
  private cache: Map<string, CacheEntry> = new Map();
  private baseUrl = 'https://api.context7.com/v1';

  constructor(config?: Partial<Context7Config>) {
    this.config = {
      maxTokens: 5000,
      cacheEnabled: true,
      cacheTtlMinutes: 60,
      ...config,
    };
    if (config?.baseUrl) this.baseUrl = config.baseUrl;
  }

  /**
   * Resolve library name to Context7-compatible library ID
   */
  async resolveLibraryId(libraryName: string): Promise<LibraryMatch[]> {
    logger.debug(`Resolving library ID for: ${libraryName}`, 'Context7');

    try {
      // Try local mappings first for speed
      const localMatches = this.getKnownLibraryMatches(libraryName);
      if (localMatches.length > 0) return localMatches;

      if (!this.config.apiKey) {
        logger.debug(
          'No Context7 API key, skipping remote resolution',
          'Context7',
        );
        return [];
      }

      // Call API
      const response = await fetch(
        `${this.baseUrl}/libraries/search?q=${encodeURIComponent(libraryName)}`,
        {
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as { matches: LibraryMatch[] };
      return data.matches || [];
    } catch (error) {
      logger.error(`Failed to resolve library: ${libraryName}`, 'Context7', {
        error,
      });
      return [];
    }
  }

  /**
   * Get library documentation
   */
  async getLibraryDocs(params: {
    libraryId: string;
    topic?: string;
    maxTokens?: number;
  }): Promise<Documentation | null> {
    const { libraryId, topic, maxTokens = this.config.maxTokens } = params;
    const cacheKey = `${libraryId}:${topic || 'default'}:${maxTokens}`;

    // Check cache
    if (this.config.cacheEnabled) {
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        return cached;
      }
    }

    try {
      const documentation = await this.fetchDocumentation(
        libraryId,
        topic,
        maxTokens,
      );

      if (documentation && this.config.cacheEnabled) {
        this.addToCache(cacheKey, documentation);
      }

      return documentation;
    } catch (error) {
      logger.error(`Failed to fetch docs for ${libraryId}`, 'Context7', {
        error,
      });
      return null;
    }
  }

  /**
   * Auto-fetch documentation for imports
   */
  async fetchDocsForImports(imports: string[]): Promise<Documentation[]> {
    const docs: Documentation[] = [];
    const unknownLibraries = imports.filter((lib) => !this.isBuiltIn(lib));

    // Process in batches
    for (const lib of unknownLibraries) {
      const matches = await this.resolveLibraryId(lib);
      if (matches.length > 0 && matches[0]) {
        const doc = await this.getLibraryDocs({
          libraryId: matches[0].id,
          maxTokens: 3000,
        });
        if (doc) docs.push(doc);
      }
    }

    return docs;
  }

  /**
   * Parse imports from code
   */
  parseImports(code: string): string[] {
    const imports: string[] = [];

    // ES6 imports
    const es6Regex =
      /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;
    let match;
    while ((match = es6Regex.exec(code)) !== null) {
      if (match[1]) imports.push(this.normalizeImportPath(match[1]));
    }

    // CommonJS requires
    const cjsRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = cjsRegex.exec(code)) !== null) {
      if (match[1]) imports.push(this.normalizeImportPath(match[1]));
    }

    return [...new Set(imports)];
  }

  /**
   * Fetch documentation from API
   */
  private async fetchDocumentation(
    libraryId: string,
    topic?: string,
    maxTokens?: number,
  ): Promise<Documentation | null> {
    if (!this.config.apiKey) {
      logger.debug('No Context7 API key, cannot fetch remote docs', 'Context7');
      // Return placeholder if no key
      const result: Documentation = {
        libraryId,
        content: `Documentation for ${libraryId} (Remote fetch requires API Key)`,
        tokens: 10,
        source: 'local-fallback',
      };
      if (topic) {
        result.topic = topic;
      }
      return result;
    }

    logger.debug(`Fetching remote docs for ${libraryId}`, 'Context7');

    const url = new URL(
      `${this.baseUrl}/libraries/${encodeURIComponent(libraryId)}/docs`,
    );
    if (topic) url.searchParams.append('topic', topic);
    if (maxTokens) url.searchParams.append('max_tokens', maxTokens.toString());

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Context7 API Error: ${response.status}`);
    }

    const data = (await response.json()) as any;

    return {
      libraryId,
      content: data.content,
      ...(data.topic ? { topic: data.topic } : {}),
      tokens: data.tokens,
      source: 'context7-api',
    };
  }

  /**
   * Get known library mappings (fallback)
   */
  private getKnownLibraryMatches(name: string): LibraryMatch[] {
    // Kept as optimization / fallback
    const knownLibraries: Record<string, LibraryMatch> = {
      react: {
        id: '/facebook/react',
        name: 'React',
        description: 'A JavaScript library for building user interfaces',
        codeSnippetCount: 500,
        trustScore: 10,
      },
      next: {
        id: '/vercel/next.js',
        name: 'Next.js',
        description: 'The React Framework for Production',
        codeSnippetCount: 800,
        trustScore: 10,
      },
      // ... (Add more common ones)
    };

    const normalizedName = name.toLowerCase().replace(/^@/, '');
    const library = knownLibraries[name] || knownLibraries[normalizedName];

    return library ? [library] : [];
  }

  /**
   * Check if import is a built-in module
   */
  private isBuiltIn(importPath: string): boolean {
    const builtIns = [
      'fs',
      'path',
      'http',
      'https',
      'crypto',
      'util',
      'os',
      'events',
      'stream',
      'buffer',
      'querystring',
      'url',
      'child_process',
      'cluster',
      'dns',
      'net',
      'readline',
      'repl',
      'tls',
      'dgram',
      'vm',
      'zlib',
      'assert',
      'console',
      'process',
      'timers',
      'module',
    ];

    // Also exclude relative imports
    if (importPath.startsWith('.') || importPath.startsWith('/')) {
      return true;
    }

    return builtIns.includes(importPath) || importPath.startsWith('node:');
  }

  /**
   * Normalize import path to package name
   */
  private normalizeImportPath(importPath: string): string {
    if (importPath.startsWith('@')) {
      const parts = importPath.split('/');
      return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : importPath;
    }
    return importPath.split('/')[0] || importPath;
  }

  /**
   * Get from cache if valid
   */
  private getFromCache(key: string): Documentation | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const ttl = this.config.cacheTtlMinutes * 60 * 1000;
    const isExpired = Date.now() - entry.cachedAt.getTime() > ttl;

    if (isExpired) {
      this.cache.delete(key);
      return null;
    }

    return entry.documentation;
  }

  /**
   * Add to cache
   */
  private addToCache(key: string, documentation: Documentation): void {
    this.cache.set(key, {
      documentation,
      cachedAt: new Date(),
    });
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

export const context7Client = new Context7Client();
