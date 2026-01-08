/**
 * Stage 1: Scope Validation Validators
 * scope-guard, hallucination-detector, change-size-monitor
 */

import { BaseValidator, ValidatorContext } from './base-validator';
import type { ValidationIssue, ScopeGuardResult, HallucinationDetectorResult, ChangeSizeMonitorResult } from '../types';

/**
 * Scope Guard Validator
 * Ensures only approved files/functions are modified
 */
export class ScopeGuardValidator extends BaseValidator {
  readonly name = 'scope-guard' as const;
  readonly stage = 'scope' as const;

  protected async validate(context: ValidatorContext): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    
    // Get allowed files from plan (if available)
    const allowedFiles = this.options.allowedFiles as string[] ?? [];
    const allowedFunctions = this.options.allowedFunctions as Record<string, string[]> ?? {};

    for (const change of context.changes) {
      // Check if file is in allowed list
      if (allowedFiles.length > 0 && !allowedFiles.includes(change.path)) {
        issues.push(this.createIssue(
          change.path,
          `File not in approved plan scope`,
          'error',
          { code: 'SCOPE_FILE_NOT_ALLOWED' }
        ));
        continue;
      }

      // For updates, check if functions are allowed
      if (change.operation === 'update' && allowedFunctions[change.path]) {
        // Parse changed functions from diff
        const changedFunctions = this.extractChangedFunctions(change.diff ?? '');
        const allowed = allowedFunctions[change.path] ?? [];

        for (const fn of changedFunctions) {
          if (!allowed.includes(fn) && allowed.length > 0) {
            issues.push(this.createIssue(
              change.path,
              `Function '${fn}' not in approved scope`,
              'error',
              { code: 'SCOPE_FUNCTION_NOT_ALLOWED' }
            ));
          }
        }
      }

      // Check for unexpected new files
      if (change.operation === 'create' && allowedFiles.length > 0) {
        if (!allowedFiles.some(f => f === change.path || change.path.startsWith(f.replace('*', '')))) {
          issues.push(this.createIssue(
            change.path,
            `New file creation not in approved scope`,
            'warning',
            { code: 'SCOPE_UNEXPECTED_FILE' }
          ));
        }
      }
    }

    return issues;
  }

  private extractChangedFunctions(diff: string): string[] {
    const functions: string[] = [];
    const functionRegex = /^[+-]\s*(?:async\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=|(\w+)\s*\()/gm;
    
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

  protected async validate(context: ValidatorContext): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    
    const planDescription = this.options.planDescription as string ?? '';
    const planTasks = this.options.planTasks as string[] ?? [];

    for (const change of context.changes) {
      // Check if change has explanation
      if (!change.explanation) {
        issues.push(this.createIssue(
          change.path,
          `Change lacks explanation/justification`,
          'warning',
          { code: 'HALLUCINATION_NO_EXPLANATION' }
        ));
        continue;
      }

      // Check if explanation relates to plan
      if (planDescription || planTasks.length > 0) {
        const isRelated = this.checkRelevance(change.explanation, planDescription, planTasks);
        if (!isRelated) {
          issues.push(this.createIssue(
            change.path,
            `Change explanation doesn't match plan scope: "${change.explanation}"`,
            'warning',
            { code: 'HALLUCINATION_UNRELATED_CHANGE' }
          ));
        }
      }

      // Check for unexpected functionality additions
      const unexpectedPatterns = [
        /TODO:\s*implement/i,
        /placeholder/i,
        /not\s+implemented/i,
        /will\s+be\s+added/i
      ];

      for (const pattern of unexpectedPatterns) {
        if (pattern.test(change.content)) {
          issues.push(this.createIssue(
            change.path,
            `Contains incomplete/placeholder code`,
            'warning',
            { code: 'HALLUCINATION_INCOMPLETE' }
          ));
          break;
        }
      }
    }

    return issues;
  }

  private checkRelevance(explanation: string, planDesc: string, tasks: string[]): boolean {
    const explLower = explanation.toLowerCase();
    
    // Check against plan description
    if (planDesc) {
      const planWords = planDesc.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const matchingWords = planWords.filter(w => explLower.includes(w));
      if (matchingWords.length >= 2) return true;
    }

    // Check against tasks
    for (const task of tasks) {
      const taskWords = task.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const matchingWords = taskWords.filter(w => explLower.includes(w));
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

  protected async validate(context: ValidatorContext): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    
    const expectedLines = this.options.expectedLines as number ?? 0;
    const expectedFiles = this.options.expectedFiles as number ?? 0;
    const warningThreshold = this.options.warningThreshold as number ?? 0.5;
    const errorThreshold = this.options.errorThreshold as number ?? 1.0;

    // Calculate actual changes
    let actualLines = 0;
    const actualFiles = context.changes.length;

    for (const change of context.changes) {
      const lines = change.content.split('\n').length;
      actualLines += lines;
    }

    // Check file count
    if (expectedFiles > 0) {
      const fileRatio = (actualFiles - expectedFiles) / expectedFiles;
      
      if (fileRatio > errorThreshold) {
        issues.push(this.createIssue(
          '',
          `File count (${actualFiles}) exceeds expected (${expectedFiles}) by ${Math.round(fileRatio * 100)}%`,
          'error',
          { code: 'SIZE_FILES_EXCEEDED' }
        ));
      } else if (fileRatio > warningThreshold) {
        issues.push(this.createIssue(
          '',
          `File count (${actualFiles}) exceeds expected (${expectedFiles}) by ${Math.round(fileRatio * 100)}%`,
          'warning',
          { code: 'SIZE_FILES_WARNING' }
        ));
      }
    }

    // Check line count
    if (expectedLines > 0) {
      const lineRatio = (actualLines - expectedLines) / expectedLines;
      
      if (lineRatio > errorThreshold) {
        issues.push(this.createIssue(
          '',
          `Line count (${actualLines}) exceeds expected (${expectedLines}) by ${Math.round(lineRatio * 100)}%`,
          'error',
          { code: 'SIZE_LINES_EXCEEDED' }
        ));
      } else if (lineRatio > warningThreshold) {
        issues.push(this.createIssue(
          '',
          `Line count (${actualLines}) exceeds expected (${expectedLines}) by ${Math.round(lineRatio * 100)}%`,
          'warning',
          { code: 'SIZE_LINES_WARNING' }
        ));
      }
    }

    return issues;
  }
}
