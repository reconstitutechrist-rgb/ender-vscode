/**
 * SQLite database client for Ender
 * Handles all database operations
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { logger, generateId } from '../utils';
import type { 
  MemoryEntry, 
  MemoryCategory, 
  MemoryStatus,
  Plan,
  PlanPhase,
  UndoEntry,
  FileSnapshot
} from '../types';

export class SqliteClient {
  private db: Database.Database | null = null;
  private dbPath: string = '';
  private initialized = false;

  constructor(dbPath?: string) {
    if (dbPath) {
      this.dbPath = dbPath;
    }
  }

  /**
   * Initialize database with schema
   */
  async initialize(projectPath?: string): Promise<void> {
    if (this.initialized) return;

    // Use provided projectPath or fall back to constructor path
    if (projectPath) {
      this.dbPath = path.join(projectPath, '.ender', 'ender.db');
    }

    if (!this.dbPath) {
      throw new Error('Database path not specified');
    }

    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.createSchema();
    this.initialized = true;

    logger.info(`SQLite database initialized at ${this.dbPath}`, 'Storage');
  }

  /**
   * Create database schema
   */
  private createSchema(): void {
    if (!this.db) return;

    this.db.exec(`
      -- Memory entries table
      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        category TEXT NOT NULL,
        summary TEXT NOT NULL,
        detail TEXT NOT NULL,
        related_files TEXT DEFAULT '[]',
        plan_id TEXT,
        confidence REAL DEFAULT 0.8,
        source TEXT DEFAULT 'auto',
        tags TEXT DEFAULT '[]',
        status TEXT DEFAULT 'pending',
        pinned INTEGER DEFAULT 0,
        last_accessed TEXT,
        access_count INTEGER DEFAULT 0,
        superseded_by TEXT,
        tier TEXT DEFAULT 'warm',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- Plans table
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'draft',
        phases TEXT DEFAULT '[]',
        current_phase_index INTEGER DEFAULT 0,
        estimated_complexity TEXT DEFAULT 'medium',
        estimated_tokens INTEGER DEFAULT 0,
        actual_tokens_used INTEGER DEFAULT 0,
        affected_files TEXT DEFAULT '[]',
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        approved_at TEXT,
        completed_at TEXT,
        locked_at TEXT
      );

      -- Conversations table
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        messages TEXT DEFAULT '[]',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- Checkpoints table (for rollback)
      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        files TEXT DEFAULT '[]',
        plan_id TEXT,
        phase_id TEXT,
        description TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- Usage logs table
      CREATE TABLE IF NOT EXISTS usage_logs (
        id TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cost REAL NOT NULL,
        agent TEXT,
        task_type TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- Undo stack table
      CREATE TABLE IF NOT EXISTS undo_stack (
        id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL,
        action_type TEXT NOT NULL,
        files_before TEXT DEFAULT '[]',
        files_after TEXT DEFAULT '[]',
        description TEXT,
        plan_id TEXT,
        phase_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_memory_category ON memory_entries(category);
      CREATE INDEX IF NOT EXISTS idx_memory_status ON memory_entries(status);
      CREATE INDEX IF NOT EXISTS idx_memory_pinned ON memory_entries(pinned);
      CREATE INDEX IF NOT EXISTS idx_memory_tier ON memory_entries(tier);
      CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
      CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_undo_sequence ON undo_stack(sequence);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_plan ON checkpoints(plan_id);
    `);
  }

  /**
   * Ensure database is ready
   */
  private ensureDb(): Database.Database {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  // =====================
  // Memory Entry Methods
  // =====================

  /**
   * Insert memory entry
   */
  insertMemoryEntry(entry: MemoryEntry): void {
    const db = this.ensureDb();
    
    const stmt = db.prepare(`
      INSERT INTO memory_entries (
        id, timestamp, category, summary, detail, related_files,
        plan_id, confidence, source, tags, status, pinned,
        last_accessed, access_count, superseded_by, tier
      ) VALUES (
        @id, @timestamp, @category, @summary, @detail, @relatedFiles,
        @planId, @confidence, @source, @tags, @status, @pinned,
        @lastAccessed, @accessCount, @supersededBy, @tier
      )
    `);

    stmt.run({
      id: entry.id,
      timestamp: entry.timestamp.toISOString(),
      category: entry.category,
      summary: entry.summary,
      detail: entry.detail,
      relatedFiles: JSON.stringify(entry.relatedFiles),
      planId: entry.planId || null,
      confidence: entry.confidence,
      source: entry.source,
      tags: JSON.stringify(entry.tags),
      status: entry.status,
      pinned: entry.pinned ? 1 : 0,
      lastAccessed: entry.lastAccessed.toISOString(),
      accessCount: entry.accessCount,
      supersededBy: entry.supersededBy || null,
      tier: entry.tier || 'warm'
    });
  }

  /**
   * Get memory entry by ID
   */
  getMemoryEntry(id: string): MemoryEntry | null {
    const db = this.ensureDb();
    
    const stmt = db.prepare('SELECT * FROM memory_entries WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    
    return row ? this.rowToMemoryEntry(row) : null;
  }

  /**
   * Get memory entries with filters
   */
  getMemoryEntries(options: {
    categories?: MemoryCategory[];
    status?: MemoryStatus;
    pinned?: boolean;
    tier?: string;
    limit?: number;
  }): MemoryEntry[] {
    const db = this.ensureDb();
    
    let sql = 'SELECT * FROM memory_entries WHERE 1=1';
    const params: Record<string, unknown> = {};

    if (options.categories && options.categories.length > 0) {
      const placeholders = options.categories.map((_, i) => `@cat${i}`).join(', ');
      sql += ` AND category IN (${placeholders})`;
      options.categories.forEach((cat, i) => {
        params[`cat${i}`] = cat;
      });
    }

    if (options.status) {
      sql += ' AND status = @status';
      params.status = options.status;
    }

    if (options.pinned !== undefined) {
      sql += ' AND pinned = @pinned';
      params.pinned = options.pinned ? 1 : 0;
    }

    if (options.tier) {
      sql += ' AND tier = @tier';
      params.tier = options.tier;
    }

    sql += ' ORDER BY pinned DESC, last_accessed DESC';

    if (options.limit) {
      sql += ' LIMIT @limit';
      params.limit = options.limit;
    }

    const stmt = db.prepare(sql);
    const rows = stmt.all(params) as Record<string, unknown>[];
    
    return rows.map(row => this.rowToMemoryEntry(row));
  }

  /**
   * Update memory entry
   */
  updateMemoryEntry(id: string, updates: Partial<MemoryEntry>): void {
    const db = this.ensureDb();
    
    const setClauses: string[] = ['updated_at = CURRENT_TIMESTAMP'];
    const params: Record<string, unknown> = { id };

    if (updates.status !== undefined) {
      setClauses.push('status = @status');
      params.status = updates.status;
    }
    if (updates.pinned !== undefined) {
      setClauses.push('pinned = @pinned');
      params.pinned = updates.pinned ? 1 : 0;
    }
    if (updates.supersededBy !== undefined) {
      setClauses.push('superseded_by = @supersededBy');
      params.supersededBy = updates.supersededBy;
    }
    if (updates.tier !== undefined) {
      setClauses.push('tier = @tier');
      params.tier = updates.tier;
    }
    if (updates.summary !== undefined) {
      setClauses.push('summary = @summary');
      params.summary = updates.summary;
    }
    if (updates.detail !== undefined) {
      setClauses.push('detail = @detail');
      params.detail = updates.detail;
    }

    const sql = `UPDATE memory_entries SET ${setClauses.join(', ')} WHERE id = @id`;
    const stmt = db.prepare(sql);
    stmt.run(params);
  }

  /**
   * Delete memory entry
   */
  deleteMemoryEntry(id: string): void {
    const db = this.ensureDb();
    const stmt = db.prepare('DELETE FROM memory_entries WHERE id = ?');
    stmt.run(id);
  }

  /**
   * Update last accessed time
   */
  touchMemoryEntry(id: string): void {
    const db = this.ensureDb();
    const stmt = db.prepare(`
      UPDATE memory_entries 
      SET last_accessed = CURRENT_TIMESTAMP, access_count = access_count + 1 
      WHERE id = ?
    `);
    stmt.run(id);
  }

  /**
   * Convert database row to MemoryEntry
   */
  private rowToMemoryEntry(row: Record<string, unknown>): MemoryEntry {
    return {
      id: row.id as string,
      timestamp: new Date(row.timestamp as string),
      category: row.category as MemoryCategory,
      summary: row.summary as string,
      detail: row.detail as string,
      relatedFiles: JSON.parse(row.related_files as string || '[]'),
      planId: row.plan_id as string | undefined,
      confidence: row.confidence as number,
      source: row.source as 'auto' | 'user',
      tags: JSON.parse(row.tags as string || '[]'),
      status: row.status as MemoryStatus,
      pinned: Boolean(row.pinned),
      lastAccessed: new Date(row.last_accessed as string),
      accessCount: row.access_count as number,
      supersededBy: row.superseded_by as string | undefined,
      tier: row.tier as 'hot' | 'warm' | 'cold'
    };
  }

  // =====================
  // Plan Methods
  // =====================

  /**
   * Insert plan
   */
  insertPlan(plan: Plan): void {
    const db = this.ensureDb();
    
    const stmt = db.prepare(`
      INSERT INTO plans (
        id, title, description, status, phases, current_phase_index,
        estimated_complexity, estimated_tokens, actual_tokens_used,
        affected_files, metadata, created_at, approved_at, completed_at, locked_at
      ) VALUES (
        @id, @title, @description, @status, @phases, @currentPhaseIndex,
        @estimatedComplexity, @estimatedTokens, @actualTokensUsed,
        @affectedFiles, @metadata, @createdAt, @approvedAt, @completedAt, @lockedAt
      )
    `);

    stmt.run({
      id: plan.id,
      title: plan.title,
      description: plan.description,
      status: plan.status,
      phases: JSON.stringify(plan.phases),
      currentPhaseIndex: plan.currentPhaseIndex,
      estimatedComplexity: plan.estimatedComplexity,
      estimatedTokens: plan.estimatedTokens,
      actualTokensUsed: plan.actualTokensUsed,
      affectedFiles: JSON.stringify(plan.affectedFiles),
      metadata: JSON.stringify(plan.metadata),
      createdAt: plan.createdAt.toISOString(),
      approvedAt: plan.approvedAt?.toISOString() || null,
      completedAt: plan.completedAt?.toISOString() || null,
      lockedAt: plan.lockedAt?.toISOString() || null
    });
  }

  /**
   * Get plan by ID
   */
  getPlan(id: string): Plan | null {
    const db = this.ensureDb();
    
    const stmt = db.prepare('SELECT * FROM plans WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    
    return row ? this.rowToPlan(row) : null;
  }

  /**
   * Update plan
   */
  updatePlan(id: string, updates: Partial<Plan>): void {
    const db = this.ensureDb();
    
    const setClauses: string[] = [];
    const params: Record<string, unknown> = { id };

    if (updates.status !== undefined) {
      setClauses.push('status = @status');
      params.status = updates.status;
    }
    if (updates.currentPhaseIndex !== undefined) {
      setClauses.push('current_phase_index = @currentPhaseIndex');
      params.currentPhaseIndex = updates.currentPhaseIndex;
    }
    if (updates.phases !== undefined) {
      setClauses.push('phases = @phases');
      params.phases = JSON.stringify(updates.phases);
    }
    if (updates.actualTokensUsed !== undefined) {
      setClauses.push('actual_tokens_used = @actualTokensUsed');
      params.actualTokensUsed = updates.actualTokensUsed;
    }
    if (updates.approvedAt !== undefined) {
      setClauses.push('approved_at = @approvedAt');
      params.approvedAt = updates.approvedAt?.toISOString() || null;
    }
    if (updates.completedAt !== undefined) {
      setClauses.push('completed_at = @completedAt');
      params.completedAt = updates.completedAt?.toISOString() || null;
    }
    if (updates.lockedAt !== undefined) {
      setClauses.push('locked_at = @lockedAt');
      params.lockedAt = updates.lockedAt?.toISOString() || null;
    }

    if (setClauses.length === 0) return;

    const sql = `UPDATE plans SET ${setClauses.join(', ')} WHERE id = @id`;
    const stmt = db.prepare(sql);
    stmt.run(params);
  }

  /**
   * Convert row to Plan
   */
  private rowToPlan(row: Record<string, unknown>): Plan {
    return {
      id: row.id as string,
      title: row.title as string,
      description: row.description as string,
      status: row.status as Plan['status'],
      phases: JSON.parse(row.phases as string || '[]'),
      currentPhaseIndex: row.current_phase_index as number,
      estimatedComplexity: row.estimated_complexity as Plan['estimatedComplexity'],
      estimatedTokens: row.estimated_tokens as number,
      actualTokensUsed: row.actual_tokens_used as number,
      affectedFiles: JSON.parse(row.affected_files as string || '[]'),
      createdAt: new Date(row.created_at as string),
      approvedAt: row.approved_at ? new Date(row.approved_at as string) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at as string) : undefined,
      lockedAt: row.locked_at ? new Date(row.locked_at as string) : undefined,
      metadata: JSON.parse(row.metadata as string || '{}')
    };
  }

  // =====================
  // Undo Stack Methods
  // =====================

  /**
   * Push to undo stack
   */
  pushUndo(entry: UndoEntry): void {
    const db = this.ensureDb();
    
    const stmt = db.prepare(`
      INSERT INTO undo_stack (
        id, sequence, action_type, files_before, files_after,
        description, plan_id, phase_id
      ) VALUES (
        @id, @sequence, @actionType, @filesBefore, @filesAfter,
        @description, @planId, @phaseId
      )
    `);

    stmt.run({
      id: entry.id,
      sequence: entry.sequence,
      actionType: entry.actionType,
      filesBefore: JSON.stringify(entry.filesBefore),
      filesAfter: JSON.stringify(entry.filesAfter),
      description: entry.description,
      planId: entry.planId || null,
      phaseId: entry.phaseId || null
    });
  }

  /**
   * Get undo stack (newest first)
   */
  getUndoStack(limit = 10): UndoEntry[] {
    const db = this.ensureDb();
    
    const stmt = db.prepare(`
      SELECT * FROM undo_stack 
      ORDER BY sequence DESC 
      LIMIT ?
    `);
    
    const rows = stmt.all(limit) as Record<string, unknown>[];
    return rows.map(row => ({
      id: row.id as string,
      sequence: row.sequence as number,
      actionType: row.action_type as string,
      filesBefore: JSON.parse(row.files_before as string || '[]'),
      filesAfter: JSON.parse(row.files_after as string || '[]'),
      description: row.description as string,
      createdAt: new Date(row.created_at as string),
      planId: row.plan_id as string | undefined,
      phaseId: row.phase_id as string | undefined
    }));
  }

  /**
   * Pop from undo stack
   */
  popUndo(): UndoEntry | null {
    const db = this.ensureDb();
    
    const entry = this.getUndoStack(1)[0];
    if (!entry) return null;

    const stmt = db.prepare('DELETE FROM undo_stack WHERE id = ?');
    stmt.run(entry.id);
    
    return entry;
  }

  /**
   * Get next sequence number for undo stack
   */
  getNextUndoSequence(): number {
    const db = this.ensureDb();
    
    const stmt = db.prepare('SELECT MAX(sequence) as max_seq FROM undo_stack');
    const row = stmt.get() as { max_seq: number | null };
    
    return (row.max_seq ?? 0) + 1;
  }

  /**
   * Trim undo stack to max levels
   */
  trimUndoStack(maxLevels: number): number {
    const db = this.ensureDb();
    
    const countStmt = db.prepare('SELECT COUNT(*) as count FROM undo_stack');
    const { count } = countStmt.get() as { count: number };
    
    if (count <= maxLevels) return 0;
    
    const toDelete = count - maxLevels;
    const deleteStmt = db.prepare(`
      DELETE FROM undo_stack 
      WHERE id IN (
        SELECT id FROM undo_stack 
        ORDER BY sequence ASC 
        LIMIT ?
      )
    `);
    
    deleteStmt.run(toDelete);
    return toDelete;
  }

  // =====================
  // Checkpoint Methods
  // =====================

  /**
   * Create checkpoint
   */
  createCheckpoint(checkpoint: {
    id: string;
    type: 'git_stash' | 'file_backup';
    files: FileSnapshot[];
    planId?: string;
    phaseId?: string;
    description?: string;
  }): void {
    const db = this.ensureDb();
    
    const stmt = db.prepare(`
      INSERT INTO checkpoints (id, timestamp, type, files, plan_id, phase_id, description)
      VALUES (@id, @timestamp, @type, @files, @planId, @phaseId, @description)
    `);

    stmt.run({
      id: checkpoint.id,
      timestamp: new Date().toISOString(),
      type: checkpoint.type,
      files: JSON.stringify(checkpoint.files),
      planId: checkpoint.planId || null,
      phaseId: checkpoint.phaseId || null,
      description: checkpoint.description || null
    });
  }

  /**
   * Get checkpoint by ID
   */
  getCheckpoint(id: string): {
    id: string;
    timestamp: Date;
    type: string;
    files: FileSnapshot[];
    planId?: string;
    phaseId?: string;
    description?: string;
  } | null {
    const db = this.ensureDb();
    
    const stmt = db.prepare('SELECT * FROM checkpoints WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    
    if (!row) return null;
    
    return {
      id: row.id as string,
      timestamp: new Date(row.timestamp as string),
      type: row.type as string,
      files: JSON.parse(row.files as string || '[]'),
      planId: row.plan_id as string | undefined,
      phaseId: row.phase_id as string | undefined,
      description: row.description as string | undefined
    };
  }

  // =====================
  // Usage Log Methods
  // =====================

  /**
   * Log API usage
   */
  logUsage(usage: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    agent?: string;
    taskType?: string;
  }): void {
    const db = this.ensureDb();
    
    const stmt = db.prepare(`
      INSERT INTO usage_logs (id, model, input_tokens, output_tokens, cost, agent, task_type)
      VALUES (@id, @model, @inputTokens, @outputTokens, @cost, @agent, @taskType)
    `);

    stmt.run({
      id: generateId(),
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cost: usage.cost,
      agent: usage.agent || null,
      taskType: usage.taskType || null
    });
  }

  /**
   * Get usage stats for date range
   */
  getUsageStats(startDate: Date, endDate: Date): {
    totalCost: number;
    totalTokens: number;
    byModel: Record<string, { cost: number; tokens: number }>;
    byAgent: Record<string, { cost: number; tokens: number }>;
  } {
    const db = this.ensureDb();
    
    const stmt = db.prepare(`
      SELECT * FROM usage_logs 
      WHERE created_at BETWEEN ? AND ?
    `);
    
    const rows = stmt.all(
      startDate.toISOString(),
      endDate.toISOString()
    ) as Record<string, unknown>[];

    const stats = {
      totalCost: 0,
      totalTokens: 0,
      byModel: {} as Record<string, { cost: number; tokens: number }>,
      byAgent: {} as Record<string, { cost: number; tokens: number }>
    };

    for (const row of rows) {
      const cost = row.cost as number;
      const tokens = (row.input_tokens as number) + (row.output_tokens as number);
      const model = row.model as string;
      const agent = row.agent as string | null;

      stats.totalCost += cost;
      stats.totalTokens += tokens;

      if (!stats.byModel[model]) {
        stats.byModel[model] = { cost: 0, tokens: 0 };
      }
      stats.byModel[model].cost += cost;
      stats.byModel[model].tokens += tokens;

      if (agent) {
        if (!stats.byAgent[agent]) {
          stats.byAgent[agent] = { cost: 0, tokens: 0 };
        }
        stats.byAgent[agent].cost += cost;
        stats.byAgent[agent].tokens += tokens;
      }
    }

    return stats;
  }

  // =====================
  // Utility Methods
  // =====================

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
    }
  }

  /**
   * Vacuum database
   */
  vacuum(): void {
    const db = this.ensureDb();
    db.exec('VACUUM');
  }

  /**
   * Get database file size
   */
  getSize(): number {
    if (!fs.existsSync(this.dbPath)) return 0;
    return fs.statSync(this.dbPath).size;
  }

  // =====================
  // Alias Methods (for memory-manager compatibility)
  // =====================

  /**
   * Insert memory (alias for insertMemoryEntry)
   */
  insertMemory(entry: MemoryEntry): void {
    this.insertMemoryEntry(entry);
  }

  /**
   * Get memory (alias for getMemoryEntry)
   */
  getMemory(id: string): MemoryEntry | null {
    return this.getMemoryEntry(id);
  }

  /**
   * Update memory access (alias for touchMemoryEntry)
   */
  updateMemoryAccess(id: string): void {
    this.touchMemoryEntry(id);
  }

  /**
   * Update memory (alias for updateMemoryEntry)
   */
  updateMemory(entry: MemoryEntry): void {
    this.updateMemoryEntry(entry.id, entry);
  }

  /**
   * Delete memory (alias for deleteMemoryEntry)
   */
  deleteMemory(id: string): boolean {
    this.deleteMemoryEntry(id);
    return true;
  }

  /**
   * Search memories with options
   */
  searchMemories(options: {
    categories?: MemoryCategory[];
    query?: string;
    pinnedOnly?: boolean;
    tier?: string;
  }): MemoryEntry[] {
    return this.getMemoryEntries({
      categories: options.categories,
      pinned: options.pinnedOnly,
      tier: options.tier
    });
  }

  /**
   * Get memory statistics
   */
  getMemoryStats(): import('../types').MemoryStats {
    const db = this.ensureDb();

    const totalStmt = db.prepare('SELECT COUNT(*) as count FROM memory_entries');
    const { count: totalEntries } = totalStmt.get() as { count: number };

    const pinnedStmt = db.prepare('SELECT COUNT(*) as count FROM memory_entries WHERE pinned = 1');
    const { count: pinnedCount } = pinnedStmt.get() as { count: number };

    const pendingStmt = db.prepare('SELECT COUNT(*) as count FROM memory_entries WHERE status = ?');
    const { count: pendingCount } = pendingStmt.get('pending') as { count: number };

    const categoryStmt = db.prepare('SELECT category, COUNT(*) as count FROM memory_entries GROUP BY category');
    const categoryRows = categoryStmt.all() as Array<{ category: string; count: number }>;
    const byCategory: Record<string, number> = {};
    for (const row of categoryRows) {
      byCategory[row.category] = row.count;
    }

    const tierStmt = db.prepare('SELECT tier, COUNT(*) as count FROM memory_entries GROUP BY tier');
    const tierRows = tierStmt.all() as Array<{ tier: string; count: number }>;
    const byTier: Record<string, number> = {};
    for (const row of tierRows) {
      byTier[row.tier] = row.count;
    }

    return {
      totalEntries,
      byCategory,
      byTier,
      pinnedCount,
      pendingCount,
      lastUpdated: new Date()
    };
  }
}

// Export singleton instance
export const sqliteClient = new SqliteClient();
