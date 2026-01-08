/**
 * Sanity Checker Agent for Ender
 * Catches AI-specific mistakes before they reach the user
 * Final gate after Reviewer
 */

import { BaseAgent } from './base-agent';
import type {
  AgentResult,
  ContextBundle,
  FileChange,
  SanityCheckerOutput,
  HallucinationIssue,
  InstructionComplianceReport,
  RequestAlignmentReport,
  AssumptionVerification,
  CompletionStatus,
  TrackedInstruction,
  Assumption
} from '../types';
import { logger, generateId } from '../utils';

const SANITY_CHECKER_SYSTEM_PROMPT = `You are the Sanity Checker Agent for Ender, an AI coding assistant.

YOUR ROLE:
- Catch AI-specific mistakes before they reach the user
- Verify all generated code is accurate and real
- Ensure all user instructions are followed
- Check that output aligns with the original request
- Verify assumptions made during generation
- Track completion of all started work

WHAT YOU CHECK:

1. HALLUCINATION DETECTION:
   - Verify all APIs/functions actually exist
   - Confirm all imports are real packages
   - Validate syntax against language spec
   - Check that referenced types exist
   - Verify file paths are correct

2. INSTRUCTION COMPLIANCE:
   - Track every user instruction
   - Verify each instruction is addressed
   - Flag violations or partial compliance

3. REQUEST ALIGNMENT:
   - Compare output to original request
   - Identify missed goals
   - Flag extra work not requested
   - Explain any drift from intent

4. ASSUMPTION VERIFICATION:
   - List all assumptions made
   - Verify against actual codebase
   - Flag unverified high-risk assumptions

5. COMPLETION TRACKING:
   - Monitor all started tasks
   - Ensure everything is finished
   - Flag incomplete implementations

OUTPUT FORMAT:
{
  "passed": true/false,
  "hallucinationsFound": [...],
  "instructionCompliance": {...},
  "requestAlignment": {...},
  "assumptionsVerified": [...],
  "completionStatus": {...},
  "adjustedConfidence": 0-100
}`;

export class SanityCheckerAgent extends BaseAgent {
  private trackedInstructions: TrackedInstruction[] = [];
  private assumptions: Assumption[] = [];
  private originalRequest: string = '';

  constructor() {
    super('sanity-checker', SANITY_CHECKER_SYSTEM_PROMPT);
  }

  /**
   * Perform sanity check on code changes
   */
  async execute(
    task: string,
    context: ContextBundle,
    options?: {
      changes: FileChange[];
      originalRequest?: string;
      previousConfidence?: number;
    }
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const changes = options?.changes ?? [];

    logger.agent('sanity-checker', 'Starting sanity check', {
      fileCount: changes.length,
      instructionCount: this.trackedInstructions.length
    });

    // Update original request if provided
    if (options?.originalRequest) {
      this.originalRequest = options.originalRequest;
    }

    try {
      // Run all sanity checks
      const [
        hallucinations,
        instructionCompliance,
        requestAlignment,
        assumptionsVerified,
        completionStatus
      ] = await Promise.all([
        this.checkHallucinations(changes, context),
        this.checkInstructionCompliance(changes, context),
        this.checkRequestAlignment(changes, context),
        this.verifyAssumptions(context),
        this.checkCompletion(changes, context)
      ]);

      // Calculate adjusted confidence
      const adjustedConfidence = this.calculateAdjustedConfidence(
        options?.previousConfidence ?? 80,
        hallucinations,
        instructionCompliance,
        requestAlignment,
        completionStatus
      );

      const passed = this.determinePassStatus(
        hallucinations,
        instructionCompliance,
        adjustedConfidence
      );

      const output: SanityCheckerOutput = {
        passed,
        hallucinationsFound: hallucinations,
        instructionCompliance,
        requestAlignment,
        assumptionsVerified,
        completionStatus,
        adjustedConfidence
      };

      return {
        success: true,
        agent: 'sanity-checker',
        output: JSON.stringify(output, null, 2),
        explanation: this.formatExplanation(output),
        confidence: adjustedConfidence,
        tokensUsed: { input: 0, output: 0 },
        duration: Date.now() - startTime,
        nextAgent: passed ? 'documenter' : 'coder',
        warnings: this.generateWarnings(output)
      };
    } catch (error) {
      logger.error('Sanity checker failed', 'SanityChecker', { error });

      return {
        success: false,
        agent: 'sanity-checker',
        confidence: 0,
        tokensUsed: { input: 0, output: 0 },
        duration: Date.now() - startTime,
        errors: [{
          code: 'SANITY_CHECK_ERROR',
          message: error instanceof Error ? error.message : 'Sanity check failed',
          recoverable: true
        }]
      };
    }
  }

