/**
 * Infrastructure Agent for Ender
 * Handles environment configs, Docker, cloud services, CI/CD
 */

import { BaseAgent, AgentExecuteParams } from './base-agent';
import type {
  AgentConfig,
  AgentResult,
  ContextBundle,
  FileChange,
  ValidationResult,
  ValidationIssue,
} from '../types';
import { logger, generateId } from '../utils';
import { apiClient } from '../api';

const INFRASTRUCTURE_AGENT_SYSTEM_PROMPT = `You are the Infrastructure Agent for Ender, an AI coding assistant.

YOUR SPECIALIZATION:
- Environment configuration (dev/staging/prod)
- Docker (Dockerfile, docker-compose)
- Kubernetes (deployments, services, ingress)
- Cloud services (AWS, GCP, Azure)
- Serverless (Vercel, Netlify, Lambda)
- CI/CD pipelines (GitHub Actions, GitLab CI)
- Secrets management (Vault, AWS Secrets Manager)

WHAT YOU CHECK:
1. Environment variables consistent across envs
2. Secrets not hardcoded or exposed
3. Docker follows best practices
4. Cloud configs follow least privilege
5. CI/CD pipelines are secure`;

export class InfrastructureAgent extends BaseAgent {
  constructor() {
    const config: AgentConfig = {
      type: 'infrastructure-agent',
      model: 'claude-opus-4-5-20251101',
      systemPrompt: INFRASTRUCTURE_AGENT_SYSTEM_PROMPT,
      capabilities: ['docker_validation', 'cloud_config', 'secrets_detection'],
      maxTokens: 4096,
    };
    super(config, apiClient);
  }

  async execute(params: AgentExecuteParams): Promise<AgentResult> {
    const { task, context, files } = params;
    const startTime = Date.now();

    try {
      // Validate infrastructure in files if provided
      if (files && files.length > 0) {
        const validationResults = await this.validateInfrastructure(
          files,
          context,
        );
        return this.createSuccessResult(
          JSON.stringify(validationResults, null, 2),
          {
            explanation: this.formatValidationExplanation(validationResults),
            confidence: 85,
            tokensUsed: { input: 0, output: 0, total: 0, cost: 0 },
            startTime,
          },
        );
      }

      const response = await this.callApi({
        model: this.defaultModel,
        system: this.buildSystemPrompt(context),
        messages: this.buildMessages(
          this.buildInfraPrompt(task, context),
          context,
        ),
        maxTokens: this.maxTokens,
        metadata: { agent: 'infrastructure-agent', taskId: generateId() },
      });

      return this.createSuccessResult(response.content, {
        explanation: response.content,
        confidence: 85,
        tokensUsed: response.usage,
        startTime,
      });
    } catch (error) {
      logger.error('Infrastructure Agent failed', 'InfrastructureAgent', {
        error,
      });
      return this.createErrorResult(
        error instanceof Error ? error : new Error(String(error)),
        startTime,
      );
    }
  }

  private async validateInfrastructure(
    changes: FileChange[],
    _context: ContextBundle,
  ): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    for (const change of changes) {
      if (!change.content) continue;

      const issues: ValidationIssue[] = [];

      // Check based on file type
      if (change.path.toLowerCase().includes('dockerfile')) {
        issues.push(...this.checkDockerfile(change));
      }

      if (change.path.match(/\.env|environment/i)) {
        issues.push(...this.checkEnvironment(change));
      }

      if (change.path.match(/\.ya?ml$/i)) {
        issues.push(...this.checkYamlConfig(change));
      }

      // Always check for secrets
      issues.push(...this.checkSecrets(change));

      if (issues.length > 0) {
        results.push({
          validator: 'environment-consistency',
          passed: issues.filter((i) => i.severity === 'error').length === 0,
          severity: issues.some((i) => i.severity === 'error')
            ? 'error'
            : 'warning',
          issues,
          duration: 0,
        });
      }
    }

