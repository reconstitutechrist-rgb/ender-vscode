/**
 * Reviewer Agent for Ender
 * Runs all 29 validators, acts as quality gate
 * Approves or rejects code changes
 */

import { BaseAgent, AgentExecuteParams } from './base-agent';
import type {
  AgentConfig,
  AgentResult,
  ReviewerOutput,
  ValidationPipelineResult,
  ValidatorMode,
  RollbackCheckpoint,
  Plan,
  ContextBundle,
  FileChange,
} from '../types';
import { logger, generateId, hashContent } from '../utils';
import { validationPipeline } from '../validators';
import { apiClient } from '../api';
import { conductorAgent } from './conductor';
import { gitManagerAgent } from './git-manager';

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

export class ReviewerAgent extends BaseAgent {
  private validatorMode: ValidatorMode = 'strict';

  constructor() {
    const config: AgentConfig = {
      type: 'reviewer',
      model: 'claude-opus-4-5-20251101',
      systemPrompt: REVIEWER_SYSTEM_PROMPT,
      capabilities: ['code_review', 'validation', 'quality_assurance'],
      maxTokens: 4096,
    };
    super(config, apiClient);
  }

  /**
   * Review code changes
   */
  async execute(params: AgentExecuteParams): Promise<AgentResult> {
    const { context, files } = params;
    const startTime = Date.now();
    const changes = files ?? [];

    logger.agent('reviewer', 'Starting code review', {
      fileCount: changes.length,
      mode: this.validatorMode,
    });

    try {
      // Create rollback checkpoint first
      const checkpoint = await this.createCheckpoint(
        changes,
        context.currentPlan,
      );

      // Run validation pipeline
      const pipelineResult = await this.runValidationPipeline(
        changes,
        context,
        this.validatorMode,
        context.currentPlan,
      );

      // Attach checkpoint to result
      pipelineResult.checkpoint = checkpoint;

      // Generate review summary using AI
      const reviewSummary = await this.generateReviewSummary(
        changes,
        pipelineResult,
        context,
      );

      const output: ReviewerOutput = {
        approved: pipelineResult.passed,
        validationResults: pipelineResult.results,
        suggestions: reviewSummary.suggestions,
        mustFix: reviewSummary.mustFix,
      };

      return this.createSuccessResult(JSON.stringify(output, null, 2), {
        confidence: pipelineResult.passed ? 95 : 40,
        tokensUsed: {
          ...reviewSummary.tokensUsed,
          total:
            reviewSummary.tokensUsed.input + reviewSummary.tokensUsed.output,
          cost: 0,
        },
        startTime,
        explanation: this.formatReviewExplanation(output, pipelineResult),
        nextAgent: pipelineResult.passed ? 'documenter' : 'coder',
      });
    } catch (error) {
      logger.error('Reviewer agent failed', 'Reviewer', { error });

      return this.createErrorResult(
        error instanceof Error ? error : new Error(String(error)),
        startTime,
      );
    }
  }

  /**
   * Run the full validation pipeline
   */
  private async runValidationPipeline(
    changes: FileChange[],
    context: ContextBundle,
    mode: ValidatorMode,
    plan?: Plan,
  ): Promise<ValidationPipelineResult> {
    // Validate plan scope before running pipeline
    if (context.currentPlan) {
      const proposedFiles = changes.map((c) => c.path);
      const scopeResult = conductorAgent.validatePlanScope(
        proposedFiles,
        context,
      );
      if (!scopeResult.valid) {
        logger.warn('Scope violations detected', 'Reviewer', {
          violations: scopeResult.violations,
        });
        // Return early with scope violations as errors
        return {
          passed: false,
          results: [
            {
              validator: 'scope-guard',
              passed: false,
              severity: 'error',
              issues: scopeResult.violations.map((v) => ({
                file: v,
                message: `File "${v}" is not in the approved plan scope`,
                severity: 'error' as const,
              })),
              duration: 0,
            },
          ],
          totalIssues: scopeResult.violations.length,
          errors: scopeResult.violations.length,
          warnings: 0,
          duration: 0,
        };
      }
    }

    // Configure pipeline mode
    validationPipeline.setMode(mode);

    // Build existing files map from context
    const existingFiles = new Map<string, string>();
    for (const file of context.relevantFiles) {
      existingFiles.set(file.path, file.content);
    }

    // Run pipeline
    return validationPipeline.run({
      changes,
      planId: plan?.id || '',
      phaseId: plan?.phases[plan.currentPhaseIndex]?.id || '',
      existingFiles,
      projectPath: context.projectPath ?? '',
      config: context.projectSettings.effective as unknown as Record<
        string,
        unknown
      >,
    });
  }

