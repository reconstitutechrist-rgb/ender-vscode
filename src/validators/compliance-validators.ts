/**
 * Stage 4: Plan Compliance Validators
 * plan-compliance, breaking-change, snapshot-diff, rollback-checkpoint
 */

import { BaseValidator, ValidatorContext } from './base-validator';
import { generateId, hashContent } from '../utils';
import type { ValidationIssue, RollbackCheckpoint, FileChange } from '../types';

/**
 * Plan Compliance Validator
 * Ensures implementation matches approved plan
 */
export class PlanComplianceValidator extends BaseValidator {
  readonly name = 'plan-compliance' as const;
  readonly stage = 'compliance' as const;

  protected async validate(context: ValidatorContext): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    
    const planTasks = this.options.planTasks as Array<{
      id: string;
      description: string;
      targetFile?: string;
      expectedChanges?: string;
    }> ?? [];

    if (planTasks.length === 0) {
      // No plan to validate against
      return issues;
    }

    // Check each plan task
    for (const task of planTasks) {
      const isAddressed = this.checkTaskAddressed(task, context.changes);
      
      if (!isAddressed) {
        issues.push(this.createIssue(
          task.targetFile ?? '',
          `Plan task not addressed: "${task.description}"`,
          'warning',
          { code: 'PLAN_TASK_MISSING' }
        ));
      }
    }

    // Check for changes not in plan
    for (const change of context.changes) {
      const inPlan = planTasks.some(t => 
        t.targetFile === change.path ||
        (change.explanation && t.description.toLowerCase().includes(change.explanation.toLowerCase().substring(0, 20)))
      );

      if (!inPlan && planTasks.length > 0) {
        issues.push(this.createIssue(
          change.path,
          `Change not explicitly in plan - verify it's necessary`,
          'info',
          { code: 'PLAN_EXTRA_CHANGE' }
        ));
      }
    }

    return issues;
  }

  private checkTaskAddressed(
    task: { description: string; targetFile?: string; expectedChanges?: string },
    changes: FileChange[]
  ): boolean {
    // Check if target file was changed
    if (task.targetFile) {
      const fileChanged = changes.some(c => c.path === task.targetFile);
      if (!fileChanged) return false;
    }

    // Check if expected changes are present
    if (task.expectedChanges) {
      const keywords = task.expectedChanges.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const changeContent = changes.map(c => c.content.toLowerCase()).join('\n');
      const matchingKeywords = keywords.filter(k => changeContent.includes(k));
      
      // At least half of keywords should be present
      return matchingKeywords.length >= keywords.length / 2;
    }

    return true;
  }
}

/**
 * Breaking Change Validator
 * Detects breaking changes in APIs and interfaces
 */
export class BreakingChangeValidator extends BaseValidator {
  readonly name = 'breaking-change' as const;
  readonly stage = 'compliance' as const;

  protected async validate(context: ValidatorContext): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    for (const change of context.changes) {
      if (change.operation !== 'update') continue;

      const originalContent = context.existingFiles.get(change.path);
      if (!originalContent) continue;

      // Check for breaking changes
      issues.push(...this.checkRemovedExports(originalContent, change.content, change.path));
      issues.push(...this.checkChangedSignatures(originalContent, change.content, change.path));
      issues.push(...this.checkRemovedProperties(originalContent, change.content, change.path));
    }

