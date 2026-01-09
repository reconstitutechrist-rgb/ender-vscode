/**
 * Memory Manager for Ender
 * Coordinates memory operations across tiers
 */

import type {
  MemoryEntry,
  MemoryCategory,
  MemoryTier,
  MemorySearchOptions,
  MemorySearchResult,
  MemoryStats,
  MemoryExport,
  MemoryConflict,
} from '../types';
import { logger, generateId } from '../utils';
import { sqliteClient } from '../storage';

export class MemoryManager {
  private projectPath: string = '';
  private initialized = false;

  /**
   * Initialize memory manager for a project
   */
  async initialize(projectPath: string): Promise<void> {
    this.projectPath = projectPath;
    await sqliteClient.initialize(projectPath);
    this.initialized = true;
    logger.info('Memory manager initialized', 'Memory', { projectPath });
  }

  /**
   * Add a new memory entry
   */
  async addEntry(
    entry: Omit<
      MemoryEntry,
      'id' | 'timestamp' | 'lastAccessed' | 'accessCount'
    >,
  ): Promise<MemoryEntry> {
    this.ensureInitialized();

    const fullEntry: MemoryEntry = {
      ...entry,
      id: generateId(),
      timestamp: new Date(),
      lastAccessed: new Date(),
      accessCount: 0,
      tier: 'warm',
    };

    await sqliteClient.insertMemory(fullEntry);
    logger.debug('Memory entry added', 'Memory', {
      id: fullEntry.id,
      category: fullEntry.category,
    });

    return fullEntry;
  }

  /**
   * Get entry by ID
   */
  async getEntry(id: string): Promise<MemoryEntry | null> {
    this.ensureInitialized();

    const entry = await sqliteClient.getMemory(id);
    if (entry) {
      // Update access tracking
      await sqliteClient.updateMemoryAccess(id);
    }
    return entry;
  }

  /**
   * Update an existing entry
   */
  async updateEntry(
    id: string,
    updates: Partial<MemoryEntry>,
  ): Promise<MemoryEntry | null> {
    this.ensureInitialized();

    const existing = await sqliteClient.getMemory(id);
    if (!existing) return null;

    const updated = { ...existing, ...updates };
    await sqliteClient.updateMemory(updated);

    logger.debug('Memory entry updated', 'Memory', { id });
    return updated;
  }

  /**
   * Delete an entry
   */
  async deleteEntry(id: string): Promise<boolean> {
    this.ensureInitialized();

    const success = await sqliteClient.deleteMemory(id);
    if (success) {
      logger.debug('Memory entry deleted', 'Memory', { id });
    }
    return success;
  }

  /**
   * Search memories
   */
  async search(options: MemorySearchOptions): Promise<MemorySearchResult> {
    this.ensureInitialized();

    const entries = await sqliteClient.searchMemories(options);

    return {
      entries,
      totalCount: entries.length,
    };
  }

  /**
   * Get all entries by category
   */
  async getByCategory(category: MemoryCategory): Promise<MemoryEntry[]> {
    return (await this.search({ categories: [category] })).entries;
  }

  /**
   * Get pinned entries
   */
  async getPinned(): Promise<MemoryEntry[]> {
    return (await this.search({ pinnedOnly: true })).entries;
  }

  /**
   * Pin/unpin an entry
   */
  async togglePin(id: string): Promise<boolean> {
    const entry = await this.getEntry(id);
    if (!entry) return false;

    await this.updateEntry(id, { pinned: !entry.pinned });
    return true;
  }

  /**
   * Confirm a pending entry
   */
  async confirmEntry(id: string): Promise<boolean> {
    const entry = await this.getEntry(id);
    if (!entry || entry.status !== 'pending') return false;

    await this.updateEntry(id, { status: 'confirmed' });
    return true;
  }

  /**
   * Reject a pending entry
   */
  async rejectEntry(id: string): Promise<boolean> {
    const entry = await this.getEntry(id);
    if (!entry || entry.status !== 'pending') return false;

    await this.updateEntry(id, { status: 'rejected' });
    return true;
  }

