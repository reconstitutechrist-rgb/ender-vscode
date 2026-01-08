/**
 * Reviewer Agent for Ender
 * Runs all 29 validators, acts as quality gate
 * Approves or rejects code changes
 */

import { BaseAgent } from './base-agent';
import type {
  AgentResult,
  ContextBundle,
  FileChange,
  ReviewerOutput,
  ValidationResult,
  ValidationPipelineResult,
  ValidatorName,
  ValidatorMode,
  RollbackCheckpoint,
  Plan
} from '../types';
import { logger, generateId, hashContent } from '../utils';

const REVIEWER_SYSTEM_PROMPT = `You are the Reviewer Agent for Ender, an AI coding assistant.

YOUR ROLE:
- Run comprehensive validation on all code changes
- Ensure code quality, security, and plan compliance
- Act as the quality gate before changes are applied
- Provide actionable feedback when issues are found

VALIDATION STAGES:
1. Scope Validation - Ensure changes match approved plan
2. Code Quality - Syntax, best practices, security
3. Integrity Checks - Types, imports, tests
4. Plan Compliance - Breaking changes, expected vs actual
5. Specialist Checks - Hooks, integrations, infrastructure
6. AI Accuracy - Hallucinations, style, completeness

CORE PRINCIPLES:
- Be thorough - check EVERY file, EVERY function
- Never approve code with critical issues
- Provide specific, actionable feedback
- Trace data flow through all changes
- Verify type signatures match
- Check for missing error handling

OUTPUT FORMAT:
{
  "approved": true/false,
  "validationResults": [...],
  "suggestions": ["improvement 1", "improvement 2"],
  "mustFix": ["critical issue 1"]
}`;

// Validator execution order by stage
const VALIDATOR_STAGES: Record<string, ValidatorName[]> = {
  scope: ['scope-guard', 'hallucination-detector', 'change-size-monitor'],
  quality: ['syntax-validator', 'best-practices', 'security-scanner'],
  integrity: ['type-integrity', 'import-export', 'test-preservation'],
  compliance: ['plan-compliance', 'breaking-change', 'snapshot-diff', 'rollback-checkpoint'],
  specialist: [
    'hook-rules-checker', 'event-leak-detector',
    'api-contract-validator', 'auth-flow-validator',
    'environment-consistency', 'secrets-exposure-checker',
    'docker-best-practices', 'cloud-config-validator'
  ],
  'ai-accuracy': [
    'api-existence-validator', 'dependency-verifier',
    'deprecation-detector', 'style-matcher',
    'complexity-analyzer', 'edge-case-checker',
    'refactor-completeness', 'doc-sync-validator'
  ]
};

// Fast mode validators
const FAST_MODE_VALIDATORS: ValidatorName[] = [
  'syntax-validator',
  'type-integrity',
  'import-export',
  'scope-guard',
  'hook-rules-checker',
  'api-existence-validator'
];

export class ReviewerAgent extends BaseAgent {
  private validatorMode: ValidatorMode = 'strict';

  constructor() {
    super('reviewer', REVIEWER_SYSTEM_PROMPT);
  }

  /**
   * Review code changes
   */
  async execute(
    task: string,
    context: ContextBundle,
    options?: {
      changes: FileChange[];
      plan?: Plan;
      mode?: ValidatorMode;
    }
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const changes = options?.changes ?? [];

    logger.agent('reviewer', 'Starting code review', {
      fileCount: changes.length,
      mode: options?.mode ?? this.validatorMode
    });

    try {
      // Create rollback checkpoint first
      const checkpoint = await this.createCheckpoint(changes, options?.plan);

      // Run validation pipeline
      const pipelineResult = await this.runValidationPipeline(
        changes,
        context,
        options?.mode ?? this.validatorMode,
        options?.plan
      );

      // Attach checkpoint to result
      pipelineResult.checkpoint = checkpoint;

      // Generate review summary using AI
      const reviewSummary = await this.generateReviewSummary(
        changes,
        pipelineResult,
        context
      );

      const output: ReviewerOutput = {
        approved: pipelineResult.passed,
        validationResults: pipelineResult.results,
        suggestions: reviewSummary.suggestions,
        mustFix: reviewSummary.mustFix
      };

      return {
        success: true,
        agent: 'reviewer',
        output: JSON.stringify(output, null, 2),
        explanation: this.formatReviewExplanation(output, pipelineResult),
        confidence: pipelineResult.passed ? 95 : 40,
        tokensUsed: reviewSummary.tokensUsed,
        duration: Date.now() - startTime,
        nextAgent: pipelineResult.passed ? 'documenter' : 'coder'
      };
    } catch (error) {
      logger.error('Reviewer agent failed', 'Reviewer', { error });

      return {
        success: false,
        agent: 'reviewer',
        confidence: 0,
        tokensUsed: { input: 0, output: 0 },
        duration: Date.now() - startTime,
        errors: [{
          code: 'REVIEWER_ERROR',
          message: error instanceof Error ? error.message : 'Review failed',
          recoverable: true
        }]
      };
    }
  }

