/**
 * Undo stack manager for Ender
 * Manages multi-level undo operations
 */

import { writeFile, fileExists, createSnapshot } from '../utils/file-utils';
import { logger, generateId } from '../utils';
import { SqliteClient } from './sqlite-client';
import type { UndoEntry, FileSnapshot } from '../types';

export interface UndoConfig {
  maxLevels: number;
  persistToDisk: boolean;
}

export class UndoStack {
  private config: UndoConfig;
  private db: SqliteClient;
  private inMemoryStack: UndoEntry[] = [];

  constructor(db: SqliteClient, config?: Partial<UndoConfig>) {
    this.db = db;
    this.config = {
      maxLevels: 10,
      persistToDisk: true,
      ...config,
    };
  }

  /**
   * Push action to undo stack
   */
  async push(entry: {
    actionType: string;
    filesBefore: FileSnapshot[];
    filesAfter: FileSnapshot[];
    description: string;
    planId?: string;
    phaseId?: string;
  }): Promise<UndoEntry> {
    const sequence = this.db.getNextUndoSequence();

    const undoEntry: UndoEntry = {
      id: generateId(),
      sequence,
      actionType: entry.actionType,
      filesBefore: entry.filesBefore,
      filesAfter: entry.filesAfter,
      description: entry.description,
      createdAt: new Date(),
    };
    if (entry.planId) {
      undoEntry.planId = entry.planId;
    }
    if (entry.phaseId) {
      undoEntry.phaseId = entry.phaseId;
    }

    // Persist to database
    if (this.config.persistToDisk) {
      this.db.pushUndo(undoEntry);
      this.db.trimUndoStack(this.config.maxLevels);
    }

    // Also keep in memory for quick access
    this.inMemoryStack.push(undoEntry);
    if (this.inMemoryStack.length > this.config.maxLevels) {
      this.inMemoryStack.shift();
    }

    logger.debug(`Pushed to undo stack: ${entry.description}`, 'Undo', {
      sequence,
      actionType: entry.actionType,
      fileCount: entry.filesBefore.length,
    });

    return undoEntry;
  }

  /**
   * Pop and execute undo
   */
  async undo(): Promise<{
    success: boolean;
    entry?: UndoEntry;
    restoredFiles: string[];
    errors: string[];
  }> {
    // Get latest entry
    const entry = this.config.persistToDisk
      ? this.db.popUndo()
      : this.inMemoryStack.pop();

    if (!entry) {
      return {
        success: false,
        restoredFiles: [],
        errors: ['Nothing to undo'],
      };
    }

    logger.info(`Undoing: ${entry.description}`, 'Undo');

    const restoredFiles: string[] = [];
    const errors: string[] = [];

    // Restore files to their "before" state
    for (const file of entry.filesBefore) {
      try {
        if (!file.exists) {
          // File didn't exist before, check if we need to delete
          if (await fileExists(file.path)) {
            // For now, don't delete - just log
            logger.debug(`File ${file.path} was created, not deleting`, 'Undo');
          }
        } else {
          // Restore original content
          await writeFile(file.path, file.content);
          restoredFiles.push(file.path);
        }
      } catch (error) {
        errors.push(`Failed to restore ${file.path}: ${error}`);
      }
    }

    // Remove from in-memory stack if we used database
    if (this.config.persistToDisk) {
      const idx = this.inMemoryStack.findIndex((e) => e.id === entry.id);
      if (idx !== -1) {
        this.inMemoryStack.splice(idx, 1);
      }
    }

    return {
      success: errors.length === 0,
      entry,
      restoredFiles,
      errors,
    };
  }

  /**
   * Peek at the stack without popping
   */
  peek(count = 1): UndoEntry[] {
    if (this.config.persistToDisk) {
      return this.db.getUndoStack(count);
    }
    return this.inMemoryStack.slice(-count).reverse();
  }

  /**
   * Get full stack
   */
  getStack(): UndoEntry[] {
    if (this.config.persistToDisk) {
      return this.db.getUndoStack(this.config.maxLevels);
    }
    return [...this.inMemoryStack].reverse();
  }

