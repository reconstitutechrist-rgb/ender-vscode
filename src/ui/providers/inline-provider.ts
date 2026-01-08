/**
 * Inline Completion Provider
 * Provides AI-powered ghost text suggestions in the editor
 */

import * as vscode from 'vscode';
import { apiClient } from '../../api/anthropic-client';
import { logger } from '../../utils';

interface CachedCompletion {
  completion: string;
  timestamp: number;
}

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private cache = new Map<string, CachedCompletion>();
  private readonly CACHE_TTL = 30000; // 30 seconds
  private readonly MAX_CONTEXT_LINES = 20;
  private readonly MIN_TRIGGER_LENGTH = 3;
  private requestInProgress = false;

  /**
   * Provide inline completion items
   */
  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[]> {
    // Skip if cancelled
    if (token.isCancellationRequested) return [];

    // Skip if API client not ready
    if (!apiClient.isReady()) {
      logger.debug('Inline completion skipped: API client not ready', 'InlineProvider');
      return [];
    }

    // Get line content
    const line = document.lineAt(position.line);
    const linePrefix = line.text.substring(0, position.character);
    const lineSuffix = line.text.substring(position.character);

    // Skip if in string or comment
    if (this.isInStringOrComment(document, position, linePrefix)) {
      return [];
    }

    // Skip if line prefix is too short
    if (linePrefix.trim().length < this.MIN_TRIGGER_LENGTH) {
      return [];
    }

    // Skip if cursor is in middle of a word (unless at end of line)
    if (lineSuffix.length > 0 && /^\w/.test(lineSuffix)) {
      return [];
    }

    // Generate cache key
    const cacheKey = this.getCacheKey(document, position, linePrefix);

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return this.createCompletionItems(cached.completion, position);
    }

    // Skip if another request is in progress
    if (this.requestInProgress) {
      return [];
    }

    try {
      this.requestInProgress = true;

      // Get context
      const prefix = this.getPrefix(document, position);
      const suffix = this.getSuffix(document, position);
      const language = document.languageId;

      // Request completion from AI
      const completion = await this.getAICompletion(prefix, suffix, language, token);

      if (!completion || token.isCancellationRequested) {
        return [];
      }

      // Cache the result
      this.cache.set(cacheKey, { completion, timestamp: Date.now() });

      // Clean old cache entries
      this.cleanCache();

      return this.createCompletionItems(completion, position);
    } catch (error) {
      if (error instanceof Error) {
        logger.debug(`Inline completion error: ${error.message}`, 'InlineProvider');
      }
      return [];
    } finally {
      this.requestInProgress = false;
    }
  }

  /**
   * Get prefix context around cursor
   */
  private getPrefix(document: vscode.TextDocument, position: vscode.Position): string {
    const startLine = Math.max(0, position.line - this.MAX_CONTEXT_LINES);
    const lines: string[] = [];

    for (let i = startLine; i < position.line; i++) {
      lines.push(document.lineAt(i).text);
    }

    // Add current line up to cursor
    lines.push(document.lineAt(position.line).text.substring(0, position.character));

    return lines.join('\n');
  }

  /**
   * Get suffix context after cursor
   */
  private getSuffix(document: vscode.TextDocument, position: vscode.Position): string {
    const endLine = Math.min(document.lineCount - 1, position.line + 5);
    const lines: string[] = [];

    // Rest of current line
    lines.push(document.lineAt(position.line).text.substring(position.character));

    // Following lines
    for (let i = position.line + 1; i <= endLine; i++) {
      lines.push(document.lineAt(i).text);
    }

    return lines.join('\n');
  }

  /**
   * Check if cursor is in a string or comment
   */
  private isInStringOrComment(
    document: vscode.TextDocument,
    _position: vscode.Position,
    linePrefix: string
  ): boolean {
    // Check for line comments
    const language = document.languageId;
    const commentMarkers = this.getCommentMarkers(language);

    for (const marker of commentMarkers.line) {
      if (linePrefix.includes(marker)) {
        return true;
      }
    }

    // Check for unmatched quotes (simple heuristic)
    const singleQuotes = (linePrefix.match(/'/g) || []).length;
    const doubleQuotes = (linePrefix.match(/"/g) || []).length;
    const backticks = (linePrefix.match(/`/g) || []).length;

    // Odd number of quotes means we're inside a string
    if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0 || backticks % 2 !== 0) {
      return true;
    }

    return false;
  }

  /**
   * Get comment markers for language
   */
  private getCommentMarkers(language: string): { line: string[]; block: [string, string][] } {
    const markers: Record<string, { line: string[]; block: [string, string][] }> = {
      typescript: { line: ['//'], block: [['/*', '*/']] },
      javascript: { line: ['//'], block: [['/*', '*/']] },
      typescriptreact: { line: ['//'], block: [['/*', '*/']] },
      javascriptreact: { line: ['//'], block: [['/*', '*/']] },
      python: { line: ['#'], block: [['"""', '"""'], ["'''", "'''"]] },
      ruby: { line: ['#'], block: [['=begin', '=end']] },
      go: { line: ['//'], block: [['/*', '*/']] },
      rust: { line: ['//'], block: [['/*', '*/']] },
      java: { line: ['//'], block: [['/*', '*/']] },
      cpp: { line: ['//'], block: [['/*', '*/']] },
      c: { line: ['//'], block: [['/*', '*/']] },
      csharp: { line: ['//'], block: [['/*', '*/']] },
      php: { line: ['//', '#'], block: [['/*', '*/']] },
    };

    return markers[language] || { line: ['//'], block: [['/*', '*/']] };
  }

  /**
   * Get AI completion from Claude
   */
  private async getAICompletion(
    prefix: string,
    suffix: string,
    language: string,
    token: vscode.CancellationToken
  ): Promise<string | null> {
    const prompt = this.buildPrompt(prefix, suffix, language);

    try {
      const response = await apiClient.chat({
        model: 'claude-sonnet-4-5-20250929',
        system: `You are a code completion assistant. Output ONLY the code that should be inserted at the cursor position. Never include explanations, markdown formatting, or code blocks. Output raw code only. Keep completions short and focused (1-3 lines max).`,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 150,
        temperature: 0
      });

      if (token.isCancellationRequested) {
        return null;
      }

      const completion = response.content.trim();

      // Validate completion
      if (!this.isValidCompletion(completion)) {
        return null;
      }

      return completion;
    } catch (error) {
      logger.debug(`AI completion request failed: ${error}`, 'InlineProvider');
      return null;
    }
  }

  /**
   * Build the completion prompt
   */
  private buildPrompt(prefix: string, suffix: string, language: string): string {
    const suffixPreview = suffix.slice(0, 200);

    return `Complete the following ${language} code at the <CURSOR> position.

\`\`\`${language}
${prefix}<CURSOR>${suffixPreview}
\`\`\`

Output ONLY the code to insert at <CURSOR>. No explanation, no markdown, no code blocks:`;
  }

  /**
   * Validate completion response
   */
  private isValidCompletion(completion: string): boolean {
    if (!completion || completion.length === 0) {
      return false;
    }

    // Reject if contains markdown code blocks
    if (completion.includes('```')) {
      return false;
    }

    // Reject if too long (likely an explanation)
    if (completion.length > 500) {
      return false;
    }

    // Reject if looks like an explanation
    if (completion.startsWith('Here') || completion.startsWith('This') ||
        completion.startsWith('The ') || completion.startsWith('I ')) {
      return false;
    }

    return true;
  }

  /**
   * Create completion items from text
   */
  private createCompletionItems(
    completion: string,
    position: vscode.Position
  ): vscode.InlineCompletionItem[] {
    const item = new vscode.InlineCompletionItem(
      completion,
      new vscode.Range(position, position)
    );

    return [item];
  }

  /**
   * Generate cache key
   */
  private getCacheKey(
    document: vscode.TextDocument,
    position: vscode.Position,
    linePrefix: string
  ): string {
    return `${document.uri.toString()}:${position.line}:${linePrefix.slice(-50)}`;
  }

  /**
   * Clean old cache entries
   */
  private cleanCache(): void {
    const now = Date.now();
    const maxSize = 100;

    // Remove expired entries
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.CACHE_TTL) {
        this.cache.delete(key);
      }
    }

    // If still too large, remove oldest
    if (this.cache.size > maxSize) {
      const entries = Array.from(this.cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);

      const toDelete = entries.slice(0, entries.length - maxSize);
      for (const [key] of toDelete) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cached completions
   */
  clearCache(): void {
    this.cache.clear();
  }
}

export const inlineProvider = new InlineCompletionProvider();