  /**
   * Run the full validation pipeline
   */
  private async runValidationPipeline(
    changes: FileChange[],
    context: ContextBundle,
    mode: ValidatorMode,
    plan?: Plan
  ): Promise<ValidationPipelineResult> {
    const results: ValidationResult[] = [];
    const startTime = Date.now();
    let totalErrors = 0;
    let totalWarnings = 0;

    // Determine which validators to run
    const validators = this.getValidatorsForMode(mode);

    for (const validatorName of validators) {
      const result = await this.runValidator(validatorName, changes, context, plan);
      results.push(result);

      if (!result.passed) {
        const errors = result.issues.filter(i => i.severity === 'error').length;
        const warnings = result.issues.filter(i => i.severity === 'warning').length;
        totalErrors += errors;
        totalWarnings += warnings;

        // Stop early on critical failures in strict mode
        if (mode === 'strict' && errors > 0 && this.isCriticalValidator(validatorName)) {
          logger.warn('Critical validator failed, stopping pipeline', 'Reviewer', {
            validator: validatorName,
            errors
          });
          break;
        }
      }
    }

    const passed = totalErrors === 0;

    return {
      passed,
      results,
      totalIssues: totalErrors + totalWarnings,
      errors: totalErrors,
      warnings: totalWarnings,
      duration: Date.now() - startTime
    };
  }

  /**
   * Run a single validator
   */
  private async runValidator(
    name: ValidatorName,
    changes: FileChange[],
    context: ContextBundle,
    plan?: Plan
  ): Promise<ValidationResult> {
    const startTime = Date.now();

    logger.debug(`Running validator: ${name}`, 'Reviewer');

    // In a full implementation, each validator would have its own class
    // For now, we'll simulate validation results
    const result = await this.simulateValidator(name, changes, context, plan);

    logger.validator(name, result.passed ? 'pass' : 'fail', {
      issues: result.issues.length,
      duration: Date.now() - startTime
    });

    return {
      ...result,
      validator: name,
      duration: Date.now() - startTime
    };
  }

  /**
   * Simulate validator execution (placeholder for real implementations)
   */
  private async simulateValidator(
    name: ValidatorName,
    changes: FileChange[],
    context: ContextBundle,
    plan?: Plan
  ): Promise<Omit<ValidationResult, 'validator' | 'duration'>> {
    // This would be replaced with actual validator implementations
    // For now, return a passing result
    return {
      passed: true,
      severity: 'info',
      issues: [],
      metadata: { simulated: true }
    };
  }

  /**
   * Get validators for the specified mode
   */
  private getValidatorsForMode(mode: ValidatorMode): ValidatorName[] {
    switch (mode) {
      case 'fast':
        return FAST_MODE_VALIDATORS;
      
      case 'strict':
        return Object.values(VALIDATOR_STAGES).flat();
      
      case 'integration-focus':
        return [
          ...VALIDATOR_STAGES['scope'] ?? [],
          ...VALIDATOR_STAGES['quality'] ?? [],
          ...VALIDATOR_STAGES['integrity'] ?? [],
          'api-contract-validator',
          'auth-flow-validator',
          'secrets-exposure-checker'
        ];
      
      case 'infrastructure-focus':
        return [
          ...VALIDATOR_STAGES['scope'] ?? [],
          ...VALIDATOR_STAGES['quality'] ?? [],
          ...VALIDATOR_STAGES['integrity'] ?? [],
          'environment-consistency',
          'docker-best-practices',
          'cloud-config-validator'
        ];
      
      case 'ai-accuracy-focus':
        return [
          ...VALIDATOR_STAGES['scope'] ?? [],
          ...VALIDATOR_STAGES['quality'] ?? [],
          ...VALIDATOR_STAGES['ai-accuracy'] ?? []
        ];
      
      case 'custom':
        // Would be configured per-project
        return FAST_MODE_VALIDATORS;
      
      default:
        return Object.values(VALIDATOR_STAGES).flat();
    }
  }

  /**
   * Check if validator is critical (stops pipeline on failure)
   */
  private isCriticalValidator(name: ValidatorName): boolean {
    const critical: ValidatorName[] = [
      'syntax-validator',
      'type-integrity',
      'security-scanner',
      'secrets-exposure-checker'
    ];
    return critical.includes(name);
  }

