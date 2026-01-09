/**
 * Memory Keeper Agent for Ender
 * Monitors activity, extracts learnings, updates memory
 */

import { BaseAgent, AgentExecuteParams } from './base-agent';
import type {
  AgentConfig,
  AgentResult,
  ContextBundle,
  MemoryEntry,
  MemoryCategory,
  AutoMemoryEvent,
  Plan,
} from '../types';
import { logger, generateId } from '../utils';
import { apiClient } from '../api';

const MEMORY_KEEPER_SYSTEM_PROMPT = `You are the Memory Keeper Agent for Ender, an AI coding assistant.

YOUR ROLE:
- Monitor all agent activity for learnings
- Extract important patterns and decisions
- Create memory entries for future reference
- Summarize and compress old memories
- Handle memory conflicts

WHAT TO REMEMBER:
- Architecture decisions and reasoning
- Coding conventions discovered
- Dependency choices
- Known issues and workarounds
- User preferences and corrections
- File structure patterns

MEMORY FORMAT:
{
  "category": "architecture|conventions|dependencies|known_issues|business_logic|plans|history|corrections|structure",
  "summary": "Brief description (< 100 chars)",
  "detail": "Full context and reasoning",
  "tags": ["relevant", "tags"],
  "relatedFiles": ["file/paths"]
}`;

export class MemoryKeeperAgent extends BaseAgent {
  private pendingMemories: Partial<MemoryEntry>[] = [];

  constructor() {
    const config: AgentConfig = {
      type: 'memory-keeper',
      model: 'claude-sonnet-4-5-20250929',
      systemPrompt: MEMORY_KEEPER_SYSTEM_PROMPT,
      capabilities: [
        'learning_extraction',
        'memory_management',
        'summarization',
      ],
      maxTokens: 2048,
    };
    super(config, apiClient);
  }

  async execute(params: AgentExecuteParams): Promise<AgentResult> {
    const { task, context } = params;
    const startTime = Date.now();

    try {
      // Extract learnings from content
      const memories = await this.extractLearnings(task, context);

      // Add to pending (awaiting user confirmation)
      this.pendingMemories.push(...memories);

      return this.createSuccessResult(JSON.stringify(memories, null, 2), {
        explanation: `Extracted ${memories.length} potential memory entries (pending confirmation)`,
        confidence: 85,
        tokensUsed: { input: 0, output: 0, total: 0, cost: 0 },
        startTime,
      });
    } catch (error) {
      logger.error('Memory Keeper failed', 'MemoryKeeper', { error });
      return this.createErrorResult(
        error instanceof Error ? error : new Error(String(error)),
        startTime,
      );
    }
  }

  /**
   * Handle auto-triggered memory events from plan completion, user corrections, etc.
   * Called by other agents when memory-worthy events occur.
   */
  async handleAutoMemoryTrigger(
    event: AutoMemoryEvent,
    context: ContextBundle,
    options: { plan?: Plan; content?: string },
  ): Promise<Partial<MemoryEntry>[]> {
    logger.info(`Auto memory trigger: ${event}`, 'MemoryKeeper');
    // Context available for enhanced memory extraction in future
    void context;
    const categoryMap: Record<AutoMemoryEvent, MemoryCategory> = {
      plan_approved: 'plans',
      phase_completed: 'history',
      plan_completed: 'history',
      dependency_added: 'dependencies',
      architecture_decision: 'architecture',
      convention_detected: 'conventions',
      bug_discovered: 'known_issues',
      user_correction: 'corrections',
      file_structure_change: 'structure',
    };

    const category = categoryMap[event];
    const entry: Partial<MemoryEntry> = {
      id: generateId(),
      timestamp: new Date(),
      category,
      source: 'auto',
      status: 'pending',
      pinned: false,
      confidence: 80,
    };

    switch (event) {
      case 'plan_approved':
        entry.summary = `Plan: ${options.plan?.title ?? 'Unknown'}`;
        entry.detail = options.plan?.description ?? '';
        entry.relatedFiles = options.plan?.affectedFiles ?? [];
        if (options.plan?.id) {
          entry.planId = options.plan.id;
        }
        break;

      case 'phase_completed':
        const phase = options.plan?.phases[options.plan.currentPhaseIndex];
        entry.summary = `Completed: ${phase?.title ?? 'Phase'}`;
        entry.detail = phase?.description ?? '';
        entry.relatedFiles = phase?.affectedFiles ?? [];
        break;

      case 'dependency_added':
        entry.summary = `Added dependency: ${options.content ?? 'unknown'}`;
        entry.detail = options.content ?? '';
        entry.tags = ['dependency'];
        break;

      case 'user_correction':
        entry.summary = `Correction: ${(options.content ?? '').slice(0, 50)}`;
        entry.detail = options.content ?? '';
        entry.pinned = true; // Corrections are important
        entry.confidence = 100;
        break;

      default:
        entry.summary = `${event}: ${(options.content ?? '').slice(0, 50)}`;
        entry.detail = options.content ?? '';
    }

    // Add to pending memories for user confirmation
    this.pendingMemories.push(entry);
    logger.info(`Created auto memory entry: ${entry.summary}`, 'MemoryKeeper');

    return [entry];
  }

