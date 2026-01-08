/**
 * Git Manager Agent for Ender
 * Handles commits, branches, merges, conflict resolution
 */

import { BaseAgent } from './base-agent';
import type { AgentResult, ContextBundle, FileChange } from '../types';
import { logger } from '../utils';
import * as cp from 'child_process';
import * as util from 'util';

const exec = util.promisify(cp.exec);

const GIT_MANAGER_SYSTEM_PROMPT = `You are the Git Manager Agent for Ender, an AI coding assistant.

YOUR ROLE:
- Create meaningful commit messages
- Manage branches appropriately
- Handle merge conflicts
- Suggest git operations

COMMIT MESSAGE FORMAT:
- Use conventional commits (feat:, fix:, docs:, etc.)
- Keep subject under 72 chars
- Include body for complex changes`;

export class GitManagerAgent extends BaseAgent {
  private workspacePath: string = '';

  constructor() {
    super('git-manager', GIT_MANAGER_SYSTEM_PROMPT);
  }

  setWorkspace(path: string): void {
    this.workspacePath = path;
  }

  async execute(
    task: string,
    context: ContextBundle,
    options?: { changes?: FileChange[]; action?: 'commit' | 'branch' | 'merge' | 'status' }
  ): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      let result: string;

      switch (options?.action) {
        case 'commit':
          result = await this.handleCommit(options.changes ?? [], context);
          break;
        case 'branch':
          result = await this.handleBranch(task);
          break;
        case 'status':
          result = await this.getStatus();
          break;
        default:
          result = await this.generateGitAdvice(task, context);
      }

      return {
        success: true,
        agent: 'git-manager',
        output: result,
        explanation: result,
        confidence: 90,
        tokensUsed: { input: 0, output: 0 },
        duration: Date.now() - startTime
      };
    } catch (error) {
      logger.error('Git Manager failed', 'GitManager', { error });
      return {
        success: false,
        agent: 'git-manager',
        confidence: 0,
        tokensUsed: { input: 0, output: 0 },
        duration: Date.now() - startTime,
        errors: [{ code: 'GIT_ERROR', message: String(error), recoverable: true }]
      };
    }
  }

  private async handleCommit(changes: FileChange[], context: ContextBundle): Promise<string> {
    // Generate commit message using AI
    const prompt = this.buildCommitPrompt(changes);
    const response = await this.callApi({ content: prompt, context, maxTokens: 500 });
    
    const message = this.extractCommitMessage(response.content);
    return `Generated commit message:\n\n${message}`;
  }

  private buildCommitPrompt(changes: FileChange[]): string {
    let prompt = '## Generate Commit Message\n\nChanges:\n';
    
    changes.forEach(c => {
      prompt += `- ${c.operation}: ${c.path}`;
      if (c.explanation) prompt += ` (${c.explanation})`;
      prompt += '\n';
    });

    prompt += '\nGenerate a conventional commit message (feat/fix/docs/etc).';
    return prompt;
  }

  private extractCommitMessage(content: string): string {
    // Look for commit message pattern
    const lines = content.split('\n').filter(l => l.trim());
    const commitLine = lines.find(l => 
      l.match(/^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\(.+\))?:/)
    );
    return commitLine || lines[0] || 'chore: update files';
  }

  private async handleBranch(task: string): Promise<string> {
    // Extract branch name from task
    const branchName = task.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 50);
    
    return `Suggested branch name: feature/${branchName}`;
  }

  private async getStatus(): Promise<string> {
    if (!this.workspacePath) return 'Workspace not set';

    try {
      const { stdout } = await exec('git status --short', { cwd: this.workspacePath });
      return stdout || 'No changes';
    } catch {
      return 'Not a git repository';
    }
  }

  private async generateGitAdvice(task: string, context: ContextBundle): Promise<string> {
    const prompt = `Git operation request: ${task}\n\nProvide the appropriate git commands.`;
    const response = await this.callApi({ content: prompt, context, maxTokens: 500 });
    return response.content;
  }

  async stashChanges(): Promise<string> {
    if (!this.workspacePath) throw new Error('Workspace not set');
    const { stdout } = await exec('git stash push -m "ender-checkpoint"', { cwd: this.workspacePath });
    return stdout;
  }

  async popStash(): Promise<string> {
    if (!this.workspacePath) throw new Error('Workspace not set');
    const { stdout } = await exec('git stash pop', { cwd: this.workspacePath });
    return stdout;
  }
}

export const gitManagerAgent = new GitManagerAgent();
