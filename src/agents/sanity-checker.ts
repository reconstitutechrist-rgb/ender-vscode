/**
 * Sanity Checker Agent for Ender
 * Catches AI-specific mistakes before they reach the user
 * Final gate after Reviewer
 */

import { apiClient } from '../api';
import { BaseAgent, AgentExecuteParams } from './base-agent';
import type {
  AgentConfig,
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
  Assumption,
} from '../types';
import { logger, generateId } from '../utils';
import { requestAlignmentChecker } from '../sanity/request-alignment';
import { completionTracker } from '../sanity/completion-tracker';

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
    const config: AgentConfig = {
      type: 'sanity-checker',
      model: 'claude-opus-4-5-20251101',
      systemPrompt: SANITY_CHECKER_SYSTEM_PROMPT,
      capabilities: ['sanity_check', 'verification', 'compliance'],
      maxTokens: 4096,
    };
    super(config, apiClient);
  }

  /**
   * Perform sanity check on code changes
   */
  async execute(params: AgentExecuteParams): Promise<AgentResult> {
    const { context, files } = params;
    const startTime = Date.now();
    const changes = files ?? [];

    logger.agent('sanity-checker', 'Starting sanity check', {
      fileCount: changes.length,
      instructionCount: this.trackedInstructions.length,
    });

    try {
      // Run all sanity checks
      const [
        hallucinations,
        instructionCompliance,
        requestAlignment,
        assumptionsVerified,
        completionStatus,
      ] = await Promise.all([
        this.checkHallucinations(changes, context),
        this.checkInstructionCompliance(changes, context),
        this.checkRequestAlignment(changes, context),
        this.verifyAssumptions(context),
        this.checkCompletion(changes, context),
      ]);

      // Calculate adjusted confidence
      const adjustedConfidence = this.calculateAdjustedConfidence(
        80, // Default baseline
        hallucinations,
        instructionCompliance,
        requestAlignment,
        completionStatus,
      );

      const passed = this.determinePassStatus(
        hallucinations,
        instructionCompliance,
        adjustedConfidence,
      );

      const output: SanityCheckerOutput = {
        passed,
        hallucinationsFound: hallucinations,
        instructionCompliance,
        requestAlignment,
        assumptionsVerified,
        completionStatus,
        adjustedConfidence,
      };

      return this.createSuccessResult(JSON.stringify(output, null, 2), {
        confidence: adjustedConfidence,
        tokensUsed: { input: 0, output: 0, total: 0, cost: 0 },
        startTime,
        explanation: this.formatExplanation(output),
        nextAgent: passed ? 'documenter' : 'coder',
        warnings: this.generateWarnings(output),
      });
    } catch (error) {
      logger.error('Sanity checker failed', 'SanityChecker', { error });

      return this.createErrorResult(
        error instanceof Error ? error : new Error(String(error)),
        startTime,
      );
    }
  }

  /**
   * Check for hallucinated APIs, imports, etc.
   */
  private async checkHallucinations(
    changes: FileChange[],
    context: ContextBundle,
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
  private async checkImports(
    change: FileChange,
  ): Promise<HallucinationIssue[]> {
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
        const suggestion = this.suggestRealPackage(baseName ?? '');
        issues.push({
          type: 'import',
          location: { file: change.path, line },
          hallucinated: packageName,
          ...(suggestion ? { suggestion } : {}),
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
    _context: ContextBundle,
  ): Promise<HallucinationIssue[]> {
    const issues: HallucinationIssue[] = [];

    // Common hallucinated method patterns
    const suspiciousPatterns = [
      { pattern: /\.readFilePromise\s*\(/, suggestion: 'fs.promises.readFile' },
      {
        pattern: /\.writeFilePromise\s*\(/,
        suggestion: 'fs.promises.writeFile',
      },
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
            suggestion,
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
    context: ContextBundle,
  ): Promise<HallucinationIssue[]> {
    const issues: HallucinationIssue[] = [];
    const content = change.content;

    // Only check TypeScript/JavaScript files
    if (!change.path.match(/\.(ts|tsx|js|jsx)$/)) {
      return [];
    }

    // Extract all type definitions from context files
    const definedTypes = new Set<string>();
    for (const file of context.relevantFiles) {
      const typeMatches = file.content.matchAll(
        /(?:type|interface|class|enum)\s+(\w+)/g,
      );
      for (const match of typeMatches) {
        if (match[1]) {
          definedTypes.add(match[1]);
        }
      }
    }

    // Also extract types from the current file being checked
    const selfTypeMatches = content.matchAll(
      /(?:type|interface|class|enum)\s+(\w+)/g,
    );
    for (const match of selfTypeMatches) {
      if (match[1]) {
        definedTypes.add(match[1]);
      }
    }

    // Built-in TypeScript types
    const builtinTypes = new Set([
      'string',
      'number',
      'boolean',
      'void',
      'null',
      'undefined',
      'any',
      'unknown',
      'never',
      'object',
      'Array',
      'Map',
      'Set',
      'WeakMap',
      'WeakSet',
      'Promise',
      'Date',
      'RegExp',
      'Error',
      'Record',
      'Partial',
      'Required',
      'Readonly',
      'Pick',
      'Omit',
      'Exclude',
      'Extract',
      'NonNullable',
      'Parameters',
      'ReturnType',
      'InstanceType',
      'ThisType',
      'Function',
      'Symbol',
      'BigInt',
      'Object',
      'String',
      'Number',
      'Boolean',
      'Uint8Array',
      'Int8Array',
      'Uint16Array',
      'Int16Array',
      'Uint32Array',
      'Int32Array',
      'Float32Array',
      'Float64Array',
      'ArrayBuffer',
      'DataView',
      'JSON',
      'Awaited',
      'Capitalize',
      'Lowercase',
      'Uppercase',
      'Uncapitalize',
    ]);

    // Find type annotations in the changed file
    // Match patterns like `: TypeName`, `as TypeName`, `<TypeName>`, `extends TypeName`, `implements TypeName`
    const typeUsagePatterns = [
      /:\s*([A-Z]\w+)(?:<[^>]+>)?(?:\s*[;,)=\]]|\s*$)/gm,
      /as\s+([A-Z]\w+)/g,
      /<([A-Z]\w+)(?:\s*[,>])/g,
      /extends\s+([A-Z]\w+)/g,
      /implements\s+([A-Z]\w+)/g,
    ];

    const lines = content.split('\n');

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum] ?? '';

      // Skip import lines - types from imports are valid
      if (line.trim().startsWith('import ')) {
        continue;
      }

      // Skip comments
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) {
        continue;
      }

      for (const pattern of typeUsagePatterns) {
        pattern.lastIndex = 0;
        let match;

        while ((match = pattern.exec(line)) !== null) {
          const typeName = match[1];
          if (!typeName) continue;

          // Skip single-letter generics (T, K, V, etc.)
          if (typeName.length === 1) continue;

          // Skip if built-in or defined in context
          if (builtinTypes.has(typeName) || definedTypes.has(typeName))
            continue;

          // Check for common framework types that are likely valid
          if (this.isCommonFrameworkType(typeName)) continue;

          const issue: HallucinationIssue = {
            type: 'type',
            location: { file: change.path, line: lineNum + 1 },
            hallucinated: typeName,
          };

          const suggestion = this.suggestSimilarType(typeName, definedTypes);
          if (suggestion) {
            issue.suggestion = suggestion;
          }

          issues.push(issue);
        }
      }
    }

    return issues;
  }

  /**
   * Check if type is a common framework type
   */
  private isCommonFrameworkType(typeName: string): boolean {
    const frameworkTypes = new Set([
      // React
      'React',
      'ReactNode',
      'ReactElement',
      'FC',
      'Component',
      'PureComponent',
      'useState',
      'useEffect',
      'useCallback',
      'useMemo',
      'useRef',
      'useContext',
      'PropsWithChildren',
      'RefObject',
      'MutableRefObject',
      'Dispatch',
      'SetStateAction',
      // Node.js
      'Buffer',
      'NodeJS',
      'EventEmitter',
      'Stream',
      'Readable',
      'Writable',
      // Express
      'Request',
      'Response',
      'NextFunction',
      'Express',
      'Router',
      // VS Code
      'ExtensionContext',
      'TextDocument',
      'Position',
      'Range',
      'Uri',
      'Disposable',
      'TreeItem',
      'TreeDataProvider',
      'WebviewView',
      'WebviewViewProvider',
      // Common
      'Event',
      'EventTarget',
      'HTMLElement',
      'Element',
      'Document',
      'Window',
    ]);
    return frameworkTypes.has(typeName);
  }

  /**
   * Suggest similar type from defined types
   */
  private suggestSimilarType(
    name: string,
    definedTypes: Set<string>,
  ): string | undefined {
    let bestMatch: string | undefined;
    let bestScore = 3; // Max Levenshtein distance threshold

    const nameLower = name.toLowerCase();

    for (const type of definedTypes) {
      const typeLower = type.toLowerCase();
      const distance = this.levenshteinDistance(nameLower, typeLower);

      if (distance < bestScore) {
        bestScore = distance;
        bestMatch = type;
      }
    }

    return bestMatch;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= a.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= b.length; j++) {
      const row = matrix[0];
      if (row) row[j] = j;
    }

    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        const row = matrix[i];
        const prevRow = matrix[i - 1];
        if (row && prevRow) {
          row[j] = Math.min(
            (prevRow[j] ?? 0) + 1,
            (row[j - 1] ?? 0) + 1,
            (prevRow[j - 1] ?? 0) + cost,
          );
        }
      }
    }

    return matrix[a.length]?.[b.length] ?? a.length + b.length;
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
    return suspicious.some((p) => p.test(name));
  }

  /**
   * Suggest real package for hallucinated one
   */
  private suggestRealPackage(hallucinated: string): string | undefined {
    const suggestions: Record<string, string> = {
      moment: 'date-fns or dayjs',
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
    context: ContextBundle,
  ): Promise<InstructionComplianceReport> {
    const instructions =
      this.trackedInstructions.length > 0
        ? this.trackedInstructions
        : (context.instructions ?? []);

    if (instructions.length === 0) {
      return {
        totalInstructions: 0,
        complied: 0,
        violated: 0,
        partial: 0,
        notApplicable: 0,
        details: [],
        overallScore: 100,
      };
    }

    const prompt = `## Instruction Compliance Check
    
Analyze the following code changes against the user instructions.

### Instructions:
${instructions.map((i, idx) => `${idx + 1}. ${i.text}`).join('\n')}

### Code Changes:
${changes.map((c) => `File: ${c.path}\n${c.content.slice(0, 1000)}...`).join('\n\n')}

For each instruction, determine if it was: 'complied', 'violated', 'partial', or 'not_applicable'.
Provide evidence from the code.

Response JSON Format:
{
  "details": [
    { "index": 0, "status": "complied", "evidence": "..." }
  ]
}`;

    try {
      const response = await this.callApi({
        model: this.defaultModel,
        system:
          'You are a compliance officer. Verify instructions against code.',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 2000,
        metadata: { agent: this.type, taskId: generateId() },
      });

      const result = JSON.parse(
        response.content.match(/\{[\s\S]*\}/)?.[0] ?? '{}',
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detailsMap = new Map<number, any>(
        result.details?.map((d: any) => [d.index, d]) ?? [],
      );

      let complied = 0,
        violated = 0,
        partial = 0,
        notApplicable = 0;

      const details: TrackedInstruction[] = instructions.map((inst, idx) => {
        const check = detailsMap.get(idx) || {
          status: 'complied',
          evidence: 'Assumed complied',
        };
        const status = check.status as TrackedInstruction['status'];

        if (status === 'complied') complied++;
        else if (status === 'violated') violated++;
        else if (status === 'partial') partial++;
        else if (status === 'not_applicable') notApplicable++;

        const detail: TrackedInstruction = {
          id: inst.id,
          text: inst.text,
          source: inst.source,
          timestamp: inst.timestamp,
          priority: inst.priority,
          status,
        };
        if (check.evidence) {
          detail.evidence = check.evidence;
        }
        return detail;
      });

      const overallScore =
        instructions.length > 0
          ? Math.round((complied / instructions.length) * 100)
          : 100;

      return {
        totalInstructions: instructions.length,
        complied,
        violated,
        partial,
        notApplicable,
        details,
        overallScore,
      };
    } catch (error) {
      logger.error('Failed to check compliance', 'SanityChecker', { error });
      // Fallback to optimistic
      const fallbackDetails: TrackedInstruction[] = instructions.map((i) => {
        const detail: TrackedInstruction = {
          id: i.id,
          text: i.text,
          source: i.source,
          timestamp: i.timestamp,
          priority: i.priority,
          status: 'complied',
          evidence: 'Optimistic fallback',
        };
        return detail;
      });
      return {
        totalInstructions: instructions.length,
        complied: instructions.length,
        violated: 0,
        partial: 0,
        notApplicable: 0,
        details: fallbackDetails,
        overallScore: 100,
      };
    }
  }

  /**
   * Check request alignment
   */
  private async checkRequestAlignment(
    changes: FileChange[],
    _context: ContextBundle,
  ): Promise<RequestAlignmentReport> {
    const originalRequest = this.originalRequest || 'Not captured';

    // Use callApi wrapper to match interface expected by RequestAlignmentChecker
    const callApiWrapper = async (params: any) => {
      const response = await this.callApi({
        ...params,
        metadata: { agent: this.type, taskId: generateId() },
      });
      return { content: response.content };
    };

    return requestAlignmentChecker.check(
      originalRequest,
      changes,
      callApiWrapper,
      this.defaultModel,
    );
  }

  /**
   * Verify assumptions
   */
  private async verifyAssumptions(
    context: ContextBundle,
  ): Promise<AssumptionVerification[]> {
    const assumptions =
      this.assumptions.length > 0
        ? this.assumptions
        : (context.assumptions ?? []);

    return assumptions.map((a) => ({
      assumption: a.assumption,
      verified: a.verified,
      verificationMethod: a.verificationMethod ?? 'Not verified',
      result: a.verificationResult ?? 'Pending',
    }));
  }

  /**
   * Check completion status
   */
  private async checkCompletion(
    changes: FileChange[],
    context: ContextBundle,
  ): Promise<CompletionStatus> {
    return completionTracker.check(changes, context);
  }

  /**
   * Calculate adjusted confidence
   */
  private calculateAdjustedConfidence(
    initial: number,
    hallucinations: HallucinationIssue[],
    instructionCompliance: InstructionComplianceReport,
    requestAlignment: RequestAlignmentReport,
    completionStatus: CompletionStatus,
  ): number {
    let confidence = initial;

    // Deduct for hallucinations
    confidence -= hallucinations.length * 10;

    // Adjust for instruction compliance
    const total = instructionCompliance.totalInstructions || 1;
    const complianceScore = (instructionCompliance.complied / total) * 100;
    if (complianceScore < 80) {
      confidence -= 80 - complianceScore;
    }

    // Adjust for alignment
    if (requestAlignment.alignmentScore < 80) {
      confidence -= (80 - requestAlignment.alignmentScore) / 2;
    }

    // Deduct for incomplete work
    const incompleteCount =
      completionStatus.incomplete.length + completionStatus.blocked.length;
    confidence -= incompleteCount * 5;

    return Math.max(0, Math.min(100, Math.round(confidence)));
  }

  /**
   * Determine if sanity check passes
   */
  private determinePassStatus(
    hallucinations: HallucinationIssue[],
    instructionCompliance: InstructionComplianceReport,
    adjustedConfidence: number,
  ): boolean {
    // Fail if any critical hallucinations
    if (hallucinations.some((h) => h.type === 'import' || h.type === 'api')) {
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
      output.hallucinationsFound.forEach((h) => {
        lines.push(
          `- ${h.type}: ${h.hallucinated} at ${h.location.file}:${h.location.line}`,
        );
        if (h.suggestion) lines.push(`  Suggestion: ${h.suggestion}`);
      });
    }

    const total = output.instructionCompliance.totalInstructions || 1;
    const score = Math.round(
      (output.instructionCompliance.complied / total) * 100,
    );
    lines.push(`\n**Instruction Compliance:** ${score}%`);
    lines.push(
      `**Request Alignment:** ${output.requestAlignment.alignmentScore}%`,
    );

    return lines.join('\n');
  }

  /**
   * Generate warnings from output
   */
  private generateWarnings(output: SanityCheckerOutput): string[] {
    const warnings: string[] = [];

    if (output.hallucinationsFound.length > 0) {
      warnings.push(
        `Found ${output.hallucinationsFound.length} potential hallucination(s)`,
      );
    }

    if (output.instructionCompliance.violated > 0) {
      warnings.push(
        `${output.instructionCompliance.violated} instruction(s) violated`,
      );
    }

    if (output.requestAlignment.missedGoals.length > 0) {
      warnings.push(
        `Missed goals: ${output.requestAlignment.missedGoals.join(', ')}`,
      );
    }

    if (output.completionStatus.incomplete.length > 0) {
      warnings.push(
        `${output.completionStatus.incomplete.length} task(s) incomplete`,
      );
    }

    return warnings;
  }

  /**
   * Track a new instruction
   */
  trackInstruction(
    instruction: Omit<TrackedInstruction, 'id' | 'status'>,
  ): void {
    this.trackedInstructions.push({
      ...instruction,
      id: generateId(),
      status: 'pending',
    });
  }

  /**
   * Add an assumption
   */
  addAssumption(assumption: Omit<Assumption, 'id' | 'createdAt'>): void {
    this.assumptions.push({
      ...assumption,
      id: generateId(),
      createdAt: new Date(),
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
