/**
 * Integrations Agent for Ender
 * Manages third-party APIs, webhooks, authentication flows
 */

import { BaseAgent, AgentExecuteParams } from './base-agent';
import type { AgentConfig, AgentResult, ContextBundle, FileChange, ValidationResult, ValidationIssue } from '../types';
import { logger, generateId } from '../utils';
import { apiClient } from '../api';

const INTEGRATIONS_AGENT_SYSTEM_PROMPT = `You are the Integrations Agent for Ender, an AI coding assistant.

YOUR SPECIALIZATION:
- Third-party API integration (REST, GraphQL)
- Webhook handling (incoming/outgoing)
- Authentication flows (OAuth, JWT, SSO, SAML)
- Payment systems (Stripe, PayPal)
- Analytics (Segment, Mixpanel)
- Monitoring (Sentry, Datadog)
- Email services (SendGrid, SES)
- Storage services (S3, Cloudinary)

WHAT YOU CHECK:
1. API contracts match documentation
2. Auth flows are complete and secure
3. Webhooks verify signatures
4. Rate limits are respected
5. Tokens stored securely (not localStorage)
6. Error handling for API failures`;

export class IntegrationsAgent extends BaseAgent {
  constructor() {
    const config: AgentConfig = {
      type: 'integrations-agent',
      model: 'claude-opus-4-5-20251101',
      systemPrompt: INTEGRATIONS_AGENT_SYSTEM_PROMPT,
      capabilities: ['api_integration', 'auth_validation', 'webhook_security'],
      maxTokens: 4096
    };
    super(config, apiClient);
  }

  async execute(params: AgentExecuteParams): Promise<AgentResult> {
    const { task, context, files } = params;
    const startTime = Date.now();

    try {
      // Validate integrations in files if provided
      if (files && files.length > 0) {
        const validationResults = await this.validateIntegrations(files, context);
        return this.createSuccessResult(JSON.stringify(validationResults, null, 2), {
          explanation: this.formatValidationExplanation(validationResults),
          confidence: 85,
          tokensUsed: { input: 0, output: 0 },
          startTime
        });
      }

      const response = await this.callApi({
        model: this.defaultModel,
        system: this.buildSystemPrompt(context),
        messages: this.buildMessages(this.buildIntegrationPrompt(task, context), context),
        maxTokens: this.maxTokens,
        metadata: { agent: 'integrations-agent', taskId: generateId() }
      });

      return this.createSuccessResult(response.content, {
        explanation: response.content,
        confidence: 85,
        tokensUsed: response.usage,
        startTime
      });
    } catch (error) {
      logger.error('Integrations Agent failed', 'IntegrationsAgent', { error });
      return this.createErrorResult(
        error instanceof Error ? error : new Error(String(error)),
        startTime
      );
    }
  }

  private async validateIntegrations(changes: FileChange[], context: ContextBundle): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    for (const change of changes) {
      if (!change.content) continue;

      const issues: ValidationIssue[] = [];

      // Check auth security
      issues.push(...this.checkAuthSecurity(change));
      
      // Check API error handling
      issues.push(...this.checkApiErrorHandling(change));
      
      // Check webhook security
      issues.push(...this.checkWebhookSecurity(change));

      if (issues.length > 0) {
        results.push({
          validator: 'api-contract-validator',
          passed: issues.filter(i => i.severity === 'error').length === 0,
          severity: issues.some(i => i.severity === 'error') ? 'error' : 'warning',
          issues,
          duration: 0
        });
      }
    }

    return results;
  }

  private checkAuthSecurity(change: FileChange): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const content = change.content;
    const lines = content.split('\n');

    // Check for tokens in localStorage
    if (content.includes('localStorage') && content.match(/token|auth|jwt|session/i)) {
      const line = lines.findIndex(l => l.includes('localStorage') && l.match(/token|auth/i));
      issues.push({
        file: change.path,
        line: line + 1,
        message: 'Authentication tokens stored in localStorage (XSS vulnerable)',
        severity: 'error',
        suggestion: 'Use httpOnly cookies or secure session storage'
      });
    }

    // Check for exposed tokens in URLs
    if (content.match(/\?.*token=|&token=/)) {
      issues.push({
        file: change.path,
        message: 'Token passed in URL query parameter',
        severity: 'error',
        suggestion: 'Pass tokens in Authorization header instead'
      });
    }

    // Check for missing token refresh
    if (content.includes('accessToken') && !content.includes('refreshToken')) {
      issues.push({
        file: change.path,
        message: 'Access token used without refresh token mechanism',
        severity: 'warning',
        suggestion: 'Implement token refresh to handle expiration'
      });
    }

    return issues;
  }

  private checkApiErrorHandling(change: FileChange): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const content = change.content;

    // Check for fetch/axios without error handling
    const fetchCalls = content.match(/fetch\s*\(|axios\.\w+\s*\(/g) ?? [];
    const catchCalls = content.match(/\.catch\s*\(|catch\s*\(/g) ?? [];
    const tryCalls = content.match(/try\s*\{/g) ?? [];

    if (fetchCalls.length > (catchCalls.length + tryCalls.length)) {
      issues.push({
        file: change.path,
        message: 'API calls without proper error handling',
        severity: 'warning',
        suggestion: 'Wrap API calls in try/catch or use .catch()'
      });
    }

    // Check for unchecked response status
    if (content.includes('fetch(') && !content.includes('response.ok') && !content.includes('status')) {
      issues.push({
        file: change.path,
        message: 'Fetch response status not checked',
        severity: 'warning',
        suggestion: 'Check response.ok or response.status before using data'
      });
    }

    return issues;
  }

  private checkWebhookSecurity(change: FileChange): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const content = change.content;

    // Check for webhook handlers without signature verification
    if (content.match(/webhook|hook/i) && content.match(/req\.body|request\.body/)) {
      if (!content.match(/signature|verify|hmac|sha256/i)) {
        issues.push({
          file: change.path,
          message: 'Webhook handler without signature verification',
          severity: 'error',
          suggestion: 'Verify webhook signatures to prevent spoofing'
        });
      }
    }

    return issues;
  }

  private buildIntegrationPrompt(task: string, context: ContextBundle): string {
    let prompt = `## Integration Task\n${task}\n\n`;

    if (context.relevantFiles.length > 0) {
      prompt += '## Relevant Files\n';
      context.relevantFiles.forEach(f => {
        prompt += `\n### ${f.path}\n\`\`\`${f.language}\n${f.content}\n\`\`\``;
      });
    }

    return prompt;
  }

  private formatValidationExplanation(results: ValidationResult[]): string {
    const totalIssues = results.flatMap(r => r.issues).length;
    
    if (totalIssues === 0) {
      return '✅ No integration security issues found';
    }

    const lines = [`⚠️ Found ${totalIssues} integration issue(s):\n`];
    
    results.forEach(r => {
      r.issues.forEach(issue => {
        lines.push(`- ${issue.file}${issue.line ? `:${issue.line}` : ''}: ${issue.message}`);
        if (issue.suggestion) lines.push(`  → ${issue.suggestion}`);
      });
    });

    return lines.join('\n');
  }
}

export const integrationsAgent = new IntegrationsAgent();