    return results;
  }

  private checkDockerfile(change: FileChange): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const content = change.content;
    const lines = content.split('\n');

    // Check for latest tag
    lines.forEach((line, idx) => {
      if (line.match(/FROM\s+\S+:latest/i)) {
        issues.push({
          file: change.path,
          line: idx + 1,
          message: 'Using :latest tag in FROM instruction',
          severity: 'warning',
          suggestion: 'Pin to a specific version for reproducibility',
        });
      }
    });

    // Check for running as root
    if (!content.match(/USER\s+\S+/i) || content.match(/USER\s+root/i)) {
      issues.push({
        file: change.path,
        message: 'Container may run as root user',
        severity: 'warning',
        suggestion: 'Add USER instruction with non-root user',
      });
    }

    // Check for secrets in build args
    if (content.match(/ARG\s+(password|secret|key|token)/i)) {
      issues.push({
        file: change.path,
        message: 'Sensitive data passed as build argument',
        severity: 'error',
        suggestion: 'Use runtime secrets instead of build args',
      });
    }

    // Check for HEALTHCHECK
    if (!content.includes('HEALTHCHECK')) {
      issues.push({
        file: change.path,
        message: 'No HEALTHCHECK instruction',
        severity: 'info',
        suggestion: 'Add HEALTHCHECK for container orchestration',
      });
    }

    return issues;
  }

  private checkEnvironment(change: FileChange): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const content = change.content;
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      // Check for hardcoded secrets
      if (line.match(/=\s*['"]?[a-zA-Z0-9]{20,}['"]?\s*$/)) {
        const keyMatch = line.match(/^(\w+)=/);
        if (keyMatch?.[1]?.match(/key|secret|password|token/i)) {
          issues.push({
            file: change.path,
            line: idx + 1,
            message: `Potential hardcoded secret: ${keyMatch[1]}`,
            severity: 'error',
            suggestion: 'Use environment-specific secrets management',
          });
        }
      }

      // Check for empty required variables
      if (line.match(/^[A-Z_]+=\s*$/)) {
        issues.push({
          file: change.path,
          line: idx + 1,
          message: 'Empty environment variable',
          severity: 'warning',
          suggestion: 'Provide default or mark as optional',
        });
      }
    });

    return issues;
  }

  private checkYamlConfig(change: FileChange): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const content = change.content;

    // Check for overly permissive IAM
    if (
      content.match(/Action:\s*['"]\*['"]/i) ||
      content.match(/Resource:\s*['"]\*['"]/i)
    ) {
      issues.push({
        file: change.path,
        message: 'Overly permissive IAM policy (uses *)',
        severity: 'error',
        suggestion: 'Follow least privilege principle',
      });
    }

    // Check for public access
    if (content.match(/public[:\s]+true|publicAccess/i)) {
      issues.push({
        file: change.path,
        message: 'Resource configured with public access',
        severity: 'warning',
        suggestion: 'Verify public access is intended',
      });
    }

    return issues;
  }

  private checkSecrets(change: FileChange): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const content = change.content;

    // Common secret patterns
    const secretPatterns = [
      { pattern: /AKIA[0-9A-Z]{16}/g, name: 'AWS Access Key' },
      { pattern: /sk_live_[a-zA-Z0-9]{24,}/g, name: 'Stripe Secret Key' },
      { pattern: /ghp_[a-zA-Z0-9]{36}/g, name: 'GitHub Personal Token' },
      {
        pattern: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/g,
        name: 'Private Key',
      },
    ];

    for (const { pattern, name } of secretPatterns) {
      if (pattern.test(content)) {
        issues.push({
          file: change.path,
          message: `Potential ${name} detected in code`,
          severity: 'error',
          suggestion: 'Remove secret and rotate immediately',
        });
      }
    }

    // Check for console.log with sensitive vars
    if (content.match(/console\.log.*?(password|secret|token|key)/i)) {
      issues.push({
        file: change.path,
        message: 'Logging potentially sensitive data',
        severity: 'warning',
        suggestion: 'Remove sensitive data from logs',
      });
    }

    return issues;
  }

  private buildInfraPrompt(task: string, context: ContextBundle): string {
    let prompt = `## Infrastructure Task\n${task}\n\n`;

    if (context.relevantFiles.length > 0) {
      prompt += '## Relevant Files\n';
      context.relevantFiles.forEach((f) => {
        prompt += `\n### ${f.path}\n\`\`\`${f.language}\n${f.content}\n\`\`\``;
      });
    }

    return prompt;
  }

  private formatValidationExplanation(results: ValidationResult[]): string {
    const totalIssues = results.flatMap((r) => r.issues).length;

    if (totalIssues === 0) {
      return '✅ No infrastructure issues found';
    }

    const lines = [`⚠️ Found ${totalIssues} infrastructure issue(s):\n`];

    results.forEach((r) => {
      r.issues.forEach((issue) => {
        lines.push(
          `- ${issue.file}${issue.line ? `:${issue.line}` : ''}: ${issue.message}`,
        );
        if (issue.suggestion) lines.push(`  → ${issue.suggestion}`);
      });
    });

    return lines.join('\n');
  }
}

export const infrastructureAgent = new InfrastructureAgent();
