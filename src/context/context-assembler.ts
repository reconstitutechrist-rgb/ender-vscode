/**
 * Context Assembler for Ender
 * Builds context bundles for agent consumption
 */

import { logger, estimateTokens, truncateToTokens } from '../utils';
import type {
  ContextBundle,
  FileContent,
  MemoryEntry,
  Plan,
  ConversationMessage,
  ProjectSettings,
  Assumption,
  TrackedInstruction,
} from '../types';

export interface ContextBudget {
  maxTokens: number;
  reserveForResponse: number;
  priorityAllocation: {
    conversation: number; // percentage
    memory: number;
    files: number;
    plan: number;
  };
}

export interface ContextSource {
  type:
    | 'file'
    | 'memory'
    | 'conversation'
    | 'plan'
    | 'assumption'
    | 'instruction';
  content: string;
  priority: number;
  tokens: number;
  metadata?: Record<string, unknown>;
}

const DEFAULT_BUDGET: ContextBudget = {
  maxTokens: 150000,
  reserveForResponse: 50000,
  priorityAllocation: {
    conversation: 30,
    memory: 20,
    files: 40,
    plan: 10,
  },
};

export class ContextAssembler {
  private budget: ContextBudget;

  constructor(budget?: Partial<ContextBudget>) {
    this.budget = { ...DEFAULT_BUDGET, ...budget };
  }

  /**
   * Assemble context bundle for an agent
   */
  async assemble(params: {
    relevantFiles: FileContent[];
    activeMemory: MemoryEntry[];
    currentPlan?: Plan;
    conversationHistory: ConversationMessage[];
    projectSettings: ProjectSettings;
    assumptions?: Assumption[];
    instructions?: TrackedInstruction[];
    focusFiles?: string[];
  }): Promise<ContextBundle> {
    const availableTokens =
      this.budget.maxTokens - this.budget.reserveForResponse;

    logger.debug('Assembling context', 'Context', {
      availableTokens,
      files: params.relevantFiles.length,
      memories: params.activeMemory.length,
      messages: params.conversationHistory.length,
    });

    // Calculate token budgets per category
    const budgets = {
      conversation: Math.floor(
        (availableTokens * this.budget.priorityAllocation.conversation) / 100,
      ),
      memory: Math.floor(
        (availableTokens * this.budget.priorityAllocation.memory) / 100,
      ),
      files: Math.floor(
        (availableTokens * this.budget.priorityAllocation.files) / 100,
      ),
      plan: Math.floor(
        (availableTokens * this.budget.priorityAllocation.plan) / 100,
      ),
    };

    // Assemble each category within budget
    const conversation = this.trimConversation(
      params.conversationHistory,
      budgets.conversation,
    );
    const memory = this.trimMemory(params.activeMemory, budgets.memory);
    const files = this.trimFiles(
      params.relevantFiles,
      budgets.files,
      params.focusFiles,
    );
    const plan = params.currentPlan
      ? this.trimPlan(params.currentPlan, budgets.plan)
      : undefined;

    const result: ContextBundle = {
      relevantFiles: files,
      activeMemory: memory,
      conversationHistory: conversation,
      projectSettings: params.projectSettings,
    };
    if (plan) {
      result.currentPlan = plan;
    }
    if (params.assumptions) {
      result.assumptions = params.assumptions;
    }
    if (params.instructions) {
      result.instructions = params.instructions;
    }
    return result;
  }

  /**
   * Trim conversation to fit budget
   */
  private trimConversation(
    messages: ConversationMessage[],
    maxTokens: number,
  ): ConversationMessage[] {
    if (messages.length === 0) return [];

    // Always include recent messages, trim from the middle if needed
    const result: ConversationMessage[] = [];
    let totalTokens = 0;

    // Start from most recent
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg) continue;

      const msgTokens = estimateTokens(msg.content);

      if (totalTokens + msgTokens > maxTokens) {
        // Add truncation marker
        if (i > 0) {
          result.unshift({
            id: 'truncated',
            role: 'assistant',
            content: `[${i} earlier messages truncated]`,
            timestamp: new Date(),
          });
        }
        break;
      }

      result.unshift(msg);
      totalTokens += msgTokens;
    }

    return result;
  }

  /**
   * Trim memory entries to fit budget
   */
  private trimMemory(entries: MemoryEntry[], maxTokens: number): MemoryEntry[] {
    // Sort by priority: pinned first, then by access count
    const sorted = [...entries].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.accessCount - a.accessCount;
    });

    const result: MemoryEntry[] = [];
    let totalTokens = 0;

    for (const entry of sorted) {
      const entryTokens = estimateTokens(entry.summary + entry.detail);

      if (totalTokens + entryTokens > maxTokens) break;

      result.push(entry);
      totalTokens += entryTokens;
    }

    return result;
  }

  /**
   * Trim files to fit budget
   */
  private trimFiles(
    files: FileContent[],
    maxTokens: number,
    focusFiles?: string[],
  ): FileContent[] {
    // Prioritize focus files
    const sorted = [...files].sort((a, b) => {
      const aFocus = focusFiles?.includes(a.path) ? 1 : 0;
      const bFocus = focusFiles?.includes(b.path) ? 1 : 0;
      return bFocus - aFocus;
    });

    const result: FileContent[] = [];
    let totalTokens = 0;

    for (const file of sorted) {
      const fileTokens = estimateTokens(file.content);

      if (totalTokens + fileTokens > maxTokens) {
        // Try to include truncated version
        const remainingTokens = maxTokens - totalTokens;
        if (remainingTokens > 500) {
          result.push({
            ...file,
            content: truncateToTokens(file.content, remainingTokens),
          });
        }
        break;
      }

      result.push(file);
      totalTokens += fileTokens;
    }

    return result;
  }

  /**
   * Trim plan to fit budget
   */
  private trimPlan(plan: Plan, maxTokens: number): Plan {
    const planJson = JSON.stringify(plan);
    const tokens = estimateTokens(planJson);

    if (tokens <= maxTokens) return plan;

    // Return summarized plan - remove verbose fields
    return {
      ...plan,
      phases: plan.phases.map((phase) => ({
        ...phase,
        tasks: phase.tasks.map((task) => {
          const { expectedChanges, actualChanges, ...rest } = task;
          return rest;
        }),
      })),
    };
  }

  /**
   * Calculate context usage
   */
  calculateUsage(bundle: ContextBundle): {
    total: number;
    breakdown: Record<string, number>;
    percentUsed: number;
  } {
    const breakdown: Record<string, number> = {};

    breakdown['conversation'] = bundle.conversationHistory.reduce(
      (sum, msg) => sum + estimateTokens(msg.content),
      0,
    );

    breakdown['memory'] = bundle.activeMemory.reduce(
      (sum, entry) => sum + estimateTokens(entry.summary + entry.detail),
      0,
    );

    breakdown['files'] = bundle.relevantFiles.reduce(
      (sum, file) => sum + estimateTokens(file.content),
      0,
    );

    breakdown['plan'] = bundle.currentPlan
      ? estimateTokens(JSON.stringify(bundle.currentPlan))
      : 0;

    const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
    const percentUsed =
      (total / (this.budget.maxTokens - this.budget.reserveForResponse)) * 100;

    return { total, breakdown, percentUsed };
  }

  /**
   * Update budget
   */
  setBudget(budget: Partial<ContextBudget>): void {
    this.budget = { ...this.budget, ...budget };
  }

  /**
   * Get current budget
   */
  getBudget(): ContextBudget {
    return { ...this.budget };
  }
}

// Singleton instance
export const contextAssembler = new ContextAssembler();
