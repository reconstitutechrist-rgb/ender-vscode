/**
 * Documenter Agent for Ender
 * Creates plain English explanations, code comments, documentation
 */

import { BaseAgent, AgentExecuteParams } from './base-agent';
import type {
  AgentConfig,
  AgentResult,
  ContextBundle,
  FileChange,
} from '../types';
import { logger, generateId } from '../utils';
import { apiClient } from '../api';

const DOCUMENTER_SYSTEM_PROMPT = `You are the Documenter Agent for Ender, an AI coding assistant.

YOUR ROLE:
- Explain code changes in plain English for beginners
- Generate appropriate code comments (not excessive)
- Create/update documentation files when needed
- Make technical concepts accessible

PRINCIPLES:
- Write for developers with limited experience
- Be clear and concise
- Use analogies when helpful
- Avoid jargon without explanation
- Focus on the "what" and "why", not just "how"`;

export class DocumenterAgent extends BaseAgent {
  constructor() {
    const config: AgentConfig = {
      type: 'documenter',
      model: 'claude-sonnet-4-5-20250929',
      systemPrompt: DOCUMENTER_SYSTEM_PROMPT,
      capabilities: ['documentation', 'explanation', 'commenting'],
      maxTokens: 2048,
    };
    super(config, apiClient);
  }

  async execute(params: AgentExecuteParams): Promise<AgentResult> {
    const { task, context, files } = params;
    const startTime = Date.now();

    try {
      const prompt = this.buildDocPrompt(task, files ?? [], context);
      const response = await this.callApi({
        model: this.defaultModel,
        system: this.buildSystemPrompt(context),
        messages: this.buildMessages(prompt, context),
        maxTokens: this.maxTokens,
        metadata: { agent: 'documenter', taskId: generateId() },
      });

      return this.createSuccessResult(response.content, {
        explanation: response.content,
        confidence: 90,
        tokensUsed: response.usage,
        startTime,
      });
    } catch (error) {
      logger.error('Documenter failed', 'Documenter', { error });
      return this.createErrorResult(
        error instanceof Error ? error : new Error(String(error)),
        startTime,
      );
    }
  }

  private buildDocPrompt(
    task: string,
    changes: FileChange[],
    _context: ContextBundle,
  ): string {
    let prompt = `## Task\n${task}\n\n`;

    if (changes.length > 0) {
      prompt += '## Changes to Document\n';
      changes.forEach((c) => {
        prompt += `\n### ${c.path} (${c.operation})\n`;
        if (c.explanation) prompt += `${c.explanation}\n`;
      });
    }

    prompt +=
      '\n\nProvide a clear, beginner-friendly explanation of these changes.';
    return prompt;
  }
}

export const documenterAgent = new DocumenterAgent();
