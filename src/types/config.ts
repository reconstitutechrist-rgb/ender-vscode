/**
 * Configuration type definitions for Ender
 * Global and project-level settings
 */

export interface GlobalConfig {
  version: string;
  apiKey: ApiKeyConfig;
  models: ModelConfig;
  defaults: DefaultSettings;
  ui: UiSettings;
  telemetry: TelemetrySettings;
  sessionRecovery: SessionRecoverySettings;
  undoStack: UndoStackSettings;
  sensitiveFilePatterns: string[];
}

export interface ApiKeyConfig {
  source: 'user' | 'bundled';
  value?: string;
}

export interface ModelConfig {
  smart: string;
  fast: string;
}

export interface DefaultSettings {
  approvalMode: ApprovalMode;
  approvalGranularity: ApprovalGranularity;
  confidenceThreshold: number;
  validatorMode: ValidatorMode;
  contextBudget: ContextBudget;
}

export type ApprovalMode = 'automatic' | 'manual' | 'hybrid';

export interface ApprovalGranularity {
  entirePlan: boolean;
  perPhase: boolean;
  perFile: boolean;
}

export interface ContextBudget {
  maxTokens: number;
  reserveForResponse: number;
}

export interface UiSettings {
  showAgentIndicator: boolean;
  showCostTracker: boolean;
  showContextUsage: boolean;
}

export interface TelemetrySettings {
  enabled: boolean;
  anonymousId?: string;
}

export interface SessionRecoverySettings {
  enabled: boolean;
  intervalSeconds: number;
}

export interface UndoStackSettings {
  maxLevels: number;
}

export interface ProjectConfig {
  version: string;
  projectName: string;
  techStack: string[];
  overrides?: Partial<DefaultSettings>;
  behavior: BehaviorSettings;
  customRules: string[];
  documentation: DocumentationConfig;
  costLimits: CostLimits;
}

export interface BehaviorSettings {
  verbosity: 'concise' | 'normal' | 'detailed';
  codingStyle: 'functional' | 'oop' | 'mixed';
  commentLevel: 'minimal' | 'moderate' | 'verbose';
}

export interface DocumentationConfig {
  context7Libraries: string[];
  customDocs: CustomDoc[];
}

export interface CustomDoc {
  name: string;
  url: string;
}

export interface CostLimits {
  dailyBudget: number;
  monthlyBudget: number;
  warnAt: number;
}

export interface ProjectSettings {
  global: GlobalConfig;
  project?: ProjectConfig;
  effective: EffectiveSettings;
}

export interface EffectiveSettings {
  approvalMode: ApprovalMode;
  approvalGranularity: ApprovalGranularity;
  confidenceThreshold: number;
  validatorMode: ValidatorMode;
  contextBudget: ContextBudget;
  verbosity: 'concise' | 'normal' | 'detailed';
  codingStyle: 'functional' | 'oop' | 'mixed';
  commentLevel: 'minimal' | 'moderate' | 'verbose';
  customRules: string[];
  sensitiveFilePatterns: string[];
  costLimits?: CostLimits;
}

export interface RuntimeVerificationConfig {
  enabled: boolean;
  mode: 'sandbox' | 'tests_only' | 'full';
  sandbox: {
    timeout: number;
    memoryLimit: number;
    networkAccess: boolean;
    fileSystemAccess: 'none' | 'read_only' | 'temp_only';
  };
  testsOnly: {
    runExisting: boolean;
    runGenerated: boolean;
    coverageThreshold: number;
  };
  full: {
    confirmBefore: boolean;
  };
}

export interface ShowYourWorkConfig {
  enabled: boolean;
  verbosity: 'minimal' | 'moderate' | 'detailed';
  showFor: Array<'planning' | 'coding' | 'debugging' | 'all'>;
}

export interface DestructiveOperationConfig {
  requireConfirmation: DestructiveOperationType[];
  typedConfirmationFor: DestructiveOperationType[];
}

export type DestructiveOperationType =
  | 'file_deletion'
  | 'bulk_modification'
  | 'database_migration'
  | 'dependency_removal'
  | 'config_change'
  | 'security_setting_change'
  | 'git_force_push'
  | 'branch_deletion';

// Import from other type files
import type { ValidatorMode } from './validators';
