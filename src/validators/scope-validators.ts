/**
 * Stage 1: Scope Validation Validators
 * scope-guard, hallucination-detector, change-size-monitor
 */

import { BaseValidator, ValidatorContext } from './base-validator';
import type {
  ValidationIssue,
  ScopeGuardResult,
  HallucinationDetectorResult,
  ChangeSizeMonitorResult,
} from '../types';

/**
 * Scope Guard Validator
 * Ensures only approved files/functions are modified
 */
export class ScopeGuardValidator extends BaseValidator {
  readonly name = 'scope-guard' as const;
  readonly stage = 'scope' as const;

  private violations: ScopeGuardResult['violations'] = [];

  async run(context: ValidatorContext): Promise<ScopeGuardResult> {
    this.violations = [];
    const baseResult = await super.run(context);
    return {
      ...baseResult,
      violations: this.violations,
    };
  }

  protected async validate(
    context: ValidatorContext,
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    // Get allowed files from plan (if available)
    const allowedFiles = (this.options.allowedFiles as string[]) ?? [];
    const allowedFunctions =
      (this.options.allowedFunctions as Record<string, string[]>) ?? {};

    for (const change of context.changes) {
      // Check if file is in allowed list
      if (allowedFiles.length > 0 && !allowedFiles.includes(change.path)) {
        issues.push(
          this.createIssue(
            change.path,
            `File not in approved plan scope`,
            'error',
            { code: 'SCOPE_FILE_NOT_ALLOWED' },
          ),
        );
        this.violations.push({
          file: change.path,
          reason: 'file_not_in_plan',
          details: `File ${change.path} is not in the approved plan scope`,
        });
        continue;
      }

      // For updates, check if functions are allowed
      if (change.operation === 'update' && allowedFunctions[change.path]) {
        // Parse changed functions from diff
        const changedFunctions = this.extractChangedFunctions(
          change.diff ?? '',
        );
        const allowed = allowedFunctions[change.path] ?? [];

        for (const fn of changedFunctions) {
          if (!allowed.includes(fn) && allowed.length > 0) {
            issues.push(
              this.createIssue(
                change.path,
                `Function '${fn}' not in approved scope`,
                'error',
                { code: 'SCOPE_FUNCTION_NOT_ALLOWED' },
              ),
            );
            this.violations.push({
              file: change.path,
              reason: 'function_not_in_plan',
              details: `Function '${fn}' in ${change.path} is not in the approved scope`,
            });
          }
        }
      }

      // Check for unexpected new files
      if (change.operation === 'create' && allowedFiles.length > 0) {
        if (
          !allowedFiles.some(
            (f) =>
              f === change.path || change.path.startsWith(f.replace('*', '')),
          )
        ) {
          issues.push(
            this.createIssue(
              change.path,
              `New file creation not in approved scope`,
              'warning',
              { code: 'SCOPE_UNEXPECTED_FILE' },
            ),
          );
          this.violations.push({
            file: change.path,
            reason: 'unexpected_addition',
            details: `New file ${change.path} was not expected in the plan scope`,
          });
        }
      }
    }

    return issues;
  }

  private extractChangedFunctions(diff: string): string[] {
    const functions: string[] = [];
    const functionRegex =
      /^[+-]\s*(?:async\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=|(\w+)\s*\()/gm;

    let match;
    while ((match = functionRegex.exec(diff)) !== null) {
      const fnName = match[1] ?? match[2] ?? match[3];
      if (fnName && !functions.includes(fnName)) {
        functions.push(fnName);
      }
    }

    return functions;
  }
}

/**
 * Hallucination Detector Validator
 * Ensures all code changes are justified by the plan
 */
export class HallucinationDetectorValidator extends BaseValidator {
  readonly name = 'hallucination-detector' as const;
  readonly stage = 'scope' as const;

  private unattributedCode: HallucinationDetectorResult['unattributedCode'] =
    [];

  async run(context: ValidatorContext): Promise<HallucinationDetectorResult> {
    this.unattributedCode = [];
    const baseResult = await super.run(context);
    return {
      ...baseResult,
      unattributedCode: this.unattributedCode,
    };
  }

  protected async validate(
    context: ValidatorContext,
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    const planDescription = (this.options.planDescription as string) ?? '';
    const planTasks = (this.options.planTasks as string[]) ?? [];

    for (const change of context.changes) {
      const contentLines = change.content.split('\n').length;

      // Check if change has explanation
      if (!change.explanation) {
        issues.push(
          this.createIssue(
            change.path,
            `Change lacks explanation/justification`,
            'warning',
            { code: 'HALLUCINATION_NO_EXPLANATION' },
          ),
        );
        this.unattributedCode.push({
          file: change.path,
          lineRange: [1, contentLines],
          code: change.content.substring(0, 200),
          reason: 'no_plan_reference',
        });
        continue;
      }

      // Check if explanation relates to plan
      if (planDescription || planTasks.length > 0) {
        const isRelated = this.checkRelevance(
          change.explanation,
          planDescription,
          planTasks,
        );
        if (!isRelated) {
          issues.push(
            this.createIssue(
              change.path,
              `Change explanation doesn't match plan scope: "${change.explanation}"`,
              'warning',
              { code: 'HALLUCINATION_UNRELATED_CHANGE' },
            ),
          );
          this.unattributedCode.push({
            file: change.path,
            lineRange: [1, contentLines],
            code: change.content.substring(0, 200),
            reason: 'exceeds_plan_scope',
          });
        }
      }

      // Check for unexpected functionality additions
      const unexpectedPatterns = [
        /TODO:\s*implement/i,
        /placeholder/i,
        /not\s+implemented/i,
        /will\s+be\s+added/i,
      ];

      for (const pattern of unexpectedPatterns) {
        if (pattern.test(change.content)) {
          issues.push(
            this.createIssue(
              change.path,
              `Contains incomplete/placeholder code`,
              'warning',
              { code: 'HALLUCINATION_INCOMPLETE' },
            ),
          );
          this.unattributedCode.push({
            file: change.path,
            lineRange: [1, contentLines],
            code: change.content.substring(0, 200),
            reason: 'unspecified_functionality',
          });
          break;
        }
      }
    }

    return issues;
  }