  /**
   * Check if undo is available
   */
  canUndo(): boolean {
    if (this.config.persistToDisk) {
      const stack = this.db.getUndoStack(1);
      return stack.length > 0;
    }
    return this.inMemoryStack.length > 0;
  }

  /**
   * Get stack size
   */
  size(): number {
    if (this.config.persistToDisk) {
      return this.db.getUndoStack(this.config.maxLevels).length;
    }
    return this.inMemoryStack.length;
  }

  /**
   * Clear the undo stack
   */
  clear(): void {
    this.inMemoryStack = [];
    // Note: We don't clear the database here to preserve history
    logger.debug('Cleared in-memory undo stack', 'Undo');
  }

  /**
   * Create an undo entry from file changes
   */
  static async createEntry(
    actionType: string,
    description: string,
    filePaths: string[],
    options?: {
      planId?: string;
      phaseId?: string;
    },
  ): Promise<{
    filesBefore: FileSnapshot[];
    record: (filesAfter: FileSnapshot[]) => {
      actionType: string;
      filesBefore: FileSnapshot[];
      filesAfter: FileSnapshot[];
      description: string;
      planId?: string;
      phaseId?: string;
    };
  }> {
    // Capture current state
    const filesBefore = await Promise.all(
      filePaths.map((p) => createSnapshot(p)),
    );

    return {
      filesBefore,
      record: (filesAfter: FileSnapshot[]) => {
        const result: {
          actionType: string;
          filesBefore: FileSnapshot[];
          filesAfter: FileSnapshot[];
          description: string;
          planId?: string;
          phaseId?: string;
        } = {
          actionType,
          description,
          filesBefore,
          filesAfter,
        };
        if (options?.planId) {
          result.planId = options.planId;
        }
        if (options?.phaseId) {
          result.phaseId = options.phaseId;
        }
        return result;
      },
    };
  }

  /**
   * Group multiple undos by plan
   */
  getUndosByPlan(planId: string): UndoEntry[] {
    const stack = this.getStack();
    return stack.filter((entry) => entry.planId === planId);
  }

  /**
   * Undo all changes for a specific plan
   */
  async undoPlan(planId: string): Promise<{
    success: boolean;
    undoneCount: number;
    errors: string[];
  }> {
    const planEntries = this.getUndosByPlan(planId);

    if (planEntries.length === 0) {
      return {
        success: true,
        undoneCount: 0,
        errors: [],
      };
    }

    logger.info(
      `Undoing ${planEntries.length} entries for plan ${planId}`,
      'Undo',
    );

    const allErrors: string[] = [];
    let undoneCount = 0;

    // Undo in reverse order (most recent first)
    for (const _entry of planEntries) {
      const result = await this.undo();
      if (result.success) {
        undoneCount++;
      } else {
        allErrors.push(...result.errors);
      }
    }

    return {
      success: allErrors.length === 0,
      undoneCount,
      errors: allErrors,
    };
  }

  /**
   * Get summary of undo stack
   */
  getSummary(): {
    totalEntries: number;
    oldestEntry?: Date;
    newestEntry?: Date;
    byActionType: Record<string, number>;
    byPlan: Record<string, number>;
  } {
    const stack = this.getStack();

    const byActionType: Record<string, number> = {};
    const byPlan: Record<string, number> = {};

    for (const entry of stack) {
      byActionType[entry.actionType] =
        (byActionType[entry.actionType] || 0) + 1;

      if (entry.planId) {
        byPlan[entry.planId] = (byPlan[entry.planId] || 0) + 1;
      }
    }

    const result: {
      totalEntries: number;
      oldestEntry?: Date;
      newestEntry?: Date;
      byActionType: Record<string, number>;
      byPlan: Record<string, number>;
    } = {
      totalEntries: stack.length,
      byActionType,
      byPlan,
    };

    if (stack.length > 0) {
      const oldest = stack[stack.length - 1]?.createdAt;
      const newest = stack[0]?.createdAt;
      if (oldest) {
        result.oldestEntry = oldest;
      }
      if (newest) {
        result.newestEntry = newest;
      }
    }

    return result;
  }
}
