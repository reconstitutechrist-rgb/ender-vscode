/**
 * Hooks Agent for Ender
 * Specializes in framework hooks, lifecycle, event systems, middleware
 */

import { BaseAgent } from './base-agent';
import type { AgentResult, ContextBundle, FileChange, ValidationResult, ValidationIssue } from '../types';
import { logger } from '../utils';

const HOOKS_AGENT_SYSTEM_PROMPT = `You are the Hooks Agent for Ender, an AI coding assistant.

YOUR SPECIALIZATION:
- React hooks (rules of hooks, custom hooks, dependencies)
- Framework lifecycle (Vue, Angular, Svelte, Next.js)
- Event systems (emitters, listeners, cleanup)
- Middleware chains (Express, Koa, Hono)
- Database hooks (Prisma, TypeORM, Mongoose)
- State management (Redux, Zustand, MobX)

WHAT YOU CHECK:
1. React hooks not in conditionals/loops
2. useEffect dependency arrays complete
3. Custom hooks named with "use" prefix
4. Event listeners have cleanup
5. Middleware calls next()
6. Subscriptions are unsubscribed

CRITICAL RULES:
- Hooks must be called in the same order every render
- Effects must clean up subscriptions
- Event listeners must be removed on unmount`;

export class HooksAgent extends BaseAgent {
  constructor() {
    super('hooks-agent', HOOKS_AGENT_SYSTEM_PROMPT);
  }

  async execute(
    task: string,
    context: ContextBundle,
    options?: { changes?: FileChange[]; validateOnly?: boolean }
  ): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      if (options?.validateOnly) {
        const validationResults = await this.validateHooks(options.changes ?? [], context);
        return {
          success: validationResults.every(r => r.passed),
          agent: 'hooks-agent',
          output: JSON.stringify(validationResults, null, 2),
          explanation: this.formatValidationExplanation(validationResults),
          confidence: 90,
          tokensUsed: { input: 0, output: 0 },
          duration: Date.now() - startTime
        };
      }

      // Generate hook-related code or fixes
      const response = await this.callApi({ content: this.buildPrompt(task, context), context });

      return {
        success: true,
        agent: 'hooks-agent',
        output: response.content,
        explanation: response.content,
        confidence: 85,
        tokensUsed: response.usage,
        duration: Date.now() - startTime
      };
    } catch (error) {
      logger.error('Hooks Agent failed', 'HooksAgent', { error });
      return {
        success: false,
        agent: 'hooks-agent',
        confidence: 0,
        tokensUsed: { input: 0, output: 0 },
        duration: Date.now() - startTime,
        errors: [{ code: 'HOOKS_ERROR', message: String(error), recoverable: true }]
      };
    }
  }

  private async validateHooks(changes: FileChange[], context: ContextBundle): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    for (const change of changes) {
      if (!change.content) continue;
      
      // Only check React/JS/TS files
      if (!change.path.match(/\.(jsx?|tsx?)$/)) continue;

      const issues: ValidationIssue[] = [];

      // Check for hooks in conditionals
      issues.push(...this.checkConditionalHooks(change));
      
      // Check for hooks in loops
      issues.push(...this.checkLoopHooks(change));
      
      // Check useEffect dependencies
      issues.push(...this.checkEffectDependencies(change));
      
      // Check event listener cleanup
      issues.push(...this.checkEventCleanup(change));

      results.push({
        validator: 'hook-rules-checker',
        passed: issues.filter(i => i.severity === 'error').length === 0,
        severity: issues.length > 0 ? 'error' : 'info',
        issues,
        duration: 0
      });
    }

    return results;
  }

  private checkConditionalHooks(change: FileChange): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const lines = change.content.split('\n');
    
    let inConditional = 0;
    lines.forEach((line, idx) => {
      if (line.match(/\bif\s*\(|\?\s*.*:/)) inConditional++;
      if (line.includes('}') && inConditional > 0) inConditional--;
      
      if (inConditional > 0 && line.match(/\buse[A-Z]\w*\s*\(/)) {
        const hookMatch = line.match(/\b(use[A-Z]\w*)\s*\(/);
        issues.push({
          file: change.path,
          line: idx + 1,
          message: `Hook "${hookMatch?.[1]}" called inside conditional`,
          severity: 'error',
          suggestion: 'Move hook to top level of component'
        });
      }
    });

    return issues;
  }

  private checkLoopHooks(change: FileChange): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const lines = change.content.split('\n');
    
    let inLoop = 0;
    lines.forEach((line, idx) => {
      if (line.match(/\b(for|while|do)\s*\(|\.forEach\(|\.map\(/)) inLoop++;
      if (line.includes('}') && inLoop > 0) inLoop--;
      
      if (inLoop > 0 && line.match(/\buse[A-Z]\w*\s*\(/)) {
        const hookMatch = line.match(/\b(use[A-Z]\w*)\s*\(/);
        issues.push({
          file: change.path,
          line: idx + 1,
          message: `Hook "${hookMatch?.[1]}" called inside loop`,
          severity: 'error',
          suggestion: 'Hooks cannot be called inside loops'
        });
      }
    });

    return issues;
  }

  private checkEffectDependencies(change: FileChange): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    
    // Look for useEffect with empty or missing dependency array
    const effectRegex = /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?\},\s*\[\s*\]\s*\)/g;
    const lines = change.content.split('\n');
    
    let match;
    while ((match = effectRegex.exec(change.content)) !== null) {
      // Check if effect uses external values
      const effectBody = match[0];
      const usesState = effectBody.match(/\b(props|state|\w+State)\b/);
      
      if (usesState) {
        const lineNum = change.content.slice(0, match.index).split('\n').length;
        issues.push({
          file: change.path,
          line: lineNum,
          message: 'useEffect has empty dependency array but may use external values',
          severity: 'warning',
          suggestion: 'Review dependencies and add them to the array'
        });
      }
    }

    return issues;
  }

  private checkEventCleanup(change: FileChange): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const content = change.content;
    
    // Check for addEventListener without removeEventListener
    const addListenerMatches = content.match(/addEventListener\s*\(['"]\w+/g) ?? [];
    const removeListenerMatches = content.match(/removeEventListener\s*\(['"]\w+/g) ?? [];
    
    if (addListenerMatches.length > removeListenerMatches.length) {
      issues.push({
        file: change.path,
        message: 'Event listeners added without corresponding cleanup',
        severity: 'warning',
        suggestion: 'Add removeEventListener in cleanup/useEffect return'
      });
    }

    // Check for setInterval without clearInterval
    const setIntervalCount = (content.match(/setInterval\s*\(/g) ?? []).length;
    const clearIntervalCount = (content.match(/clearInterval\s*\(/g) ?? []).length;
    
    if (setIntervalCount > clearIntervalCount) {
      issues.push({
        file: change.path,
        message: 'setInterval used without clearInterval cleanup',
        severity: 'warning',
        suggestion: 'Store interval ID and call clearInterval in cleanup'
      });
    }

    return issues;
  }

  private buildPrompt(task: string, context: ContextBundle): string {
    let prompt = `## Hooks/Lifecycle Task\n${task}\n\n`;
    
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
      return '✅ No hook rule violations found';
    }

    const lines = [`⚠️ Found ${totalIssues} hook-related issue(s):\n`];
    
    results.forEach(r => {
      r.issues.forEach(issue => {
        lines.push(`- ${issue.file}${issue.line ? `:${issue.line}` : ''}: ${issue.message}`);
        if (issue.suggestion) lines.push(`  → ${issue.suggestion}`);
      });
    });

    return lines.join('\n');
  }
}

export const hooksAgent = new HooksAgent();
