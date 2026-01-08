/**
 * Model router for Ender
 * Intelligently routes requests to Sonnet or Opus based on complexity
 */

import { logger } from '../utils';
import type { ModelId, TaskType, AgentType } from '../types';

export interface RoutingDecision {
  model: ModelId;
  reason: string;
  confidence: number;
}

export interface RoutingContext {
  taskType: TaskType;
  agent: AgentType;
  inputTokens: number;
  fileCount: number;
  hasBreakingChanges: boolean;
  isSecurityRelated: boolean;
  complexityScore: number;
  userOverride?: ModelId;
}

// Tasks that always require Opus
const OPUS_REQUIRED_TASKS: TaskType[] = [
  'self_review',
  'architecture_decision',
  'complex_refactoring',
  'multi_file_changes',
  'breaking_change_analysis',
  'implementation_planning',
  'security_scanning',
  'debugging',
  'sanity_check'
];

// Tasks suitable for Sonnet
const SONNET_SUITABLE_TASKS: TaskType[] = [
  'simple_question',
  'single_file_small_change',
  'syntax_formatting_fix',
  'documentation_generation',
  'quick_suggestion',
  'memory_summarization',
  'test_generation',
  'research_lookup'
];

// Agents that typically need Opus
const OPUS_AGENTS: AgentType[] = [
  'conductor',
  'planner',
  'reviewer',
  'debugger',
  'hooks-agent',
  'integrations-agent',
  'sanity-checker'
];

// Thresholds
const TOKEN_THRESHOLD_FOR_OPUS = 500;
const FILE_COUNT_THRESHOLD = 3;
const COMPLEXITY_THRESHOLD = 0.7;

export class ModelRouter {
  private defaultSmartModel: ModelId = 'claude-opus-4-5-20251101';
  private defaultFastModel: ModelId = 'claude-sonnet-4-5-20250929';

  constructor(config?: { smartModel?: ModelId; fastModel?: ModelId }) {
    if (config?.smartModel) this.defaultSmartModel = config.smartModel;
    if (config?.fastModel) this.defaultFastModel = config.fastModel;
  }

  /**
   * Route request to appropriate model
   */
  route(context: RoutingContext): RoutingDecision {
    // User override takes precedence
    if (context.userOverride) {
      return {
        model: context.userOverride,
        reason: 'User specified model override',
        confidence: 1.0
      };
    }

    // Check for Opus-required conditions
    const opusReasons: string[] = [];

    // Task type check
    if (OPUS_REQUIRED_TASKS.includes(context.taskType)) {
      opusReasons.push(`Task type '${context.taskType}' requires advanced reasoning`);
    }

    // Agent check
    if (OPUS_AGENTS.includes(context.agent)) {
      opusReasons.push(`Agent '${context.agent}' typically needs Opus capabilities`);
    }

    // Token threshold
    if (context.inputTokens > TOKEN_THRESHOLD_FOR_OPUS) {
      opusReasons.push(`Large input (${context.inputTokens} tokens) benefits from Opus`);
    }

    // File count
    if (context.fileCount > FILE_COUNT_THRESHOLD) {
      opusReasons.push(`Multiple files (${context.fileCount}) require careful coordination`);
    }

    // Breaking changes
    if (context.hasBreakingChanges) {
      opusReasons.push('Breaking changes detected - needs careful analysis');
    }

    // Security related
    if (context.isSecurityRelated) {
      opusReasons.push('Security-sensitive operation requires thorough review');
    }

    // Complexity score
    if (context.complexityScore > COMPLEXITY_THRESHOLD) {
      opusReasons.push(`High complexity score (${context.complexityScore.toFixed(2)})`);
    }

    // Decision logic
    if (opusReasons.length >= 2) {
      // Multiple reasons favor Opus
      return {
        model: this.defaultSmartModel,
        reason: opusReasons.join('; '),
        confidence: Math.min(0.5 + opusReasons.length * 0.1, 0.95)
      };
    }

    if (opusReasons.length === 1) {
      // Single reason - still use Opus but lower confidence
      return {
        model: this.defaultSmartModel,
        reason: opusReasons[0]!,
        confidence: 0.7
      };
    }

    // Check if explicitly Sonnet-suitable
    if (SONNET_SUITABLE_TASKS.includes(context.taskType)) {
      return {
        model: this.defaultFastModel,
        reason: `Task type '${context.taskType}' is well-suited for Sonnet`,
        confidence: 0.9
      };
    }

    // Default to Sonnet for efficiency
    return {
      model: this.defaultFastModel,
      reason: 'Standard task suitable for Sonnet',
      confidence: 0.8
    };
  }

