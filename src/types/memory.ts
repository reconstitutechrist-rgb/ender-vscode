/**
 * Memory system type definitions for Ender
 * Tiered memory with auto-update and user confirmation
 */

export type MemoryCategory =
  | 'architecture'
  | 'conventions'
  | 'dependencies'
  | 'known_issues'
  | 'business_logic'
  | 'plans'
  | 'history'
  | 'corrections'
  | 'structure';

export type MemoryTier = 'hot' | 'warm' | 'cold';

export type MemoryStatus = 'pending' | 'confirmed' | 'rejected';

export type MemorySource = 'auto' | 'user';

export interface MemoryEntry {
  id: string;
  timestamp: Date;
  category: MemoryCategory;
  summary: string;
  detail: string;
  relatedFiles: string[];
  planId?: string;
  confidence: number;
  source: MemorySource;
  tags: string[];
  status: MemoryStatus;
  pinned: boolean;
  lastAccessed: Date;
  accessCount: number;
  supersededBy?: string;
  tier?: MemoryTier;
}

export interface MemoryConflict {
  existingEntry: MemoryEntry;
  newEntry: MemoryEntry;
  conflictType: 'contradiction' | 'update' | 'refinement';
  suggestedResolution: 'replace' | 'merge' | 'keep_both';
  affectedFields: string[];
}

export interface MemorySearchOptions {
  categories?: MemoryCategory[];
  tags?: string[];
  query?: string;
  limit?: number;
  includeArchived?: boolean;
  pinnedOnly?: boolean;
  tier?: MemoryTier;
  dateRange?: {
    start: Date;
    end: Date;
  };
}

export interface MemorySearchResult {
  entries: MemoryEntry[];
  totalCount: number;
  relevanceScores?: Map<string, number>;
}

export interface AutoMemoryTrigger {
  event: AutoMemoryEvent;
  category: MemoryCategory;
  extractData: (context: AutoMemoryContext) => Partial<MemoryEntry>;
}

export type AutoMemoryEvent =
  | 'plan_approved'
  | 'phase_completed'
  | 'plan_completed'
  | 'dependency_added'
  | 'architecture_decision'
  | 'convention_detected'
  | 'bug_discovered'
  | 'user_correction'
  | 'file_structure_change';

export interface AutoMemoryContext {
  event: AutoMemoryEvent;
  plan?: Plan;
  phase?: PlanPhase;
  files?: string[];
  decision?: string;
  reasoning?: string;
  correction?: {
    wrong: string;
    correct: string;
  };
}

export interface MemoryConfirmationRequest {
  entry: MemoryEntry;
  context: string;
  suggestedAction: 'confirm' | 'reject' | 'edit';
}

export interface MemoryExport {
  version: string;
  exportedAt: Date;
  projectName: string;
  entries: MemoryEntry[];
  metadata: {
    totalEntries: number;
    categories: Record<MemoryCategory, number>;
    pinnedCount: number;
  };
}

export interface MemorySummary {
  id: string;
  originalEntries: string[];
  summary: string;
  category: MemoryCategory;
  createdAt: Date;
  tokensSaved: number;
}

export interface MemoryTierConfig {
  hot: {
    maxAge: number; // hours
    maxEntries: number;
  };
  warm: {
    maxAge: number; // days
    summarizeAfter: number; // days
  };
  cold: {
    compressionLevel: 'light' | 'heavy';
  };
}

export interface MemoryStats {
  totalEntries: number;
  byCategory: Record<MemoryCategory, number>;
  byStatus: Record<MemoryStatus, number>;
  byTier: Record<MemoryTier, number>;
  pinnedCount: number;
  averageAccessCount: number;
  oldestEntry: Date;
  newestEntry: Date;
  totalTokens: number;
}

// Import related types
import type { Plan, PlanPhase } from './plans';
