/**
 * Phase Executor
 * Handles the execution of individual plan phases and their tasks
 */

import { logger } from '../utils';
import type { PlanPhase, PlanTask, AgentResult } from '../types';

export interface PhaseExecutionResult {
  success: boolean;
  phaseId: string;
  completedTasks: string[];
  failedTasks: string[];
  tokensUsed: number;
  error?: string;
}

export class PhaseExecutor {
  /**
   * Execute a single phase
   * Note: This is a high-level orchestration method.
   * Actual work is done by agents calling back to update status.
   */
  async executePhase(
    phase: PlanPhase,
    taskExecutor: (task: PlanTask) => Promise<AgentResult>,
  ): Promise<PhaseExecutionResult> {
    logger.info(`Executing phase: ${phase.title}`, 'PhaseExecutor');

    let tokensUsed = 0;
    const completedTasks: string[] = [];
    const failedTasks: string[] = [];

    // Execute tasks sequentially
    for (const task of phase.tasks) {
      if (task.status === 'completed') continue;

      logger.info(`Starting task: ${task.description}`, 'PhaseExecutor');
      task.status = 'in_progress';
      task.startedAt = new Date();

      try {
        const result = await taskExecutor(task);
        tokensUsed += result.tokensUsed.input + result.tokensUsed.output;

        if (result.success) {
          task.status = 'completed';
          task.completedAt = new Date();
          completedTasks.push(task.id);
          logger.info(`Task completed: ${task.description}`, 'PhaseExecutor');
        } else {
          task.status = 'failed';
          task.error = result.errors?.[0]?.message ?? 'Unknown error';
          failedTasks.push(task.id);
          logger.error(`Task failed: ${task.description}`, 'PhaseExecutor', {
            error: task.error,
          });

          // Stop phase on failure
          return {
            success: false,
            phaseId: phase.id,
            completedTasks,
            failedTasks,
            tokensUsed,
            error: `Task failed: ${task.description}`,
          };
        }
      } catch (error) {
        task.status = 'failed';
        task.error = error instanceof Error ? error.message : String(error);
        failedTasks.push(task.id);
        logger.error(
          `Task execution error: ${task.description}`,
          'PhaseExecutor',
          { error },
        );

        return {
          success: false,
          phaseId: phase.id,
          completedTasks,
          failedTasks,
          tokensUsed,
          error: `Task execution error: ${task.error}`,
        };
      }
    }

    return {
      success: true,
      phaseId: phase.id,
      completedTasks,
      failedTasks,
      tokensUsed,
    };
  }

  /**
   * Update task status manually
   */
  updateTaskStatus(
    phase: PlanPhase,
    taskId: string,
    status: PlanTask['status'],
    error?: string,
  ): void {
    const task = phase.tasks.find((t) => t.id === taskId);
    if (task) {
      task.status = status;
      if (status === 'completed') task.completedAt = new Date();
      if (status === 'in_progress' && !task.startedAt)
        task.startedAt = new Date();
      if (error) task.error = error;
    }
  }
}

export const phaseExecutor = new PhaseExecutor();
