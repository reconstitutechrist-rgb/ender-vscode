/**
 * Plan Lock Enforcement
 * Ensures approved plans are immutable and file access is restricted
 */

import { logger } from '../utils';
import type { Plan, PlanLock, FileContent } from '../types';

export class PlanLockManager {
  private activeLock: PlanLock | null = null;

  /**
   * Create a lock for an approved plan
   */
  createLock(plan: Plan, files?: FileContent[], userId: 'user' | 'conductor' = 'user'): void {
    const allowedFunctions = this.buildAllowedFunctions(plan, files ?? []);

    this.activeLock = {
      planId: plan.id,
      lockedAt: new Date(),
      lockedBy: userId,
      allowedFiles: [...plan.affectedFiles],
      allowedFunctions,
      checksum: this.calculatePlanChecksum(plan)
    };

    logger.info(`Plan locked: ${plan.id}, ${allowedFunctions.size} files with function restrictions`, 'PlanLock');
  }

  /**
   * Build the allowed functions map from plan and files
   */
  private buildAllowedFunctions(plan: Plan, files: FileContent[]): Map<string, string[]> {
    const allowedFunctions = new Map<string, string[]>();

    // Extract from plan tasks that have targetFile and targetFunction
    for (const phase of plan.phases) {
      for (const task of phase.tasks) {
        if (task.targetFile && task.targetFunction) {
          const existing = allowedFunctions.get(task.targetFile) ?? [];
          if (!existing.includes(task.targetFunction)) {
            existing.push(task.targetFunction);
          }
          allowedFunctions.set(task.targetFile, existing);
        }
      }
    }

    // For files in affectedFiles without specific functions,
    // extract all function names from file content
    for (const filePath of plan.affectedFiles) {
      // Skip if already has specific functions defined
      if (allowedFunctions.has(filePath)) continue;

      // Find file content
      const file = files.find(f =>
        f.path === filePath ||
        f.path.endsWith(filePath) ||
        filePath.endsWith(f.path)
      );

      if (file) {
        const functions = this.extractFunctionNames(file.content);
        if (functions.length > 0) {
          allowedFunctions.set(filePath, functions);
        }
      }
    }

    return allowedFunctions;
  }

  /**
   * Extract function names from file content
   */
  private extractFunctionNames(content: string): string[] {
    const functions: string[] = [];

    // Match various function declaration patterns
    const patterns = [
      // Regular function declarations: function name() or export function name()
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g,
      // Arrow functions assigned to const/let/var: const name = () or const name = async ()
      /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/g,
      // Arrow functions with implicit params: const name = async param =>
      /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\w+\s*=>/g,
      // Class methods: name() { or async name() { or public name() {
      /^\s*(?:public|private|protected|static|async|\s)*(\w+)\s*\([^)]*\)\s*(?::\s*\w+(?:<[^>]+>)?)?\s*\{/gm,
    ];

    const keywords = new Set([
      'if', 'else', 'for', 'while', 'switch', 'case', 'return', 'new', 'class',
      'constructor', 'get', 'set', 'try', 'catch', 'finally', 'throw', 'import', 'export'
    ]);

    for (const regex of patterns) {
      let match;
      while ((match = regex.exec(content)) !== null) {
        const name = match[1];
        if (name && !functions.includes(name) && !keywords.has(name)) {
          functions.push(name);
        }
      }
    }

    return functions;
  }

  /**
   * Release the current lock
   */
  releaseLock(): void {
    if (this.activeLock) {
      logger.info(`Plan lock released: ${this.activeLock.planId}`, 'PlanLock');
      this.activeLock = null;
    }
  }

  /**
   * Check if a file is allowed to be modified
   */
  isAllowed(filePath: string): boolean {
    if (!this.activeLock) return true;

    // Normalize path separators
    const normalizedPath = filePath.replace(/\\/g, '/');

    // Check exact match
    if (this.activeLock.allowedFiles.includes(filePath)) return true;
    if (this.activeLock.allowedFiles.includes(normalizedPath)) return true;

    // Check partial match (file at end of path)
    return this.activeLock.allowedFiles.some(allowed =>
      normalizedPath.endsWith(allowed) || allowed.endsWith(normalizedPath)
    );
  }

  /**
   * Check if a specific function change is allowed
   */
  isAllowedChange(filePath: string, functionName?: string): boolean {
    if (!this.activeLock) return true;

    // First check if file is allowed
    if (!this.isAllowed(filePath)) return false;

    // If no function specified, only check file
    if (!functionName) return true;

    // Check function-level restriction
    const normalizedPath = filePath.replace(/\\/g, '/');

    for (const [path, funcs] of this.activeLock.allowedFunctions) {
      if (normalizedPath.endsWith(path) || path.endsWith(normalizedPath) ||
          normalizedPath === path) {
        // If no specific functions listed, all functions in file are allowed
        if (funcs.length === 0) return true;
        // Otherwise, check if function is in the allowed list
        return funcs.includes(functionName);
      }
    }

    // If file is in allowedFiles but not in allowedFunctions, allow all functions
    return true;
  }

  /**
   * Get allowed functions for a file
   */
  getAllowedFunctions(filePath: string): string[] | null {
    if (!this.activeLock) return null;

    const normalizedPath = filePath.replace(/\\/g, '/');

    for (const [path, funcs] of this.activeLock.allowedFunctions) {
      if (normalizedPath.endsWith(path) || path.endsWith(normalizedPath)) {
        return [...funcs];
      }
    }

    return null;
  }

  /**
   * Get current lock
   */
  getLock(): PlanLock | null {
    return this.activeLock;
  }

  /**
   * Verify plan integrity hasn't changed
   */
  verifyIntegrity(plan: Plan): boolean {
    if (!this.activeLock) return false;
    return this.calculatePlanChecksum(plan) === this.activeLock.checksum;
  }

  /**
   * Calculate checksum to verify plan integrity
   */
  private calculatePlanChecksum(plan: Plan): string {
    const content = JSON.stringify({
      id: plan.id,
      phases: plan.phases.map(p => ({
        title: p.title,
        tasks: p.tasks.map(t => ({
          description: t.description,
          targetFile: t.targetFile,
          targetFunction: t.targetFunction
        }))
      })),
      affectedFiles: plan.affectedFiles
    });

    // Simple hash
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }
}

export const planLockManager = new PlanLockManager();
