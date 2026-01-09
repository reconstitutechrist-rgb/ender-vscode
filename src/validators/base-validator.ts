/**
 * Base Validator for Ender
 * Abstract class that all validators extend
 */

import { logger } from '../utils';
import type {
  ValidatorName,
  ValidatorStage,
  ValidatorSeverity,
  ValidatorConfig,
  ValidationResult,
  ValidationIssue,
  FileChange,
} from '../types';

export interface ValidatorContext {
  changes: FileChange[];
  planId?: string;
  phaseId?: string;
  existingFiles: Map<string, string>;
  projectPath: string;
  config: Record<string, unknown>;
}

export abstract class BaseValidator {
  abstract readonly name: ValidatorName;
  abstract readonly stage: ValidatorStage;
  protected severity: ValidatorSeverity = 'error';
  protected enabled: boolean = true;
  protected options: Record<string, unknown> = {};

  /**
   * Run the validator
   */
  async run(context: ValidatorContext): Promise<ValidationResult> {
    if (!this.enabled) {
      return this.createResult(true, []);
    }

    const startTime = Date.now();

    try {
      logger.debug(`Running validator: ${this.name}`, 'Validator');
      const issues = await this.validate(context);
      const duration = Date.now() - startTime;

      const passed = !issues.some((i) => i.severity === 'error');

      logger.validator(this.name, passed ? 'pass' : 'fail', {
        issues: issues.length,
        duration,
      });

      return this.createResult(passed, issues, duration);
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Validator ${this.name} threw error`, 'Validator', error);

      return this.createResult(
        false,
        [
          {
            file: '',
            message: `Validator error: ${error instanceof Error ? error.message : String(error)}`,
            severity: 'error',
          },
        ],
        duration,
      );
    }
  }

  /**
   * Implement validation logic in subclasses
   */
  protected abstract validate(
    context: ValidatorContext,
  ): Promise<ValidationIssue[]>;

  /**
   * Create a validation result
   */
  protected createResult(
    passed: boolean,
    issues: ValidationIssue[],
    duration: number = 0,
  ): ValidationResult {
    return {
      validator: this.name,
      passed,
      severity: this.severity,
      issues,
      duration,
    };
  }

  /**
   * Create an issue
   */
  protected createIssue(
    file: string,
    message: string,
    severity: ValidatorSeverity = this.severity,
    options?: Partial<ValidationIssue>,
  ): ValidationIssue {
    return {
      file,
      message,
      severity,
      ...options,
    };
  }

  /**
   * Get validator config
   */
  getConfig(): ValidatorConfig {
    return {
      name: this.name,
      stage: this.stage,
      enabled: this.enabled,
      severity: this.severity,
      options: this.options,
    };
  }

  /**
   * Update validator options
   */
  configure(options: Partial<ValidatorConfig>): void {
    if (options.enabled !== undefined) this.enabled = options.enabled;
    if (options.severity) this.severity = options.severity;
    if (options.options) this.options = { ...this.options, ...options.options };
  }

  /**
   * Enable/disable validator
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if validator is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

/**
 * Helper to check if content contains pattern
 */
export function containsPattern(
  content: string,
  pattern: RegExp,
): Array<{ line: number; match: string }> {
  const results: Array<{ line: number; match: string }> = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line && pattern.test(line)) {
      const match = line.match(pattern);
      results.push({ line: i + 1, match: match?.[0] ?? line });
    }
  }

  return results;
}

/**
 * Helper to extract imports from code
 */
export function extractImports(
  content: string,
): Array<{ line: number; module: string; isDefault: boolean }> {
  const imports: Array<{ line: number; module: string; isDefault: boolean }> =
    [];
  const lines = content.split('\n');

  const importRegex =
    /import\s+(?:(\w+)|{[^}]+}|\*\s+as\s+\w+)\s+from\s+['"]([^'"]+)['"]/;
  const requireRegex =
    /(?:const|let|var)\s+(?:(\w+)|{[^}]+})\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    let match = line.match(importRegex);
    if (match) {
      imports.push({
        line: i + 1,
        module: match[2] ?? '',
        isDefault: !!match[1],
      });
      continue;
    }

    match = line.match(requireRegex);
    if (match) {
      imports.push({
        line: i + 1,
        module: match[2] ?? '',
        isDefault: !!match[1],
      });
    }
  }

  return imports;
}

/**
 * Helper to get function calls in code
 */
export function extractFunctionCalls(
  content: string,
): Array<{ line: number; call: string; object?: string }> {
  const calls: Array<{ line: number; call: string; object?: string }> = [];
  const lines = content.split('\n');

  // Match patterns like: object.method(), method(), await method()
  const callRegex = /(?:(\w+)\.)?(\w+)\s*\(/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    let match;
    while ((match = callRegex.exec(line)) !== null) {
      const callEntry: { line: number; call: string; object?: string } = {
        line: i + 1,
        call: match[2] ?? '',
      };
      if (match[1]) {
        callEntry.object = match[1];
      }
      calls.push(callEntry);
    }
  }

  return calls;
}
