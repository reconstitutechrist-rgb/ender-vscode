/**
 * Backup manager for Ender
 * Handles file backups, git stash, and rollback operations
 */

import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  readFile,
  writeFile,
  fileExists,
  hashContent,
} from '../utils/file-utils';
import { logger, generateId } from '../utils';
import type { FileSnapshot, RollbackCheckpoint } from '../types';

const execAsync = promisify(exec);

export interface BackupConfig {
  backupDir: string;
  useGitStash: boolean;
  maxBackups: number;
  compressBackups: boolean;
}

export class BackupManager {
  private config: BackupConfig;
  private workspacePath: string;

  constructor(config: Partial<BackupConfig> & { workspacePath: string }) {
    this.workspacePath = config.workspacePath;
    this.config = {
      backupDir: path.join(config.workspacePath, '.ender', 'backups'),
      useGitStash: true,
      maxBackups: 50,
      compressBackups: false,
      ...config,
    };
  }

  /**
   * Initialize backup manager
   */
  async initialize(): Promise<void> {
    // Ensure backup directory exists
    if (!fs.existsSync(this.config.backupDir)) {
      fs.mkdirSync(this.config.backupDir, { recursive: true });
    }

    // Check if git is available
    if (this.config.useGitStash) {
      const hasGit = await this.isGitRepo();
      if (!hasGit) {
        logger.warn(
          'Git not available, falling back to file backups',
          'Backup',
        );
        this.config.useGitStash = false;
      }
    }

    logger.info('Backup manager initialized', 'Backup');
  }

  /**
   * Check if workspace is a git repo
   */
  private async isGitRepo(): Promise<boolean> {
    try {
      await execAsync('git rev-parse --git-dir', { cwd: this.workspacePath });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a checkpoint before changes
   */
  async createCheckpoint(
    files: string[],
    options?: {
      planId?: string;
      phaseId?: string;
      description?: string;
    },
  ): Promise<RollbackCheckpoint> {
    const id = generateId();
    const timestamp = new Date();

    logger.info(
      `Creating checkpoint ${id} for ${files.length} files`,
      'Backup',
    );

    // Try git stash first
    if (this.config.useGitStash) {
      try {
        const stashResult = await this.createGitStash(
          files,
          options?.description,
        );
        if (stashResult) {
          const checkpoint: RollbackCheckpoint = {
            id,
            timestamp,
            type: 'git_stash',
            files: await Promise.all(files.map((f) => this.createFileEntry(f))),
          };
          if (options?.planId) {
            checkpoint.planId = options.planId;
          }
          if (options?.phaseId) {
            checkpoint.phaseId = options.phaseId;
          }

          // Save checkpoint metadata
          await this.saveCheckpointMetadata(checkpoint);

          return checkpoint;
        }
      } catch (error) {
        logger.warn('Git stash failed, falling back to file backup', 'Backup', {
          error,
        });
      }
    }

    // Fall back to file backup
    const fileBackups = await Promise.all(files.map((f) => this.backupFile(f)));

    const checkpoint: RollbackCheckpoint = {
      id,
      timestamp,
      type: 'file_backup',
      files: fileBackups.filter(
        (
          f,
        ): f is FileSnapshot & {
          path: string;
          originalContent: string;
          hash: string;
        } => f !== null,
      ) as Array<{
        path: string;
        originalContent: string;
        hash: string;
      }>,
    };
    if (options?.planId) {
      checkpoint.planId = options.planId;
    }
    if (options?.phaseId) {
      checkpoint.phaseId = options.phaseId;
    }

    // Save checkpoint metadata
    await this.saveCheckpointMetadata(checkpoint);

    // Clean up old backups
    await this.cleanupOldBackups();

    return checkpoint;
  }

  /**
   * Create git stash
   */
  private async createGitStash(
    files: string[],
    message?: string,
  ): Promise<boolean> {
    try {
      // Stage specified files
      const relativeFiles = files.map((f) =>
        path.relative(this.workspacePath, f),
      );

      for (const file of relativeFiles) {
        try {
          await execAsync(`git add "${file}"`, { cwd: this.workspacePath });
        } catch {
          // File might not exist yet, that's ok
        }
      }

      // Create stash with message
      const stashMessage =
        message || `Ender checkpoint ${new Date().toISOString()}`;
      await execAsync(`git stash push -m "${stashMessage}"`, {
        cwd: this.workspacePath,
      });

      return true;
    } catch (error) {
      logger.debug('Git stash creation failed', 'Backup', { error });
      return false;
    }
  }

  /**
   * Create file entry for checkpoint
   */
  private async createFileEntry(filePath: string): Promise<{
    path: string;
    originalContent: string;
    hash: string;
  }> {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.workspacePath, filePath);

    try {
      const content = await readFile(absolutePath);
      return {
        path: filePath,
        originalContent: content,
        hash: hashContent(content),
      };
    } catch {
      return {
        path: filePath,
        originalContent: '',
        hash: hashContent(''),
      };
    }
  }

  /**
   * Backup single file
   */
  private async backupFile(filePath: string): Promise<FileSnapshot | null> {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.workspacePath, filePath);

    try {
      const exists = await fileExists(absolutePath);
      if (!exists) {
        return {
          path: filePath,
          content: '',
          hash: hashContent(''),
          exists: false,
        };
      }

      const content = await readFile(absolutePath);
      const hash = hashContent(content);

      // Save backup file
      const backupPath = path.join(
        this.config.backupDir,
        `${hash.slice(0, 8)}_${path.basename(filePath)}`,
      );

      await writeFile(backupPath, content);

      return {
        path: filePath,
        content,
        hash,
        exists: true,
      };
    } catch (error) {
      logger.error(`Failed to backup file: ${filePath}`, 'Backup', { error });
      return null;
    }
  }

