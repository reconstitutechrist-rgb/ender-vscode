/**
 * Git Manager Agent for Ender
 * Handles commits, branches, merges, conflict resolution
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
    const config: AgentConfig = {
      type: 'git-manager',
      model: 'claude-sonnet-4-5-20250929',
      systemPrompt: GIT_MANAGER_SYSTEM_PROMPT,
      capabilities: [
        'commit_generation',
        'branch_management',
        'git_operations',
      ],
      maxTokens: 2048,
    };
    super(config, apiClient);
  }

  setWorkspace(path: string): void {
    this.workspacePath = path;
  }

  async execute(params: AgentExecuteParams): Promise<AgentResult> {
    const { task, context, files } = params;
    const startTime = Date.now();
    const taskLower = task.toLowerCase();

    try {
      let result: string;

      // Route based on task type
      if (
        taskLower.includes('commit') ||
        taskLower.includes('commit message') ||
        taskLower.includes('generate commit')
      ) {
        result = await this.handleCommit(files ?? [], context);
      } else if (
        taskLower.includes('branch') ||
        taskLower.includes('create branch') ||
        taskLower.includes('new branch')
      ) {
        result = await this.handleBranch(task);
      } else if (
        taskLower.includes('status') ||
        taskLower.includes('git status') ||
        taskLower.includes('changes')
      ) {
        result = await this.getStatus();
      } else {
        // Default to generating git advice for other operations
        result = await this.generateGitAdvice(task, context, files ?? []);
      }

      return this.createSuccessResult(result, {
        explanation: result,
        confidence: 90,
        tokensUsed: { input: 0, output: 0, total: 0, cost: 0 },
        startTime,
      });
    } catch (error) {
      logger.error('Git Manager failed', 'GitManager', { error });
      return this.createErrorResult(
        error instanceof Error ? error : new Error(String(error)),
        startTime,
      );
    }
  }

  private async handleCommit(
    changes: FileChange[],
    context: ContextBundle,
  ): Promise<string> {
    // Generate commit message using AI
    const prompt = this.buildCommitPrompt(changes);
    const response = await this.callApi({
      model: this.defaultModel,
      system: this.buildSystemPrompt(context),
      messages: this.buildMessages(prompt, context),
      maxTokens: 500,
      metadata: { agent: 'git-manager', taskId: generateId() },
    });

    const message = this.extractCommitMessage(response.content);
    return `Generated commit message:\n\n${message}`;
  }

  private buildCommitPrompt(changes: FileChange[]): string {
    let prompt = '## Generate Commit Message\n\nChanges:\n';

    changes.forEach((c) => {
      prompt += `- ${c.operation}: ${c.path}`;
      if (c.explanation) prompt += ` (${c.explanation})`;
      prompt += '\n';
    });

    prompt += '\nGenerate a conventional commit message (feat/fix/docs/etc).';
    return prompt;
  }

  private extractCommitMessage(content: string): string {
    // Look for commit message pattern
    const lines = content.split('\n').filter((l) => l.trim());
    const commitLine = lines.find((l) =>
      l.match(
        /^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\(.+\))?:/,
      ),
    );
    return commitLine || lines[0] || 'chore: update files';
  }

  private async handleBranch(task: string): Promise<string> {
    // Extract branch name from task
    const branchName = task
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 50);

    return `Suggested branch name: feature/${branchName}`;
  }

  private async getStatus(): Promise<string> {
    if (!this.workspacePath) return 'Workspace not set';

    try {
      const { stdout } = await exec('git status --short', {
        cwd: this.workspacePath,
      });
      return stdout || 'No changes';
    } catch {
      return 'Not a git repository';
    }
  }

  private async generateGitAdvice(
    task: string,
    context: ContextBundle,
    files: FileChange[],
  ): Promise<string> {
    // Files parameter available for future use
    void files;
    const prompt = `Git operation request: ${task}\n\nProvide the appropriate git commands.`;
    const response = await this.callApi({
      model: this.defaultModel,
      system: this.buildSystemPrompt(context),
      messages: this.buildMessages(prompt, context),
      maxTokens: 500,
      metadata: { agent: 'git-manager', taskId: generateId() },
    });
    return response.content;
  }

  async stashChanges(): Promise<string> {
    if (!this.workspacePath) throw new Error('Workspace not set');
    const { stdout } = await exec('git stash push -m "ender-checkpoint"', {
      cwd: this.workspacePath,
    });
    return stdout;
  }

  async popStash(): Promise<string> {
    if (!this.workspacePath) throw new Error('Workspace not set');
    const { stdout } = await exec('git stash pop', { cwd: this.workspacePath });
    return stdout;
  }
}

export const gitManagerAgent = new GitManagerAgent();