  /**
   * Calculate complexity score based on various factors
   */
  calculateComplexity(factors: {
    linesOfCode?: number;
    cyclomaticComplexity?: number;
    dependencyCount?: number;
    isRefactoring?: boolean;
    hasTests?: boolean;
    isNewFeature?: boolean;
  }): number {
    let score = 0;
    let factorCount = 0;

    if (factors.linesOfCode !== undefined) {
      // 0-100 lines: low, 100-500: medium, 500+: high
      if (factors.linesOfCode > 500) score += 1.0;
      else if (factors.linesOfCode > 100) score += 0.5;
      else score += 0.2;
      factorCount++;
    }

    if (factors.cyclomaticComplexity !== undefined) {
      // 1-5: low, 5-10: medium, 10+: high
      if (factors.cyclomaticComplexity > 10) score += 1.0;
      else if (factors.cyclomaticComplexity > 5) score += 0.5;
      else score += 0.2;
      factorCount++;
    }

    if (factors.dependencyCount !== undefined) {
      // 0-5: low, 5-15: medium, 15+: high
      if (factors.dependencyCount > 15) score += 1.0;
      else if (factors.dependencyCount > 5) score += 0.5;
      else score += 0.2;
      factorCount++;
    }

    if (factors.isRefactoring) {
      score += 0.8;
      factorCount++;
    }

    if (factors.hasTests === false) {
      // No tests increases complexity/risk
      score += 0.3;
      factorCount++;
    }

    if (factors.isNewFeature) {
      score += 0.5;
      factorCount++;
    }

    return factorCount > 0 ? score / factorCount : 0.5;
  }

  /**
   * Get model for specific agent
   */
  getModelForAgent(agent: AgentType): ModelId {
    const agentModels: Record<AgentType, ModelId> = {
      'conductor': this.defaultSmartModel,
      'planner': this.defaultSmartModel,
      'coder': this.defaultFastModel, // Adaptive - will be overridden by route()
      'reviewer': this.defaultSmartModel,
      'documenter': this.defaultFastModel,
      'researcher': this.defaultFastModel,
      'tester': this.defaultFastModel,
      'debugger': this.defaultSmartModel,
      'git-manager': this.defaultFastModel,
      'memory-keeper': this.defaultFastModel,
      'hooks-agent': this.defaultSmartModel,
      'integrations-agent': this.defaultSmartModel,
      'infrastructure-agent': this.defaultFastModel,
      'sanity-checker': this.defaultSmartModel
    };

    return agentModels[agent];
  }

  /**
   * Estimate cost difference between models
   */
  estimateCostDifference(inputTokens: number, outputTokens: number): {
    sonnetCost: number;
    opusCost: number;
    savings: number;
    savingsPercent: number;
  } {
    // Sonnet: $3/$15 per 1M tokens
    const sonnetCost = (inputTokens * 3 + outputTokens * 15) / 1_000_000;
    
    // Opus: $15/$75 per 1M tokens
    const opusCost = (inputTokens * 15 + outputTokens * 75) / 1_000_000;
    
    const savings = opusCost - sonnetCost;
    const savingsPercent = (savings / opusCost) * 100;

    return {
      sonnetCost: Number(sonnetCost.toFixed(6)),
      opusCost: Number(opusCost.toFixed(6)),
      savings: Number(savings.toFixed(6)),
      savingsPercent: Number(savingsPercent.toFixed(1))
    };
  }

  /**
   * Log routing decision
   */
  logDecision(context: RoutingContext, decision: RoutingDecision): void {
    logger.debug('Model routing decision', 'Router', {
      taskType: context.taskType,
      agent: context.agent,
      selectedModel: decision.model,
      reason: decision.reason,
      confidence: decision.confidence
    });
  }
}

export const modelRouter = new ModelRouter();