  private async extractLearnings(
    content: string,
    context: ContextBundle,
  ): Promise<Partial<MemoryEntry>[]> {
    const prompt = `## Extract Learnings

Analyze this content and extract important learnings to remember:

${content}

Output as JSON array of memory entries with category, summary, detail, and tags.`;

    const response = await this.callApi({
      model: this.defaultModel,
      system: this.buildSystemPrompt(context),
      messages: this.buildMessages(prompt, context),
      maxTokens: 2000,
      metadata: { agent: 'memory-keeper', taskId: generateId() },
    });

    try {
      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.map((p: Record<string, unknown>) => ({
          id: generateId(),
          timestamp: new Date(),
          category: p.category as MemoryCategory,
          summary: p.summary as string,
          detail: p.detail as string,
          tags: (p.tags as string[]) ?? [],
          relatedFiles: (p.relatedFiles as string[]) ?? [],
          source: 'auto' as const,
          status: 'pending' as const,
          pinned: false,
          confidence: 70,
        }));
      }
    } catch {
      // Parsing failed
    }

    return [];
  }

  async summarizeOldMemories(
    memories: MemoryEntry[],
    context: ContextBundle,
  ): Promise<{ summary: string; tokensSaved: number }> {
    const content = memories
      .map((m) => `- ${m.summary}: ${m.detail}`)
      .join('\n');

    const prompt = `Summarize these memory entries into a concise paragraph:

${content}`;

    const response = await this.callApi({
      model: this.defaultModel,
      system: this.buildSystemPrompt(context),
      messages: this.buildMessages(prompt, context),
      maxTokens: 500,
      metadata: { agent: 'memory-keeper', taskId: generateId() },
    });

    const originalTokens = content.length / 4;
    const summaryTokens = response.content.length / 4;

    return {
      summary: response.content,
      tokensSaved: Math.max(0, originalTokens - summaryTokens),
    };
  }

  getPendingMemories(): Partial<MemoryEntry>[] {
    return [...this.pendingMemories];
  }

  clearPendingMemories(): void {
    this.pendingMemories = [];
  }

  confirmMemory(id: string): Partial<MemoryEntry> | undefined {
    const index = this.pendingMemories.findIndex((m) => m.id === id);
    if (index !== -1) {
      const memory = this.pendingMemories.splice(index, 1)[0];
      if (memory) {
        memory.status = 'confirmed';
      }
      return memory;
    }
    return undefined;
  }

  rejectMemory(id: string): void {
    const index = this.pendingMemories.findIndex((m) => m.id === id);
    if (index !== -1) {
      this.pendingMemories.splice(index, 1);
    }
  }
}

export const memoryKeeperAgent = new MemoryKeeperAgent();
