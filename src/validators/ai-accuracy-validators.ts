/**
 * Stage 6: AI Accuracy Validators
 * api-existence-validator, dependency-verifier, deprecation-detector, style-matcher
 * complexity-analyzer, edge-case-checker, refactor-completeness, doc-sync-validator
 */

import {
  BaseValidator,
  ValidatorContext,
  extractImports,
  extractFunctionCalls,
} from './base-validator';
import type {
  ValidationIssue,
  ApiExistenceResult,
  DependencyVerifierResult,
  DeprecationResult,
  StyleMatcherResult,
  ComplexityAnalyzerResult,
  EdgeCaseResult,
  RefactorCompletenessResult,
  DocSyncResult,
} from '../types';

/**
 * API Existence Validator
 * Verifies all called functions/methods actually exist
 */
export class ApiExistenceValidator extends BaseValidator {
  readonly name = 'api-existence-validator' as const;
  readonly stage = 'ai-accuracy' as const;

  async run(context: ValidatorContext): Promise<ApiExistenceResult> {
    const baseResult = await super.run(context);
    const hallucinations: ApiExistenceResult['hallucinations'] =
      baseResult.issues.map((issue) => {
        const item: ApiExistenceResult['hallucinations'][number] = {
          file: issue.file,
          line: issue.line ?? 0,
          call: this.extractCall(issue.message),
          type: 'method' as const,
        };
        if (issue.suggestion !== undefined) {
          item.suggestion = issue.suggestion;
        }
        return item;
      });
    return { ...baseResult, hallucinations };
  }

  private extractCall(message: string): string {
    const match = message.match(/'([^']+)'/);
    return match?.[1] ?? 'unknown';
  }

  // Known common APIs that are often hallucinated
  private knownMistakes: Record<string, string> = {
    'fs.readFilePromise': 'fs.promises.readFile',
    'fs.writeFilePromise': 'fs.promises.writeFile',
    'array.contains': 'array.includes',
    'string.contains': 'string.includes',
    'object.hasKey': 'Object.hasOwn or "key" in object',
    'array.remove': 'array.filter or array.splice',
    'array.first': 'array[0] or array.at(0)',
    'array.last': 'array[array.length-1] or array.at(-1)',
    'string.isEmpty': 'string.length === 0 or !string',
    'axios.postJSON': 'axios.post',
    'console.write': 'console.log',
    'Math.clamp': 'Math.min(Math.max(val, min), max)',
  };

  protected async validate(
    context: ValidatorContext,
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    for (const change of context.changes) {
      const calls = extractFunctionCalls(change.content);

      for (const call of calls) {
        const fullCall = call.object
          ? `${call.object}.${call.call}`
          : call.call;

        // Check against known hallucinations
        if (this.knownMistakes[fullCall]) {
          issues.push(
            this.createIssue(
              change.path,
              `'${fullCall}' doesn't exist - use ${this.knownMistakes[fullCall]}`,
              'error',
              {
                line: call.line,
                code: 'API_HALLUCINATED',
                suggestion: this.knownMistakes[fullCall],
              },
            ),
          );
        }

        // Check for common patterns of hallucination
        if (call.object && this.isLikelyHallucination(call.object, call.call)) {
          issues.push(
            this.createIssue(
              change.path,
              `'${fullCall}' may not exist - verify this method`,
              'warning',
              { line: call.line, code: 'API_UNVERIFIED' },
            ),
          );
        }
      }
    }

    return issues;
  }

  private isLikelyHallucination(object: string, method: string): boolean {
    // Methods that don't exist on common objects
    const invalidArrayMethods = [
      'contains',
      'remove',
      'first',
      'last',
      'isEmpty',
      'clear',
    ];
    const invalidStringMethods = ['contains', 'isEmpty', 'toArray', 'chars'];
    const invalidObjectMethods = ['hasKey', 'getKeys', 'getValues'];

    if (
      ['array', 'arr', 'list', 'items'].some((n) =>
        object.toLowerCase().includes(n),
      )
    ) {
      if (invalidArrayMethods.includes(method)) return true;
    }

    if (
      ['string', 'str', 'text', 'name'].some((n) =>
        object.toLowerCase().includes(n),
      )
    ) {
      if (invalidStringMethods.includes(method)) return true;
    }

    if (
      ['object', 'obj', 'data'].some((n) => object.toLowerCase().includes(n))
    ) {
      if (invalidObjectMethods.includes(method)) return true;
    }

    return false;
  }
}

