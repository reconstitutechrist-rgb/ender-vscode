/**
 * Cost calculator utility for Ender
 * Track and calculate API usage costs
 */

import type { TokenUsage, CostTracking } from '../types';

// Pricing per 1M tokens (as of 2025)
const PRICING = {
  'claude-opus-4-5-20251101': {
    input: 15.0, // $15 per 1M input tokens
    output: 75.0, // $75 per 1M output tokens
  },
  'claude-sonnet-4-5-20250929': {
    input: 3.0, // $3 per 1M input tokens
    output: 15.0, // $15 per 1M output tokens
  },
} as const;

type ModelId = keyof typeof PRICING;

/**
 * Calculate cost for token usage
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = PRICING[model as ModelId];
  if (!pricing) {
    // Default to Sonnet pricing for unknown models
    return calculateCost(
      'claude-sonnet-4-5-20250929',
      inputTokens,
      outputTokens,
    );
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;

  return Number((inputCost + outputCost).toFixed(6));
}

/**
 * Create token usage object
 */
export function createTokenUsage(
  model: string,
  input: number,
  output: number,
): TokenUsage {
  return {
    input,
    output,
    total: input + output,
    cost: calculateCost(model, input, output),
  };
}

/**
 * Cost tracking manager
 */
export class CostTracker {
  private today: number = 0;
  private thisMonth: number = 0;
  private allTime: number = 0;
  private lastUpdated: Date = new Date();
  private dailyBudget?: number;
  private monthlyBudget?: number;
  private warningThreshold: number = 0.8;

  private currentDay: number;
  private currentMonth: number;

  constructor(config?: {
    dailyBudget?: number;
    monthlyBudget?: number;
    warningThreshold?: number;
  }) {
    const now = new Date();
    this.currentDay = now.getDate();
    this.currentMonth = now.getMonth();

    if (config) {
      if (config.dailyBudget !== undefined) {
        this.dailyBudget = config.dailyBudget;
      }
      if (config.monthlyBudget !== undefined) {
        this.monthlyBudget = config.monthlyBudget;
      }
      this.warningThreshold = config.warningThreshold ?? 0.8;
    }
  }

  /**
   * Reset daily/monthly counters if needed
   */
  private checkReset(): void {
    const now = new Date();

    // Reset daily if new day
    if (now.getDate() !== this.currentDay) {
      this.today = 0;
      this.currentDay = now.getDate();
    }

    // Reset monthly if new month
    if (now.getMonth() !== this.currentMonth) {
      this.thisMonth = 0;
      this.currentMonth = now.getMonth();
    }
  }

  /**
   * Add cost
   */
  addCost(cost: number): void {
    this.checkReset();

    this.today += cost;
    this.thisMonth += cost;
    this.allTime += cost;
    this.lastUpdated = new Date();
  }

  /**
   * Get current tracking state
   */
  getTracking(): CostTracking {
    this.checkReset();

    const result: CostTracking = {
      today: Number(this.today.toFixed(4)),
      thisMonth: Number(this.thisMonth.toFixed(4)),
      allTime: Number(this.allTime.toFixed(4)),
      lastUpdated: this.lastUpdated,
    };

    if (this.dailyBudget || this.monthlyBudget) {
      result.budget = {
        daily: this.dailyBudget ?? 0,
        monthly: this.monthlyBudget ?? 0,
        dailyRemaining: this.dailyBudget
          ? Math.max(0, this.dailyBudget - this.today)
          : 0,
        monthlyRemaining: this.monthlyBudget
          ? Math.max(0, this.monthlyBudget - this.thisMonth)
          : 0,
        warningThreshold: this.warningThreshold,
      };
    }

    return result;
  }

  /**
   * Check if approaching budget limit
   */
  isApproachingLimit(): { daily: boolean; monthly: boolean } {
    this.checkReset();

    return {
      daily: this.dailyBudget
        ? this.today >= this.dailyBudget * this.warningThreshold
        : false,
      monthly: this.monthlyBudget
        ? this.thisMonth >= this.monthlyBudget * this.warningThreshold
        : false,
    };
  }

  /**
   * Check if over budget
   */
  isOverBudget(): { daily: boolean; monthly: boolean } {
    this.checkReset();

    return {
      daily: this.dailyBudget ? this.today >= this.dailyBudget : false,
      monthly: this.monthlyBudget
        ? this.thisMonth >= this.monthlyBudget
        : false,
    };
  }

  /**
   * Get formatted cost string
   */
  formatCost(cost: number): string {
    if (cost < 0.01) {
      return `$${cost.toFixed(4)}`;
    }
    return `$${cost.toFixed(2)}`;
  }

  /**
   * Load state from storage
   */
  loadState(state: Partial<CostTracking>): void {
    if (state.today !== undefined) this.today = state.today;
    if (state.thisMonth !== undefined) this.thisMonth = state.thisMonth;
    if (state.allTime !== undefined) this.allTime = state.allTime;
    if (state.lastUpdated) this.lastUpdated = new Date(state.lastUpdated);

    // Check for resets after loading
    this.checkReset();
  }

  /**
   * Export state for storage
   */
  exportState(): CostTracking {
    return this.getTracking();
  }

  /**
   * Set budget limits
   */
  setBudget(daily?: number, monthly?: number): void {
    if (daily !== undefined) {
      this.dailyBudget = daily;
    } else {
      delete this.dailyBudget;
    }
    if (monthly !== undefined) {
      this.monthlyBudget = monthly;
    } else {
      delete this.monthlyBudget;
    }
  }

  /**
   * Get cost per model type summary
   */
  static summarizeUsage(usages: Array<{ model: string; tokens: TokenUsage }>): {
    totalCost: number;
    byModel: Record<string, { calls: number; tokens: number; cost: number }>;
  } {
    const byModel: Record<
      string,
      { calls: number; tokens: number; cost: number }
    > = {};
    let totalCost = 0;

    for (const usage of usages) {
      if (!byModel[usage.model]) {
        byModel[usage.model] = { calls: 0, tokens: 0, cost: 0 };
      }
      const modelEntry = byModel[usage.model];
      if (modelEntry) {
        modelEntry.calls++;
        modelEntry.tokens += usage.tokens.total ?? 0;
        modelEntry.cost += usage.tokens.cost ?? 0;
        totalCost += usage.tokens.cost ?? 0;
      }
    }

    return { totalCost, byModel };
  }
}