  /**
   * Check for conflicts with existing entries
   */
  async checkConflicts(
    newEntry: Partial<MemoryEntry>,
  ): Promise<MemoryConflict[]> {
    this.ensureInitialized();

    const conflicts: MemoryConflict[] = [];

    // Search for similar entries
    const searchOptions: MemorySearchOptions = {};
    if (newEntry.category) {
      searchOptions.categories = [newEntry.category];
    }
    if (newEntry.summary) {
      searchOptions.query = newEntry.summary;
    }
    const similar = await this.search(searchOptions);

    for (const existing of similar.entries) {
      // Simple conflict detection based on summary similarity
      if (this.isSimilar(existing.summary, newEntry.summary ?? '')) {
        conflicts.push({
          existingEntry: existing,
          newEntry: newEntry as MemoryEntry,
          conflictType: 'update',
          suggestedResolution: 'merge',
          affectedFields: ['summary', 'detail'],
        });
      }
    }

    return conflicts;
  }

  /**
   * Get memory statistics
   */
  async getStats(): Promise<MemoryStats> {
    this.ensureInitialized();
    return sqliteClient.getMemoryStats();
  }

  /**
   * Export all memories
   */
  async export(): Promise<MemoryExport> {
    this.ensureInitialized();

    const entries = (await this.search({})).entries;
    const stats = await this.getStats();

    return {
      version: '1.0.0',
      exportedAt: new Date(),
      projectName: this.projectPath.split('/').pop() ?? 'Unknown',
      entries,
      metadata: {
        totalEntries: stats.totalEntries,
        categories: stats.byCategory,
        pinnedCount: stats.pinnedCount,
      },
    };
  }

  /**
   * Import memories from export
   */
  async import(
    data: MemoryExport,
  ): Promise<{ imported: number; skipped: number }> {
    this.ensureInitialized();

    let imported = 0;
    let skipped = 0;

    for (const entry of data.entries) {
      try {
        // Check for existing entry with same ID
        const existing = await this.getEntry(entry.id);
        if (existing) {
          skipped++;
          continue;
        }

        await this.addEntry(entry);
        imported++;
      } catch {
        skipped++;
      }
    }

    logger.info('Memory import completed', 'Memory', { imported, skipped });
    return { imported, skipped };
  }

  /**
   * Move entries between tiers
   */
  async updateTiers(): Promise<void> {
    this.ensureInitialized();

    const now = new Date();
    const entries = (await this.search({})).entries;

    for (const entry of entries) {
      const age = now.getTime() - entry.lastAccessed.getTime();
      const hoursSinceAccess = age / (1000 * 60 * 60);

      let newTier: MemoryTier = entry.tier ?? 'warm';

      if (hoursSinceAccess < 24 && entry.accessCount > 5) {
        newTier = 'hot';
      } else if (hoursSinceAccess > 168) {
        // > 1 week
        newTier = 'cold';
      } else {
        newTier = 'warm';
      }

      if (newTier !== entry.tier) {
        await this.updateEntry(entry.id, { tier: newTier });
      }
    }
  }

  /**
   * Get hot tier entries for context
   */
  async getHotMemories(): Promise<MemoryEntry[]> {
    return (await this.search({ tier: 'hot' })).entries;
  }

  /**
   * Get warm tier entries for context
   */
  async getWarmMemories(): Promise<MemoryEntry[]> {
    return (await this.search({ tier: 'warm' })).entries;
  }

  /**
   * Check if two strings are similar
   */
  private isSimilar(a: string, b: string): boolean {
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const na = normalize(a);
    const nb = normalize(b);

    // Simple containment check
    return na.includes(nb) || nb.includes(na);
  }

  /**
   * Ensure manager is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        'Memory manager not initialized. Call initialize() first.',
      );
    }
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    await sqliteClient.close();
    this.initialized = false;
  }
}

export const memoryManager = new MemoryManager();
