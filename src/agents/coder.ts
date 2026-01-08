/**
 * Coder Agent for Ender
 * Writes code, modifies files, implements plan phases
 * Uses adaptive model selection (Sonnet for simple, Opus for complex)
 */

import { BaseAgent } from './base-agent';
import type {
  AgentType,
  AgentResult,
  ContextBundle,
  FileChange,
  CoderOutput,
  Plan,
  PlanPhase,
  PlanTask
} from '../types';
import { logger, generateId } from '../utils';
import { modelRouter } from '../api';

const CODER_SYSTEM_PROMPT = `You are the Coder Agent for Ender, an AI coding assistant.

YOUR ROLE:
- Write high-quality, production-ready code
- Implement approved plan phases step by step
- Modify existing files while preserving functionality
- Follow project coding conventions and best practices

CORE PRINCIPLES:
1. NEVER add functionality not specified in the plan
2. ALWAYS follow the exact scope defined in the current phase/task
3. Match existing code style (naming, formatting, patterns)
4. Include appropriate error handling and edge cases
5. Write clear, self-documenting code with minimal comments
6. Preserve all existing functionality - never remove working code unless specified

WHEN WRITING CODE:
- Start with the most critical files first
- Make incremental, reviewable changes
- Ensure type safety (TypeScript)
- Handle errors appropriately
- Consider edge cases
- Follow DRY principles but don't over-abstract

OUTPUT FORMAT:
Provide your response as JSON:
{
  "files": [
    {
      "path": "relative/path/to/file.ts",
      "operation": "create" | "update" | "delete",
      "content": "full file content for create/update",
      "explanation": "what this change does"
    }
  ],
  "explanation": "overall summary of changes",
  "planStepCompleted": "description of what plan step this completes",
  "testsNeeded": true/false,
  "confidence": 0-100
}`;

export class CoderAgent extends BaseAgent {
  constructor() {
    super('coder', CODER_SYSTEM_PROMPT);
  }

  /**
   * Execute a coding task
   */
  async execute(
    task: string,
    context: ContextBundle,
    options?: {
      plan?: Plan;
      phase?: PlanPhase;
      targetTask?: PlanTask;
    }
  ): Promise<AgentResult> {
    const startTime = Date.now();
    
    logger.agent('coder', 'Starting coding task', { 
      task: task.slice(0, 100),
      hasplan: !!options?.plan,
      phase: options?.phase?.index
    });

    try {
      // Determine model based on complexity
      const routingDecision = modelRouter.route({
        agent: 'coder',
        taskType: this.determineTaskType(task, context, options),
        content: task,
        fileCount: context.relevantFiles.length,
        complexity: this.estimateComplexity(task, options)
      });

      // Build the prompt
      const prompt = this.buildCoderPrompt(task, context, options);

      // Call API
      const response = await this.callApi({
        content: prompt,
        context,
        model: routingDecision.model
      });

      // Parse response
      const output = this.parseCoderOutput(response.content);

      // Validate output against plan
      if (options?.phase) {
        this.validateAgainstPlan(output, options.phase);
      }

      return {
        success: true,
        agent: 'coder',
        output: output.explanation,
        files: output.files,
        explanation: output.explanation,
        confidence: output.confidence,
        tokensUsed: response.usage,
        duration: Date.now() - startTime,
        nextAgent: 'reviewer'
      };
    } catch (error) {
      logger.error('Coder agent failed', 'Coder', { error, task: task.slice(0, 100) });
      
      return {
        success: false,
        agent: 'coder',
        confidence: 0,
        tokensUsed: { input: 0, output: 0 },
        duration: Date.now() - startTime,
        errors: [{
          code: 'CODER_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
          suggestion: 'Try breaking down the task into smaller pieces'
        }]
      };
    }
  }