  private checkRelevance(
    explanation: string,
    planDesc: string,
    tasks: string[],
  ): boolean {
    const explLower = explanation.toLowerCase();

    // Check against plan description
    if (planDesc) {
      const planWords = planDesc
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3);
      const matchingWords = planWords.filter((w) => explLower.includes(w));
      if (matchingWords.length >= 2) return true;
    }

    // Check against tasks
    for (const task of tasks) {
      const taskWords = task
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3);
      const matchingWords = taskWords.filter((w) => explLower.includes(w));
      if (matchingWords.length >= 2) return true;
    }

    return false;
  }
}

/**
 * Change Size Monitor Validator
 * Ensures changes don't exceed expected scope
 */
export class ChangeSizeMonitorValidator extends BaseValidator {
  readonly name = 'change-size-monitor' as const;
  readonly stage = 'scope' as const;

  private sizeMetrics = {
    actualLines: 0,
    actualFiles: 0,
    expectedLines: 0,
    expectedFiles: 0,
    percentageOver: 0,
    alert: 'none' as 'none' | 'warning' | 'critical',
  };

  async run(context: ValidatorContext): Promise<ChangeSizeMonitorResult> {
    this.sizeMetrics = {
      actualLines: 0,
      actualFiles: 0,
      expectedLines: 0,
      expectedFiles: 0,
      percentageOver: 0,
      alert: 'none',
    };
    const baseResult = await super.run(context);
    return {
      ...baseResult,
      actualLines: this.sizeMetrics.actualLines,
      actualFiles: this.sizeMetrics.actualFiles,
      expectedLines: this.sizeMetrics.expectedLines,
      expectedFiles: this.sizeMetrics.expectedFiles,
      percentageOver: this.sizeMetrics.percentageOver,
      alert: this.sizeMetrics.alert,
    };
  }

  protected async validate(
    context: ValidatorContext,
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    const expectedLines = (this.options.expectedLines as number) ?? 0;
    const expectedFiles = (this.options.expectedFiles as number) ?? 0;
    const warningThreshold = (this.options.warningThreshold as number) ?? 0.5;
    const errorThreshold = (this.options.errorThreshold as number) ?? 1.0;

    // Calculate actual changes
    let actualLines = 0;
    const actualFiles = context.changes.length;

    for (const change of context.changes) {
      const lines = change.content.split('\n').length;
      actualLines += lines;
    }

    // Store metrics for typed result
    this.sizeMetrics.actualLines = actualLines;
    this.sizeMetrics.actualFiles = actualFiles;
    this.sizeMetrics.expectedLines = expectedLines;
    this.sizeMetrics.expectedFiles = expectedFiles;

    // Check file count
    if (expectedFiles > 0) {
      const fileRatio = (actualFiles - expectedFiles) / expectedFiles;
      const percentOver = Math.round(fileRatio * 100);

      if (fileRatio > errorThreshold) {
        issues.push(
          this.createIssue(
            '',
            `File count (${actualFiles}) exceeds expected (${expectedFiles}) by ${percentOver}%`,
            'error',
            { code: 'SIZE_FILES_EXCEEDED' },
          ),
        );
        this.sizeMetrics.percentageOver = Math.max(
          this.sizeMetrics.percentageOver,
          percentOver,
        );
        this.sizeMetrics.alert = 'critical';
      } else if (fileRatio > warningThreshold) {
        issues.push(
          this.createIssue(
            '',
            `File count (${actualFiles}) exceeds expected (${expectedFiles}) by ${percentOver}%`,
            'warning',
            { code: 'SIZE_FILES_WARNING' },
          ),
        );
        this.sizeMetrics.percentageOver = Math.max(
          this.sizeMetrics.percentageOver,
          percentOver,
        );
        if (this.sizeMetrics.alert !== 'critical') {
          this.sizeMetrics.alert = 'warning';
        }
      }
    }

    // Check line count
    if (expectedLines > 0) {
      const lineRatio = (actualLines - expectedLines) / expectedLines;
      const percentOver = Math.round(lineRatio * 100);

      if (lineRatio > errorThreshold) {
        issues.push(
          this.createIssue(
            '',
            `Line count (${actualLines}) exceeds expected (${expectedLines}) by ${percentOver}%`,
            'error',
            { code: 'SIZE_LINES_EXCEEDED' },
          ),
        );
        this.sizeMetrics.percentageOver = Math.max(
          this.sizeMetrics.percentageOver,
          percentOver,
        );
        this.sizeMetrics.alert = 'critical';
      } else if (lineRatio > warningThreshold) {
        issues.push(
          this.createIssue(
            '',
            `Line count (${actualLines}) exceeds expected (${expectedLines}) by ${percentOver}%`,
            'warning',
            { code: 'SIZE_LINES_WARNING' },
          ),
        );
        this.sizeMetrics.percentageOver = Math.max(
          this.sizeMetrics.percentageOver,
          percentOver,
        );
        if (this.sizeMetrics.alert !== 'critical') {
          this.sizeMetrics.alert = 'warning';
        }
      }
    }

    return issues;
  }
}
