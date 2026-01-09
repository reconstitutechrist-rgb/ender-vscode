/**
 * Completion Tracker
 * Tracks progress of plan execution and identifies incomplete work
 */

import type { ContextBundle, CompletionStatus, FileChange } from '../types';

export class CompletionTracker {
  /**
   * Check completion status
   */
  async check(
    changes: FileChange[],
    context: ContextBundle,
  ): Promise<CompletionStatus> {
    const plan = context.currentPlan;
    if (!plan) {
      // Without a plan, we assume single task is completed if changes exist
      return {
        totalTasks: 1,
        completed: changes.length > 0 ? 1 : 0,
        incomplete: changes.length === 0 ? ['Task execution'] : [],
        blocked: [],
      };
    }

    const totalTasks = plan.phases.reduce((sum, p) => sum + p.tasks.length, 0);
    const completedTasks = plan.phases.reduce(
      (sum, p) => sum + p.tasks.filter((t) => t.status === 'completed').length,
      0,
    );

    const incomplete: string[] = [];
    const blocked: string[] = [];

    // Analyze current phase
    const currentPhase = plan.phases[plan.currentPhaseIndex];
    if (currentPhase) {
      currentPhase.tasks.forEach((t) => {
        if (t.status === 'pending' || t.status === 'in_progress') {
          incomplete.push(t.description);
        } else if (t.status === 'failed') {
          blocked.push(t.description);
        }
      });
    }

    // Add future phases
    for (let i = plan.currentPhaseIndex + 1; i < plan.phases.length; i++) {
      plan.phases[i]?.tasks.forEach((t) => incomplete.push(t.description));
    }

    return {
      totalTasks,
      completed: completedTasks,
      incomplete,
      blocked,
    };
  }
}

export const completionTracker = new CompletionTracker();
