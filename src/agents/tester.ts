/**
 * Tester Agent for Ender
 * Generates tests, runs test suites, reports coverage
 */

import { BaseAgent } from './base-agent';
import type { AgentResult, ContextBundle, FileChange } from '../types';
import { logger } from '../utils';

const TESTER_SYSTEM_PROMPT = `You are the Tester Agent for Ender, an AI coding assistant.

YOUR ROLE:
- Generate comprehensive test cases
- Run existing test suites
- Report test coverage
- Identify edge cases to test

OUTPUT TEST CODE:
- Match existing test patterns in the project
- Include unit, integration tests as needed
- Test happy path AND edge cases
- Use appropriate mocking`;

export class TesterAgent extends BaseAgent {
  constructor() {
    super('tester', TESTER_SYSTEM_PROMPT);
  }

  async execute(
    task: string,
    context: ContextBundle,
    options?: { filesToTest?: string[] }
  ): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      const prompt = this.buildPrompt(task, options?.filesToTest ?? [], context);
      const response = await this.callApi({ content: prompt, context, maxTokens: 4000 });

      // Extract test files from response
      const testFiles = this.extractTestFiles(response.content);

      return {
        success: true,
        agent: 'tester',
        output: response.content,
        files: testFiles,
        explanation: `Generated ${testFiles.length} test file(s)`,
        confidence: 85,
        tokensUsed: response.usage,
        duration: Date.now() - startTime
      };
    } catch (error) {
      logger.error('Tester failed', 'Tester', { error });
      return {
        success: false,
        agent: 'tester',
        confidence: 0,
        tokensUsed: { input: 0, output: 0 },
        duration: Date.now() - startTime,
        errors: [{ code: 'TEST_ERROR', message: String(error), recoverable: true }]
      };
    }
  }

  private buildPrompt(task: string, files: string[], context: ContextBundle): string {
    let prompt = `## Testing Task\n${task}\n\n`;
    
    if (files.length > 0) {
      prompt += '## Files to Test\n' + files.join('\n');
    }

    // Include relevant source files
    const sourceFiles = context.relevantFiles.filter(f => !f.path.includes('.test.'));
    if (sourceFiles.length > 0) {
      prompt += '\n\n## Source Code\n';
      sourceFiles.forEach(f => {
        prompt += `\n### ${f.path}\n\`\`\`${f.language}\n${f.content}\n\`\`\``;
      });
    }

    return prompt;
  }

  private extractTestFiles(content: string): FileChange[] {
    const files: FileChange[] = [];
    const codeBlockRegex = /```(?:typescript|javascript)?\s*\n(?:\/\/\s*(\S+\.test\.\w+)\n)?([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      const path = match[1] || `generated.test.ts`;
      const code = match[2]?.trim();
      if (code && code.includes('test(') || code?.includes('it(') || code?.includes('describe(')) {
        files.push({ path, content: code, operation: 'create' });
      }
    }

    return files;
  }
}

export const testerAgent = new TesterAgent();