    return issues;
  }

  private checkRemovedExports(original: string, updated: string, filePath: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    
    const originalExports = this.extractExportedNames(original);
    const updatedExports = this.extractExportedNames(updated);

    for (const exp of originalExports) {
      if (!updatedExports.has(exp)) {
        issues.push(this.createIssue(
          filePath,
          `Export '${exp}' was removed - this may break consumers`,
          'error',
          { code: 'BREAKING_REMOVED_EXPORT' }
        ));
      }
    }

    return issues;
  }

  private checkChangedSignatures(original: string, updated: string, filePath: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    const originalFunctions = this.extractFunctionSignatures(original);
    const updatedFunctions = this.extractFunctionSignatures(updated);

    for (const [name, origSig] of originalFunctions) {
      const newSig = updatedFunctions.get(name);
      if (newSig && origSig !== newSig) {
        // Check if parameters were removed or reordered
        const origParams = origSig.match(/\(([^)]*)\)/)?.[1] ?? '';
        const newParams = newSig.match(/\(([^)]*)\)/)?.[1] ?? '';

        if (this.hasBreakingParamChange(origParams, newParams)) {
          issues.push(this.createIssue(
            filePath,
            `Function '${name}' signature changed - may break callers`,
            'warning',
            { code: 'BREAKING_SIGNATURE_CHANGE' }
          ));
        }
      }
    }

    return issues;
  }

  private checkRemovedProperties(original: string, updated: string, filePath: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    const originalInterfaces = this.extractInterfaceProperties(original);
    const updatedInterfaces = this.extractInterfaceProperties(updated);

    for (const [name, props] of originalInterfaces) {
      const newProps = updatedInterfaces.get(name);
      if (newProps) {
        for (const prop of props) {
          // Check if required property was removed
          if (!prop.includes('?') && !newProps.some(p => p.startsWith(prop.split(':')[0] ?? ''))) {
            issues.push(this.createIssue(
              filePath,
              `Required property removed from '${name}' interface`,
              'error',
              { code: 'BREAKING_REMOVED_PROPERTY' }
            ));
          }
        }
      }
    }

    return issues;
  }

  private extractExportedNames(content: string): Set<string> {
    const names = new Set<string>();
    const regex = /export\s+(?:const|let|var|function|class|interface|type|enum|default)\s+(\w+)?/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      if (match[1]) names.add(match[1]);
    }
    return names;
  }

  private extractFunctionSignatures(content: string): Map<string, string> {
    const signatures = new Map<string, string>();
    const regex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(\([^)]*\))/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      if (match[1] && match[2]) {
        signatures.set(match[1], match[2]);
      }
    }
    return signatures;
  }

  private extractInterfaceProperties(content: string): Map<string, string[]> {
    const interfaces = new Map<string, string[]>();
    const regex = /interface\s+(\w+)\s*{([^}]+)}/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1];
      const body = match[2];
      if (name && body) {
        const props = body.split('\n')
          .map(l => l.trim())
          .filter(l => l && !l.startsWith('//'));
        interfaces.set(name, props);
      }
    }
    return interfaces;
  }

  private hasBreakingParamChange(original: string, updated: string): boolean {
    const origParams = original.split(',').map(p => p.trim().split(':')[0]?.trim()).filter(Boolean);
    const newParams = updated.split(',').map(p => p.trim().split(':')[0]?.trim()).filter(Boolean);

    // Check if any required params were removed
    for (let i = 0; i < origParams.length; i++) {
      const param = origParams[i];
      if (param && !param.includes('?') && !newParams.includes(param)) {
        return true;
      }
    }

    return false;
  }
}

/**
 * Snapshot Diff Validator
 * Compares actual changes against expected changes
 */
export class SnapshotDiffValidator extends BaseValidator {
  readonly name = 'snapshot-diff' as const;
  readonly stage = 'compliance' as const;

  protected async validate(context: ValidatorContext): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    
    const expectedChanges = this.options.expectedChanges as FileChange[] ?? [];
    
    if (expectedChanges.length === 0) {
      return issues;
    }

    const actualPaths = new Set(context.changes.map(c => c.path));
    const expectedPaths = new Set(expectedChanges.map(c => c.path));

    // Check for unexpected changes
    for (const change of context.changes) {
      if (!expectedPaths.has(change.path)) {
        issues.push(this.createIssue(
          change.path,
          `Unexpected file change not in plan`,
          'warning',
          { code: 'SNAPSHOT_UNEXPECTED' }
        ));
      }
    }

    // Check for missing expected changes
    for (const expected of expectedChanges) {
      if (!actualPaths.has(expected.path)) {
        issues.push(this.createIssue(
          expected.path,
          `Expected change not made`,
          'warning',
          { code: 'SNAPSHOT_MISSING' }
        ));
      }
    }

    // Compare content for matching files
    for (const actual of context.changes) {
      const expected = expectedChanges.find(e => e.path === actual.path);
      if (expected && expected.content !== actual.content) {
        // Content differs - this might be okay if it's better
        const actualLines = actual.content.split('\n').length;
        const expectedLines = expected.content.split('\n').length;
        
        if (Math.abs(actualLines - expectedLines) > expectedLines * 0.5) {
          issues.push(this.createIssue(
            actual.path,
            `Content significantly differs from expected (${actualLines} vs ${expectedLines} lines)`,
            'info',
            { code: 'SNAPSHOT_CONTENT_DIFF' }
          ));
        }
      }
    }

    return issues;
  }
}

/**
 * Rollback Checkpoint Validator
 * Creates restore points before applying changes
 */
export class RollbackCheckpointValidator extends BaseValidator {
  readonly name = 'rollback-checkpoint' as const;
  readonly stage = 'compliance' as const;

  private checkpoint: RollbackCheckpoint | null = null;

  protected async validate(context: ValidatorContext): Promise<ValidationIssue[]> {
    // This validator doesn't produce issues - it creates checkpoints
    await this.createCheckpoint(context);
    return [];
  }

  private async createCheckpoint(context: ValidatorContext): Promise<void> {
    const files: RollbackCheckpoint['files'] = [];

    for (const change of context.changes) {
      if (change.operation === 'update' || change.operation === 'delete') {
        const originalContent = context.existingFiles.get(change.path) ?? '';
        files.push({
          path: change.path,
          originalContent,
          hash: hashContent(originalContent)
        });
      }
    }

    this.checkpoint = {
      id: generateId(),
      timestamp: new Date(),
      type: 'file_backup',
      files,
      planId: context.planId,
      phaseId: this.options.phaseId as string
    };
  }

  getCheckpoint(): RollbackCheckpoint | null {
    return this.checkpoint;
  }

  clearCheckpoint(): void {
    this.checkpoint = null;
  }
}