/**
 * Dependency Verifier
 * Confirms all imports reference installed packages
 */
export class DependencyVerifierValidator extends BaseValidator {
  readonly name = 'dependency-verifier' as const;
  readonly stage = 'ai-accuracy' as const;

  async run(context: ValidatorContext): Promise<DependencyVerifierResult> {
    const baseResult = await super.run(context);
    const dependencyIssues: DependencyVerifierResult['dependencyIssues'] =
      baseResult.issues.map((issue) => {
        const item: DependencyVerifierResult['dependencyIssues'][number] = {
          file: issue.file,
          line: issue.line ?? 0,
          importStatement: issue.message,
          package: this.extractPackage(issue.message),
          issue: this.mapDependencyIssue(issue.code ?? ''),
        };
        if (issue.suggestion !== undefined) {
          item.suggestion = issue.suggestion;
        }
        return item;
      });
    return {
      ...baseResult,
      dependencyIssues,
      missingPeerDeps: [],
      versionMismatches: [],
    };
  }

  private extractPackage(message: string): string {
    const match = message.match(/'([^']+)'/);
    return match?.[1] ?? 'unknown';
  }

  private mapDependencyIssue(
    code: string,
  ): 'not_installed' | 'not_in_package_json' | 'wrong_name' | 'deprecated_package' {
    if (code.includes('NOT_INSTALLED') || code.includes('UNKNOWN'))
      return 'not_installed';
    if (code.includes('DEPRECATED')) return 'deprecated_package';
    return 'not_in_package_json';
  }

  protected async validate(
    context: ValidatorContext,
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    // Get known dependencies from package.json if available
    const knownDeps = (this.options.dependencies as string[]) ?? [];
    const knownDevDeps = (this.options.devDependencies as string[]) ?? [];
    const allKnownDeps = new Set([...knownDeps, ...knownDevDeps]);

    for (const change of context.changes) {
      const imports = extractImports(change.content);

      for (const imp of imports) {
        // Skip relative imports
        if (imp.module.startsWith('.') || imp.module.startsWith('/')) continue;

        // Get package name (handle scoped packages)
        const packageName = imp.module.startsWith('@')
          ? imp.module.split('/').slice(0, 2).join('/')
          : imp.module.split('/')[0];

        if (!packageName) continue;

        // Skip node built-ins
        if (this.isNodeBuiltin(packageName)) continue;

        // Check if dependency is known
        if (allKnownDeps.size > 0 && !allKnownDeps.has(packageName)) {
          issues.push(
            this.createIssue(
              change.path,
              `Package '${packageName}' may not be installed`,
              'warning',
              {
                line: imp.line,
                code: 'DEP_NOT_INSTALLED',
                suggestion: `Run: npm install ${packageName}`,
              },
            ),
          );
        }

        // Check for commonly misspelled packages
        const correction = this.checkCommonMisspellings(packageName);
        if (correction) {
          issues.push(
            this.createIssue(
              change.path,
              `Package '${packageName}' may be misspelled - did you mean '${correction}'?`,
              'error',
              { line: imp.line, code: 'DEP_MISSPELLED' },
            ),
          );
        }
      }
    }

    return issues;
  }

  private isNodeBuiltin(name: string): boolean {
    const builtins = [
      'fs',
      'path',
      'os',
      'util',
      'events',
      'stream',
      'http',
      'https',
      'crypto',
      'buffer',
      'querystring',
      'url',
      'child_process',
      'cluster',
      'dgram',
      'dns',
      'domain',
      'net',
      'readline',
      'repl',
      'tls',
      'tty',
      'vm',
      'zlib',
      'assert',
      'console',
      'process',
      'timers',
      'module',
      'node:fs',
      'node:path',
      'node:crypto', // Node 16+ prefixed imports
    ];
    return builtins.includes(name) || name.startsWith('node:');
  }

  private checkCommonMisspellings(name: string): string | null {
    const misspellings: Record<string, string> = {
      lodash: 'lodash', // underscore vs lodash confusion
      axois: 'axios',
      expresss: 'express',
      reat: 'react',
      raect: 'react',
      mongose: 'mongoose',
      sequalize: 'sequelize',
      knexjs: 'knex',
    };
    return misspellings[name.toLowerCase()] ?? null;
  }
}

