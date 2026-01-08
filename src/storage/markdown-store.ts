/**
 * Markdown store for Ender
 * Human-readable memory storage using markdown files
 */

import * as path from 'path';
import { readFile, writeFile, fileExists } from '../utils/file-utils';
import { logger, generateId } from '../utils';
import type { MemoryEntry, MemoryCategory, MemoryStatus } from '../types';

export class MarkdownStore {
  private baseDir: string;
  private initialized = false;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  /**
   * Initialize markdown store
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create directory structure
    const categories: MemoryCategory[] = [
      'architecture',
      'conventions', 
      'dependencies',
      'known_issues',
      'business_logic',
      'plans',
      'history',
      'corrections',
      'structure'
    ];

    for (const category of categories) {
      const filePath = this.getCategoryPath(category);
      if (!(await fileExists(filePath))) {
        await this.createCategoryFile(category);
      }
    }

    this.initialized = true;
    logger.info(`Markdown store initialized at ${this.baseDir}`, 'Storage');
  }

  /**
   * Get path for category file
   */
  private getCategoryPath(category: MemoryCategory): string {
    return path.join(this.baseDir, 'memory', `${category}.md`);
  }

  /**
   * Create category file with header
   */
  private async createCategoryFile(category: MemoryCategory): Promise<void> {
    const header = this.getCategoryHeader(category);
    await writeFile(this.getCategoryPath(category), header);
  }

  /**
   * Get header for category
   */
  private getCategoryHeader(category: MemoryCategory): string {
    const headers: Record<MemoryCategory, string> = {
      architecture: '# Architecture Decisions\n\nStructural and design decisions for the project.\n\n---\n',
      conventions: '# Coding Conventions\n\nCoding standards and patterns used in this project.\n\n---\n',
      dependencies: '# Dependencies\n\nPackage decisions and external libraries.\n\n---\n',
      known_issues: '# Known Issues\n\nDocumented problems and their resolutions.\n\n---\n',
      business_logic: '# Business Logic\n\nDomain rules and business requirements.\n\n---\n',
      plans: '# Implementation Plans\n\nApproved and completed implementation plans.\n\n---\n',
      history: '# History\n\nCompleted work and changes.\n\n---\n',
      corrections: '# Corrections\n\nUser corrections and feedback.\n\n---\n',
      structure: '# Project Structure\n\nFile organization and directory layout.\n\n---\n'
    };

    return headers[category];
  }

  /**
   * Save memory entry to markdown
   */
  async saveEntry(entry: MemoryEntry): Promise<void> {
    const filePath = this.getCategoryPath(entry.category);
    const markdown = this.entryToMarkdown(entry);

    try {
      let content = await readFile(filePath);
      content += '\n' + markdown;
      await writeFile(filePath, content);
      
      logger.debug(`Saved entry ${entry.id} to ${entry.category}.md`, 'MarkdownStore');
    } catch (error) {
      logger.error(`Failed to save entry ${entry.id}`, 'MarkdownStore', { error });
      throw error;
    }
  }

  /**
   * Convert entry to markdown format
   */
  private entryToMarkdown(entry: MemoryEntry): string {
    const statusEmoji: Record<MemoryStatus, string> = {
      pending: '⏳',
      confirmed: '✅',
      rejected: '❌'
    };

    let md = `## Entry: ${entry.id}\n`;
    md += `**Date:** ${entry.timestamp.toISOString().split('T')[0]}\n`;
    md += `**Status:** ${statusEmoji[entry.status]} ${entry.status}\n`;
    md += `**Pinned:** ${entry.pinned ? '📌 yes' : 'no'}\n`;
    
    if (entry.confidence < 100) {
      md += `**Confidence:** ${entry.confidence}%\n`;
    }

    md += `\n### Summary\n${entry.summary}\n`;
    
    if (entry.detail && entry.detail !== entry.summary) {
      md += `\n### Detail\n${entry.detail}\n`;
    }

    if (entry.relatedFiles.length > 0) {
      md += `\n### Related Files\n`;
      for (const file of entry.relatedFiles) {
        md += `- ${file}\n`;
      }
    }

    if (entry.tags.length > 0) {
      md += `\n### Tags\n${entry.tags.join(', ')}\n`;
    }

    if (entry.planId) {
      md += `\n**Plan:** ${entry.planId}\n`;
    }

    if (entry.supersededBy) {
      md += `\n**⚠️ Superseded by:** ${entry.supersededBy}\n`;
    }

    md += '\n---\n';

    return md;
  }

  /**
   * Update entry in markdown file
   */
  async updateEntry(entry: MemoryEntry): Promise<void> {
    const filePath = this.getCategoryPath(entry.category);
    
    try {
      let content = await readFile(filePath);
      
      // Find and replace the entry
      const entryRegex = new RegExp(
        `## Entry: ${entry.id}[\\s\\S]*?(?=## Entry:|$)`,
        'g'
      );
      
      const newMarkdown = this.entryToMarkdown(entry);
      
      if (entryRegex.test(content)) {
        content = content.replace(entryRegex, newMarkdown);
      } else {
        // Entry not found, append it
        content += '\n' + newMarkdown;
      }

      await writeFile(filePath, content);
      logger.debug(`Updated entry ${entry.id} in ${entry.category}.md`, 'MarkdownStore');
    } catch (error) {
      logger.error(`Failed to update entry ${entry.id}`, 'MarkdownStore', { error });
      throw error;
    }
  }

