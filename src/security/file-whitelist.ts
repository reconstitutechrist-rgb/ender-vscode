/**
 * File Whitelist Security Module
 * Controls access to files based on allowlist policies
 */

import * as path from 'path';
import { logger } from '../utils';

export class FileWhitelist {
  private allowedPaths: Set<string> = new Set();
  private allowedPatterns: RegExp[] = [];
  private workspaceRoot: string = '';

  constructor(workspaceRoot?: string) {
    if (workspaceRoot) {
      this.setWorkspaceRoot(workspaceRoot);
    }
  }

  /**
   * Set workspace root
   */
  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = path.resolve(root);
    // Always allow workspace root
    this.allowPath(this.workspaceRoot);
  }

  /**
   * Add path to allowlist
   */
  allowPath(allowedPath: string): void {
    this.allowedPaths.add(path.resolve(allowedPath));
  }

  /**
   * Add pattern to allowlist
   */
  allowPattern(pattern: RegExp): void {
    this.allowedPatterns.push(pattern);
  }

  /**
   * Check if file access is allowed
   */
  validateRead(filePath: string): boolean {
    return this.isPathAllowed(filePath);
  }

  /**
   * Check if file write is allowed
   */
  validateWrite(filePath: string): boolean {
    return this.isPathAllowed(filePath);
  }

  /**
   * Check if path is allowed
   */
  private isPathAllowed(filePath: string): boolean {
    const resolvedPath = path.resolve(filePath);

    // Check strict paths (and subpaths)
    for (const allowed of this.allowedPaths) {
      if (resolvedPath.startsWith(allowed)) {
        return true;
      }
    }

    // Check patterns
    for (const pattern of this.allowedPatterns) {
      if (pattern.test(filePath)) {
        return true;
      }
    }

    // Default deny if outside workspace
    if (this.workspaceRoot && !resolvedPath.startsWith(this.workspaceRoot)) {
      logger.warn(
        `Access denied to external file: ${filePath}`,
        'FileWhitelist',
      );
      return false;
    }

    return true;
  }
}

export const fileWhitelist = new FileWhitelist();