/**
 * Deprecation Detector
 * Flags outdated APIs and patterns
 */
export class DeprecationDetectorValidator extends BaseValidator {
  readonly name = 'deprecation-detector' as const;
  readonly stage = 'ai-accuracy' as const;
  protected severity = 'warning' as const;

  async run(context: ValidatorContext): Promise<DeprecationResult> {
    const baseResult = await super.run(context);
    const deprecations: DeprecationResult['deprecations'] = baseResult.issues.map(
      (issue) => ({
        file: issue.file,
        line: issue.line ?? 0,
        deprecated: this.extractDeprecated(issue.message),
        reason: issue.message,
        replacement: issue.suggestion ?? '',
        autoFixAvailable: false,
      }),
    );
    return { ...baseResult, deprecations };
  }

  private extractDeprecated(message: string): string {
    const match = message.match(/(\w+)\s+is deprecated/);
    return match?.[1] ?? 'unknown';
  }

  private deprecationsData: Array<{
    pattern: RegExp;
    message: string;
    replacement: string;
  }> = [
    {
      pattern: /componentWillMount\s*\(/,
      message: 'componentWillMount is deprecated',
      replacement: 'Use componentDidMount or useEffect',
    },
    {
      pattern: /componentWillReceiveProps\s*\(/,
      message: 'componentWillReceiveProps is deprecated',
      replacement: 'Use getDerivedStateFromProps or useEffect',
    },
    {
      pattern: /componentWillUpdate\s*\(/,
      message: 'componentWillUpdate is deprecated',
      replacement: 'Use getSnapshotBeforeUpdate or useEffect',
    },
    {
      pattern: /findDOMNode\s*\(/,
      message: 'findDOMNode is deprecated',
      replacement: 'Use refs instead',
    },
    {
      pattern: /substr\s*\(/,
      message: 'String.substr is deprecated',
      replacement: 'Use String.slice or String.substring',
    },
    {
      pattern: /__proto__/,
      message: '__proto__ is deprecated',
      replacement: 'Use Object.getPrototypeOf/setPrototypeOf',
    },
    {
      pattern: /escape\s*\(/,
      message: 'escape() is deprecated',
      replacement: 'Use encodeURIComponent',
    },
    {
      pattern: /unescape\s*\(/,
      message: 'unescape() is deprecated',
      replacement: 'Use decodeURIComponent',
    },
    {
      pattern: /new Buffer\s*\(/,
      message: 'new Buffer() is deprecated',
      replacement: 'Use Buffer.from() or Buffer.alloc()',
    },
  ];

  protected async validate(
    context: ValidatorContext,
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    for (const change of context.changes) {
      const lines = change.content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';

        for (const dep of this.deprecationsData) {
          if (dep.pattern.test(line)) {
            issues.push(
              this.createIssue(change.path, dep.message, 'warning', {
                line: i + 1,
                code: 'DEPRECATED_API',
                suggestion: dep.replacement,
              }),
            );
          }
        }
      }
    }

    return issues;
  }
}

/**
 * Style Matcher
 * Ensures new code matches project style
 */
export class StyleMatcherValidator extends BaseValidator {
  readonly name = 'style-matcher' as const;
  readonly stage = 'ai-accuracy' as const;
  protected severity = 'info' as const;

  async run(context: ValidatorContext): Promise<StyleMatcherResult> {
    const baseResult = await super.run(context);
    const inconsistencies: StyleMatcherResult['inconsistencies'] =
      baseResult.issues.map((issue) => ({
        file: issue.file,
        line: issue.line ?? 0,
        category: 'formatting' as const,
        existing: 'project style',
        generated: issue.message,
        suggestion: issue.suggestion ?? '',
      }));
    const detectedPatterns: StyleMatcherResult['detectedPatterns'] = {
      namingConvention: 'camelCase',
      quoteStyle: 'single',
      semicolons: true,
      indentation: 'spaces',
      indentSize: 2,
      trailingCommas: true,
      importStyle: 'named',
      exportStyle: 'named',
      asyncStyle: 'async_await',
      errorHandling: 'try_catch',
    };
    return { ...baseResult, inconsistencies, detectedPatterns };
  }

  protected async validate(
    context: ValidatorContext,
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    // Detect project style from existing files
    const existingStyle = this.detectProjectStyle(context.existingFiles);

    for (const change of context.changes) {
      const changeStyle = this.analyzeStyle(change.content);
      issues.push(
        ...this.compareStyles(existingStyle, changeStyle, change.path),
      );
    }

    return issues;
  }

  private detectProjectStyle(
    files: Map<string, string>,
  ): Record<string, string> {
    const style: Record<string, string> = {};
    let singleQuotes = 0,
      doubleQuotes = 0;
    let semicolons = 0,
      noSemicolons = 0;
    let tabs = 0,
      spaces = 0;

    for (const content of files.values()) {
      // Quote style
      singleQuotes += (content.match(/'/g) ?? []).length;
      doubleQuotes += (content.match(/"/g) ?? []).length;

      // Semicolons
      semicolons += (content.match(/;\s*$/gm) ?? []).length;
      noSemicolons += (content.match(/[^;]\s*$/gm) ?? []).length;

      // Indentation
      tabs += (content.match(/^\t/gm) ?? []).length;
      spaces += (content.match(/^  /gm) ?? []).length;
    }

    style['quotes'] = singleQuotes > doubleQuotes ? 'single' : 'double';
    style['semicolons'] = semicolons > noSemicolons ? 'yes' : 'no';
    style['indent'] = tabs > spaces ? 'tabs' : 'spaces';

    return style;
  }

  private analyzeStyle(content: string): Record<string, string> {
    const style: Record<string, string> = {};

    const singleQuotes = (content.match(/'/g) ?? []).length;
    const doubleQuotes = (content.match(/"/g) ?? []).length;
    style['quotes'] = singleQuotes > doubleQuotes ? 'single' : 'double';

    const semicolons = (content.match(/;\s*$/gm) ?? []).length;
    const lines = content.split('\n').length;
    style['semicolons'] = semicolons > lines * 0.3 ? 'yes' : 'no';

    const tabs = (content.match(/^\t/gm) ?? []).length;
    const spaces = (content.match(/^  /gm) ?? []).length;
    style['indent'] = tabs > spaces ? 'tabs' : 'spaces';

    return style;
  }

  private compareStyles(
    project: Record<string, string>,
    change: Record<string, string>,
    filePath: string,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (
      project['quotes'] &&
      change['quotes'] &&
      project['quotes'] !== change['quotes']
    ) {
      issues.push(
        this.createIssue(
          filePath,
          `Quote style inconsistent (project uses ${project['quotes']}, file uses ${change['quotes']})`,
          'info',
          { code: 'STYLE_QUOTES' },
        ),
      );
    }

    if (
      project['semicolons'] &&
      change['semicolons'] &&
      project['semicolons'] !== change['semicolons']
    ) {
      issues.push(
        this.createIssue(
          filePath,
          `Semicolon usage inconsistent with project style`,
          'info',
          { code: 'STYLE_SEMICOLONS' },
        ),
      );
    }

    if (
      project['indent'] &&
      change['indent'] &&
      project['indent'] !== change['indent']
    ) {
      issues.push(
        this.createIssue(
          filePath,
          `Indentation style inconsistent (project uses ${project['indent']})`,
          'info',
          { code: 'STYLE_INDENT' },
        ),
      );
    }

    return issues;
  }
}

/**
 * Complexity Analyzer
 * Flags over/under-engineered solutions
 */
export class ComplexityAnalyzerValidator extends BaseValidator {
  readonly name = 'complexity-analyzer' as const;
  readonly stage = 'ai-accuracy' as const;

  async run(context: ValidatorContext): Promise<ComplexityAnalyzerResult> {
    const baseResult = await super.run(context);
    const complexityIssues: ComplexityAnalyzerResult['complexityIssues'] =
      baseResult.issues.map((issue) => ({
        file: issue.file,
        line: issue.line ?? 0,
        type: this.mapComplexityType(issue.code ?? ''),
        description: issue.message,
        complexity: {
          cyclomatic: this.extractComplexityValue(issue.message),
          cognitive: 0,
          linesOfCode: 0,
          dependencies: 0,
        },
        suggestion: issue.suggestion ?? 'Consider refactoring',
      }));
    return {
      ...baseResult,
      complexityIssues,
    };
  }

  private mapComplexityType(
    code: string,
  ): 'over_engineered' | 'under_engineered' {
    if (code.includes('UNDER') || code.includes('SIMPLE')) return 'under_engineered';
    return 'over_engineered';
  }

  private extractComplexityValue(message: string): number {
    const match = message.match(/(\d+)/);
    return match && match[1] ? parseInt(match[1], 10) : 0;
  }

  protected async validate(
    context: ValidatorContext,
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    const maxComplexity =
      (this.options.maxCyclomaticComplexity as number) ?? 10;
    const maxFunctionLength = (this.options.maxFunctionLength as number) ?? 50;

    for (const change of context.changes) {
      issues.push(
        ...this.analyzeComplexity(
          change.content,
          change.path,
          maxComplexity,
          maxFunctionLength,
        ),
      );
    }

    return issues;
  }

  private analyzeComplexity(
    content: string,
    filePath: string,
    maxComplexity: number,
    maxLength: number,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const functions = this.extractFunctions(content);

    for (const fn of functions) {
      // Calculate cyclomatic complexity
      const complexity = this.calculateCyclomaticComplexity(fn.body);

      if (complexity > maxComplexity) {
        issues.push(
          this.createIssue(
            filePath,
            `Function '${fn.name}' has high cyclomatic complexity (${complexity})`,
            'warning',
            {
              line: fn.startLine,
              code: 'COMPLEX_HIGH_CYCLOMATIC',
              suggestion: 'Consider breaking into smaller functions',
            },
          ),
        );
      }

      // Check function length
      const lines = fn.body.split('\n').length;
      if (lines > maxLength) {
        issues.push(
          this.createIssue(
            filePath,
            `Function '${fn.name}' is ${lines} lines long`,
            'warning',
            {
              line: fn.startLine,
              code: 'COMPLEX_LONG_FUNCTION',
              suggestion: `Consider breaking into smaller functions (max ${maxLength} lines)`,
            },
          ),
        );
      }

      // Check for under-engineering (missing error handling)
      if (this.hasAsyncOperation(fn.body) && !this.hasErrorHandling(fn.body)) {
        issues.push(
          this.createIssue(
            filePath,
            `Function '${fn.name}' has async operations without error handling`,
            'warning',
            {
              line: fn.startLine,
              code: 'COMPLEX_NO_ERROR_HANDLING',
              suggestion: 'Add try/catch or .catch() for error handling',
            },
          ),
        );
      }
    }

    return issues;
  }

  private extractFunctions(
    content: string,
  ): Array<{ name: string; body: string; startLine: number }> {
    const functions: Array<{ name: string; body: string; startLine: number }> =
      [];
    const regex =
      /(?:async\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>|(\w+)\s*\([^)]*\)\s*{)/g;

    let match;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1] ?? match[2] ?? match[3] ?? 'anonymous';
      const startLine = content.substring(0, match.index).split('\n').length;

      // Extract function body
      let braceCount = 0;
      let started = false;
      let bodyStart = match.index;
      let bodyEnd = content.length;

      for (let i = match.index; i < content.length; i++) {
        if (content[i] === '{') {
          if (!started) bodyStart = i;
          braceCount++;
          started = true;
        } else if (content[i] === '}') {
          braceCount--;
          if (started && braceCount === 0) {
            bodyEnd = i + 1;
            break;
          }
        }
      }

      functions.push({
        name,
        body: content.substring(bodyStart, bodyEnd),
        startLine,
      });
    }

    return functions;
  }

  private calculateCyclomaticComplexity(code: string): number {
    let complexity = 1;
    const patterns = [
      /\bif\s*\(/g,
      /\belse\s+if\s*\(/g,
      /\bfor\s*\(/g,
      /\bwhile\s*\(/g,
      /\bcase\s+/g,
      /\bcatch\s*\(/g,
      /\?\?/g,
      /\|\|/g,
      /&&/g,
      /\?[^:]*:/g,
    ];

    for (const pattern of patterns) {
      complexity += (code.match(pattern) ?? []).length;
    }

    return complexity;
  }

  private hasAsyncOperation(code: string): boolean {
    return /await\s+|\.then\s*\(|fetch\s*\(|axios\.|\.subscribe\s*\(/.test(
      code,
    );
  }

  private hasErrorHandling(code: string): boolean {
    return /try\s*{|\.catch\s*\(|\.finally\s*\(/.test(code);
  }
}

/**
 * Edge Case Checker
 * Identifies missing error handling
 */
export class EdgeCaseCheckerValidator extends BaseValidator {
  readonly name = 'edge-case-checker' as const;
  readonly stage = 'ai-accuracy' as const;

  async run(context: ValidatorContext): Promise<EdgeCaseResult> {
    const baseResult = await super.run(context);
    const missingHandling: EdgeCaseResult['missingHandling'] =
      baseResult.issues.map((issue) => ({
        file: issue.file,
        line: issue.line ?? 0,
        context: issue.message,
        edgeCase: this.mapEdgeCaseType(issue.code ?? ''),
        risk: this.mapEdgeCaseRisk(issue.severity),
        suggestion: issue.suggestion ?? 'Add appropriate handling',
      }));
    return {
      ...baseResult,
      missingHandling,
    };
  }

  private mapEdgeCaseType(
    code: string,
  ): EdgeCaseResult['missingHandling'][number]['edgeCase'] {
    if (code.includes('NULL') || code.includes('UNDEFINED')) return 'null_undefined';
    if (code.includes('EMPTY') && code.includes('ARRAY')) return 'empty_array';
    if (code.includes('EMPTY') && code.includes('STRING')) return 'empty_string';
    if (code.includes('ERROR') || code.includes('CATCH')) return 'network_error';
    if (code.includes('PARSE') || code.includes('JSON')) return 'invalid_input';
    return 'null_undefined';
  }

  private mapEdgeCaseRisk(severity: string): 'high' | 'medium' | 'low' {
    if (severity === 'error') return 'high';
    if (severity === 'warning') return 'medium';
    return 'low';
  }

  protected async validate(
    context: ValidatorContext,
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    for (const change of context.changes) {
      issues.push(...this.checkEdgeCases(change.content, change.path));
    }

    return issues;
  }

  private checkEdgeCases(content: string, filePath: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';

      // Array access without bounds check
      if (
        /\w+\[\w+\]/.test(line) &&
        !/\.length|\.at\(|if\s*\(/.test(
          lines.slice(Math.max(0, i - 2), i + 1).join('\n'),
        )
      ) {
        // Check if it's a simple constant access like arr[0]
        if (!/\[\d+\]/.test(line) && /\[\w+\]/.test(line)) {
          issues.push(
            this.createIssue(
              filePath,
              `Array access without bounds checking`,
              'info',
              { line: i + 1, code: 'EDGE_NO_BOUNDS_CHECK' },
            ),
          );
        }
      }

      // Division without zero check
      if (
        /\/\s*\w+[^/]/.test(line) &&
        !/if\s*\(.*===?\s*0|!==?\s*0/.test(
          lines.slice(Math.max(0, i - 3), i + 1).join('\n'),
        )
      ) {
        if (!/\/\s*\d+/.test(line)) {
          // Skip constant division
          issues.push(
            this.createIssue(filePath, `Division without zero check`, 'info', {
              line: i + 1,
              code: 'EDGE_DIVISION_BY_ZERO',
            }),
          );
        }
      }

      // Object property access on potentially null value
      if (
        /\w+\.\w+/.test(line) &&
        /\|\|\s*null|\?\s*:/.test(lines.slice(Math.max(0, i - 2), i).join('\n'))
      ) {
        if (!/\?\.\w+/.test(line)) {
          // Not using optional chaining
          issues.push(
            this.createIssue(
              filePath,
              `Property access on potentially null value - consider optional chaining`,
              'info',
              { line: i + 1, code: 'EDGE_NULL_ACCESS' },
            ),
          );
        }
      }

      // String operations without empty check
      if (/\.split\s*\(|\.substring\s*\(|\.slice\s*\(/.test(line)) {
        const context = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
        if (!/\.length|if\s*\(|&&/.test(context)) {
          issues.push(
            this.createIssue(
              filePath,
              `String operation without empty string check`,
              'info',
              { line: i + 1, code: 'EDGE_EMPTY_STRING' },
            ),
          );
        }
      }

      // Parse operations without validation
      if (/JSON\.parse\s*\(/.test(line)) {
        if (
          !/try\s*{/.test(lines.slice(Math.max(0, i - 3), i + 1).join('\n'))
        ) {
          issues.push(
            this.createIssue(
              filePath,
              `JSON.parse without try/catch`,
              'warning',
              { line: i + 1, code: 'EDGE_JSON_PARSE' },
            ),
          );
        }
      }
    }

    return issues;
  }
}

/**
 * Refactor Completeness Checker
 * Ensures all references are updated
 */
export class RefactorCompletenessValidator extends BaseValidator {
  readonly name = 'refactor-completeness' as const;
  readonly stage = 'ai-accuracy' as const;

  async run(context: ValidatorContext): Promise<RefactorCompletenessResult> {
    const baseResult = await super.run(context);
    const incompleteRefactors: RefactorCompletenessResult['incompleteRefactors'] =
      baseResult.issues.map((issue) => ({
        type: this.mapRefactorType(issue.code ?? ''),
        original: this.extractOldReference(issue.message),
        updated: this.extractNewReference(issue.message),
        missedReferences: [
          {
            file: issue.file,
            line: issue.line ?? 0,
            code: issue.message,
          },
        ],
        affectedTests: [],
        affectedDocs: [],
      }));
    return {
      ...baseResult,
      incompleteRefactors,
    };
  }

  private mapRefactorType(
    code: string,
  ): RefactorCompletenessResult['incompleteRefactors'][number]['type'] {
    if (code.includes('RENAME') || code.includes('OLD_NAME')) return 'rename';
    if (code.includes('MOVE')) return 'move';
    if (code.includes('TYPE')) return 'type_change';
    if (code.includes('DELETE') || code.includes('REMOVE')) return 'deletion';
    return 'signature_change';
  }

  private extractOldReference(message: string): string {
    const match = message.match(/'([^']+)'\s+(?:was|has been|to)/);
    return match?.[1] ?? 'unknown';
  }

  private extractNewReference(message: string): string {
    const match = message.match(/to\s+'([^']+)'/);
    return match?.[1] ?? 'unknown';
  }

  protected async validate(
    context: ValidatorContext,
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    // Detect renames
    const renames = this.detectRenames(context);

    for (const rename of renames) {
      // Check if old name still exists in other files
      for (const [path, content] of context.existingFiles) {
        if (path === rename.file) continue;

        const regex = new RegExp(`\\b${rename.oldName}\\b`, 'g');
        const matches = content.match(regex);

        if (matches && matches.length > 0) {
          issues.push(
            this.createIssue(
              path,
              `'${rename.oldName}' was renamed to '${rename.newName}' but references remain`,
              'warning',
              { code: 'REFACTOR_INCOMPLETE_RENAME' },
            ),
          );
        }
      }
    }

    return issues;
  }

  private detectRenames(
    context: ValidatorContext,
  ): Array<{ file: string; oldName: string; newName: string }> {
    const renames: Array<{ file: string; oldName: string; newName: string }> =
      [];

    for (const change of context.changes) {
      if (change.operation !== 'update' || !change.diff) continue;

      // Look for function/variable renames in diff
      const diffLines = change.diff.split('\n');
      const removed = diffLines.filter((l) => l.startsWith('-')).join('\n');
      const added = diffLines.filter((l) => l.startsWith('+')).join('\n');

      // Extract removed exports/functions
      const removedNames = this.extractNames(removed);
      const addedNames = this.extractNames(added);

      // Find likely renames (similar patterns, different names)
      for (const oldName of removedNames) {
        for (const newName of addedNames) {
          if (oldName !== newName && this.areSimilar(oldName, newName)) {
            renames.push({ file: change.path, oldName, newName });
          }
        }
      }
    }

    return renames;
  }

  private extractNames(code: string): string[] {
    const names: string[] = [];
    const patterns = [
      /(?:function|const|let|var|class|interface|type)\s+(\w+)/g,
      /export\s+(?:default\s+)?(?:function|const|class)\s+(\w+)/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(code)) !== null) {
        if (match[1]) names.push(match[1]);
      }
    }

    return names;
  }

  private areSimilar(a: string, b: string): boolean {
    // Check if names are similar (same prefix, similar length)
    if (a.length === 0 || b.length === 0) return false;

    const commonPrefix = this.getCommonPrefix(a, b);
    return commonPrefix.length >= Math.min(a.length, b.length) * 0.5;
  }

  private getCommonPrefix(a: string, b: string): string {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return a.substring(0, i);
  }
}

/**
 * Doc Sync Validator
 * Flags outdated documentation
 */
export class DocSyncValidatorValidator extends BaseValidator {
  readonly name = 'doc-sync-validator' as const;
  readonly stage = 'ai-accuracy' as const;
  protected severity = 'info' as const;

  async run(context: ValidatorContext): Promise<DocSyncResult> {
    const baseResult = await super.run(context);
    const outOfSync: DocSyncResult['outOfSync'] = baseResult.issues
      .filter((issue) => !issue.code?.includes('MISSING'))
      .map((issue) => ({
        type: this.mapDocType(issue.code ?? ''),
        file: issue.file,
        line: issue.line ?? 0,
        documentedBehavior: issue.message,
        actualBehavior: 'code behavior differs',
        suggestion: this.mapDocSuggestion(issue.code ?? ''),
      }));
    const missingDocs: DocSyncResult['missingDocs'] = baseResult.issues
      .filter((issue) => issue.code?.includes('MISSING') || issue.code?.includes('NO_DOC'))
      .map((issue) => ({
        file: issue.file,
        symbol: 'unknown',
        type: 'function' as const,
        complexity: 0,
      }));
    return { ...baseResult, outOfSync, missingDocs };
  }

  private mapDocType(
    code: string,
  ): DocSyncResult['outOfSync'][number]['type'] {
    if (code.includes('JSDOC')) return 'jsdoc';
    if (code.includes('README')) return 'readme';
    if (code.includes('API')) return 'api_doc';
    if (code.includes('COMMENT')) return 'comment';
    return 'inline_comment';
  }

  private mapDocSuggestion(
    code: string,
  ): 'update_doc' | 'update_code' | 'remove_doc' {
    if (code.includes('STALE') || code.includes('OLD')) return 'remove_doc';
    return 'update_doc';
  }

  protected async validate(
    context: ValidatorContext,
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    for (const change of context.changes) {
      issues.push(...this.checkDocSync(change.content, change.path));
    }

    return issues;
  }

  private checkDocSync(content: string, filePath: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';

      // Check JSDoc @param mismatches
      if (/@param\s+{[^}]+}\s+(\w+)/.test(line)) {
        const paramMatch = line.match(/@param\s+{[^}]+}\s+(\w+)/);
        if (paramMatch?.[1]) {
          const paramName = paramMatch[1];
          // Look for function signature
          for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
            const funcLine = lines[j] ?? '';
            if (/function|=>|:\s*\(/.test(funcLine)) {
              if (!funcLine.includes(paramName)) {
                issues.push(
                  this.createIssue(
                    filePath,
                    `@param '${paramName}' may not exist in function signature`,
                    'info',
                    { line: i + 1, code: 'DOC_PARAM_MISMATCH' },
                  ),
                );
              }
              break;
            }
          }
        }
      }

      // Check for TODO comments that might be stale
      if (/\/\/\s*TODO|\/\*\s*TODO/.test(line)) {
        issues.push(
          this.createIssue(
            filePath,
            `TODO comment found - verify if still applicable`,
            'info',
            { line: i + 1, code: 'DOC_TODO_FOUND' },
          ),
        );
      }

      // Check for FIXME comments
      if (/\/\/\s*FIXME|\/\*\s*FIXME/.test(line)) {
        issues.push(
          this.createIssue(
            filePath,
            `FIXME comment found - this should be addressed`,
            'warning',
            { line: i + 1, code: 'DOC_FIXME_FOUND' },
          ),
        );
      }
    }

    return issues;
  }
}
