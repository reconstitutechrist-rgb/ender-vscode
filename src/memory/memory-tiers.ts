/**
 * Memory Tier Management
 * Logic for Hot/Warm/Cold memory tiering based on access patterns
 */

import type { MemoryEntry, MemoryTier } from '../types';

export class MemoryTierManager {
  /**
   * Determine appropriate tier for an entry
   */
  determineTier(entry: MemoryEntry): MemoryTier {
    const now = new Date();
    const ageMs = now.getTime() - entry.lastAccessed.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);

    // Hot: Accessed recently (last 24h) and frequently (> 5 times)
    // Or very recently created (last 1h)
    const ageCreatedHours =
      (now.getTime() - entry.timestamp.getTime()) / (1000 * 60 * 60);

    if (ageCreatedHours < 1) {
      return 'hot';
    }

    if (ageHours < 24 && entry.accessCount > 5) {
      return 'hot';
    }

    // Cold: Not accessed in a week
    if (ageHours > 168) {
      return 'cold';
    }

    // Default: Warm
    return 'warm';
  }

  /**
   * Check if entry should be promoted/demoted
   */
  shouldUpdateTier(entry: MemoryEntry): boolean {
    const currentTier = entry.tier || 'warm';
    const newTier = this.determineTier(entry);
    return currentTier !== newTier;
  }
}

export const memoryTierManager = new MemoryTierManager();
