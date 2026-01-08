/**
 * Documenter Agent for Ender
 * Creates plain English explanations, code comments, documentation
 */

import { BaseAgent } from './base-agent';
import type { AgentResult, ContextBundle, FileChange } from '../types';
import { logger } from '../utils';

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
    super('documenter', DOCUMENTER_SYSTEM_PROMPT);
  }

  async execute(
    task: string,
    context: ContextBundle,
    options?: { changes?: FileChange[] }
  ): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      const prompt = this.buildPrompt(task, options?.changes ?? [], context);
      const response = await this.callApi({ content: prompt, context, maxTokens: 2000 });

      return {
        success: true,
        agent: 'documenter',
        output: response.content,
        explanation: response.content,
        confidence: 90,
        tokensUsed: response.usage,
        duration: Date.now() - startTime
      };
    } catch (error) {
      logger.error('Documenter failed', 'Documenter', { error });
      return {
        success: false,
        agent: 'documenter',
        confidence: 0,
        tokensUsed: { input: 0, output: 0 },
        duration: Date.now() - startTime,
        errors: [{ code: 'DOC_ERROR', message: String(error), recoverable: true }]
      };
    }
  }

  private buildPrompt(task: string, changes: FileChange[], context: ContextBundle): string {
    let prompt = `## Task\n${task}\n\n`;
    
    if (changes.length > 0) {
      prompt += '## Changes to Document\n';
      changes.forEach(c => {
        prompt += `\n### ${c.path} (${c.operation})\n`;
        if (c.explanation) prompt += `${c.explanation}\n`;
      });
    }

    prompt += '\n\nProvide a clear, beginner-friendly explanation of these changes.';
    return prompt;
  }
}

export const documenterAgent = new DocumenterAgent();
