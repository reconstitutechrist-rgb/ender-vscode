/**
 * Agent type definitions for Ender
 * 14 specialized agents coordinated by the Conductor
 */

export type AgentType =
  | 'conductor'
  | 'planner'
  | 'coder'
  | 'reviewer'
  | 'documenter'
  | 'researcher'
  | 'tester'
  | 'debugger'
  | 'git-manager'
  | 'memory-keeper'
  | 'hooks-agent'
  | 'integrations-agent'
  | 'infrastructure-agent'
  | 'sanity-checker';

export type ModelId = 
  | 'claude-opus-4-5-20251101'
  | 'claude-sonnet-4-5-20250929';

export interface AgentConfig {
  type: AgentType;
  model: ModelId;
  systemPrompt: string;
  capabilities: string[];
  maxTokens: number;
}

export interface AgentMessage {
  id: string;
  fromAgent: AgentType;
  toAgent: AgentType;
  timestamp: Date;
  type: 'request' | 'response' | 'error' | 'status';
  payload: AgentPayload;
}

export interface AgentPayload {
  task: string;
  context: ContextBundle;
  planReference?: string;
  confidence: number;
  files?: FileChange[];
  explanation?: string;
  metadata?: Record<string, unknown>;
}

export interface ContextBundle {
  relevantFiles: FileContent[];
  activeMemory: MemoryEntry[];
  currentPlan?: Plan;
  conversationHistory: ConversationMessage[];
  projectSettings: ProjectSettings;
  assumptions?: Assumption[];
  instructions?: TrackedInstruction[];
}

export interface FileContent {
  path: string;
  content: string;
  language: string;
  lastModified: Date;
}

export interface FileChange {
  path: string;
  content: string;
  operation: 'create' | 'update' | 'delete';
  diff?: string;
  explanation?: string;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  agent?: AgentType;
  metadata?: Record<string, unknown>;
}

export interface AgentStatus {
  agent: AgentType;
  status: 'idle' | 'working' | 'waiting' | 'error';
  currentTask?: string;
  progress?: number;
  lastActivity: Date;
}

export interface AgentResult {
  success: boolean;
  agent: AgentType;
  output?: string;
  files?: FileChange[];
  explanation?: string;
  confidence: number;
  tokensUsed: {
    input: number;
    output: number;
  };
  duration: number;
  errors?: AgentError[];
  warnings?: string[];
  nextAgent?: AgentType;
}

export interface AgentError {
  code: string;
  message: string;
  recoverable: boolean;
  suggestion?: string;
}

// Model routing configuration
export interface ModelRoutingConfig {
  opusRequired: TaskType[];
  sonnetSuitable: TaskType[];
  tokenThresholdForOpus: number;
  confidenceEscalationThreshold: number;
}

export type TaskType =
  | 'self_review'
  | 'architecture_decision'
  | 'complex_refactoring'
  | 'multi_file_changes'
  | 'breaking_change_analysis'
  | 'implementation_planning'
  | 'security_scanning'
  | 'debugging'
  | 'simple_question'
  | 'single_file_small_change'
  | 'syntax_formatting_fix'
  | 'documentation_generation'
  | 'quick_suggestion'
  | 'memory_summarization'
  | 'test_generation'
  | 'research_lookup'
  | 'hook_validation'
  | 'integration_check'
  | 'infrastructure_config'
  | 'sanity_check';

// Agent-specific interfaces
export interface ConductorDecision {
  selectedAgents: AgentType[];
  routingReason: string;
  estimatedComplexity: 'low' | 'medium' | 'high';
  requiresApproval: boolean;
  planId?: string;
}

export interface PlannerOutput {
  plan: Plan;
  estimatedTokens: number;
  estimatedDuration: string;
  risks: string[];
}

export interface CoderOutput {
  files: FileChange[];
  explanation: string;
  planStepCompleted: string;
  testsNeeded: boolean;
}

export interface ReviewerOutput {
  approved: boolean;
  validationResults: ValidationResult[];
  suggestions: string[];
  mustFix: string[];
}

export interface SanityCheckerOutput {
  passed: boolean;
  hallucinationsFound: HallucinationIssue[];
  instructionCompliance: InstructionComplianceReport;
  requestAlignment: RequestAlignmentReport;
  assumptionsVerified: AssumptionVerification[];
  completionStatus: CompletionStatus;
  adjustedConfidence: number;
}

export interface HallucinationIssue {
  type: 'api' | 'import' | 'syntax' | 'type' | 'path' | 'config';
  location: {
    file: string;
    line: number;
  };
  hallucinated: string;
  suggestion?: string;
}

export interface InstructionComplianceReport {
  totalInstructions: number;
  complied: number;
  violated: number;
  partial: number;
  details: Array<{
    instruction: string;
    status: 'complied' | 'violated' | 'partial' | 'not_applicable';
    evidence?: string;
  }>;
}

export interface RequestAlignmentReport {
  originalRequest: string;
  alignmentScore: number;
  addressedGoals: string[];
  missedGoals: string[];
  extraWork: string[];
  driftExplanation?: string;
}

export interface AssumptionVerification {
  assumption: string;
  verified: boolean;
  verificationMethod: string;
  result: string;
}

export interface CompletionStatus {
  totalTasks: number;
  completed: number;
  incomplete: string[];
  blocked: string[];
}

// Import from other type files
import type { MemoryEntry } from './memory';
import type { Plan } from './plans';
import type { ProjectSettings } from './config';
import type { ValidationResult } from './validators';
import type { Assumption, TrackedInstruction } from './sanity';
