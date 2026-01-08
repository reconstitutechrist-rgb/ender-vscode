/**
 * Validator type definitions for Ender
 * 29 validators across 6 stages
 */

export type ValidatorName =
  // Stage 1: Scope Validation (3)
  | 'scope-guard'
  | 'hallucination-detector'
  | 'change-size-monitor'
  // Stage 2: Code Quality (3)
  | 'syntax-validator'
  | 'best-practices'
  | 'security-scanner'
  // Stage 3: Integrity Checks (3)
  | 'type-integrity'
  | 'import-export'
  | 'test-preservation'
  // Stage 4: Plan Compliance (4)
  | 'plan-compliance'
  | 'breaking-change'
  | 'snapshot-diff'
  | 'rollback-checkpoint'
  // Stage 5: Specialist (8)
  | 'hook-rules-checker'
  | 'event-leak-detector'
  | 'api-contract-validator'
  | 'auth-flow-validator'
  | 'environment-consistency'
  | 'secrets-exposure-checker'
  | 'docker-best-practices'
  | 'cloud-config-validator'
  // Stage 6: AI Accuracy (8)
  | 'api-existence-validator'
  | 'dependency-verifier'
  | 'deprecation-detector'
  | 'style-matcher'
  | 'complexity-analyzer'
  | 'edge-case-checker'
  | 'refactor-completeness'
  | 'doc-sync-validator';

export type ValidatorStage =
  | 'scope'
  | 'quality'
  | 'integrity'
  | 'compliance'
  | 'specialist'
  | 'ai-accuracy';

export type ValidatorMode = 'strict' | 'fast' | 'custom' | 'integration-focus' | 'infrastructure-focus' | 'ai-accuracy-focus';

export type ValidatorSeverity = 'error' | 'warning' | 'info';

export interface ValidatorConfig {
  name: ValidatorName;
  stage: ValidatorStage;
  enabled: boolean;
  severity: ValidatorSeverity;
  options?: Record<string, unknown>;
}

export interface ValidationResult {
  validator: ValidatorName;
  passed: boolean;
  severity: ValidatorSeverity;
  issues: ValidationIssue[];
  duration: number;
  metadata?: Record<string, unknown>;
}

export interface ValidationIssue {
  file: string;
  line?: number;
  column?: number;
  message: string;
  severity: ValidatorSeverity;
  code?: string;
  suggestion?: string;
  autoFixAvailable?: boolean;
}

export interface ValidationPipelineResult {
  passed: boolean;
  results: ValidationResult[];
  totalIssues: number;
  errors: number;
  warnings: number;
  duration: number;
  checkpoint?: RollbackCheckpoint;
}

// Individual validator result types

// Stage 1: Scope Validation
export interface ScopeGuardResult extends ValidationResult {
  violations: Array<{
    file: string;
    reason: 'file_not_in_plan' | 'function_not_in_plan' | 'unexpected_addition';
    details: string;
  }>;
}

export interface HallucinationDetectorResult extends ValidationResult {
  unattributedCode: Array<{
    file: string;
    lineRange: [number, number];
    code: string;
    reason: 'no_plan_reference' | 'exceeds_plan_scope' | 'unspecified_functionality';
  }>;
}

export interface ChangeSizeMonitorResult extends ValidationResult {
  actualLines: number;
  actualFiles: number;
  expectedLines: number;
  expectedFiles: number;
  percentageOver: number;
  alert: 'none' | 'warning' | 'critical';
}

// Stage 2: Code Quality
export interface SyntaxValidatorResult extends ValidationResult {
  errors: Array<{
    file: string;
    line: number;
    column: number;
    message: string;
    severity: 'error' | 'warning';
  }>;
}

export interface BestPracticesResult extends ValidationResult {
  violations: Array<{
    file: string;
    line: number;
    rule: string;
    message: string;
    suggestion: string;
  }>;
}

export interface SecurityScannerResult extends ValidationResult {
  issues: Array<{
    file: string;
    line: number;
    severity: 'critical' | 'high' | 'medium' | 'low';
    type: 'hardcoded_secret' | 'sql_injection' | 'xss' | 'path_traversal' | 'other';
    description: string;
    recommendation: string;
  }>;
}

