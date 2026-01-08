/**
 * Stage 3: Integrity Check Validators
 * type-integrity, import-export, test-preservation
 */

import { BaseValidator, ValidatorContext, extractImports } from './base-validator';
import type { ValidationIssue } from '../types';

/**
 * Type Integrity Validator
 * Ensures TypeScript types are valid
 */
export class TypeIntegrityValidator extends BaseValidator {
  readonly name = 'type-integrity' as const;
  readonly stage = 'integrity' as const;

  protected async validate(context: ValidatorContext): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    for (const change of context.changes) {
      const ext = change.path.split('.').pop()?.toLowerCase();
      
      if (!['ts', 'tsx'].includes(ext ?? '')) {
        continue;
      }

      issues.push(...this.checkTypeAnnotations(change.content, change.path));
      issues.push(...this.checkGenericUsage(change.content, change.path));
      issues.push(...this.checkNullChecks(change.content, change.path));
    }

    return issues;
  }

  private checkTypeAnnotations(content: string, filePath: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      
      // Check for implicit any in function parameters
      const funcMatch = /(?:function\s+\w+|(?:const|let)\s+\w+\s*=\s*(?:async\s+)?)\(([^)]+)\)/.exec(line);
      if (funcMatch) {
        const params = funcMatch[1];
        if (params && !/:\s*\w/.test(params) && params.trim() !== '') {
          issues.push(this.createIssue(
            filePath,
            `Function parameters lack type annotations`,
            'warning',
            { line: i + 1, code: 'TYPE_IMPLICIT_ANY' }
          ));
        }
      }

      // Check for non-null assertions that might be risky
      if (/\w+!\./.test(line) || /\w+!\[/.test(line)) {
        issues.push(this.createIssue(
          filePath,
          `Non-null assertion (!) used - ensure value cannot be null`,
          'info',
          { line: i + 1, code: 'TYPE_NON_NULL_ASSERTION' }
        ));
      }

      // Check for type assertions that might hide errors
      if (/as\s+any\b/.test(line)) {
        issues.push(this.createIssue(
          filePath,
          `Type assertion to 'any' bypasses type checking`,
          'warning',
          { line: i + 1, code: 'TYPE_AS_ANY' }
        ));
      }
    }

    return issues;
  }

  private checkGenericUsage(content: string, filePath: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      
      // Check for raw Promise without type parameter
      if (/:\s*Promise\s*[^<]/.test(line) || /new\s+Promise\s*\(/.test(line)) {
        if (!/Promise</.test(line)) {
          issues.push(this.createIssue(
            filePath,
            `Promise should have type parameter: Promise<T>`,
            'warning',
            { line: i + 1, code: 'TYPE_RAW_PROMISE' }
          ));
        }
      }

      // Check for raw Array without type
      if (/:\s*Array\s*[^<]/.test(line)) {
        issues.push(this.createIssue(
          filePath,
          `Array should have type parameter: Array<T> or T[]`,
          'warning',
          { line: i + 1, code: 'TYPE_RAW_ARRAY' }
        ));
      }
    }

    return issues;
  }

  private checkNullChecks(content: string, filePath: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      
      // Check for == null or != null (should use === or !==)
      if (/[^!=]=\s*null\b/.test(line) && !/===\s*null/.test(line)) {
        issues.push(this.createIssue(
          filePath,
          `Use === null instead of == null`,
          'warning',
          { line: i + 1, code: 'TYPE_LOOSE_NULL_CHECK' }
        ));
      }

      // Check for loose equality with undefined
      if (/[^!=]=\s*undefined\b/.test(line) && !/===\s*undefined/.test(line)) {
        issues.push(this.createIssue(
          filePath,
          `Use === undefined instead of == undefined`,
          'warning',
          { line: i + 1, code: 'TYPE_LOOSE_UNDEFINED_CHECK' }
        ));
      }
    }

    return issues;
  }
}

/**
 * Import/Export Validator
 * Checks for broken dependencies
 */
export class ImportExportValidator extends BaseValidator {
  readonly name = 'import-export' as const;
  readonly stage = 'integrity' as const;

  protected async validate(context: ValidatorContext): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    const allFiles = new Set<string>([
      ...context.changes.map(c => c.path),
      ...context.existingFiles.keys()
    ]);

    // Build export map
    const exports = new Map<string, Set<string>>();
    
    for (const change of context.changes) {
      const fileExports = this.extractExports(change.content);
      exports.set(change.path, fileExports);
    }

    // Check imports
    for (const change of context.changes) {
      const imports = extractImports(change.content);
      
      for (const imp of imports) {
        // Skip node_modules and built-in modules
        if (!imp.module.startsWith('.') && !imp.module.startsWith('/')) {
          continue;
        }

        // Resolve relative import
        const resolvedPath = this.resolveImport(change.path, imp.module);
        
        // Check if file exists
        if (!allFiles.has(resolvedPath) && 
            !allFiles.has(resolvedPath + '.ts') && 
            !allFiles.has(resolvedPath + '.tsx') &&
            !allFiles.has(resolvedPath + '/index.ts')) {
          issues.push(this.createIssue(
            change.path,
            `Import '${imp.module}' - file not found`,
            'error',
            { line: imp.line, code: 'IMPORT_FILE_NOT_FOUND' }
          ));
        }
      }

      // Check for circular dependencies
      const circularDeps = this.detectCircularDependencies(change.path, context.changes);
      if (circularDeps.length > 0) {
        issues.push(this.createIssue(
          change.path,
          `Circular dependency detected: ${circularDeps.join(' -> ')}`,
          'warning',
          { code: 'IMPORT_CIRCULAR' }
        ));
      }
    }

