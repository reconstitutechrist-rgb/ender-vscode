/**
 * Debugger Agent for Ender
 * Analyzes errors, traces issues, suggests fixes
 */

import { BaseAgent, AgentExecuteParams } from './base-agent';
import type { AgentConfig, AgentResult, ContextBundle } from '../types';
import { logger, generateId } from '../utils';
import { apiClient } from '../api';

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
    const config: AgentConfig = {
      type: 'debugger',
      model: 'claude-opus-4-5-20251101',
      systemPrompt: DEBUGGER_SYSTEM_PROMPT,
      capabilities: [
        'error_analysis',
        'root_cause_identification',
        'fix_suggestion',
      ],
      maxTokens: 4096,
    };
    super(config, apiClient);
  }

  async execute(params: AgentExecuteParams): Promise<AgentResult> {
    const { task, context } = params;
    const startTime = Date.now();

    try {
      const prompt = this.buildDebugPrompt(task, undefined, context);
      const response = await this.callApi({
        model: this.defaultModel,
        system: this.buildSystemPrompt(context),
        messages: this.buildMessages(prompt, context),
        maxTokens: this.maxTokens,
        metadata: { agent: 'debugger', taskId: generateId() },
      });

      return this.createSuccessResult(response.content, {
        explanation: response.content,
        confidence: 80,
        tokensUsed: response.usage,
        startTime,
        nextAgent: 'coder',
      });
    } catch (error) {
      logger.error('Debugger failed', 'Debugger', { error });
      return this.createErrorResult(
        error instanceof Error ? error : new Error(String(error)),
        startTime,
      );
    }
  }

  private buildDebugPrompt(
    task: string,
    options: { error?: string; stackTrace?: string } | undefined,
    context: ContextBundle,
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
      context.relevantFiles.forEach((f) => {
        prompt += `\n### ${f.path}\n\`\`\`${f.language}\n${f.content}\n\`\`\``;
      });
    }

    prompt += '\n\nAnalyze the issue and provide a detailed fix.';
    return prompt;
  }
}

export const debuggerAgent = new DebuggerAgent();
