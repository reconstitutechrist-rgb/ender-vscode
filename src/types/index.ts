/**
 * Ender Type Definitions
 * Central export for all types
 */

// Agent types
export * from './agents';

// Memory types
export * from './memory';

// Validator types
export * from './validators';

// Plan types
export * from './plans';

// Config types
export * from './config';

// Sanity checker types
export * from './sanity';

// Common utility types
export interface Result<T, E = Error> {
  success: boolean;
  data?: T;
  error?: E;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
  cost: number;
}

export interface CostTracking {
  today: number;
  thisMonth: number;
  allTime: number;
  lastUpdated: Date;
  budget?: {
    daily: number;
    monthly: number;
    dailyRemaining: number;
    monthlyRemaining: number;
    warningThreshold: number;
  };
}

export interface UndoEntry {
  id: string;
  sequence: number;
  actionType: string;
  filesBefore: FileSnapshot[];
  filesAfter: FileSnapshot[];
  description: string;
  createdAt: Date;
  planId?: string;
  phaseId?: string;
}

export interface FileSnapshot {
  path: string;
  content: string;
  hash: string;
  exists: boolean;
}

export interface SessionState {
  id: string;
  timestamp: Date;
  activePlan?: import('./plans').Plan;
  currentPhase?: number;
  pendingChanges: import('./agents').FileChange[];
  conversationHistory: import('./agents').ConversationMessage[];
  memorySnapshot: string[];
  lastSuccessfulAction: string;
  incompleteActions: string[];
}

export interface ExtensionState {
  initialized: boolean;
  workspaceFolder?: string;
  hasProject: boolean;
  apiKeyConfigured: boolean;
  activeAgents: import('./agents').AgentStatus[];
  currentTask?: string;
  queuedTasks: number;
  costTracking: CostTracking;
  sessionId: string;
}

// Event types
export type EnderEvent =
  | { type: 'agent_started'; agent: import('./agents').AgentType; task: string }
  | {
      type: 'agent_completed';
      agent: import('./agents').AgentType;
      result: import('./agents').AgentResult;
    }
  | { type: 'agent_error'; agent: import('./agents').AgentType; error: Error }
  | { type: 'plan_created'; plan: import('./plans').Plan }
  | { type: 'plan_approved'; planId: string }
  | { type: 'phase_started'; planId: string; phaseIndex: number }
  | { type: 'phase_completed'; planId: string; phaseIndex: number }
  | {
      type: 'validation_started';
      validators: import('./validators').ValidatorName[];
    }
  | {
      type: 'validation_completed';
      result: import('./validators').ValidationPipelineResult;
    }
  | { type: 'memory_updated'; entry: import('./memory').MemoryEntry }
  | {
      type: 'checkpoint_created';
      checkpoint: import('./validators').RollbackCheckpoint;
    }
  | { type: 'rollback_triggered'; checkpointId: string }
  | { type: 'cost_updated'; cost: CostTracking }
  | {
      type: 'approval_required';
      request: import('./plans').PlanApprovalRequest;
    }
  | {
      type: 'confirmation_required';
      checkpoint: import('./sanity').VerificationCheckpoint;
    };

export type EnderEventHandler = (event: EnderEvent) => void;
