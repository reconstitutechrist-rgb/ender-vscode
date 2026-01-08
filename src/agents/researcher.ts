/**
 * Researcher Agent for Ender
 * Fetches external documentation via Context7
 */

import { BaseAgent } from './base-agent';
import type { AgentResult, ContextBundle } from '../types';
import { logger } from '../utils';
import { context7Client } from '../api';

const RESEARCHER_SYSTEM_PROMPT = `You are the Researcher Agent for Ender, an AI coding assistant.

YOUR ROLE:
- Fetch and summarize external documentation
- Answer "how do I" questions with accurate info
- Look up library APIs, patterns, and best practices
- Provide relevant code examples from documentation`;

export class ResearcherAgent extends BaseAgent {
  constructor() {
    super('researcher', RESEARCHER_SYSTEM_PROMPT);
  }

  async execute(
    task: string,
    context: ContextBundle,
    options?: { libraries?: string[] }
  ): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      // Fetch documentation for relevant libraries
      const docs = await this.fetchRelevantDocs(task, options?.libraries);
      
      const prompt = this.buildPrompt(task, docs, context);
      const response = await this.callApi({ content: prompt, context, maxTokens: 3000 });

      return {
        success: true,
        agent: 'researcher',
        output: response.content,
        explanation: response.content,
        confidence: 85,
        tokensUsed: response.usage,
        duration: Date.now() - startTime
      };
    } catch (error) {
      logger.error('Researcher failed', 'Researcher', { error });
      return {
        success: false,
        agent: 'researcher',
        confidence: 0,
        tokensUsed: { input: 0, output: 0 },
        duration: Date.now() - startTime,
        errors: [{ code: 'RESEARCH_ERROR', message: String(error), recoverable: true }]
      };
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

  private buildPrompt(task: string, docs: string[], context: ContextBundle): string {
    let prompt = `## Research Question\n${task}\n\n`;
    
    if (docs.length > 0) {
      prompt += '## Documentation\n' + docs.join('\n\n');
    }

    prompt += '\n\nProvide a clear, accurate answer based on the documentation.';
    return prompt;
  }
}

export const researcherAgent = new ResearcherAgent();