  /**
   * Create rollback checkpoint
   */
  private async createCheckpoint(
    changes: FileChange[],
    plan?: Plan,
  ): Promise<RollbackCheckpoint> {
    // Try git stash first for safer rollback
    let checkpointType: 'git_stash' | 'file_backup' = 'file_backup';
    try {
      await gitManagerAgent.stashChanges();
      checkpointType = 'git_stash';
      logger.debug('Created git stash checkpoint', 'Reviewer');
    } catch (error) {
      logger.warn('Git stash failed, falling back to file backup', 'Reviewer', {
        error,
      });
    }

    const checkpoint: RollbackCheckpoint = {
      id: generateId(),
      timestamp: new Date(),
      type: checkpointType,
      files: changes.map((change) => ({
        path: change.path,
        originalContent: '', // Would be loaded from disk
        hash: hashContent(change.content),
      })),
      planId: plan?.id || '',
      phaseId: plan?.phases[plan.currentPhaseIndex]?.id || '',
    };

    logger.debug('Created rollback checkpoint', 'Reviewer', {
      checkpointId: checkpoint.id,
      fileCount: checkpoint.files.length,
      type: checkpointType,
    });

    return checkpoint;
  }

  /**
   * Generate AI-powered review summary
   */
  private async generateReviewSummary(
    changes: FileChange[],
    pipelineResult: ValidationPipelineResult,
    context: ContextBundle,
  ): Promise<{
    suggestions: string[];
    mustFix: string[];
    tokensUsed: { input: number; output: number };
  }> {
    // Build prompt for AI review
    const prompt = this.buildReviewPrompt(changes, pipelineResult, context);

    try {
      const response = await this.callApi({
        model: this.defaultModel,
        system: this.systemPrompt,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 2000,
        metadata: { agent: this.type, taskId: generateId() },
      });

      const parsed = this.parseReviewResponse(response.content);

      return {
        suggestions: parsed.suggestions,
        mustFix: parsed.mustFix,
        tokensUsed: response.usage,
      };
    } catch {
      return {
        suggestions: [],
        mustFix: pipelineResult.results
          .filter((r) => !r.passed)
          .flatMap((r) => r.issues.map((i) => i.message)),
        tokensUsed: { input: 0, output: 0 },
      };
    }
  }

  /**
   * Build review prompt
   */
  private buildReviewPrompt(
    changes: FileChange[],
    pipelineResult: ValidationPipelineResult,
    _context: ContextBundle,
  ): string {
    const parts: string[] = [];

    parts.push('## Code Review Request\n');
    parts.push(
      `Review the following ${changes.length} file(s) for issues and improvements.\n`,
    );

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
          result.issues.forEach((issue) => {
            parts.push(
              `- [${issue.severity}] ${issue.file}:${issue.line ?? '?'}: ${issue.message}`,
            );
          });
        }
      }
    }

    parts.push('\n### Required Output:');
    parts.push(
      'Provide suggestions for improvement and list any must-fix issues.',
    );
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
          mustFix: parsed.mustFix || [],
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
    pipelineResult: ValidationPipelineResult,
  ): string {
    const lines: string[] = [];

    if (output.approved) {
      lines.push('✅ **Code Review Passed**\n');
      lines.push(`All ${pipelineResult.results.length} validators passed.`);
    } else {
      lines.push('❌ **Code Review Failed**\n');
      lines.push(
        `Found ${pipelineResult.errors} error(s) and ${pipelineResult.warnings} warning(s).`,
      );
    }

    if (output.mustFix.length > 0) {
      lines.push('\n**Must Fix:**');
      output.mustFix.forEach((issue) => lines.push(`- ${issue}`));
    }

    if (output.suggestions.length > 0) {
      lines.push('\n**Suggestions:**');
      output.suggestions.forEach((s) => lines.push(`- ${s}`));
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
