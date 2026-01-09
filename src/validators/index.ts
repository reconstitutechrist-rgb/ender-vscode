/**
 * Validators Index for Ender
 * Exports all 29 validators and provides validation pipeline
 */

import { logger } from '../utils';
import type {
  ValidatorName,
  ValidatorMode,
  ValidationPipelineResult,
  ValidationResult,
  RollbackCheckpoint,
} from '../types';

// Base validator
export { BaseValidator, type ValidatorContext } from './base-validator';

// Stage 1: Scope Validation
export {
  ScopeGuardValidator,
  HallucinationDetectorValidator,
  ChangeSizeMonitorValidator,
} from './scope-validators';

// Stage 2: Code Quality
export {
  SyntaxValidator,
  BestPracticesValidator,
  SecurityScannerValidator,
} from './quality-validators';

// Stage 3: Integrity Checks
export {
  TypeIntegrityValidator,
  ImportExportValidator,
  TestPreservationValidator,
} from './integrity-validators';

// Stage 4: Plan Compliance
export {
  PlanComplianceValidator,
  BreakingChangeValidator,
  SnapshotDiffValidator,
  RollbackCheckpointValidator,
} from './compliance-validators';

// Stage 5: Specialist Validators
export {
  HookRulesCheckerValidator,
  EventLeakDetectorValidator,
  ApiContractValidatorValidator,
  AuthFlowValidatorValidator,
  EnvironmentConsistencyValidator,
  SecretsExposureCheckerValidator,
  DockerBestPracticesValidator,
  CloudConfigValidatorValidator,
} from './specialist-validators';

// Stage 6: AI Accuracy Validators
export {
  ApiExistenceValidator,
  DependencyVerifierValidator,
  DeprecationDetectorValidator,
  StyleMatcherValidator,
  ComplexityAnalyzerValidator,
  EdgeCaseCheckerValidator,
  RefactorCompletenessValidator,
  DocSyncValidatorValidator,
} from './ai-accuracy-validators';

// Import all validators for pipeline
import {
  ScopeGuardValidator,
  HallucinationDetectorValidator,
  ChangeSizeMonitorValidator,
} from './scope-validators';
import {
  SyntaxValidator,
  BestPracticesValidator,
  SecurityScannerValidator,
} from './quality-validators';
import {
  TypeIntegrityValidator,
  ImportExportValidator,
  TestPreservationValidator,
} from './integrity-validators';
import {
  PlanComplianceValidator,
  BreakingChangeValidator,
  SnapshotDiffValidator,
  RollbackCheckpointValidator,
} from './compliance-validators';
import {
  HookRulesCheckerValidator,
  EventLeakDetectorValidator,
  ApiContractValidatorValidator,
  AuthFlowValidatorValidator,
  EnvironmentConsistencyValidator,
  SecretsExposureCheckerValidator,
  DockerBestPracticesValidator,
  CloudConfigValidatorValidator,
} from './specialist-validators';
import {
  ApiExistenceValidator,
  DependencyVerifierValidator,
  DeprecationDetectorValidator,
  StyleMatcherValidator,
  ComplexityAnalyzerValidator,
  EdgeCaseCheckerValidator,
  RefactorCompletenessValidator,
  DocSyncValidatorValidator,
} from './ai-accuracy-validators';
import { BaseValidator, ValidatorContext } from './base-validator';

/**
 * Validator mode configurations
 */
