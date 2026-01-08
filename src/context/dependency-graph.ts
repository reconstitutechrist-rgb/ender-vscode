/**
 * Dependency Graph
 * Analyzes file dependencies to improve context selection
 */

import { context7Client } from '../api/context7-client';

export interface DependencyNode {
  path: string;
  imports: string[];
  importedBy: string[];
}

export class DependencyGraph {
  private nodes: Map<string, DependencyNode> = new Map();

  /**
   * Build dependency graph from files
   */
  build(files: Map<string, string>): void {
    this.nodes.clear();

    // First pass: Create nodes and parse imports
    for (const [path, content] of files.entries()) {
      const imports = context7Client.parseImports(content);
      this.nodes.set(path, {
        path,
        imports,
        importedBy: []
      });
    }

    // Second pass: Link importedBy
    for (const [path, node] of this.nodes.entries()) {
      for (const importPath of node.imports) {
        // Resolve import path to file path (simplified)
        // In a real implementation, this would handle relative paths, extensions, aliases
        const resolvedPath = this.resolveImport(importPath, path);
        const importedNode = this.nodes.get(resolvedPath);
        
        if (importedNode) {
          importedNode.importedBy.push(path);
        }
      }
    }
  }

  /**
   * Get direct dependencies for a file
   */
  getDependencies(filePath: string): string[] {
    return this.nodes.get(filePath)?.imports || [];
  }

  /**
   * Get files that depend on a file
   */
  getDependents(filePath: string): string[] {
    return this.nodes.get(filePath)?.importedBy || [];
  }

  /**
   * Resolve import to file path (stub)
   */
  private resolveImport(importPath: string, fromPath: string): string {
    // Simplified resolution logic
    // Assumes relative imports match file structure
    // This is a placeholder for full module resolution
    return importPath; 
  }
}

export const dependencyGraph = new DependencyGraph();
