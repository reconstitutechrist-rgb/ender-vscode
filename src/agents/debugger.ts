/**
 * Debugger Agent for Ender
 * Analyzes errors, traces issues, suggests fixes
 */

import { BaseAgent } from './base-agent';
import type { AgentResult, ContextBundle } from '../types';
import { logger } from '../utils';

const DEBUGGER_SYSTEM_PROMPT = `You are the Debugger Agent for Ender, an AI coding assistant.

YOUR ROLE:
- Analyze error messages and stack traces
- Trace issues through the codebase
- Identify root causes
- Suggest specific fixes

DEBUGGING APPROACH:
1. Parse and understand the error
2. Identify the exact location
3. Trace data flow to find root cause
4. Suggest fix with explanation
5. Consider similar bugs elsewhere

OUTPUT:
- Clear explanation of the bug
- Root cause analysis
- Specific fix with code
- Prevention suggestions`;

export class DebuggerAgent extends BaseAgent {
  constructor() {
    super('debugger', DEBUGGER_SYSTEM_PROMPT);
  }

  async execute(
    task: string,
    context: ContextBundle,
    options?: { error?: string; stackTrace?: string }
  ): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      const prompt = this.buildPrompt(task, options, context);
      const response = await this.callApi({ content: prompt, context, maxTokens: 3000 });

      return {
        success: true,
        agent: 'debugger',
        output: response.content,
        explanation: response.content,
        confidence: 80,
        tokensUsed: response.usage,
        duration: Date.now() - startTime,
        nextAgent: 'coder' // Often needs coder to implement fix
      };
    } catch (error) {
      logger.error('Debugger failed', 'Debugger', { error });
      return {
        success: false,
        agent: 'debugger',
        confidence: 0,
        tokensUsed: { input: 0, output: 0 },
        duration: Date.now() - startTime,
        errors: [{ code: 'DEBUG_ERROR', message: String(error), recoverable: true }]
      };
    }
  }

  private buildPrompt(
    task: string,
    options: { error?: string; stackTrace?: string } | undefined,
    context: ContextBundle
  ): string {
    let prompt = `## Debugging Request\n${task}\n\n`;

    if (options?.error) {
      prompt += `## Error Message\n\`\`\`\n${options.error}\n\`\`\`\n\n`;
    }

    if (options?.stackTrace) {
      prompt += `## Stack Trace\n\`\`\`\n${options.stackTrace}\n\`\`\`\n\n`;
    }

    if (context.relevantFiles.length > 0) {
      prompt += '## Relevant Code\n';
      context.relevantFiles.forEach(f => {
        prompt += `\n### ${f.path}\n\`\`\`${f.language}\n${f.content}\n\`\`\``;
      });
    }

    prompt += '\n\nAnalyze the issue and provide a detailed fix.';
    return prompt;
  }
}

export const debuggerAgent = new DebuggerAgent();