const VALIDATOR_MODES: Record<ValidatorMode, ValidatorName[]> = {
  strict: [
    // All 29 validators
    'scope-guard',
    'hallucination-detector',
    'change-size-monitor',
    'syntax-validator',
    'best-practices',
    'security-scanner',
    'type-integrity',
    'import-export',
    'test-preservation',
    'plan-compliance',
    'breaking-change',
    'snapshot-diff',
    'rollback-checkpoint',
    'hook-rules-checker',
    'event-leak-detector',
    'api-contract-validator',
    'auth-flow-validator',
    'environment-consistency',
    'secrets-exposure-checker',
    'docker-best-practices',
    'cloud-config-validator',
    'api-existence-validator',
    'dependency-verifier',
    'deprecation-detector',
    'style-matcher',
    'complexity-analyzer',
    'edge-case-checker',
    'refactor-completeness',
    'doc-sync-validator',
  ],
  fast: [
    // Essential validators only
    'syntax-validator',
    'type-integrity',
    'import-export',
    'scope-guard',
    'hook-rules-checker',
    'api-existence-validator',
  ],
  custom: [],
  'integration-focus': [
    // Core + integration validators
    'scope-guard',
    'hallucination-detector',
    'change-size-monitor',
    'syntax-validator',
    'best-practices',
    'security-scanner',
    'type-integrity',
    'import-export',
    'test-preservation',
    'plan-compliance',
    'breaking-change',
    'snapshot-diff',
    'rollback-checkpoint',
    'api-contract-validator',
    'auth-flow-validator',
    'secrets-exposure-checker',
  ],
  'infrastructure-focus': [
    // Core + infrastructure validators
    'scope-guard',
    'hallucination-detector',
    'change-size-monitor',
    'syntax-validator',
    'best-practices',
    'security-scanner',
    'type-integrity',
    'import-export',
    'test-preservation',
    'plan-compliance',
    'breaking-change',
    'snapshot-diff',
    'rollback-checkpoint',
    'environment-consistency',
    'docker-best-practices',
    'cloud-config-validator',
  ],
  'ai-accuracy-focus': [
    // Core + all AI accuracy validators
    'scope-guard',
    'hallucination-detector',
    'change-size-monitor',
    'syntax-validator',
    'best-practices',
    'security-scanner',
    'type-integrity',
    'import-export',
    'test-preservation',
    'plan-compliance',
    'breaking-change',
    'snapshot-diff',
    'rollback-checkpoint',
    'api-existence-validator',
    'dependency-verifier',
    'deprecation-detector',
    'style-matcher',
    'complexity-analyzer',
    'edge-case-checker',
    'refactor-completeness',
    'doc-sync-validator',
  ],
};

/**
 * Create validator instance by name
 */
function createValidator(name: ValidatorName): BaseValidator {
  const validators: Record<ValidatorName, new () => BaseValidator> = {
    'scope-guard': ScopeGuardValidator,
    'hallucination-detector': HallucinationDetectorValidator,
    'change-size-monitor': ChangeSizeMonitorValidator,
    'syntax-validator': SyntaxValidator,
    'best-practices': BestPracticesValidator,
    'security-scanner': SecurityScannerValidator,
    'type-integrity': TypeIntegrityValidator,
    'import-export': ImportExportValidator,
    'test-preservation': TestPreservationValidator,
    'plan-compliance': PlanComplianceValidator,
    'breaking-change': BreakingChangeValidator,
    'snapshot-diff': SnapshotDiffValidator,
    'rollback-checkpoint': RollbackCheckpointValidator,
    'hook-rules-checker': HookRulesCheckerValidator,
    'event-leak-detector': EventLeakDetectorValidator,
    'api-contract-validator': ApiContractValidatorValidator,
    'auth-flow-validator': AuthFlowValidatorValidator,
    'environment-consistency': EnvironmentConsistencyValidator,
    'secrets-exposure-checker': SecretsExposureCheckerValidator,
    'docker-best-practices': DockerBestPracticesValidator,
    'cloud-config-validator': CloudConfigValidatorValidator,
    'api-existence-validator': ApiExistenceValidator,
    'dependency-verifier': DependencyVerifierValidator,
    'deprecation-detector': DeprecationDetectorValidator,
    'style-matcher': StyleMatcherValidator,
    'complexity-analyzer': ComplexityAnalyzerValidator,
    'edge-case-checker': EdgeCaseCheckerValidator,
    'refactor-completeness': RefactorCompletenessValidator,
    'doc-sync-validator': DocSyncValidatorValidator,
  };

  const ValidatorClass = validators[name];
  if (!ValidatorClass) {
    throw new Error(`Unknown validator: ${name}`);
  }

  return new ValidatorClass();
}

/**
 * Validation Pipeline
 * Runs validators based on mode and returns results
 */
export class ValidationPipeline {
  private validators: Map<ValidatorName, BaseValidator> = new Map();
  private mode: ValidatorMode = 'strict';
  private customValidators: ValidatorName[] = [];