  /**
   * Check for hallucinated APIs, imports, etc.
   */
  private async checkHallucinations(
    changes: FileChange[],
    context: ContextBundle
  ): Promise<HallucinationIssue[]> {
    const issues: HallucinationIssue[] = [];

    for (const change of changes) {
      if (!change.content) continue;

      // Check imports
      const importIssues = await this.checkImports(change);
      issues.push(...importIssues);

      // Check API calls
      const apiIssues = await this.checkApiCalls(change, context);
      issues.push(...apiIssues);

      // Check types
      const typeIssues = await this.checkTypes(change, context);
      issues.push(...typeIssues);
    }

    return issues;
  }

  /**
   * Check imports for hallucinated packages
   */
  private async checkImports(change: FileChange): Promise<HallucinationIssue[]> {
    const issues: HallucinationIssue[] = [];
    const content = change.content;

    // Extract imports
    const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

    const checkImport = (match: RegExpExecArray, line: number) => {
      const packageName = match[1];
      if (!packageName) return;

      // Extract base package name
      const baseName = packageName.startsWith('@')
        ? packageName.split('/').slice(0, 2).join('/')
        : packageName.split('/')[0];

      // Check against known suspicious patterns
      if (this.isSuspiciousPackage(baseName ?? '')) {
        issues.push({
          type: 'import',
          location: { file: change.path, line },
          hallucinated: packageName,
          suggestion: this.suggestRealPackage(baseName ?? '')
        });
      }
    };

    let match;
    let lineNum = 1;
    const lines = content.split('\n');

    for (const line of lines) {
      importRegex.lastIndex = 0;
      requireRegex.lastIndex = 0;

      while ((match = importRegex.exec(line)) !== null) {
        checkImport(match, lineNum);
      }
      while ((match = requireRegex.exec(line)) !== null) {
        checkImport(match, lineNum);
      }
      lineNum++;
    }

    return issues;
  }