  /**
   * Build the coding prompt with full context
   */
  private buildCoderPrompt(
    task: string,
    context: ContextBundle,
    options?: {
      plan?: Plan;
      phase?: PlanPhase;
      targetTask?: PlanTask;
    }
  ): string {
    const parts: string[] = [];

    // Task description
    parts.push(`## Task\n${task}`);

    // Plan context if available
    if (options?.plan) {
      parts.push(`\n## Active Plan\n**${options.plan.title}**\n${options.plan.description}`);
    }

    if (options?.phase) {
      parts.push(`\n## Current Phase (${options.phase.index + 1}/${options.plan?.phases.length ?? '?'})\n**${options.phase.title}**\n${options.phase.description}`);
      
      if (options.phase.tasks.length > 0) {
        parts.push('\n### Tasks:');
        options.phase.tasks.forEach((t, i) => {
          const status = t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '→' : '○';
          parts.push(`${status} ${i + 1}. ${t.description}`);
        });
      }
    }

    if (options?.targetTask) {
      parts.push(`\n## Current Task\n${options.targetTask.description}`);
      if (options.targetTask.targetFile) {
        parts.push(`Target file: ${options.targetTask.targetFile}`);
      }
      if (options.targetTask.expectedChanges) {
        parts.push(`Expected changes: ${options.targetTask.expectedChanges}`);
      }
    }

    // Relevant files
    if (context.relevantFiles.length > 0) {
      parts.push('\n## Relevant Files');
      for (const file of context.relevantFiles) {
        parts.push(`\n### ${file.path}\n\`\`\`${file.language}\n${file.content}\n\`\`\``);
      }
    }

    // Project settings and conventions
    if (context.projectSettings.effective.customRules.length > 0) {
      parts.push('\n## Project Rules');
      context.projectSettings.effective.customRules.forEach(rule => {
        parts.push(`- ${rule}`);
      });
    }

    // Active memory entries
    const relevantMemory = context.activeMemory.filter(m => 
      m.category === 'conventions' || m.category === 'architecture'
    );
    if (relevantMemory.length > 0) {
      parts.push('\n## Project Conventions');
      relevantMemory.forEach(m => {
        parts.push(`- ${m.summary}`);
      });
    }

    // Assumptions to consider
    if (context.assumptions && context.assumptions.length > 0) {
      parts.push('\n## Assumptions');
      context.assumptions.forEach(a => {
        parts.push(`- ${a.assumption} (${a.verified ? 'verified' : 'unverified'})`);
      });
    }

    return parts.join('\n');
  }

  /**
   * Parse coder output from response
   */
  private parseCoderOutput(content: string): CoderOutput {
    try {
      // Try to extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          files: parsed.files || [],
          explanation: parsed.explanation || '',
          planStepCompleted: parsed.planStepCompleted || '',
          testsNeeded: parsed.testsNeeded ?? false
        };
      }
    } catch {
      // If JSON parsing fails, try to extract file changes from code blocks
    }

    // Fallback: extract code blocks
    const files: FileChange[] = [];
    const codeBlockRegex = /```(\w+)?\s*\n(?:\/\/\s*(\S+)\n)?([\s\S]*?)```/g;
    let match;
    
    while ((match = codeBlockRegex.exec(content)) !== null) {
      const language = match[1] || 'typescript';
      const path = match[2] || `generated-${files.length}.${this.getExtension(language)}`;
      const code = match[3]?.trim() || '';
      
      if (code) {
        files.push({
          path,
          content: code,
          operation: 'create',
          explanation: 'Extracted from code block'
        });
      }
    }

    return {
      files,
      explanation: content.slice(0, 500),
      planStepCompleted: '',
      testsNeeded: false
    };
  }

  /**
   * Validate output against plan phase
   */
  private validateAgainstPlan(output: CoderOutput, phase: PlanPhase): void {
    // Check that modified files are in the plan's affected files
    const allowedFiles = new Set(phase.affectedFiles);
    
    for (const file of output.files) {
      if (!allowedFiles.has(file.path) && file.operation !== 'create') {
        logger.warn('File modification not in plan', 'Coder', {
          file: file.path,
          allowedFiles: Array.from(allowedFiles)
        });
      }
    }
  }

  /**
   * Determine task type for routing
   */
  private determineTaskType(
    task: string,
    context: ContextBundle,
    options?: { plan?: Plan; phase?: PlanPhase }
  ): 'single_file_small_change' | 'multi_file_changes' | 'complex_refactoring' {
    // Multi-file changes
    if (options?.phase && options.phase.affectedFiles.length > 1) {
      return 'multi_file_changes';
    }

    // Complex refactoring indicators
    const complexIndicators = ['refactor', 'restructure', 'migrate', 'rewrite', 'overhaul'];
    if (complexIndicators.some(i => task.toLowerCase().includes(i))) {
      return 'complex_refactoring';
    }

    // Single file small change
    if (context.relevantFiles.length <= 1) {
      return 'single_file_small_change';
    }

    return 'multi_file_changes';
  }

  /**
   * Estimate complexity
   */
  private estimateComplexity(
    task: string,
    options?: { plan?: Plan; phase?: PlanPhase }
  ): 'low' | 'medium' | 'high' {
    if (options?.plan?.estimatedComplexity) {
      return options.plan.estimatedComplexity;
    }

    const taskLength = task.length;
    if (taskLength > 1000) return 'high';
    if (taskLength > 300) return 'medium';
    return 'low';
  }

  /**
   * Get file extension for language
   */
  private getExtension(language: string): string {
    const extensions: Record<string, string> = {
      typescript: 'ts',
      javascript: 'js',
      typescriptreact: 'tsx',
      javascriptreact: 'jsx',
      python: 'py',
      rust: 'rs',
      go: 'go',
      java: 'java',
      css: 'css',
      html: 'html',
      json: 'json',
      yaml: 'yaml',
      markdown: 'md'
    };
    return extensions[language.toLowerCase()] ?? 'txt';
  }
}

export const coderAgent = new CoderAgent();
