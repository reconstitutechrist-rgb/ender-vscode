/**
 * Security Module for Ender
 * Handles sensitive file detection and protection
 */

import * as path from 'path';
import ignore from 'ignore';
import { logger } from '../utils';

// Default sensitive file patterns
const DEFAULT_SENSITIVE_PATTERNS = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*secret*',
  '*credential*',
  '*password*',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  '.npmrc',
  '.pypirc',
  'aws-credentials',
  '.docker/config.json',
  'kubeconfig',
  '.kube/config'
];

// Patterns that should never be sent to AI
const NEVER_SEND_PATTERNS = [
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  '.npmrc',
  '.pypirc'
];

export interface SensitiveFileCheck {
  isSensitive: boolean;
  canSendToAI: boolean;
  reason?: string;
  recommendation?: string;
}

export interface SecretMatch {
  file: string;
  line: number;
  type: string;
  value: string;
  masked: string;
}

export class SensitiveFileDetector {
  private patterns: string[];
  private neverSendPatterns: string[];
  private customPatterns: string[] = [];

  constructor(additionalPatterns?: string[]) {
    this.patterns = [...DEFAULT_SENSITIVE_PATTERNS];
    this.neverSendPatterns = [...NEVER_SEND_PATTERNS];
    
    if (additionalPatterns) {
      this.customPatterns = additionalPatterns;
      this.patterns.push(...additionalPatterns);
    }
  }

  /**
   * Check if a file is sensitive
   */
  checkFile(filePath: string): SensitiveFileCheck {
    const fileName = path.basename(filePath).toLowerCase();
    const ig = ignore().add(this.patterns);
    const neverSendIg = ignore().add(this.neverSendPatterns);

    // Check never send patterns first
    if (neverSendIg.ignores(fileName)) {
      return {
        isSensitive: true,
        canSendToAI: false,
        reason: 'File contains private keys or credentials',
        recommendation: 'This file should never be shared. Reference it by name only.'
      };
    }

    // Check sensitive patterns
    if (ig.ignores(fileName)) {
      return {
        isSensitive: true,
        canSendToAI: true, // Can send but with warning
        reason: 'File may contain sensitive configuration',
        recommendation: 'Review file contents before sharing. Mask any secrets.'
      };
    }

    // Check content patterns in filename
    if (this.hasSensitiveNamePattern(fileName)) {
      return {
        isSensitive: true,
        canSendToAI: true,
        reason: 'Filename suggests sensitive content',
        recommendation: 'Verify no secrets are exposed before sharing.'
      };
    }

    return {
      isSensitive: false,
      canSendToAI: true
    };
  }

  /**
   * Check if filename has sensitive patterns
   */
  private hasSensitiveNamePattern(fileName: string): boolean {
    const sensitiveKeywords = [
      'secret', 'credential', 'password', 'token', 'auth',
      'private', 'apikey', 'api_key', 'api-key', 'access_key',
      'secret_key', 'private_key'
    ];

    const nameLower = fileName.toLowerCase();
    return sensitiveKeywords.some(keyword => nameLower.includes(keyword));
  }

  /**
   * Scan content for secrets
   */
  scanForSecrets(content: string, filePath: string): SecretMatch[] {
    const matches: SecretMatch[] = [];
    const lines = content.split('\n');

    const patterns: Array<{ regex: RegExp; type: string }> = [
      // API Keys
      { regex: /['"]?(sk[-_]live[-_][a-zA-Z0-9]{24,})['"]?/, type: 'Stripe Secret Key' },
      { regex: /['"]?(pk[-_]live[-_][a-zA-Z0-9]{24,})['"]?/, type: 'Stripe Publishable Key' },
      { regex: /['"]?(AKIA[A-Z0-9]{16})['"]?/, type: 'AWS Access Key' },
      { regex: /['"]?(ghp_[a-zA-Z0-9]{36})['"]?/, type: 'GitHub Personal Token' },
      { regex: /['"]?(gho_[a-zA-Z0-9]{36})['"]?/, type: 'GitHub OAuth Token' },
      { regex: /['"]?(glpat-[a-zA-Z0-9\-_]{20,})['"]?/, type: 'GitLab Token' },
      { regex: /['"]?(xox[baprs]-[a-zA-Z0-9\-]{10,})['"]?/, type: 'Slack Token' },
      
      // Generic patterns
      { regex: /api[-_]?key\s*[:=]\s*['"]([^'"]{20,})['"]/, type: 'API Key' },
      { regex: /secret[-_]?key\s*[:=]\s*['"]([^'"]{20,})['"]/, type: 'Secret Key' },
      { regex: /password\s*[:=]\s*['"]([^'"]{8,})['"]/, type: 'Password' },
      { regex: /token\s*[:=]\s*['"]([^'"]{20,})['"]/, type: 'Token' },
      
      // Connection strings
      { regex: /mongodb(\+srv)?:\/\/[^:]+:[^@]+@/, type: 'MongoDB Connection String' },
      { regex: /postgres(ql)?:\/\/[^:]+:[^@]+@/, type: 'PostgreSQL Connection String' },
      { regex: /mysql:\/\/[^:]+:[^@]+@/, type: 'MySQL Connection String' },
      { regex: /redis:\/\/[^:]+:[^@]+@/, type: 'Redis Connection String' },
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      
      // Skip comments
      if (/^\s*(\/\/|#|\/\*)/.test(line)) continue;
      
      // Skip env references
      if (/process\.env|import\.meta\.env|os\.environ/.test(line)) continue;

      for (const { regex, type } of patterns) {
        const match = line.match(regex);
        if (match) {
          const value = match[1] ?? match[0];
          matches.push({
            file: filePath,
            line: i + 1,
            type,
            value,
            masked: this.maskSecret(value)
          });
        }
      }
    }

    return matches;
  }

  /**
   * Mask a secret value
   */
  maskSecret(value: string): string {
    if (value.length <= 8) {
      return '*'.repeat(value.length);
    }
    const visibleChars = Math.min(4, Math.floor(value.length / 4));
    return value.substring(0, visibleChars) + '*'.repeat(value.length - visibleChars * 2) + value.substring(value.length - visibleChars);
  }

  /**
   * Redact secrets from content
   */
  redactSecrets(content: string, filePath: string): string {
    const secrets = this.scanForSecrets(content, filePath);
    let redacted = content;

    for (const secret of secrets) {
      redacted = redacted.replace(secret.value, `[REDACTED_${secret.type.toUpperCase().replace(/\s+/g, '_')}]`);
    }

    return redacted;
  }

  /**
   * Add custom patterns
   */
  addPatterns(patterns: string[]): void {
    this.customPatterns.push(...patterns);
    this.patterns.push(...patterns);
  }

  /**
   * Get all patterns
   */
  getPatterns(): string[] {
    return [...this.patterns];
  }

  /**
   * Check if file should be excluded from context
   */
  shouldExcludeFromContext(filePath: string): boolean {
    const check = this.checkFile(filePath);
    return check.isSensitive && !check.canSendToAI;
  }
}

// Singleton instance
export const sensitiveFileDetector = new SensitiveFileDetector();
