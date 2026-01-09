/**
 * Plan Manager for Ender
 * Manages plan lifecycle: creation, approval, execution, completion
 */

import { generateId, logger } from '../utils';
import type {
  Plan,
  PlanPhase,
  PhaseStatus,
  PlanLock,
  PlanApprovalRequest,
  PlanExecutionResult,
  PlanError,
  TaskType,
} from '../types';
import { plannerAgent } from '../agents/planner';

export interface CreatePlanParams {
  title: string;
  description: string;
  phases: Array<{
    title: string;
    description: string;
    tasks: Array<{
      description: string;
      type: TaskType;
      targetFile?: string;
      expectedChanges?: string;
    }>;
    affectedFiles: string[];
  }>;
  originalRequest: string;
  assumptions?: string[];
  risks?: string[];
}

export class PlanManager {
  private plans: Map<string, Plan> = new Map();
  private activePlan: Plan | null = null;
  private planLock: PlanLock | null = null;

  /**
   * Create a new plan
   */
  createPlan(params: CreatePlanParams): Plan {
    const planId = generateId();
    const now = new Date();

    const phases: PlanPhase[] = params.phases.map((p, index) => ({
      id: generateId(),
      planId,
      index,
      title: p.title,
      description: p.description,
      status: 'pending' as PhaseStatus,
      tasks: p.tasks.map((t) => {
        const task: {
          id: string;
          phaseId: string;
          description: string;
          type: TaskType;
          status: 'pending';
          targetFile?: string;
          expectedChanges?: string;
        } = {
          id: generateId(),
          phaseId: '',
          description: t.description,
          type: t.type,
          status: 'pending',
        };
        if (t.targetFile) {
          task.targetFile = t.targetFile;
        }
        if (t.expectedChanges) {
          task.expectedChanges = t.expectedChanges;
        }
        return task;
      }),
      affectedFiles: p.affectedFiles,
      estimatedTokens: this.estimatePhaseTokens(p),
      actualTokensUsed: 0,
    }));

    // Update phase IDs in tasks
    for (const phase of phases) {
      for (const task of phase.tasks) {
        task.phaseId = phase.id;
      }
    }

    const allAffectedFiles = [
      ...new Set(phases.flatMap((p) => p.affectedFiles)),
    ];

    const plan: Plan = {
      id: planId,
      title: params.title,
      description: params.description,
      status: 'draft',
      phases,
      currentPhaseIndex: 0,
      estimatedComplexity: this.estimateComplexity(phases),
      estimatedTokens: phases.reduce((sum, p) => sum + p.estimatedTokens, 0),
      actualTokensUsed: 0,
      affectedFiles: allAffectedFiles,
      createdAt: now,
      metadata: {
        originalRequest: params.originalRequest,
        assumptions: params.assumptions ?? [],
        risks: params.risks ?? [],
        dependencies: [],
      },
    };

    this.plans.set(planId, plan);
    logger.info(`Plan created: ${planId}`, 'PlanManager', {
      title: params.title,
    });

    return plan;
  }

  /**
   * Get plan by ID
   */
  getPlan(planId: string): Plan | undefined {
    return this.plans.get(planId);
  }

  /**
   * Get active plan
   */
  getActivePlan(): Plan | null {
    return this.activePlan;
  }

  /**
   * Request plan approval
   */
  requestApproval(planId: string): PlanApprovalRequest | null {
    const plan = this.plans.get(planId);
    if (!plan) return null;

    const warnings: string[] = [];
    const requiredConfirmations: PlanApprovalRequest['requiredConfirmations'] =
      [];

    // Check for breaking changes
    if (
      plan.phases.some((p) =>
        p.affectedFiles.some((f) => f.includes('index') || f.includes('main')),
      )
    ) {
      warnings.push('This plan modifies entry point files');
      requiredConfirmations.push({
        type: 'file_modification',
        description: 'Entry point files will be modified',
        acknowledged: false,
      });
    }

    // Check for security-related changes
    if (
      plan.affectedFiles.some((f) => /auth|security|token|password/i.test(f))
    ) {
      warnings.push('This plan modifies security-related files');
      requiredConfirmations.push({
        type: 'security_impact',
        description: 'Security-related files will be modified',
        acknowledged: false,
      });
    }

    // Calculate confidence based on complexity
    let confidence = 95;
    if (plan.estimatedComplexity === 'high') confidence -= 15;
    if (plan.estimatedComplexity === 'medium') confidence -= 5;
    if (plan.metadata.risks.length > 0)
      confidence -= plan.metadata.risks.length * 3;

    return {
      plan,
      confidence: Math.max(50, confidence),
      explanation: this.generatePlanExplanation(plan),
      warnings,
      requiredConfirmations,
    };
  }