// Stage 3: Integrity Checks
export interface TypeIntegrityResult extends ValidationResult {
  errors: Array<{
    file: string;
    line: number;
    message: string;
    expectedType: string;
    actualType: string;
  }>;
}

export interface ImportExportResult extends ValidationResult {
  issues: Array<{
    file: string;
    type: 'broken_import' | 'missing_export' | 'circular_dependency';
    details: string;
    affectedFiles: string[];
  }>;
}

export interface TestPreservationResult extends ValidationResult {
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
  failures: Array<{
    testFile: string;
    testName: string;
    error: string;
  }>;
}

// Stage 4: Plan Compliance
export interface PlanComplianceResult extends ValidationResult {
  planStep: string;
  completionPercentage: number;
  missingElements: string[];
  extraElements: string[];
}

export interface BreakingChangeResult extends ValidationResult {
  breakingChanges: Array<{
    file: string;
    type: 'api_change' | 'type_change' | 'behavior_change' | 'removal';
    description: string;
    affectedConsumers: string[];
    migrationRequired: boolean;
  }>;
}

export interface SnapshotDiffResult extends ValidationResult {
  expectedChanges: FileChange[];
  actualChanges: FileChange[];
  unexpectedChanges: FileChange[];
  missingChanges: FileChange[];
}

export interface RollbackCheckpoint {
  id: string;
  timestamp: Date;
  type: 'git_stash' | 'file_backup';
  files: Array<{
    path: string;
    originalContent: string;
    hash: string;
  }>;
  planId?: string;
  phaseId?: string;
}

// Stage 5: Specialist Validators
export interface HookRulesResult extends ValidationResult {
  violations: Array<{
    file: string;
    line: number;
    hookName: string;
    rule: 'conditional_hook' | 'loop_hook' | 'wrong_order' | 'missing_deps' | 'invalid_name';
    framework: 'react' | 'vue' | 'svelte' | 'angular';
    message: string;
    suggestion: string;
  }>;
}

export interface EventLeakResult extends ValidationResult {
  leaks: Array<{
    file: string;
    line: number;
    eventType: 'dom_listener' | 'emitter_listener' | 'subscription' | 'interval' | 'timeout';
    registrationCode: string;
    missingCleanup: string;
    severity: 'high' | 'medium';
  }>;
}

export interface ApiContractResult extends ValidationResult {
  violations: Array<{
    file: string;
    line: number;
    apiName: string;
    endpoint: string;
    issue: 'wrong_method' | 'missing_param' | 'wrong_type' | 'deprecated_endpoint' | 'missing_auth';
    expected: string;
    actual: string;
    documentation?: string;
  }>;
}

export interface AuthFlowResult extends ValidationResult {
  issues: Array<{
    file: string;
    line: number;
    flowType: 'oauth' | 'jwt' | 'session' | 'api_key' | 'sso';
    issue: 'missing_refresh' | 'insecure_storage' | 'missing_validation' | 'exposed_token' | 'missing_logout';
    severity: 'critical' | 'high' | 'medium';
    description: string;
    recommendation: string;
  }>;
}

export interface EnvironmentConsistencyResult extends ValidationResult {
  issues: Array<{
    variable: string;
    issue: 'missing_in_env' | 'missing_in_code' | 'type_mismatch' | 'no_default';
    environments: string[];
    usedInFiles: string[];
    suggestion: string;
  }>;
}

export interface SecretsExposureResult extends ValidationResult {
  exposures: Array<{
    file: string;
    line: number;
    type: 'hardcoded' | 'logged' | 'committed' | 'exposed_in_error';
    secretType: 'api_key' | 'password' | 'token' | 'private_key' | 'connection_string';
    severity: 'critical';
    pattern: string;
    recommendation: string;
  }>;
}

export interface DockerBestPracticesResult extends ValidationResult {
  issues: Array<{
    file: string;
    line: number;
    rule: 'no_latest_tag' | 'missing_user' | 'secrets_in_build' | 'large_image' | 'no_healthcheck';
    severity: 'high' | 'medium' | 'low';
    description: string;
    recommendation: string;
  }>;
}

