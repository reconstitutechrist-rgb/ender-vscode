/**
 * Stage 5: Specialist Validators
 * hook-rules-checker, event-leak-detector, api-contract-validator, auth-flow-validator
 * environment-consistency, secrets-exposure-checker, docker-best-practices, cloud-config-validator
 */

import { BaseValidator, ValidatorContext, containsPattern } from './base-validator';
import type { ValidationIssue } from '../types';

/**
 * Hook Rules Checker (Hooks Agent)
 * Enforces React/Vue/etc hook rules
 */
export class HookRulesCheckerValidator extends BaseValidator {
  readonly name = 'hook-rules-checker' as const;
  readonly stage = 'specialist' as const;

  protected async validate(context: ValidatorContext): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    for (const change of context.changes) {
      const ext = change.path.split('.').pop()?.toLowerCase();
      if (!['tsx', 'jsx', 'ts', 'js'].includes(ext ?? '')) continue;

      issues.push(...this.checkReactHooks(change.content, change.path));
    }

    return issues;
  }

  private checkReactHooks(content: string, filePath: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const lines = content.split('\n');

    // Check for hooks
    const hookPattern = /\b(use[A-Z]\w*)\s*\(/g;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      
      // Check for hooks in conditions
      if (/if\s*\([^)]*\)\s*{[^}]*use[A-Z]\w*\s*\(/.test(line) ||
          (line.includes('if') && lines[i + 1]?.includes('use'))) {
        issues.push(this.createIssue(
          filePath,
          `Hook may be called conditionally - hooks must be called unconditionally`,
          'error',
          { line: i + 1, code: 'HOOK_CONDITIONAL' }
        ));
      }

      // Check for hooks in loops
      if (/(?:for|while|do)\s*[({]/.test(line)) {
        // Check next few lines for hooks
        for (let j = i; j < Math.min(i + 10, lines.length); j++) {
          if (lines[j]?.includes('}')) break;
          if (/use[A-Z]\w*\s*\(/.test(lines[j] ?? '')) {
            issues.push(this.createIssue(
              filePath,
              `Hook called inside loop - hooks must not be in loops`,
              'error',
              { line: j + 1, code: 'HOOK_IN_LOOP' }
            ));
          }
        }
      }

      // Check for hooks after early return
      if (/^\s*return\b/.test(line)) {
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j] ?? '';
          if (/^\s*}/.test(nextLine)) break;
          if (/use[A-Z]\w*\s*\(/.test(nextLine) && !/^\s*\/\//.test(nextLine)) {
            issues.push(this.createIssue(
              filePath,
              `Hook called after early return`,
              'error',
              { line: j + 1, code: 'HOOK_AFTER_RETURN' }
            ));
          }
        }
      }

      // Check useEffect dependencies
      if (/useEffect\s*\(\s*\(\s*\)\s*=>\s*{/.test(line)) {
        // Look for closing of useEffect
        let bracketCount = 0;
        let foundDeps = false;
        for (let j = i; j < lines.length; j++) {
          const checkLine = lines[j] ?? '';
          bracketCount += (checkLine.match(/{/g) ?? []).length;
          bracketCount -= (checkLine.match(/}/g) ?? []).length;
          if (/\[\s*\]/.test(checkLine) || /\[[^\]]+\]/.test(checkLine)) {
            foundDeps = true;
          }
          if (bracketCount === 0) {
            if (!foundDeps) {
              issues.push(this.createIssue(
                filePath,
                `useEffect may be missing dependency array`,
                'warning',
                { line: i + 1, code: 'HOOK_MISSING_DEPS' }
              ));
            }
            break;
          }
        }
      }

      // Check custom hook naming
      if (/(?:const|function)\s+([a-z]\w*)\s*=?\s*(?:\([^)]*\)\s*=>|\()/.test(line)) {
        const match = line.match(/(?:const|function)\s+([a-z]\w*)/);
        const funcName = match?.[1];
        if (funcName && /use[A-Z]/.test(content.slice(content.indexOf(line)))) {
          // Function uses hooks but doesn't start with 'use'
          if (funcName && !funcName.startsWith('use') && !['render', 'component'].some(k => funcName.toLowerCase().includes(k))) {
            // Check if this function contains hook calls
            let funcContent = '';
            let braceCount = 0;
            for (let j = i; j < lines.length; j++) {
              funcContent += lines[j];
              braceCount += (lines[j]?.match(/{/g) ?? []).length;
              braceCount -= (lines[j]?.match(/}/g) ?? []).length;
              if (braceCount === 0 && j > i) break;
            }
            if (/use[A-Z]\w*\s*\(/.test(funcContent)) {
              issues.push(this.createIssue(
                filePath,
                `Function '${funcName}' uses hooks but name doesn't start with 'use'`,
                'warning',
                { line: i + 1, code: 'HOOK_INVALID_NAME' }
              ));
            }
          }
        }
      }
    }

    return issues;
  }
}

/**
 * Event Leak Detector (Hooks Agent)
 * Finds event listeners without cleanup
 */
export class EventLeakDetectorValidator extends BaseValidator {
  readonly name = 'event-leak-detector' as const;
  readonly stage = 'specialist' as const;

  protected async validate(context: ValidatorContext): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    for (const change of context.changes) {
      issues.push(...this.checkEventLeaks(change.content, change.path));
    }

    return issues;
  }

  private checkEventLeaks(content: string, filePath: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const lines = content.split('\n');

    // Track addEventListener calls
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      
      // DOM event listeners
      if (/addEventListener\s*\(/.test(line)) {
        const hasRemove = content.includes('removeEventListener');
        if (!hasRemove) {
          issues.push(this.createIssue(
            filePath,
            `addEventListener without removeEventListener - potential memory leak`,
            'warning',
            { line: i + 1, code: 'LEAK_EVENT_LISTENER' }
          ));
        }
      }

      // setInterval without clear
      if (/setInterval\s*\(/.test(line)) {
        const hasClear = content.includes('clearInterval');
        if (!hasClear) {
          issues.push(this.createIssue(
            filePath,
            `setInterval without clearInterval - potential memory leak`,
            'warning',
            { line: i + 1, code: 'LEAK_INTERVAL' }
          ));
        }
      }

      // setTimeout in useEffect without cleanup
      if (/setTimeout\s*\(/.test(line)) {
        // Check if inside useEffect and has cleanup
        const prevLines = lines.slice(Math.max(0, i - 10), i).join('\n');
        if (/useEffect/.test(prevLines)) {
          const nextLines = lines.slice(i, Math.min(lines.length, i + 20)).join('\n');
          if (!/clearTimeout/.test(nextLines)) {
            issues.push(this.createIssue(
              filePath,
              `setTimeout in useEffect without clearTimeout in cleanup`,
              'info',
              { line: i + 1, code: 'LEAK_TIMEOUT' }
            ));
          }
        }
      }

      // EventEmitter listeners
      if (/\.on\s*\(\s*['"][^'"]+['"]/.test(line)) {
        if (!content.includes('.off(') && !content.includes('.removeListener(')) {
          issues.push(this.createIssue(
            filePath,
            `Event emitter .on() without .off() - potential memory leak`,
            'warning',
            { line: i + 1, code: 'LEAK_EMITTER' }
          ));
        }
      }

      // RxJS subscriptions
      if (/\.subscribe\s*\(/.test(line)) {
        if (!content.includes('unsubscribe') && !content.includes('takeUntil')) {
          issues.push(this.createIssue(
            filePath,
            `Observable subscription without unsubscribe - potential memory leak`,
            'warning',
            { line: i + 1, code: 'LEAK_SUBSCRIPTION' }
          ));
        }
      }
    }

    return issues;
  }
}

/**
 * API Contract Validator (Integrations Agent)
 * Ensures code matches API contracts
 */
export class ApiContractValidatorValidator extends BaseValidator {
  readonly name = 'api-contract-validator' as const;
  readonly stage = 'specialist' as const;

  protected async validate(context: ValidatorContext): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    for (const change of context.changes) {
      issues.push(...this.checkApiCalls(change.content, change.path));
    }

    return issues;
  }

  private checkApiCalls(content: string, filePath: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      
      // Check fetch calls without error handling
      if (/fetch\s*\(/.test(line)) {
        const context = lines.slice(i, Math.min(i + 10, lines.length)).join('\n');
        if (!/.catch\s*\(/.test(context) && !/try\s*{/.test(lines.slice(Math.max(0, i - 5), i).join('\n'))) {
          issues.push(this.createIssue(
            filePath,
            `fetch() call without error handling`,
            'warning',
            { line: i + 1, code: 'API_NO_ERROR_HANDLING' }
          ));
        }
      }

      // Check for missing authentication headers
      if (/fetch\s*\([^)]+\)/.test(line) && /api|endpoint/i.test(line)) {
        const context = lines.slice(i, Math.min(i + 5, lines.length)).join('\n');
        if (!/[Aa]uthorization|[Aa]uth|[Tt]oken|[Aa]pi[-_]?[Kk]ey/.test(context)) {
          issues.push(this.createIssue(
            filePath,
            `API call may be missing authentication`,
            'info',
            { line: i + 1, code: 'API_MISSING_AUTH' }
          ));
        }
      }

      // Check axios without interceptors for error handling
      if (/axios\.\w+\s*\(/.test(line)) {
        const context = lines.slice(i, Math.min(i + 10, lines.length)).join('\n');
        if (!/.catch\s*\(/.test(context) && !/try\s*{/.test(lines.slice(Math.max(0, i - 5), i).join('\n'))) {
          issues.push(this.createIssue(
            filePath,
            `axios call without error handling`,
            'warning',
            { line: i + 1, code: 'API_AXIOS_NO_CATCH' }
          ));
        }
      }
    }

    return issues;
  }
}

/**
 * Auth Flow Validator (Integrations Agent)
 * Verifies authentication flows are complete
 */
export class AuthFlowValidatorValidator extends BaseValidator {
  readonly name = 'auth-flow-validator' as const;
  readonly stage = 'specialist' as const;

  protected async validate(context: ValidatorContext): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    for (const change of context.changes) {
      if (!/auth|login|token|session/i.test(change.path + change.content)) continue;
      issues.push(...this.checkAuthPatterns(change.content, change.path));
    }

    return issues;
  }

  private checkAuthPatterns(content: string, filePath: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      
      // Check for tokens in localStorage
      if (/localStorage\.\w+\s*\([^)]*(?:token|auth|jwt)/i.test(line)) {
        issues.push(this.createIssue(
          filePath,
          `Storing auth tokens in localStorage is vulnerable to XSS - consider httpOnly cookies`,
          'warning',
          { line: i + 1, code: 'AUTH_INSECURE_STORAGE' }
        ));
      }

      // Check for missing token validation
      if (/(?:jwt|token)\s*=/.test(line) && !/verify|decode|validate/i.test(content)) {
        issues.push(this.createIssue(
          filePath,
          `JWT/token usage without apparent validation`,
          'warning',
          { line: i + 1, code: 'AUTH_NO_VALIDATION' }
        ));
      }

      // Check for exposed tokens in URLs
      if (/\?.*(?:token|api_key|auth)=/i.test(line)) {
        issues.push(this.createIssue(
          filePath,
          `Token exposed in URL query parameter - use headers instead`,
          'error',
          { line: i + 1, code: 'AUTH_TOKEN_IN_URL' }
        ));
      }
    }

    // Check for missing logout/session cleanup
    if (/login|signIn|authenticate/i.test(content) && !/logout|signOut|clearSession/i.test(content)) {
      issues.push(this.createIssue(
        filePath,
        `Auth implementation without logout/cleanup functionality`,
        'info',
        { code: 'AUTH_NO_LOGOUT' }
      ));
    }

    return issues;
  }
}

/**
 * Environment Consistency Validator (Infrastructure Agent)
 */
export class EnvironmentConsistencyValidator extends BaseValidator {
  readonly name = 'environment-consistency' as const;
  readonly stage = 'specialist' as const;

  protected async validate(context: ValidatorContext): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    // Collect all env var references
    const envVarUsage = new Map<string, string[]>();
    
    for (const change of context.changes) {
      const vars = this.extractEnvVars(change.content);
      for (const v of vars) {
        if (!envVarUsage.has(v)) envVarUsage.set(v, []);
        envVarUsage.get(v)?.push(change.path);
      }
    }

    // Check .env files if present
    const envFiles = context.changes.filter(c => c.path.includes('.env'));
    const definedVars = new Set<string>();
    
    for (const envFile of envFiles) {
      const vars = this.extractEnvDefinitions(envFile.content);
      vars.forEach(v => definedVars.add(v));
    }

    // Report undefined env vars
    for (const [varName, files] of envVarUsage) {
      if (!definedVars.has(varName) && !this.isCommonEnvVar(varName)) {
        issues.push(this.createIssue(
          files[0] ?? '',
          `Environment variable '${varName}' used but may not be defined`,
          'warning',
          { code: 'ENV_UNDEFINED_VAR' }
        ));
      }
    }

    return issues;
  }

  private extractEnvVars(content: string): string[] {
    const vars: string[] = [];
    const regex = /process\.env\.(\w+)|import\.meta\.env\.(\w+)/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const varName = match[1] ?? match[2];
      if (varName) vars.push(varName);
    }
    return vars;
  }

  private extractEnvDefinitions(content: string): string[] {
    const vars: string[] = [];
    const regex = /^([A-Z][A-Z0-9_]*)=/gm;
    let match;
    while ((match = regex.exec(content)) !== null) {
      if (match[1]) vars.push(match[1]);
    }
    return vars;
  }

  private isCommonEnvVar(name: string): boolean {
    const common = ['NODE_ENV', 'PORT', 'HOST', 'DEBUG', 'HOME', 'PATH', 'USER'];
    return common.includes(name);
  }
}

/**
 * Secrets Exposure Checker (Infrastructure Agent)
 */
export class SecretsExposureCheckerValidator extends BaseValidator {
  readonly name = 'secrets-exposure-checker' as const;
  readonly stage = 'specialist' as const;
  protected severity = 'error' as const;

  protected async validate(context: ValidatorContext): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    for (const change of context.changes) {
      issues.push(...this.checkSecretExposure(change.content, change.path));
    }

    return issues;
  }

  private checkSecretExposure(content: string, filePath: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      
      // Check for logged secrets
      if (/console\.\w+\([^)]*(?:password|secret|token|key|auth)/i.test(line)) {
        issues.push(this.createIssue(
          filePath,
          `Possible secret being logged`,
          'error',
          { line: i + 1, code: 'SECRET_LOGGED' }
        ));
      }

      // Check for secrets in error messages
      if (/(?:throw|Error)\s*\([^)]*(?:password|secret|token|apiKey)/i.test(line)) {
        issues.push(this.createIssue(
          filePath,
          `Possible secret in error message`,
          'warning',
          { line: i + 1, code: 'SECRET_IN_ERROR' }
        ));
      }

      // High entropy strings (potential keys)
      const highEntropyMatch = line.match(/['"]([A-Za-z0-9+/=]{32,})['"]/) ||
                               line.match(/['"]([a-f0-9]{32,})['"]/) ||
                               line.match(/['"](sk-[A-Za-z0-9]{32,})['"]/);
      if (highEntropyMatch && !/process\.env|import\.meta\.env/.test(line)) {
        issues.push(this.createIssue(
          filePath,
          `High-entropy string detected - possible hardcoded secret`,
          'warning',
          { line: i + 1, code: 'SECRET_HIGH_ENTROPY' }
        ));
      }
    }

    return issues;
  }
}

/**
 * Docker Best Practices Validator (Infrastructure Agent)
 */
export class DockerBestPracticesValidator extends BaseValidator {
  readonly name = 'docker-best-practices' as const;
  readonly stage = 'specialist' as const;

  protected async validate(context: ValidatorContext): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    for (const change of context.changes) {
      if (!/dockerfile/i.test(change.path)) continue;
      issues.push(...this.checkDockerfile(change.content, change.path));
    }

    return issues;
  }

  private checkDockerfile(content: string, filePath: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      
      // Check for :latest tag
      if (/FROM\s+\S+:latest/i.test(line)) {
        issues.push(this.createIssue(
          filePath,
          `Avoid :latest tag - use specific version for reproducibility`,
          'warning',
          { line: i + 1, code: 'DOCKER_LATEST_TAG' }
        ));
      }

      // Check for running as root
      if (/FROM/i.test(line) && !content.includes('USER')) {
        issues.push(this.createIssue(
          filePath,
          `Container runs as root - add USER instruction`,
          'warning',
          { code: 'DOCKER_ROOT_USER' }
        ));
      }

      // Check for secrets in build args
      if (/ARG\s+(?:PASSWORD|SECRET|TOKEN|KEY)/i.test(line)) {
        issues.push(this.createIssue(
          filePath,
          `Secrets in ARG are visible in image history`,
          'error',
          { line: i + 1, code: 'DOCKER_SECRET_ARG' }
        ));
      }
    }

    // Check for HEALTHCHECK
    if (!content.includes('HEALTHCHECK')) {
      issues.push(this.createIssue(
        filePath,
        `No HEALTHCHECK instruction - consider adding for better orchestration`,
        'info',
        { code: 'DOCKER_NO_HEALTHCHECK' }
      ));
    }

    return issues;
  }
}

/**
 * Cloud Config Validator (Infrastructure Agent)
 */
export class CloudConfigValidatorValidator extends BaseValidator {
  readonly name = 'cloud-config-validator' as const;
  readonly stage = 'specialist' as const;

  protected async validate(context: ValidatorContext): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    for (const change of context.changes) {
      if (/serverless\.ya?ml|vercel\.json|netlify\.toml|\.aws/i.test(change.path)) {
        issues.push(...this.checkCloudConfig(change.content, change.path));
      }
    }

    return issues;
  }

  private checkCloudConfig(content: string, filePath: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      
      // Check for overly permissive policies
      if (/"Action"\s*:\s*"\*"/.test(line) || /Action:\s*['"]?\*/.test(line)) {
        issues.push(this.createIssue(
          filePath,
          `Overly permissive action (*) - follow least privilege principle`,
          'warning',
          { line: i + 1, code: 'CLOUD_PERMISSIVE_ACTION' }
        ));
      }

      if (/"Resource"\s*:\s*"\*"/.test(line) || /Resource:\s*['"]?\*/.test(line)) {
        issues.push(this.createIssue(
          filePath,
          `Overly permissive resource (*) - scope to specific resources`,
          'warning',
          { line: i + 1, code: 'CLOUD_PERMISSIVE_RESOURCE' }
        ));
      }

      // Check for public access
      if (/public[_-]?access.*true|acl.*public/i.test(line)) {
        issues.push(this.createIssue(
          filePath,
          `Public access enabled - ensure this is intentional`,
          'warning',
          { line: i + 1, code: 'CLOUD_PUBLIC_ACCESS' }
        ));
      }
    }

    return issues;
  }
}