  /**
   * Approve a plan
   */
  approvePlan(planId: string): boolean {
    const plan = this.plans.get(planId);
    if (!plan || plan.status !== 'draft') return false;

    // Validate plan before approval
    const validation = plannerAgent.validatePlan(plan);
    if (!validation.valid) {
      logger.error('Plan validation failed', 'PlanManager', {
        issues: validation.issues,
      });
      return false;
    }

    plan.status = 'approved';
    plan.approvedAt = new Date();
    this.activePlan = plan;

    // Create plan lock
    this.planLock = {
      planId,
      lockedAt: new Date(),
      lockedBy: 'user',
      allowedFiles: plan.affectedFiles,
      allowedFunctions: new Map(),
      checksum: this.calculatePlanChecksum(plan),
    };

    logger.info(`Plan approved: ${planId}`, 'PlanManager');
    return true;
  }

  /**
   * Start plan execution
   */
  startExecution(planId: string): boolean {
    const plan = this.plans.get(planId);
    if (!plan || plan.status !== 'approved') return false;

    plan.status = 'in_progress';

    // Start first phase
    const firstPhase = plan.phases[0];
    if (firstPhase) {
      firstPhase.status = 'in_progress';
      firstPhase.startedAt = new Date();
    }

    logger.info(`Plan execution started: ${planId}`, 'PlanManager');
    return true;
  }

  /**
   * Complete current phase and move to next
   */
  completePhase(planId: string, tokensUsed: number): PlanPhase | null {
    const plan = this.plans.get(planId);
    if (!plan || plan.status !== 'in_progress') return null;

    const currentPhase = plan.phases[plan.currentPhaseIndex];
    if (!currentPhase) return null;

    // Mark all tasks as completed before advancing
    for (const task of currentPhase.tasks) {
      task.status = 'completed';
      task.completedAt = new Date();
    }

    logger.info(`Phase completed: ${currentPhase.title}`, 'PlanManager');

    // Use planner's advancePlan to handle phase advancement
    const updatedPlan = plannerAgent.advancePlan(plan, tokensUsed);
    this.plans.set(planId, updatedPlan);
    this.activePlan = updatedPlan;

    // Check if plan is completed
    if (updatedPlan.status === 'completed') {
      this.activePlan = null;
      this.planLock = null;
      logger.info(`Plan completed: ${planId}`, 'PlanManager');
      return null;
    }

    // Start next phase
    const nextPhase = updatedPlan.phases[updatedPlan.currentPhaseIndex];
    if (nextPhase) {
      nextPhase.status = 'in_progress';
      nextPhase.startedAt = new Date();
      return nextPhase;
    }

    return null;
  }

  /**
   * Fail a phase
   */
  failPhase(planId: string, error: string): void {
    const plan = this.plans.get(planId);
    if (!plan) return;

    const currentPhase = plan.phases[plan.currentPhaseIndex];
    if (currentPhase) {
      currentPhase.status = 'failed';
      currentPhase.error = error;
    }

    plan.status = 'paused';
    logger.error(`Phase failed: ${currentPhase?.title}`, 'PlanManager', {
      error,
    });
  }

  /**
   * Cancel a plan
   */
  cancelPlan(planId: string): boolean {
    const plan = this.plans.get(planId);
    if (!plan) return false;

    plan.status = 'cancelled';

    if (this.activePlan?.id === planId) {
      this.activePlan = null;
      this.planLock = null;
    }

    logger.info(`Plan cancelled: ${planId}`, 'PlanManager');
    return true;
  }