export interface CloudConfigResult extends ValidationResult {
  issues: Array<{
    file: string;
    line: number;
    provider: 'aws' | 'gcp' | 'azure' | 'vercel' | 'netlify';
    resource: string;
    issue: 'overly_permissive' | 'missing_encryption' | 'public_access' | 'no_logging' | 'invalid_config';
    severity: 'critical' | 'high' | 'medium';
    description: string;
    recommendation: string;
  }>;
}

// Stage 6: AI Accuracy Validators
export interface ApiExistenceResult extends ValidationResult {
  hallucinations: Array<{
    file: string;
    line: number;
    call: string;
    type: 'method' | 'function' | 'property' | 'class';
    sourcePackage?: string;
    suggestion?: string;
    documentation?: string;
  }>;
}

export interface DependencyVerifierResult extends ValidationResult {
  issues: Array<{
    file: string;
    line: number;
    importStatement: string;
    package: string;
    issue: 'not_installed' | 'not_in_package_json' | 'wrong_name' | 'deprecated_package';
    suggestion?: string;
  }>;
  missingPeerDeps: string[];
  versionMismatches: Array<{
    package: string;
    required: string;
    installed: string;
  }>;
}

export interface DeprecationResult extends ValidationResult {
  deprecations: Array<{
    file: string;
    line: number;
    deprecated: string;
    reason: string;
    replacement: string;
    deprecatedSince?: string;
    removalVersion?: string;
    autoFixAvailable: boolean;
  }>;
}

export interface StyleMatcherResult extends ValidationResult {
  inconsistencies: Array<{
    file: string;
    line: number;
    category: 'naming' | 'formatting' | 'structure' | 'patterns' | 'comments';
    existing: string;
    generated: string;
    suggestion: string;
  }>;
  detectedPatterns: {
    namingConvention: 'camelCase' | 'snake_case' | 'PascalCase' | 'mixed';
    quoteStyle: 'single' | 'double';
    semicolons: boolean;
    indentation: 'tabs' | 'spaces';
    indentSize: number;
    trailingCommas: boolean;
    importStyle: 'named' | 'default' | 'mixed';
    exportStyle: 'named' | 'default' | 'mixed';
    asyncStyle: 'async_await' | 'promises' | 'callbacks' | 'mixed';
    errorHandling: 'try_catch' | 'catch_chain' | 'result_type' | 'mixed';
  };
}

export interface ComplexityAnalyzerResult extends ValidationResult {
  issues: Array<{
    file: string;
    line: number;
    type: 'over_engineered' | 'under_engineered';
    description: string;
    complexity: {
      cyclomatic: number;
      cognitive: number;
      linesOfCode: number;
      dependencies: number;
    };
    suggestion: string;
    simplifiedVersion?: string;
    robustVersion?: string;
  }>;
}

export interface EdgeCaseResult extends ValidationResult {
  missingHandling: Array<{
    file: string;
    line: number;
    context: string;
    edgeCase: 'null_undefined' | 'empty_array' | 'empty_string' | 'zero' |
              'negative' | 'overflow' | 'network_error' | 'timeout' |
              'invalid_input' | 'concurrent_access' | 'file_not_found';
    risk: 'high' | 'medium' | 'low';
    suggestion: string;
    exampleCode?: string;
  }>;
}

export interface RefactorCompletenessResult extends ValidationResult {
  incompleteRefactors: Array<{
    type: 'rename' | 'move' | 'signature_change' | 'type_change' | 'deletion';
    original: string;
    updated: string;
    missedReferences: Array<{
      file: string;
      line: number;
      code: string;
    }>;
    affectedTests: string[];
    affectedDocs: string[];
  }>;
}

export interface DocSyncResult extends ValidationResult {
  outOfSync: Array<{
    type: 'jsdoc' | 'comment' | 'readme' | 'api_doc' | 'inline_comment';
    file: string;
    line: number;
    documentedBehavior: string;
    actualBehavior: string;
    suggestion: 'update_doc' | 'update_code' | 'remove_doc';
  }>;
  missingDocs: Array<{
    file: string;
    symbol: string;
    type: 'function' | 'class' | 'interface' | 'export';
    complexity: number;
  }>;
}

// Import from other type files
import type { FileChange } from './agents';