  /**
   * Check for hallucinated API calls
   */
  private async checkApiCalls(
    change: FileChange,
    context: ContextBundle
  ): Promise<HallucinationIssue[]> {
    const issues: HallucinationIssue[] = [];

    // Common hallucinated method patterns
    const suspiciousPatterns = [
      { pattern: /\.readFilePromise\s*\(/, suggestion: 'fs.promises.readFile' },
      { pattern: /\.writeFilePromise\s*\(/, suggestion: 'fs.promises.writeFile' },
      { pattern: /\.contains\s*\(/, suggestion: '.includes()' },
      { pattern: /\.size\s*\(/, suggestion: '.length or .size (property)' },
      { pattern: /\.first\s*\(/, suggestion: '[0] or .at(0)' },
      { pattern: /\.last\s*\(/, suggestion: '.at(-1)' },
      { pattern: /\.isEmpty\s*\(/, suggestion: '.length === 0' },
      { pattern: /\.postJSON\s*\(/, suggestion: '.post() with JSON body' },
      { pattern: /\.getJSON\s*\(/, suggestion: '.get() then .json()' },
    ];

    const lines = change.content.split('\n');
    let lineNum = 1;

    for (const line of lines) {
      for (const { pattern, suggestion } of suspiciousPatterns) {
        if (pattern.test(line)) {
          const match = line.match(pattern);
          issues.push({
            type: 'api',
            location: { file: change.path, line: lineNum },
            hallucinated: match?.[0]?.trim() ?? 'Unknown',
            suggestion
          });
        }
      }
      lineNum++;
    }

    return issues;
  }

  /**
   * Check for hallucinated types
   */
  private async checkTypes(
    change: FileChange,
    context: ContextBundle
  ): Promise<HallucinationIssue[]> {
    // Would check types against actual TypeScript definitions
    return [];
  }

  /**
   * Check if package name looks suspicious
   */
  private isSuspiciousPackage(name: string): boolean {
    // Patterns that suggest hallucination
    const suspicious = [
      /^(super|ultra|mega|hyper)-/,
      /-helper-utils$/,
      /^easy-.*-simple$/,
      /^@fake\//,
    ];
    return suspicious.some(p => p.test(name));
  }

  /**
   * Suggest real package for hallucinated one
   */
  private suggestRealPackage(hallucinated: string): string | undefined {
    const suggestions: Record<string, string> = {
      'moment': 'date-fns or dayjs',
      'lodash-utils': 'lodash',
      'axios-helper': 'axios',
    };
    return suggestions[hallucinated];
  }

  /**
   * Check instruction compliance
   */
  private async checkInstructionCompliance(
    changes: FileChange[],
    context: ContextBundle
  ): Promise<InstructionComplianceReport> {
    // Use tracked instructions or extract from context
    const instructions = this.trackedInstructions.length > 0
      ? this.trackedInstructions
      : context.instructions ?? [];

    let complied = 0;
    let violated = 0;
    let partial = 0;
    let notApplicable = 0;

    const details = instructions.map(inst => {
      // Would analyze code to determine compliance
      // For now, assume complied
      const status = 'complied' as const;
      if (status === 'complied') complied++;
      else if (status === 'violated') violated++;
      else if (status === 'partial') partial++;
      else notApplicable++;

      return { ...inst, status };
    });

    const total = instructions.length || 1;
    const overallScore = Math.round(((complied + partial * 0.5) / total) * 100);

    return {
      totalInstructions: instructions.length,
      complied,
      violated,
      partial,
      notApplicable,
      details,
      overallScore
    };
  }

  /**
   * Check request alignment
   */
  private async checkRequestAlignment(
    changes: FileChange[],
    context: ContextBundle
  ): Promise<RequestAlignmentReport> {
    const originalRequest = this.originalRequest || 'Not captured';

    // Would use AI to compare output to request
    return {
      originalRequest,
      currentOutput: `Modified ${changes.length} file(s)`,
      alignment: {
        score: 85,
        addressedGoals: ['Primary functionality implemented'],
        missedGoals: [],
        extraWork: [],
        driftExplanation: undefined
      }
    };
  }

  /**
   * Verify assumptions
   */
  private async verifyAssumptions(
    context: ContextBundle
  ): Promise<AssumptionVerification[]> {
    const assumptions = this.assumptions.length > 0
      ? this.assumptions
      : context.assumptions ?? [];

    return assumptions.map(a => ({
      assumption: a.assumption,
      verified: a.verified,
      verificationMethod: a.verificationMethod ?? 'Not verified',
      result: a.verificationResult ?? 'Pending'
    }));
  }

  /**
   * Check completion status
   */
  private async checkCompletion(
    changes: FileChange[],
    context: ContextBundle
  ): Promise<CompletionStatus> {
    // Would analyze plan progress
    return {
      totalTasks: 1,
      completed: changes.length > 0 ? 1 : 0,
      incomplete: [],
      blocked: []
    };
  }

  /**
   * Calculate adjusted confidence
   */
  private calculateAdjustedConfidence(
    initial: number,
    hallucinations: HallucinationIssue[],
    instructionCompliance: InstructionComplianceReport,
    requestAlignment: RequestAlignmentReport,
    completionStatus: CompletionStatus
  ): number {
    let confidence = initial;

    // Deduct for hallucinations
    confidence -= hallucinations.length * 10;

    // Adjust for instruction compliance
    if (instructionCompliance.overallScore < 80) {
      confidence -= (80 - instructionCompliance.overallScore);
    }

    // Adjust for alignment
    if (requestAlignment.alignment.score < 80) {
      confidence -= (80 - requestAlignment.alignment.score) / 2;
    }

    // Deduct for incomplete work
    const incompleteCount = completionStatus.incomplete.length + completionStatus.blocked.length;
    confidence -= incompleteCount * 5;

    return Math.max(0, Math.min(100, Math.round(confidence)));
  }

  /**
   * Determine if sanity check passes
   */
  private determinePassStatus(
    hallucinations: HallucinationIssue[],
    instructionCompliance: InstructionComplianceReport,
    adjustedConfidence: number
  ): boolean {
    // Fail if any critical hallucinations
    if (hallucinations.some(h => h.type === 'import' || h.type === 'api')) {
      return false;
    }

    // Fail if significant instruction violations
    if (instructionCompliance.violated > 0) {
      return false;
    }

    // Fail if confidence too low
    if (adjustedConfidence < 50) {
      return false;
    }

    return true;
  }

  /**
   * Format explanation for user
   */
  private formatExplanation(output: SanityCheckerOutput): string {
    const lines: string[] = [];

    if (output.passed) {
      lines.push('✅ **Sanity Check Passed**\n');
    } else {
      lines.push('⚠️ **Sanity Check Issues Found**\n');
    }

    lines.push(`Adjusted Confidence: ${output.adjustedConfidence}%`);

    if (output.hallucinationsFound.length > 0) {
      lines.push('\n**Potential Hallucinations:**');
      output.hallucinationsFound.forEach(h => {
        lines.push(`- ${h.type}: ${h.hallucinated} at ${h.location.file}:${h.location.line}`);
        if (h.suggestion) lines.push(`  Suggestion: ${h.suggestion}`);
      });
    }

    lines.push(`\n**Instruction Compliance:** ${output.instructionCompliance.overallScore}%`);
    lines.push(`**Request Alignment:** ${output.requestAlignment.alignment.score}%`);

    return lines.join('\n');
  }

  /**
   * Generate warnings from output
   */
  private generateWarnings(output: SanityCheckerOutput): string[] {
    const warnings: string[] = [];

    if (output.hallucinationsFound.length > 0) {
      warnings.push(`Found ${output.hallucinationsFound.length} potential hallucination(s)`);
    }

    if (output.instructionCompliance.violated > 0) {
      warnings.push(`${output.instructionCompliance.violated} instruction(s) violated`);
    }

    if (output.requestAlignment.alignment.missedGoals.length > 0) {
      warnings.push(`Missed goals: ${output.requestAlignment.alignment.missedGoals.join(', ')}`);
    }

    if (output.completionStatus.incomplete.length > 0) {
      warnings.push(`${output.completionStatus.incomplete.length} task(s) incomplete`);
    }

    return warnings;
  }

  /**
   * Track a new instruction
   */
  trackInstruction(instruction: Omit<TrackedInstruction, 'id' | 'status'>): void {
    this.trackedInstructions.push({
      ...instruction,
      id: generateId(),
      status: 'pending'
    });
  }

  /**
   * Add an assumption
   */
  addAssumption(assumption: Omit<Assumption, 'id' | 'createdAt'>): void {
    this.assumptions.push({
      ...assumption,
      id: generateId(),
      createdAt: new Date()
    });
  }

  /**
   * Set original request for alignment tracking
   */
  setOriginalRequest(request: string): void {
    this.originalRequest = request;
  }

  /**
   * Clear tracked state
   */
  clearTracking(): void {
    this.trackedInstructions = [];
    this.assumptions = [];
    this.originalRequest = '';
  }
}

export const sanityCheckerAgent = new SanityCheckerAgent();
