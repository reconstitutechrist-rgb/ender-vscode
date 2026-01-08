/**
 * Context7 client for Ender
 * Fetches up-to-date library documentation
 */

import { logger, retry } from '../utils';

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
}

interface CacheEntry {
  documentation: Documentation;
  cachedAt: Date;
}

export class Context7Client {
  private config: Context7Config;
  private cache: Map<string, CacheEntry> = new Map();
  private baseUrl = 'https://context7.com/api'; // Placeholder URL

  constructor(config?: Partial<Context7Config>) {
    this.config = {
      maxTokens: 5000,
      cacheEnabled: true,
      cacheTtlMinutes: 60,
      ...config
    };
  }

  /**
   * Resolve library name to Context7-compatible library ID
   */
  async resolveLibraryId(libraryName: string): Promise<LibraryMatch[]> {
    logger.debug(`Resolving library ID for: ${libraryName}`, 'Context7');

    try {
      // In production, this would call the actual Context7 API
      // For now, we'll provide common library mappings
      const matches = this.getKnownLibraryMatches(libraryName);
      
      if (matches.length > 0) {
        logger.debug(`Found ${matches.length} matches for ${libraryName}`, 'Context7');
        return matches;
      }

      // If no known match, return empty (would call API in production)
      logger.debug(`No matches found for ${libraryName}`, 'Context7');
      return [];
    } catch (error) {
      logger.error(`Failed to resolve library: ${libraryName}`, 'Context7', { error });
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

    logger.debug(`Fetching docs for ${libraryId}`, 'Context7', { topic, maxTokens });

    // Check cache
    if (this.config.cacheEnabled) {
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        logger.debug(`Cache hit for ${libraryId}`, 'Context7');
        return cached;
      }
    }

    try {
      // In production, this would call the actual Context7 API
      const documentation = await this.fetchDocumentation(libraryId, topic, maxTokens);
      
      if (documentation && this.config.cacheEnabled) {
        this.addToCache(cacheKey, documentation);
      }

      return documentation;
    } catch (error) {
      logger.error(`Failed to fetch docs for ${libraryId}`, 'Context7', { error });
      return null;
    }
  }

  /**
   * Auto-fetch documentation for imports
   */
  async fetchDocsForImports(imports: string[]): Promise<Documentation[]> {
    const docs: Documentation[] = [];
    const unknownLibraries = imports.filter(lib => !this.isBuiltIn(lib));

    for (const lib of unknownLibraries) {
      const matches = await this.resolveLibraryId(lib);
      if (matches.length > 0 && matches[0]) {
        const doc = await this.getLibraryDocs({
          libraryId: matches[0].id,
          maxTokens: 3000 // Smaller budget for auto-fetch
        });
        if (doc) {
          docs.push(doc);
        }
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
    const es6Regex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;
    let match;
    while ((match = es6Regex.exec(code)) !== null) {
      if (match[1]) imports.push(this.normalizeImportPath(match[1]));
    }

    // CommonJS requires
    const cjsRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = cjsRegex.exec(code)) !== null) {
      if (match[1]) imports.push(this.normalizeImportPath(match[1]));
    }

    // Remove duplicates
    return [...new Set(imports)];
  }

  /**
   * Get known library mappings
   */
  private getKnownLibraryMatches(name: string): LibraryMatch[] {
    const knownLibraries: Record<string, LibraryMatch> = {
      'react': {
        id: '/facebook/react',
        name: 'React',
        description: 'A JavaScript library for building user interfaces',
        codeSnippetCount: 500,
        trustScore: 10
      },
      'next': {
        id: '/vercel/next.js',
        name: 'Next.js',
        description: 'The React Framework for Production',
        codeSnippetCount: 800,
        trustScore: 10
      },
      'express': {
        id: '/expressjs/express',
        name: 'Express',
        description: 'Fast, unopinionated, minimalist web framework for Node.js',
        codeSnippetCount: 300,
        trustScore: 10
      },
      'typescript': {
        id: '/microsoft/typescript',
        name: 'TypeScript',
        description: 'TypeScript is a superset of JavaScript that compiles to clean JavaScript output',
        codeSnippetCount: 600,
        trustScore: 10
      },
      'zod': {
        id: '/colinhacks/zod',
        name: 'Zod',
        description: 'TypeScript-first schema validation with static type inference',
        codeSnippetCount: 200,
        trustScore: 9
      },
      'prisma': {
        id: '/prisma/prisma',
        name: 'Prisma',
        description: 'Next-generation ORM for Node.js & TypeScript',
        codeSnippetCount: 400,
        trustScore: 9
      },
      '@tanstack/react-query': {
        id: '/tanstack/react-query',
        name: 'TanStack Query',
        description: 'Powerful asynchronous state management for React',
        codeSnippetCount: 350,
        trustScore: 9
      },
      'tailwindcss': {
        id: '/tailwindlabs/tailwindcss',
        name: 'Tailwind CSS',
        description: 'A utility-first CSS framework',
        codeSnippetCount: 250,
        trustScore: 10
      },
      'axios': {
        id: '/axios/axios',
        name: 'Axios',
        description: 'Promise based HTTP client for the browser and node.js',
        codeSnippetCount: 150,
        trustScore: 9
      },
      'lodash': {
        id: '/lodash/lodash',
        name: 'Lodash',
        description: 'A modern JavaScript utility library delivering modularity, performance & extras',
        codeSnippetCount: 400,
        trustScore: 10
      },
      'date-fns': {
        id: '/date-fns/date-fns',
        name: 'date-fns',
        description: 'Modern JavaScript date utility library',
        codeSnippetCount: 200,
        trustScore: 9
      },
      'stripe': {
        id: '/stripe/stripe-node',
        name: 'Stripe Node.js',
        description: 'Node.js library for the Stripe API',
        codeSnippetCount: 180,
        trustScore: 10
      }
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
      'fs', 'path', 'http', 'https', 'crypto', 'util', 'os', 'events',
      'stream', 'buffer', 'querystring', 'url', 'child_process', 'cluster',
      'dns', 'net', 'readline', 'repl', 'tls', 'dgram', 'vm', 'zlib',
      'assert', 'console', 'process', 'timers', 'module'
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
    // Handle scoped packages (@org/package)
    if (importPath.startsWith('@')) {
      const parts = importPath.split('/');
      return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : importPath;
    }
    
    // Handle regular packages (package/subpath)
    return importPath.split('/')[0] || importPath;
  }

  /**
   * Fetch documentation (placeholder - would call actual API)
   */
  private async fetchDocumentation(
    libraryId: string,
    topic?: string,
    maxTokens?: number
  ): Promise<Documentation | null> {
    // In production, this would make an actual API call
    // For now, return a placeholder
    return {
      libraryId,
      content: `Documentation for ${libraryId}${topic ? ` (topic: ${topic})` : ''} would be fetched from Context7 API.`,
      topic,
      tokens: 100,
      source: 'context7'
    };
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
      cachedAt: new Date()
    });
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: [...this.cache.keys()]
    };
  }
}

export const context7Client = new Context7Client();