  /**
   * Get current phase
   */
  getCurrentPhase(planId: string): PlanPhase | null {
    const plan = this.plans.get(planId);
    if (!plan) return null;
    return plan.phases[plan.currentPhaseIndex] ?? null;
  }

  /**
   * Check if file is allowed by plan lock
   */
  isFileAllowed(filePath: string): boolean {
    if (!this.planLock) return true;
    return this.planLock.allowedFiles.includes(filePath);
  }

  /**
   * Get plan lock
   */
  getPlanLock(): PlanLock | null {
    return this.planLock;
  }

  /**
   * Get execution result
   */
  getExecutionResult(planId: string): PlanExecutionResult | null {
    const plan = this.plans.get(planId);
    if (!plan) return null;

    const errors: PlanError[] = [];

    for (let i = 0; i < plan.phases.length; i++) {
      const phase = plan.phases[i];
      if (phase?.status === 'failed' && phase.error) {
        errors.push({
          phaseIndex: i,
          error: phase.error,
          recoverable: true,
        });
      }
    }

    return {
      planId,
      success: plan.status === 'completed',
      phasesCompleted: plan.phases.filter((p) => p.status === 'completed')
        .length,
      totalPhases: plan.phases.length,
      filesModified: plan.affectedFiles,
      tokensUsed: plan.actualTokensUsed,
      duration: plan.completedAt
        ? plan.completedAt.getTime() - (plan.approvedAt?.getTime() ?? 0)
        : 0,
      errors,
      rollbackAvailable: true,
    };
  }

  /**
   * Generate plain English explanation of plan
   */
  private generatePlanExplanation(plan: Plan): string {
    const lines: string[] = [];

    lines.push(`I'm going to ${plan.description.toLowerCase()}.`);
    lines.push('');
    lines.push("Here's what I'll do:");

    for (let i = 0; i < plan.phases.length; i++) {
      const phase = plan.phases[i];
      if (!phase) continue;
      lines.push(`${i + 1}. ${phase.title}: ${phase.description}`);
    }

    if (plan.metadata.assumptions.length > 0) {
      lines.push('');
      lines.push("I'm assuming:");
      for (const assumption of plan.metadata.assumptions) {
        lines.push(`• ${assumption}`);
      }
    }

    if (plan.metadata.risks.length > 0) {
      lines.push('');
      lines.push('Potential risks:');
      for (const risk of plan.metadata.risks) {
        lines.push(`• ${risk}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Estimate phase tokens
   */
  private estimatePhaseTokens(phase: {
    tasks: Array<unknown>;
    affectedFiles: string[];
  }): number {
    const baseTokens = 2000;
    const perTask = 500;
    const perFile = 1000;

    return (
      baseTokens +
      phase.tasks.length * perTask +
      phase.affectedFiles.length * perFile
    );
  }

  /**
   * Estimate plan complexity
   */
  private estimateComplexity(phases: PlanPhase[]): 'low' | 'medium' | 'high' {
    const totalTasks = phases.reduce((sum, p) => sum + p.tasks.length, 0);
    const totalFiles = new Set(phases.flatMap((p) => p.affectedFiles)).size;

    if (totalTasks > 10 || totalFiles > 5 || phases.length > 4) return 'high';
    if (totalTasks > 5 || totalFiles > 3 || phases.length > 2) return 'medium';
    return 'low';
  }

  /**
   * Calculate plan checksum for lock
   */
  private calculatePlanChecksum(plan: Plan): string {
    const content = JSON.stringify({
      id: plan.id,
      phases: plan.phases.map((p) => ({
        title: p.title,
        tasks: p.tasks.map((t) => t.description),
      })),
      affectedFiles: plan.affectedFiles,
    });

    // Simple hash
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  /**
   * Clear all plans (for testing)
   */
  clearAll(): void {
    this.plans.clear();
    this.activePlan = null;
    this.planLock = null;
  }
}

// Singleton instance
export const planManager = new PlanManager();
