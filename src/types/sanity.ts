/**
 * Sanity Checker type definitions for Ender
 * AI-specific mistake detection and prevention
 */

export interface Assumption {
  id: string;
  assumption: string;
  category: 'technical' | 'requirement' | 'environment' | 'user_intent';
  verified: boolean;
  verificationMethod?: string;
  verificationResult?: string;
  risk: 'high' | 'medium' | 'low';
  createdAt: Date;
  verifiedAt?: Date;
}

export interface TrackedInstruction {
  id: string;
  text: string;
  source: 'user' | 'approved_plan';
  timestamp: Date;
  priority: 'must' | 'should' | 'nice_to_have';
  status: 'pending' | 'complied' | 'violated' | 'partial' | 'not_applicable';
  evidence?: string;
  explanation?: string;
}

export interface InstructionComplianceReport {
  totalInstructions: number;
  complied: number;
  violated: number;
  partial: number;
  notApplicable: number;
  details: TrackedInstruction[];
  overallScore: number;
}

export interface RequestAlignmentCheck {
  originalRequest: string;
  currentOutput: string;
  alignment: {
    score: number;
    addressedGoals: string[];
    missedGoals: string[];
    extraWork: string[];
    driftExplanation?: string;
  };
}

export interface AssumptionLog {
  assumptions: Assumption[];
  unverifiedCount: number;
  highRiskCount: number;
}

export interface CompletionTracker {
  totalTasks: number;
  completed: number;
  inProgress: number;
  incomplete: CompletionItem[];
  blocked: CompletionItem[];
}

export interface CompletionItem {
  id: string;
  description: string;
  status: 'incomplete' | 'blocked';
  reason?: string;
  blockedBy?: string[];
}

export interface ConfidenceCalibration {
  initialConfidence: number;
  adjustedConfidence: number;
  adjustments: ConfidenceAdjustment[];
  requiresManualReview: boolean;
  reviewReason?: string;
}

export interface ConfidenceAdjustment {
  factor: string;
  impact: number;
  reason: string;
}

export interface HallucinationCheck {
  type: 'api' | 'import' | 'syntax' | 'type' | 'path' | 'config';
  target: string;
  exists: boolean;
  source?: string;
  suggestion?: string;
}

export interface SanityCheckResult {
  passed: boolean;
  timestamp: Date;
  duration: number;

  hallucinations: {
    checked: number;
    found: HallucinationCheck[];
  };

  instructionCompliance: InstructionComplianceReport;

  requestAlignment: RequestAlignmentCheck;

  assumptions: AssumptionLog;

  completion: CompletionTracker;

  confidence: ConfidenceCalibration;

  summary: string;
  recommendations: string[];
}

export interface VerificationCheckpoint {
  id: string;
  type: VerificationCheckpointType;
  title: string;
  reason: string;
  currentState: string;
  proposedAction: string;
  risks: string[];
  canSkip: boolean;
  userResponse?: 'proceed' | 'cancel' | 'modify';
  respondedAt?: Date;
}

export type VerificationCheckpointType =
  | 'before_destructive_operation'
  | 'before_external_call'
  | 'before_security_change'
  | 'before_database_change'
  | 'after_each_phase'
  | 'on_low_confidence'
  | 'on_assumption_made';

export interface DiffExplanation {
  file: string;
  changes: DiffChangeExplanation[];
  summary: {
    totalAdditions: number;
    totalDeletions: number;
    filesModified: number;
    riskLevel: 'low' | 'medium' | 'high';
    breakingChanges: boolean;
  };
}

export interface DiffChangeExplanation {
  type: 'addition' | 'modification' | 'deletion';
  location: string;
  technicalDiff: string;
  plainEnglish: string;
  reason: string;
  impact: string;
  dependencies: string[];
}

export interface DestructiveOperationConfirmation {
  operation: string;
  description: string;
  affectedItems: string[];
  canUndo: boolean;
  undoInstructions?: string;
  typedConfirmation?: string;
  confirmed: boolean;
  confirmedAt?: Date;
}

export interface AutoRollbackConfig {
  enabled: boolean;
  triggers: Array<
    'test_failure' | 'type_error' | 'lint_error' | 'runtime_error'
  >;
  behavior: 'rollback_immediately' | 'ask_user' | 'rollback_and_notify';
  preserveAttempt: boolean;
}

export interface AutoRollbackResult {
  triggered: boolean;
  trigger?: string;
  rolledBack: boolean;
  preservedAttemptId?: string;
  error?: string;
}
