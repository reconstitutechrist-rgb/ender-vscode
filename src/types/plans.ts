/**
 * Plan type definitions for Ender
 * Structured multi-phase implementation specifications
 */

export type PlanStatus = 'draft' | 'approved' | 'in_progress' | 'completed' | 'cancelled' | 'paused';

export type PhaseStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

export interface Plan {
  id: string;
  title: string;
  description: string;
  status: PlanStatus;
  phases: PlanPhase[];
  currentPhaseIndex: number;
  estimatedComplexity: 'low' | 'medium' | 'high';
  estimatedTokens: number;
  actualTokensUsed: number;
  affectedFiles: string[];
  createdAt: Date;
  approvedAt?: Date;
  completedAt?: Date;
  lockedAt?: Date;
  metadata: PlanMetadata;
}

export interface PlanPhase {
  id: string;
  planId: string;
  index: number;
  title: string;
  description: string;
  status: PhaseStatus;
  tasks: PlanTask[];
  affectedFiles: string[];
  estimatedTokens: number;
  actualTokensUsed: number;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface PlanTask {
  id: string;
  phaseId: string;
  description: string;
  type: TaskType;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  targetFile?: string;
  targetFunction?: string;
  expectedChanges?: string;
  actualChanges?: string;
  completedAt?: Date;
}

export interface PlanMetadata {
  originalRequest: string;
  assumptions: string[];
  risks: string[];
  dependencies: string[];
  testingStrategy?: string;
  rollbackPlan?: string;
}

export interface PlanLock {
  planId: string;
  lockedAt: Date;
  lockedBy: 'user' | 'conductor';
  allowedFiles: string[];
  allowedFunctions: Map<string, string[]>;
  checksum: string;
}

export interface PlanApprovalRequest {
  plan: Plan;
  confidence: number;
  explanation: string;
  warnings: string[];
  requiredConfirmations: ApprovalConfirmation[];
}

export interface ApprovalConfirmation {
  type: 'file_modification' | 'new_dependency' | 'breaking_change' | 'security_impact';
  description: string;
  acknowledged: boolean;
}

export interface PlanExecutionResult {
  planId: string;
  success: boolean;
  phasesCompleted: number;
  totalPhases: number;
  filesModified: string[];
  tokensUsed: number;
  duration: number;
  errors: PlanError[];
  rollbackAvailable: boolean;
}

export interface PlanError {
  phaseIndex: number;
  taskId?: string;
  error: string;
  recoverable: boolean;
  suggestion?: string;
}

export interface PlanDiff {
  planId: string;
  changes: Array<{
    phase: number;
    field: string;
    oldValue: unknown;
    newValue: unknown;
    reason: string;
  }>;
  requiresReapproval: boolean;
}

export interface PlanTemplate {
  id: string;
  name: string;
  description: string;
  phases: Omit<PlanPhase, 'id' | 'planId' | 'status' | 'actualTokensUsed' | 'startedAt' | 'completedAt'>[];
  applicableTo: string[];
  complexity: 'low' | 'medium' | 'high';
}

// Import from other type files
import type { TaskType } from './agents';