  /**
   * Remove entry from markdown file
   */
  async removeEntry(id: string, category: MemoryCategory): Promise<void> {
    const filePath = this.getCategoryPath(category);
    
    try {
      let content = await readFile(filePath);
      
      // Remove the entry
      const entryRegex = new RegExp(
        `## Entry: ${id}[\\s\\S]*?(?=## Entry:|$)`,
        'g'
      );
      
      content = content.replace(entryRegex, '');
      
      // Clean up multiple blank lines
      content = content.replace(/\n{3,}/g, '\n\n');

      await writeFile(filePath, content);
      logger.debug(`Removed entry ${id} from ${category}.md`, 'MarkdownStore');
    } catch (error) {
      logger.error(`Failed to remove entry ${id}`, 'MarkdownStore', { error });
      throw error;
    }
  }

  /**
   * Parse entries from markdown file
   */
  async parseEntries(category: MemoryCategory): Promise<Partial<MemoryEntry>[]> {
    const filePath = this.getCategoryPath(category);
    
    try {
      const content = await readFile(filePath);
      const entries: Partial<MemoryEntry>[] = [];
      
      // Find all entries
      const entryRegex = /## Entry: ([^\n]+)\n([\s\S]*?)(?=## Entry:|---\s*$|$)/g;
      let match;

      while ((match = entryRegex.exec(content)) !== null) {
        const id = match[1]?.trim();
        const body = match[2] || '';
        
        if (!id) continue;

        const entry: Partial<MemoryEntry> = {
          id,
          category
        };

        // Parse date
        const dateMatch = body.match(/\*\*Date:\*\* ([^\n]+)/);
        if (dateMatch?.[1]) {
          entry.timestamp = new Date(dateMatch[1]);
        }

        // Parse status
        const statusMatch = body.match(/\*\*Status:\*\* [^\s]+ (\w+)/);
        if (statusMatch?.[1]) {
          entry.status = statusMatch[1] as MemoryStatus;
        }

        // Parse pinned
        const pinnedMatch = body.match(/\*\*Pinned:\*\* (📌 yes|yes)/);
        entry.pinned = Boolean(pinnedMatch);

        // Parse confidence
        const confidenceMatch = body.match(/\*\*Confidence:\*\* (\d+)%/);
        if (confidenceMatch?.[1]) {
          entry.confidence = parseInt(confidenceMatch[1], 10);
        }

        // Parse summary
        const summaryMatch = body.match(/### Summary\n([\s\S]*?)(?=###|---|\*\*|$)/);
        if (summaryMatch?.[1]) {
          entry.summary = summaryMatch[1].trim();
        }

        // Parse detail
        const detailMatch = body.match(/### Detail\n([\s\S]*?)(?=###|---|\*\*|$)/);
        if (detailMatch?.[1]) {
          entry.detail = detailMatch[1].trim();
        }

        // Parse related files
        const filesMatch = body.match(/### Related Files\n([\s\S]*?)(?=###|---|\*\*|$)/);
        if (filesMatch?.[1]) {
          entry.relatedFiles = filesMatch[1]
            .split('\n')
            .filter(line => line.startsWith('-'))
            .map(line => line.replace(/^-\s*/, '').trim());
        }

        // Parse tags
        const tagsMatch = body.match(/### Tags\n([^\n]+)/);
        if (tagsMatch?.[1]) {
          entry.tags = tagsMatch[1].split(',').map(t => t.trim());
        }

        // Parse plan ID
        const planMatch = body.match(/\*\*Plan:\*\* ([^\n]+)/);
        if (planMatch?.[1]) {
          entry.planId = planMatch[1].trim();
        }

        // Parse superseded by
        const supersededMatch = body.match(/\*\*⚠️ Superseded by:\*\* ([^\n]+)/);
        if (supersededMatch?.[1]) {
          entry.supersededBy = supersededMatch[1].trim();
        }

        entries.push(entry);
      }

      return entries;
    } catch (error) {
      logger.error(`Failed to parse entries from ${category}.md`, 'MarkdownStore', { error });
      return [];
    }
  }

  /**
   * Export all entries to markdown
   */
  async exportAll(): Promise<string> {
    const categories: MemoryCategory[] = [
      'architecture', 'conventions', 'dependencies', 'known_issues',
      'business_logic', 'plans', 'history', 'corrections', 'structure'
    ];

    let exported = '# Ender Memory Export\n\n';
    exported += `**Exported:** ${new Date().toISOString()}\n\n`;
    exported += '---\n\n';

    for (const category of categories) {
      const filePath = this.getCategoryPath(category);
      try {
        const content = await readFile(filePath);
        exported += content + '\n\n';
      } catch {
        // File might not exist, skip it
      }
    }

    return exported;
  }

  /**
   * Get category file content
   */
  async getCategoryContent(category: MemoryCategory): Promise<string> {
    const filePath = this.getCategoryPath(category);
    try {
      return await readFile(filePath);
    } catch {
      return this.getCategoryHeader(category);
    }
  }

  /**
   * Get summary of all categories
   */
  async getSummary(): Promise<Record<MemoryCategory, number>> {
    const categories: MemoryCategory[] = [
      'architecture', 'conventions', 'dependencies', 'known_issues',
      'business_logic', 'plans', 'history', 'corrections', 'structure'
    ];

    const summary: Record<string, number> = {};

    for (const category of categories) {
      const entries = await this.parseEntries(category);
      summary[category] = entries.length;
    }

    return summary as Record<MemoryCategory, number>;
  }
}