  /**
   * Rollback to checkpoint
   */
  async rollback(checkpoint: RollbackCheckpoint): Promise<{
    success: boolean;
    restoredFiles: string[];
    errors: string[];
  }> {
    logger.info(`Rolling back to checkpoint ${checkpoint.id}`, 'Backup');

    const restoredFiles: string[] = [];
    const errors: string[] = [];

    if (checkpoint.type === 'git_stash') {
      try {
        // Pop the stash
        await execAsync('git stash pop', { cwd: this.workspacePath });
        restoredFiles.push(...checkpoint.files.map((f) => f.path));
      } catch (error) {
        errors.push(`Git stash pop failed: ${error}`);

        // Fall back to file restoration
        for (const file of checkpoint.files) {
          try {
            await this.restoreFile(file);
            restoredFiles.push(file.path);
          } catch (e) {
            errors.push(`Failed to restore ${file.path}: ${e}`);
          }
        }
      }
    } else {
      // File backup restoration
      for (const file of checkpoint.files) {
        try {
          await this.restoreFile(file);
          restoredFiles.push(file.path);
        } catch (error) {
          errors.push(`Failed to restore ${file.path}: ${error}`);
        }
      }
    }

    return {
      success: errors.length === 0,
      restoredFiles,
      errors,
    };
  }

  /**
   * Restore single file
   */
  private async restoreFile(file: {
    path: string;
    originalContent: string;
  }): Promise<void> {
    const absolutePath = path.isAbsolute(file.path)
      ? file.path
      : path.join(this.workspacePath, file.path);

    if (file.originalContent === '') {
      // File didn't exist, delete it
      if (await fileExists(absolutePath)) {
        fs.unlinkSync(absolutePath);
      }
    } else {
      await writeFile(absolutePath, file.originalContent);
    }
  }

  /**
   * Save checkpoint metadata
   */
  private async saveCheckpointMetadata(
    checkpoint: RollbackCheckpoint,
  ): Promise<void> {
    const metadataPath = path.join(
      this.config.backupDir,
      `checkpoint_${checkpoint.id}.json`,
    );

    // Don't save full file contents in metadata (they're in separate backup files)
    const metadata = {
      id: checkpoint.id,
      timestamp: checkpoint.timestamp.toISOString(),
      type: checkpoint.type,
      files: checkpoint.files.map((f) => ({
        path: f.path,
        hash: f.hash,
      })),
      planId: checkpoint.planId,
      phaseId: checkpoint.phaseId,
    };

    await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  }

