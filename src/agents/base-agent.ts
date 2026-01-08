/**
 * Base agent class for Ender
 * All specialized agents extend this base class
 */

import { AnthropicClient, ChatParams, ChatResponse } from '../api/anthropic-client';
import { modelRouter, RoutingContext } from '../api/model-router';
import { requestQueue } from '../api/request-queue';
import { logger, generateId } from '../utils';
import type {
  AgentType,
  AgentConfig,
  AgentResult,
  AgentError,
  ContextBundle,
  ModelId,
  TaskType,
  ConversationMessage,
  FileChange,
  TokenUsage
} from '../types';

export interface AgentExecuteParams {
  task: string;
  context: ContextBundle;
  planId?: string;
  phaseId?: string;
  stream?: boolean;
  onProgress?: (content: string) => void;
}

export abstract class BaseAgent {
  protected type: AgentType;
  protected defaultModel: ModelId;
  protected systemPrompt: string;
  protected capabilities: string[];
  protected maxTokens: number;
  protected apiClient: AnthropicClient;

  constructor(config: AgentConfig, apiClient: AnthropicClient) {
    this.type = config.type;
    this.defaultModel = config.model;
    this.systemPrompt = config.systemPrompt;
    this.capabilities = config.capabilities;
    this.maxTokens = config.maxTokens;
    this.apiClient = apiClient;
  }

  /**
   * Get agent type
   */
  getType(): AgentType {
    return this.type;
  }

  /**
   * Get agent capabilities
   */
  getCapabilities(): string[] {
    return this.capabilities;
  }

  /**
   * Execute the agent's task
   */
  abstract execute(params: AgentExecuteParams): Promise<AgentResult>;

  /**
   * Build the full system prompt with context
   */
  protected buildSystemPrompt(context: ContextBundle): string {
    let prompt = this.systemPrompt;

    // Add core behavior guidelines
    prompt += `\n\n## Core Behavior Guidelines
- Be direct and concise in responses
- Skip unnecessary explanations for simple tasks
- Ask clarifying questions when requirements are ambiguous
- ALWAYS perform deep, thorough analysis - never surface-level reviews
- When reviewing code or refactoring, verify ALL functionality is preserved
- Check every handler, callback, and UI connection systematically
- Trace data flow through components, hooks, and state management
- Verify type signatures match between interfaces and implementations
- Document specific issues found with file paths and line numbers
- Never skim - read and understand code in full before making judgments`;

    // Add project settings
    if (context.projectSettings) {
      prompt += `\n\n## Project Settings
- Verbosity: ${context.projectSettings.effective.verbosity}
- Coding Style: ${context.projectSettings.effective.codingStyle}
- Comment Level: ${context.projectSettings.effective.commentLevel}`;

      if (context.projectSettings.effective.customRules.length > 0) {
        prompt += `\n\n## Custom Rules`;
        for (const rule of context.projectSettings.effective.customRules) {
          prompt += `\n- ${rule}`;
        }
      }
    }

    // Add active memory
    if (context.activeMemory && context.activeMemory.length > 0) {
      prompt += `\n\n## Relevant Project Memory`;
      for (const entry of context.activeMemory.slice(0, 10)) {
        prompt += `\n\n### ${entry.category}: ${entry.summary}`;
        if (entry.detail !== entry.summary) {
          prompt += `\n${entry.detail}`;
        }
      }
    }

    // Add current plan if exists
    if (context.currentPlan) {
      prompt += `\n\n## Current Plan: ${context.currentPlan.title}
Status: ${context.currentPlan.status}
Current Phase: ${context.currentPlan.currentPhaseIndex + 1} of ${context.currentPlan.phases.length}`;
      
      const currentPhase = context.currentPlan.phases[context.currentPlan.currentPhaseIndex];
      if (currentPhase) {
        prompt += `\nPhase: ${currentPhase.title}
Description: ${currentPhase.description}`;
      }
    }

    // Add assumptions if any
    if (context.assumptions && context.assumptions.length > 0) {
      prompt += `\n\n## Active Assumptions (verify before proceeding)`;
      for (const assumption of context.assumptions) {
        prompt += `\n- [${assumption.verified ? '✓' : '?'}] ${assumption.assumption} (${assumption.risk} risk)`;
      }
    }

    // Add tracked instructions if any
    if (context.instructions && context.instructions.length > 0) {
      prompt += `\n\n## User Instructions (must follow)`;
      for (const instruction of context.instructions) {
        prompt += `\n- [${instruction.priority}] ${instruction.text}`;
      }
    }

    return prompt;
  }

  /**
   * Build messages for API call
   */
  protected buildMessages(
    task: string,
    context: ContextBundle
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    // Add relevant conversation history (last 10 messages)
    const recentHistory = context.conversationHistory.slice(-10);
    for (const msg of recentHistory) {
      messages.push({
        role: msg.role,
        content: msg.content
      });
    }

    // Add relevant files as context
    if (context.relevantFiles && context.relevantFiles.length > 0) {
      let filesContext = '## Relevant Files\n\n';
      for (const file of context.relevantFiles) {
        filesContext += `### ${file.path}\n\`\`\`${file.language}\n${file.content}\n\`\`\`\n\n`;
      }
      
      // Add files as a user message if not already part of history
      if (!recentHistory.some(m => m.content.includes('## Relevant Files'))) {
        messages.push({
          role: 'user',
          content: filesContext
        });
        messages.push({
          role: 'assistant',
          content: 'I\'ve reviewed the relevant files. What would you like me to do?'
        });
      }
    }

    // Add the current task
    messages.push({
      role: 'user',
      content: task
    });

    return messages;
  }