  constructor(mode: ValidatorMode = 'strict') {
    this.mode = mode;
    this.initializeValidators();
  }

  /**
   * Initialize all validators
   */
  private initializeValidators(): void {
    // Initialize all validators that might be needed
    const allValidators: ValidatorName[] = VALIDATOR_MODES.strict;

    for (const name of allValidators) {
      this.validators.set(name, createValidator(name));
    }
  }

  /**
   * Set validation mode
   */
  setMode(mode: ValidatorMode): void {
    this.mode = mode;
  }

  /**
   * Set custom validator list
   */
  setCustomValidators(validators: ValidatorName[]): void {
    this.customValidators = validators;
    this.mode = 'custom';
  }

  /**
   * Get validators to run based on mode
   */
  private getValidatorsToRun(): ValidatorName[] {
    if (this.mode === 'custom') {
      return this.customValidators;
    }
    return VALIDATOR_MODES[this.mode];
  }

  /**
   * Configure a specific validator
   */
  configureValidator(
    name: ValidatorName,
    options: Record<string, unknown>,
  ): void {
    const validator = this.validators.get(name);
    if (validator) {
      validator.configure({ options });
    }
  }

  /**
   * Run the validation pipeline
   */
  async run(context: ValidatorContext): Promise<ValidationPipelineResult> {
    const startTime = Date.now();
    const results: ValidationResult[] = [];
    const validatorsToRun = this.getValidatorsToRun();
    let checkpoint: RollbackCheckpoint | undefined;

    logger.info(
      `Running validation pipeline (${this.mode} mode, ${validatorsToRun.length} validators)`,
      'Validation',
    );

    for (const name of validatorsToRun) {
      const validator = this.validators.get(name);
      if (!validator || !validator.isEnabled()) continue;

      try {
        const result = await validator.run(context);
        results.push(result);

        // Get checkpoint from rollback validator
        if (
          name === 'rollback-checkpoint' &&
          validator instanceof RollbackCheckpointValidator
        ) {
          checkpoint = validator.getCheckpoint() ?? undefined;
        }

        // Stop early on critical errors
        if (!result.passed && result.severity === 'error') {
          const hasSecurityIssue = result.issues.some(
            (i) => i.code?.startsWith('SEC_') || i.code?.startsWith('SECRET_'),
          );
          if (hasSecurityIssue) {
            logger.warn(
              'Validation stopped early due to security issue',
              'Validation',
            );
            break;
          }
        }
      } catch (error) {
        logger.error(`Validator ${name} failed`, 'Validation', error);
        results.push({
          validator: name,
          passed: false,
          severity: 'error',
          issues: [
            {
              file: '',
              message: `Validator error: ${error instanceof Error ? error.message : String(error)}`,
              severity: 'error',
            },
          ],
          duration: 0,
        });
      }
    }

    const duration = Date.now() - startTime;
    const passed = results.every((r) => r.passed || r.severity !== 'error');
    const errors = results.reduce(
      (sum, r) => sum + r.issues.filter((i) => i.severity === 'error').length,
      0,
    );
    const warnings = results.reduce(
      (sum, r) => sum + r.issues.filter((i) => i.severity === 'warning').length,
      0,
    );
    const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);

    logger.info(
      `Validation complete: ${passed ? 'PASSED' : 'FAILED'} (${errors} errors, ${warnings} warnings)`,
      'Validation',
    );

    const pipelineResult: ValidationPipelineResult = {
      passed,
      results,
      totalIssues,
      errors,
      warnings,
      duration,
    };
    if (checkpoint) {
      pipelineResult.checkpoint = checkpoint;
    }
    return pipelineResult;
  }

  /**
   * Get available validator modes
   */
  static getModes(): ValidatorMode[] {
    return Object.keys(VALIDATOR_MODES) as ValidatorMode[];
  }

  /**
   * Get validators for a mode
   */
  static getValidatorsForMode(mode: ValidatorMode): ValidatorName[] {
    return VALIDATOR_MODES[mode];
  }
}

// Export singleton pipeline instance
export const validationPipeline = new ValidationPipeline();
