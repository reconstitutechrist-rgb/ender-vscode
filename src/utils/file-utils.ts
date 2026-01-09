/**
 * File utilities for Ender
 * File operations, hashing, and path manipulation
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { glob } from 'glob';
import ignore from 'ignore';
import type { FileContent, FileSnapshot } from '../types';

/**
 * Read file content from workspace
 */
export async function readFile(filePath: string): Promise<string> {
  const uri = vscode.Uri.file(filePath);
  const content = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(content).toString('utf-8');
}

/**
 * Write content to file
 */
export async function writeFile(
  filePath: string,
  content: string,
): Promise<void> {
  const uri = vscode.Uri.file(filePath);
  const dirUri = vscode.Uri.file(path.dirname(filePath));

  // Ensure directory exists
  try {
    await vscode.workspace.fs.stat(dirUri);
  } catch {
    await vscode.workspace.fs.createDirectory(dirUri);
  }

  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
}

/**
 * Delete file
 */
export async function deleteFile(filePath: string): Promise<void> {
  const uri = vscode.Uri.file(filePath);
  await vscode.workspace.fs.delete(uri);
}

/**
 * Check if file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const uri = vscode.Uri.file(filePath);
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get file hash (SHA-256)
 */
export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Create file snapshot
 */
export async function createSnapshot(filePath: string): Promise<FileSnapshot> {
  const exists = await fileExists(filePath);
  const content = exists ? await readFile(filePath) : '';

  return {
    path: filePath,
    content,
    hash: hashContent(content),
    exists,
  };
}

/**
 * Create snapshots for multiple files
 */
export async function createSnapshots(
  filePaths: string[],
): Promise<FileSnapshot[]> {
  return Promise.all(filePaths.map(createSnapshot));
}

/**
 * Get language from file extension
 */
export function getLanguageFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const languageMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescriptreact',
    '.js': 'javascript',
    '.jsx': 'javascriptreact',
    '.json': 'json',
    '.md': 'markdown',
    '.html': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.less': 'less',
    '.py': 'python',
    '.rb': 'ruby',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.c': 'c',
    '.cpp': 'cpp',
    '.h': 'c',
    '.hpp': 'cpp',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.xml': 'xml',
    '.sql': 'sql',
    '.sh': 'shellscript',
    '.bash': 'shellscript',
    '.zsh': 'shellscript',
    '.ps1': 'powershell',
    '.dockerfile': 'dockerfile',
    '.env': 'dotenv',
    '.gitignore': 'ignore',
  };

  // Check filename for special cases
  const filename = path.basename(filePath).toLowerCase();
  if (filename === 'dockerfile') return 'dockerfile';
  if (filename.startsWith('.env')) return 'dotenv';

  return languageMap[ext] || 'plaintext';
}

/**
 * Load file content with metadata
 */
export async function loadFileContent(filePath: string): Promise<FileContent> {
  const content = await readFile(filePath);
  const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));

  return {
    path: filePath,
    content,
    language: getLanguageFromPath(filePath),
    lastModified: new Date(stat.mtime),
  };
}

/**
 * Find files matching pattern with ignore support
 */
export async function findFiles(
  pattern: string,
  workspacePath: string,
  ignorePatterns: string[] = [],
): Promise<string[]> {
  const ig = ignore().add([
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    'coverage',
    '*.min.js',
    '*.bundle.js',
    ...ignorePatterns,
  ]);

  const files = await glob(pattern, {
    cwd: workspacePath,
    absolute: true,
    nodir: true,
  });

  return files.filter((file) => {
    const relativePath = path.relative(workspacePath, file);
    return !ig.ignores(relativePath);
  });
}

/**
 * Load .enderignore patterns
 */
export async function loadEnderIgnore(
  workspacePath: string,
): Promise<string[]> {
  const ignorePath = path.join(workspacePath, '.ender', '.enderignore');

  try {
    const content = await readFile(ignorePath);
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * Check if file matches sensitive patterns
 */
export function isSensitiveFile(filePath: string, patterns: string[]): boolean {
  const filename = path.basename(filePath).toLowerCase();
  const ig = ignore().add(patterns);
  return ig.ignores(filename) || ig.ignores(filePath);
}

/**
 * Get relative path from workspace
 */
export function getRelativePath(
  filePath: string,
  workspacePath: string,
): string {
  return path.relative(workspacePath, filePath);
}

/**
 * Ensure path is absolute
 */
export function toAbsolutePath(
  filePath: string,
  workspacePath: string,
): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.join(workspacePath, filePath);
}

/**
 * Get workspace folder path
 */
export function getWorkspacePath(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders?.[0]?.uri.fsPath;
}

/**
 * Count tokens (rough estimate)
 * Actual token counting should use the API
 */
export function estimateTokens(text: string): number {
  // Rough estimate: ~4 characters per token for English text
  // Code tends to be more token-dense
  return Math.ceil(text.length / 3.5);
}

/**
 * Truncate content to max tokens
 */
export function truncateToTokens(content: string, maxTokens: number): string {
  const estimatedChars = maxTokens * 3.5;
  if (content.length <= estimatedChars) {
    return content;
  }
  return content.slice(0, estimatedChars) + '\n... [truncated]';
}
