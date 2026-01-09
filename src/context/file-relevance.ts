/**
 * File Relevance Scorer for Ender
 * Determines which files are relevant to a task
 */

import * as path from 'path';
// Logger is available but currently unused in favor of simple implementation
import type { FileContent, Plan, ConversationMessage } from '../types';

export interface RelevanceScore {
  path: string;
  score: number;
  reasons: string[];
}

export interface ScoringContext {
  query: string;
  plan?: Plan;
  recentMessages?: ConversationMessage[];
  recentlyModified?: string[];
  imports?: Map<string, string[]>;
}

export class FileRelevanceScorer {
  /**
   * Score files by relevance to context
   */
  scoreFiles(files: FileContent[], context: ScoringContext): RelevanceScore[] {
    const scores: RelevanceScore[] = [];

    for (const file of files) {
      const score = this.scoreFile(file, context);
      scores.push(score);
    }

    // Sort by score descending
    return scores.sort((a, b) => b.score - a.score);
  }

  /**
   * Get most relevant files
   */
  getMostRelevant(
    files: FileContent[],
    context: ScoringContext,
    limit: number = 10,
  ): FileContent[] {
    const scores = this.scoreFiles(files, context);
    const topPaths = scores.slice(0, limit).map((s) => s.path);

    return files.filter((f) => topPaths.includes(f.path));
  }

  /**
   * Score a single file
   */
  private scoreFile(
    file: FileContent,
    context: ScoringContext,
  ): RelevanceScore {
    let score = 0;
    const reasons: string[] = [];

    // Check query relevance
    const queryScore = this.scoreQueryRelevance(file, context.query);
    if (queryScore > 0) {
      score += queryScore;
      reasons.push(`Query match: +${queryScore}`);
    }

    // Check plan relevance
    if (context.plan) {
      const planScore = this.scorePlanRelevance(file, context.plan);
      if (planScore > 0) {
        score += planScore;
        reasons.push(`Plan match: +${planScore}`);
      }
    }

    // Check recent conversation relevance
    if (context.recentMessages) {
      const conversationScore = this.scoreConversationRelevance(
        file,
        context.recentMessages,
      );
      if (conversationScore > 0) {
        score += conversationScore;
        reasons.push(`Conversation match: +${conversationScore}`);
      }
    }

    // Boost recently modified files
    if (context.recentlyModified?.includes(file.path)) {
      score += 20;
      reasons.push('Recently modified: +20');
    }

    // Boost files imported by other relevant files
    if (context.imports) {
      const importScore = this.scoreImportRelevance(file, context.imports);
      if (importScore > 0) {
        score += importScore;
        reasons.push(`Import chain: +${importScore}`);
      }
    }

    // Boost key files (entry points, configs)
    const keyFileScore = this.scoreKeyFile(file.path);
    if (keyFileScore > 0) {
      score += keyFileScore;
      reasons.push(`Key file: +${keyFileScore}`);
    }

    return { path: file.path, score, reasons };
  }

  /**
   * Score based on query keywords
   */
  private scoreQueryRelevance(file: FileContent, query: string): number {
    if (!query) return 0;

    let score = 0;
    const queryLower = query.toLowerCase();
    const contentLower = file.content.toLowerCase();
    const pathLower = file.path.toLowerCase();

    // Extract keywords from query
    const keywords = queryLower
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .filter(
        (w) => !['the', 'and', 'for', 'with', 'this', 'that'].includes(w),
      );

    for (const keyword of keywords) {
      // Path match is very relevant
      if (pathLower.includes(keyword)) {
        score += 15;
      }

      // Content match
      const matches = (contentLower.match(new RegExp(keyword, 'g')) || [])
        .length;
      if (matches > 0) {
        score += Math.min(matches * 2, 20);
      }
    }

    return score;
  }

  /**
   * Score based on plan relevance
   */
  private scorePlanRelevance(file: FileContent, plan: Plan): number {
    let score = 0;

    // Direct match with affected files
    if (plan.affectedFiles.includes(file.path)) {
      score += 50;
    }

    // Check phase files
    for (const phase of plan.phases) {
      if (phase.affectedFiles.includes(file.path)) {
        score += 30;
      }
    }

    // Check task descriptions
    const planText = JSON.stringify(plan).toLowerCase();
    const fileName = path.basename(file.path).toLowerCase();

    if (planText.includes(fileName)) {
      score += 20;
    }

    return score;
  }

  /**
   * Score based on recent conversation
   */
  private scoreConversationRelevance(
    file: FileContent,
    messages: ConversationMessage[],
  ): number {
    let score = 0;
    const recentMessages = messages.slice(-5);
    const fileName = path.basename(file.path).toLowerCase();

    for (const msg of recentMessages) {
      const msgLower = msg.content.toLowerCase();

      if (msgLower.includes(fileName)) {
        score += 10;
      }

      // Check for path mentions
      if (msgLower.includes(file.path.toLowerCase())) {
        score += 15;
      }
    }

    return score;
  }

  /**
   * Score based on import relationships
   */
  private scoreImportRelevance(
    file: FileContent,
    imports: Map<string, string[]>,
  ): number {
    let score = 0;

    // Files that import this file
    for (const [_importer, imported] of imports) {
      if (imported.includes(file.path)) {
        score += 5;
      }
    }

    // Files this file imports
    const thisFileImports = imports.get(file.path) || [];
    score += Math.min(thisFileImports.length * 2, 10);

    return score;
  }

  /**
   * Score key files (entry points, configs)
   */
  private scoreKeyFile(filePath: string): number {
    const fileName = path.basename(filePath).toLowerCase();
    const keyFiles: Record<string, number> = {
      'index.ts': 10,
      'index.tsx': 10,
      'index.js': 10,
      'main.ts': 15,
      'app.ts': 15,
      'app.tsx': 15,
      'package.json': 20,
      'tsconfig.json': 10,
      '.env': 5,
      'readme.md': 5,
    };

    return keyFiles[fileName] || 0;
  }

  /**
   * Build import map from files
   */
  static buildImportMap(files: FileContent[]): Map<string, string[]> {
    const imports = new Map<string, string[]>();
    const importRegex = /import\s+.*\s+from\s+['"]([^'"]+)['"]/g;
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

    for (const file of files) {
      const fileImports: string[] = [];

      let match;
      while ((match = importRegex.exec(file.content)) !== null) {
        if (match[1]?.startsWith('.')) {
          const resolved = path.resolve(path.dirname(file.path), match[1]);
          fileImports.push(resolved);
        }
      }

      while ((match = requireRegex.exec(file.content)) !== null) {
        if (match[1]?.startsWith('.')) {
          const resolved = path.resolve(path.dirname(file.path), match[1]);
          fileImports.push(resolved);
        }
      }

      imports.set(file.path, fileImports);
    }

    return imports;
  }
}

// Singleton instance
export const fileRelevanceScorer = new FileRelevanceScorer();