    return issues;
  }

  private extractExports(content: string): Set<string> {
    const exports = new Set<string>();
    
    // Named exports
    const namedExportRegex = /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g;
    let match;
    while ((match = namedExportRegex.exec(content)) !== null) {
      if (match[1]) exports.add(match[1]);
    }

    // Export statements
    const exportStatementRegex = /export\s*{\s*([^}]+)\s*}/g;
    while ((match = exportStatementRegex.exec(content)) !== null) {
      const names = match[1]?.split(',').map(n => n.trim().split(/\s+as\s+/)[0]?.trim());
      names?.forEach(n => n && exports.add(n));
    }

    // Default export
    if (/export\s+default\b/.test(content)) {
      exports.add('default');
    }

    return exports;
  }

  private resolveImport(fromPath: string, importPath: string): string {
    if (!importPath.startsWith('.')) {
      return importPath;
    }

    const fromDir = fromPath.split('/').slice(0, -1).join('/');
    const parts = importPath.split('/');
    const resultParts = fromDir.split('/').filter(Boolean);

    for (const part of parts) {
      if (part === '.') continue;
      if (part === '..') {
        resultParts.pop();
      } else {
        resultParts.push(part);
      }
    }

    return resultParts.join('/');
  }

  private detectCircularDependencies(
    startFile: string,
    changes: Array<{ path: string; content: string }>
  ): string[] {
    const fileImports = new Map<string, string[]>();
    
    for (const change of changes) {
      const imports = extractImports(change.content)
        .filter(i => i.module.startsWith('.'))
        .map(i => this.resolveImport(change.path, i.module));
      fileImports.set(change.path, imports);
    }

    const visited = new Set<string>();
    const path: string[] = [];

    const dfs = (file: string): string[] | null => {
      if (path.includes(file)) {
        return [...path.slice(path.indexOf(file)), file];
      }
      if (visited.has(file)) return null;

      visited.add(file);
      path.push(file);

      const imports = fileImports.get(file) ?? [];
      for (const imp of imports) {
        const cycle = dfs(imp);
        if (cycle) return cycle;
      }

      path.pop();
      return null;
    };

    return dfs(startFile) ?? [];
  }
}

/**
 * Test Preservation Validator
 * Ensures existing tests still pass
 */
export class TestPreservationValidator extends BaseValidator {
  readonly name = 'test-preservation' as const;
  readonly stage = 'integrity' as const;

  protected async validate(context: ValidatorContext): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    // Check if any test files were modified
    const modifiedTestFiles = context.changes.filter(c => 
      c.path.includes('.test.') || 
      c.path.includes('.spec.') ||
      c.path.includes('__tests__')
    );

    // Check if source files have corresponding tests
    const sourceFiles = context.changes.filter(c =>
      !c.path.includes('.test.') && 
      !c.path.includes('.spec.') &&
      !c.path.includes('__tests__') &&
      (c.path.endsWith('.ts') || c.path.endsWith('.tsx') || c.path.endsWith('.js') || c.path.endsWith('.jsx'))
    );

    for (const source of sourceFiles) {
      const baseName = source.path.replace(/\.(ts|tsx|js|jsx)$/, '');
      const hasTest = [...context.existingFiles.keys()].some(f =>
        f.includes(`${baseName}.test.`) ||
        f.includes(`${baseName}.spec.`) ||
        f.includes(`__tests__/${baseName.split('/').pop()}`)
      );

      // Only warn if the file likely needs tests (has exports, functions)
      if (!hasTest && this.likelyNeedsTests(source.content)) {
        issues.push(this.createIssue(
          source.path,
          `Modified file has no corresponding test file`,
          'info',
          { code: 'TEST_NO_TEST_FILE' }
        ));
      }
    }

    // Check for test-related issues in modified test files
    for (const testFile of modifiedTestFiles) {
      issues.push(...this.checkTestQuality(testFile.content, testFile.path));
    }

    return issues;
  }

  private likelyNeedsTests(content: string): boolean {
    // Has exported functions or classes
    return /export\s+(async\s+)?function/.test(content) ||
           /export\s+class/.test(content) ||
           /export\s+const\s+\w+\s*=\s*(?:async\s+)?\(/.test(content);
  }

  private checkTestQuality(content: string, filePath: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const lines = content.split('\n');

    // Check for skipped tests
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      
      if (/\b(it|test|describe)\.skip\s*\(/.test(line)) {
        issues.push(this.createIssue(
          filePath,
          `Skipped test found - ensure this is intentional`,
          'warning',
          { line: i + 1, code: 'TEST_SKIPPED' }
        ));
      }

      if (/\b(it|test|describe)\.only\s*\(/.test(line)) {
        issues.push(this.createIssue(
          filePath,
          `.only() will skip other tests - remove before committing`,
          'error',
          { line: i + 1, code: 'TEST_ONLY' }
        ));
      }

      // Check for empty test bodies
      if (/\b(it|test)\s*\([^)]+,\s*(?:async\s*)?\(\s*\)\s*=>\s*{\s*}\s*\)/.test(line)) {
        issues.push(this.createIssue(
          filePath,
          `Empty test body`,
          'warning',
          { line: i + 1, code: 'TEST_EMPTY' }
        ));
      }
    }

    // Check for assertions
    if (!/expect\s*\(|assert\.|should\./.test(content)) {
      issues.push(this.createIssue(
        filePath,
        `Test file contains no assertions`,
        'warning',
        { code: 'TEST_NO_ASSERTIONS' }
      ));
    }

    return issues;
  }
}