  /**
   * List available checkpoints
   */
  async listCheckpoints(): Promise<
    Array<{
      id: string;
      timestamp: Date;
      type: string;
      fileCount: number;
      planId?: string;
    }>
  > {
    const checkpoints: Array<{
      id: string;
      timestamp: Date;
      type: string;
      fileCount: number;
      planId?: string;
    }> = [];

    const files = fs.readdirSync(this.config.backupDir);

    for (const file of files) {
      if (file.startsWith('checkpoint_') && file.endsWith('.json')) {
        try {
          const content = await readFile(
            path.join(this.config.backupDir, file),
          );
          const metadata = JSON.parse(content);
          checkpoints.push({
            id: metadata.id,
            timestamp: new Date(metadata.timestamp),
            type: metadata.type,
            fileCount: metadata.files?.length || 0,
            planId: metadata.planId,
          });
        } catch {
          // Invalid checkpoint file, skip
        }
      }
    }

    // Sort by timestamp descending
    checkpoints.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return checkpoints;
  }

  /**
   * Get checkpoint by ID
   */
  async getCheckpoint(id: string): Promise<RollbackCheckpoint | null> {
    const metadataPath = path.join(
      this.config.backupDir,
      `checkpoint_${id}.json`,
    );

    try {
      const content = await readFile(metadataPath);
      const metadata = JSON.parse(content);

      // Reconstruct full checkpoint with file contents
      const files = await Promise.all(
        (metadata.files as Array<{ path: string; hash: string }>).map(
          async (f) => {
            const backupPath = path.join(
              this.config.backupDir,
              `${f.hash.slice(0, 8)}_${path.basename(f.path)}`,
            );

            let originalContent = '';
            try {
              originalContent = await readFile(backupPath);
            } catch {
              // Backup file not found, might be git stash
            }

            return {
              path: f.path,
              originalContent,
              hash: f.hash,
            };
          },
        ),
      );

      return {
        id: metadata.id,
        timestamp: new Date(metadata.timestamp),
        type: metadata.type,
        files,
        planId: metadata.planId,
        phaseId: metadata.phaseId,
      };
    } catch {
      return null;
    }
  }

  /**
   * Delete checkpoint
   */
  async deleteCheckpoint(id: string): Promise<boolean> {
    try {
      const checkpoint = await this.getCheckpoint(id);
      if (!checkpoint) return false;

      // Delete backup files
      for (const file of checkpoint.files) {
        const backupPath = path.join(
          this.config.backupDir,
          `${file.hash.slice(0, 8)}_${path.basename(file.path)}`,
        );
        try {
          fs.unlinkSync(backupPath);
        } catch {
          // File might not exist
        }
      }

      // Delete metadata
      const metadataPath = path.join(
        this.config.backupDir,
        `checkpoint_${id}.json`,
      );
      fs.unlinkSync(metadataPath);

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clean up old backups
   */
  private async cleanupOldBackups(): Promise<void> {
    const checkpoints = await this.listCheckpoints();

    if (checkpoints.length <= this.config.maxBackups) return;

    // Delete oldest checkpoints
    const toDelete = checkpoints.slice(this.config.maxBackups);

    for (const checkpoint of toDelete) {
      await this.deleteCheckpoint(checkpoint.id);
    }

    logger.debug(`Cleaned up ${toDelete.length} old backups`, 'Backup');
  }

  /**
   * Get backup storage size
   */
  getStorageSize(): number {
    let totalSize = 0;

    const files = fs.readdirSync(this.config.backupDir);
    for (const file of files) {
      const filePath = path.join(this.config.backupDir, file);
      const stats = fs.statSync(filePath);
      totalSize += stats.size;
    }

    return totalSize;
  }
}