  /**
   * Route to appropriate model
   */
  protected routeModel(
    taskType: TaskType,
    context: ContextBundle
  ): ModelId {
    const routingContext: RoutingContext = {
      taskType,
      agent: this.type,
      inputTokens: this.estimateInputTokens(context),
      fileCount: context.relevantFiles?.length ?? 0,
      hasBreakingChanges: false,
      isSecurityRelated: this.isSecurityRelated(taskType),
      complexityScore: this.estimateComplexity(context)
    };

    const decision = modelRouter.route(routingContext);
    modelRouter.logDecision(routingContext, decision);

    return decision.model;
  }

  /**
   * Estimate input tokens
   */
  protected estimateInputTokens(context: ContextBundle): number {
    let tokens = 0;

    // System prompt
    tokens += Math.ceil(this.systemPrompt.length / 3.5);

    // Files
    for (const file of context.relevantFiles ?? []) {
      tokens += Math.ceil(file.content.length / 3.5);
    }

    // Memory
    for (const entry of context.activeMemory ?? []) {
      tokens += Math.ceil((entry.summary.length + entry.detail.length) / 3.5);
    }

    // Conversation history
    for (const msg of context.conversationHistory ?? []) {
      tokens += Math.ceil(msg.content.length / 3.5);
    }

    return tokens;
  }

  /**
   * Estimate complexity
   */
  protected estimateComplexity(context: ContextBundle): number {
    let complexity = 0.5;

    // More files = more complexity
    const fileCount = context.relevantFiles?.length ?? 0;
    if (fileCount > 5) complexity += 0.2;
    if (fileCount > 10) complexity += 0.2;

    // Multi-phase plan = more complexity
    if (context.currentPlan && context.currentPlan.phases.length > 3) {
      complexity += 0.15;
    }

    // Many assumptions = more complexity
    if ((context.assumptions?.length ?? 0) > 3) {
      complexity += 0.1;
    }

    return Math.min(complexity, 1.0);
  }

  /**
   * Check if task is security related
   */
  protected isSecurityRelated(taskType: TaskType): boolean {
    const securityTasks: TaskType[] = [
      'security_scanning',
      'integration_check'
    ];
    return securityTasks.includes(taskType);
  }

  /**
   * Make API call through queue
   */
  protected async callApi(params: ChatParams): Promise<ChatResponse> {
    return requestQueue.enqueue(this.type, () => this.apiClient.chat(params), {
      priority: this.getPriority(),
      metadata: { agent: this.type }
    });
  }

  /**
   * Get agent priority
   */
  protected getPriority(): 'high' | 'normal' | 'low' {
    const highPriorityAgents: AgentType[] = ['conductor', 'reviewer', 'sanity-checker'];
    const lowPriorityAgents: AgentType[] = ['documenter', 'memory-keeper'];

    if (highPriorityAgents.includes(this.type)) return 'high';
    if (lowPriorityAgents.includes(this.type)) return 'low';
    return 'normal';
  }

  /**
   * Parse response for file changes
   */
  protected parseFileChanges(content: string): FileChange[] {
    const changes: FileChange[] = [];
    
    // Parse code blocks with file paths
    const codeBlockRegex = /```(\w+)?\s*(?:\/\/|#|<!--)\s*(?:file:|path:)\s*([^\n]+)\n([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      const language = match[1] || '';
      const filePath = match[2]?.trim() || '';
      const code = match[3] || '';

      if (filePath) {
        changes.push({
          path: filePath,
          content: code.trim(),
          operation: 'update', // Could be 'create' if file doesn't exist
          explanation: `Changes to ${filePath}`
        });
      }
    }

    return changes;
  }

  /**
   * Create error result
   */
  protected createErrorResult(error: Error, startTime: number): AgentResult {
    return {
      success: false,
      agent: this.type,
      confidence: 0,
      tokensUsed: { input: 0, output: 0 },
      duration: Date.now() - startTime,
      errors: [{
        code: 'AGENT_ERROR',
        message: error.message,
        recoverable: true
      }]
    };
  }

  /**
   * Create success result
   */
  protected createSuccessResult(
    output: string,
    options: {
      files?: FileChange[];
      explanation?: string;
      confidence?: number;
      tokensUsed: TokenUsage;
      startTime: number;
      warnings?: string[];
      nextAgent?: AgentType;
    }
  ): AgentResult {
    return {
      success: true,
      agent: this.type,
      output,
      files: options.files,
      explanation: options.explanation,
      confidence: options.confidence ?? 85,
      tokensUsed: {
        input: options.tokensUsed.input,
        output: options.tokensUsed.output
      },
      duration: Date.now() - options.startTime,
      warnings: options.warnings,
      nextAgent: options.nextAgent
    };
  }

  /**
   * Log agent activity
   */
  protected log(message: string, data?: unknown): void {
    logger.agent(this.type, message, data);
  }
}
