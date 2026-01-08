/**
 * Researcher Agent for Ender
 * Fetches external documentation via Context7
 */

import { BaseAgent, AgentExecuteParams } from './base-agent';
import type { AgentConfig, AgentResult, ContextBundle } from '../types';
import { logger, generateId } from '../utils';
import { context7Client, apiClient } from '../api';

const RESEARCHER_SYSTEM_PROMPT = `You are the Researcher Agent for Ender, an AI coding assistant.

YOUR ROLE:
- Fetch and summarize external documentation
- Answer "how do I" questions with accurate info
- Look up library APIs, patterns, and best practices
- Provide relevant code examples from documentation`;

export class ResearcherAgent extends BaseAgent {
  constructor() {
    const config: AgentConfig = {
      type: 'researcher',
      model: 'claude-sonnet-4-5-20250929',
      systemPrompt: RESEARCHER_SYSTEM_PROMPT,
      capabilities: ['documentation_lookup', 'api_reference'],
      maxTokens: 4096
    };
    super(config, apiClient);
  }

  async execute(params: AgentExecuteParams): Promise<AgentResult> {
    const { task, context } = params;
    const startTime = Date.now();

    try {
      // Fetch documentation for relevant libraries
      const docs = await this.fetchRelevantDocs(task);

      const prompt = this.buildResearchPrompt(task, docs, context);
      const response = await this.callApi({
        model: this.defaultModel,
        system: this.buildSystemPrompt(context),
        messages: this.buildMessages(prompt, context),
        maxTokens: this.maxTokens,
        metadata: { agent: 'researcher', taskId: generateId() }
      });

      return this.createSuccessResult(response.content, {
        explanation: response.content,
        confidence: 85,
        tokensUsed: response.usage,
        startTime
      });
    } catch (error) {
      logger.error('Researcher failed', 'Researcher', { error });
      return this.createErrorResult(
        error instanceof Error ? error : new Error(String(error)),
        startTime
      );
    }
  }

  private async fetchRelevantDocs(task: string, libraries?: string[]): Promise<string[]> {
    const docs: string[] = [];
    const libs = libraries ?? this.extractLibraryNames(task);

    for (const lib of libs.slice(0, 3)) {
      const matches = await context7Client.resolveLibraryId(lib);
      if (matches.length > 0 && matches[0]) {
        const doc = await context7Client.getLibraryDocs({
          libraryId: matches[0].id,
          maxTokens: 3000
        });
        if (doc) docs.push(doc.content);
      }
    }

    return docs;
  }

  private extractLibraryNames(task: string): string[] {
    const patterns = /\b(react|next|express|prisma|zod|tailwind|typescript)\b/gi;
    const matches = task.match(patterns) ?? [];
    return [...new Set(matches.map(m => m.toLowerCase()))];
  }

  private buildResearchPrompt(task: string, docs: string[], _context: ContextBundle): string {
    let prompt = `## Research Question\n${task}\n\n`;
    
    if (docs.length > 0) {
      prompt += '## Documentation\n' + docs.join('\n\n');
    }

    prompt += '\n\nProvide a clear, accurate answer based on the documentation.';
    return prompt;
  }
}

export const researcherAgent = new ResearcherAgent();