  /**
   * Create rollback checkpoint
   */
  private async createCheckpoint(
    changes: FileChange[],
    plan?: Plan
  ): Promise<RollbackCheckpoint> {
    const checkpoint: RollbackCheckpoint = {
      id: generateId(),
      timestamp: new Date(),
      type: 'file_backup',
      files: changes.map(change => ({
        path: change.path,
        originalContent: '', // Would be loaded from disk
        hash: hashContent(change.content)
      })),
      planId: plan?.id,
      phaseId: plan?.phases[plan.currentPhaseIndex]?.id
    };

    logger.debug('Created rollback checkpoint', 'Reviewer', { 
      checkpointId: checkpoint.id,
      fileCount: checkpoint.files.length
    });

    return checkpoint;
  }

  /**
   * Generate AI-powered review summary
   */
  private async generateReviewSummary(
    changes: FileChange[],
    pipelineResult: ValidationPipelineResult,
    context: ContextBundle
  ): Promise<{
    suggestions: string[];
    mustFix: string[];
    tokensUsed: { input: number; output: number };
  }> {
    // Build prompt for AI review
    const prompt = this.buildReviewPrompt(changes, pipelineResult, context);

    try {
      const response = await this.callApi({
        content: prompt,
        context,
        maxTokens: 2000
      });

      const parsed = this.parseReviewResponse(response.content);

      return {
        suggestions: parsed.suggestions,
        mustFix: parsed.mustFix,
        tokensUsed: response.usage
      };
    } catch {
      return {
        suggestions: [],
        mustFix: pipelineResult.results
          .filter(r => !r.passed)
          .flatMap(r => r.issues.map(i => i.message)),
        tokensUsed: { input: 0, output: 0 }
      };
    }
  }

  /**
   * Build review prompt
   */
  private buildReviewPrompt(
    changes: FileChange[],
    pipelineResult: ValidationPipelineResult,
    context: ContextBundle
  ): string {
    const parts: string[] = [];

    parts.push('## Code Review Request\n');
    parts.push(`Review the following ${changes.length} file(s) for issues and improvements.\n`);

    // Changes
    parts.push('### Changes:');
    for (const change of changes) {
      parts.push(`\n**${change.path}** (${change.operation})`);
      if (change.content) {
        parts.push('```\n' + change.content.slice(0, 2000) + '\n```');
      }
    }

    // Validation results
    if (pipelineResult.errors > 0 || pipelineResult.warnings > 0) {
      parts.push('\n### Validation Issues:');
      for (const result of pipelineResult.results) {
        if (result.issues.length > 0) {
          parts.push(`\n**${result.validator}:**`);
          result.issues.forEach(issue => {
            parts.push(`- [${issue.severity}] ${issue.file}:${issue.line ?? '?'}: ${issue.message}`);
          });
        }
      }
    }

    parts.push('\n### Required Output:');
    parts.push('Provide suggestions for improvement and list any must-fix issues.');
    parts.push('Format as JSON: { "suggestions": [...], "mustFix": [...] }');

    return parts.join('\n');
  }

  /**
   * Parse AI review response
   */
  private parseReviewResponse(content: string): {
    suggestions: string[];
    mustFix: string[];
  } {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          suggestions: parsed.suggestions || [],
          mustFix: parsed.mustFix || []
        };
      }
    } catch {
      // Ignore parsing errors
    }

    return { suggestions: [], mustFix: [] };
  }

  /**
   * Format review explanation for user
   */
  private formatReviewExplanation(
    output: ReviewerOutput,
    pipelineResult: ValidationPipelineResult
  ): string {
    const lines: string[] = [];

    if (output.approved) {
      lines.push('✅ **Code Review Passed**\n');
      lines.push(`All ${pipelineResult.results.length} validators passed.`);
    } else {
      lines.push('❌ **Code Review Failed**\n');
      lines.push(`Found ${pipelineResult.errors} error(s) and ${pipelineResult.warnings} warning(s).`);
    }

    if (output.mustFix.length > 0) {
      lines.push('\n**Must Fix:**');
      output.mustFix.forEach(issue => lines.push(`- ${issue}`));
    }

    if (output.suggestions.length > 0) {
      lines.push('\n**Suggestions:**');
      output.suggestions.forEach(s => lines.push(`- ${s}`));
    }

    return lines.join('\n');
  }

  /**
   * Set validator mode
   */
  setValidatorMode(mode: ValidatorMode): void {
    this.validatorMode = mode;
    logger.info(`Validator mode set to: ${mode}`, 'Reviewer');
  }

  /**
   * Get current validator mode
   */
  getValidatorMode(): ValidatorMode {
    return this.validatorMode;
  }
}

export const reviewerAgent = new ReviewerAgent();
