/**
 * Stage 2: Code Quality Validators
 * syntax-validator, best-practices, security-scanner
 */

import {
  BaseValidator,
  ValidatorContext,
  containsPattern,
} from './base-validator';
import type {
  ValidationIssue,
  SyntaxValidatorResult,
  BestPracticesResult,
  SecurityScannerResult,
} from '../types';

/**
 * Syntax Validator
 * Checks for syntactically correct code
 */
export class SyntaxValidator extends BaseValidator {
  readonly name = 'syntax-validator' as const;
  readonly stage = 'quality' as const;

  private syntaxErrors: SyntaxValidatorResult['errors'] = [];

  async run(context: ValidatorContext): Promise<SyntaxValidatorResult> {
    this.syntaxErrors = [];
    const baseResult = await super.run(context);
    return {
      ...baseResult,
      errors: this.syntaxErrors,
    };
  }

  protected async validate(
    context: ValidatorContext,
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    for (const change of context.changes) {
      const ext = change.path.split('.').pop()?.toLowerCase();

      // Skip non-code files
      if (!['ts', 'tsx', 'js', 'jsx', 'json'].includes(ext ?? '')) {
        continue;
      }

      // Basic syntax checks
      const syntaxIssues = this.checkSyntax(
        change.content,
        change.path,
        ext ?? '',
      );
      issues.push(...syntaxIssues);
    }

    return issues;
  }

  private checkSyntax(
    content: string,
    filePath: string,
    ext: string,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const lines = content.split('\n');

    // Check JSON files
    if (ext === 'json') {
      try {
        JSON.parse(content);
      } catch (error) {
        const msg = `Invalid JSON: ${error instanceof Error ? error.message : 'Parse error'}`;
        issues.push(
          this.createIssue(filePath, msg, 'error', {
            code: 'SYNTAX_INVALID_JSON',
          }),
        );
        this.syntaxErrors.push({
          file: filePath,
          line: 1,
          column: 1,
          message: msg,
          severity: 'error',
        });
      }
      return issues;
    }

    // Check bracket matching
    const bracketIssues = this.checkBrackets(content, filePath);
    issues.push(...bracketIssues);

    // Check for common syntax errors
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const lineNum = i + 1;

      // Check for unclosed strings
      if (this.hasUnclosedString(line)) {
        issues.push(
          this.createIssue(filePath, `Possible unclosed string`, 'warning', {
            line: lineNum,
            code: 'SYNTAX_UNCLOSED_STRING',
          }),
        );
        this.syntaxErrors.push({
          file: filePath,
          line: lineNum,
          column: 1,
          message: 'Possible unclosed string',
          severity: 'warning',
        });
      }

      // Check for multiple semicolons
      if (/;;/.test(line)) {
        issues.push(
          this.createIssue(filePath, `Double semicolon`, 'warning', {
            line: lineNum,
            code: 'SYNTAX_DOUBLE_SEMICOLON',
          }),
        );
        this.syntaxErrors.push({
          file: filePath,
          line: lineNum,
          column: 1,
          message: 'Double semicolon',
          severity: 'warning',
        });
      }

      // Check for assignment in condition (common mistake)
      if (/if\s*\([^=]*[^!=<>]=[^=][^)]*\)/.test(line)) {
        issues.push(
          this.createIssue(
            filePath,
            `Possible assignment in condition (use === for comparison)`,
            'warning',
            { line: lineNum, code: 'SYNTAX_ASSIGNMENT_IN_CONDITION' },
          ),
        );
        this.syntaxErrors.push({
          file: filePath,
          line: lineNum,
          column: 1,
          message: 'Possible assignment in condition (use === for comparison)',
          severity: 'warning',
        });
      }
    }

    return issues;
  }

  private checkBrackets(content: string, filePath: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const stack: Array<{ char: string; line: number }> = [];
    const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
    const closers: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

    const lines = content.split('\n');
    let inString = false;
    let stringChar = '';
    let inMultiComment = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';

      for (let j = 0; j < line.length; j++) {
        const char = line[j] ?? '';
        const prev = line[j - 1] ?? '';

        // Handle string detection
        if ((char === '"' || char === "'" || char === '`') && prev !== '\\') {
          if (!inString) {
            inString = true;
            stringChar = char;
          } else if (char === stringChar) {
            inString = false;
          }
          continue;
        }

        if (inString) continue;

        // Handle comments
        if (char === '/' && line[j + 1] === '/') {
          break; // Rest of line is comment
        }
        if (char === '/' && line[j + 1] === '*') {
          inMultiComment = true;
          continue;
        }
        if (char === '*' && line[j + 1] === '/') {
          inMultiComment = false;
          j++; // Skip the /
          continue;
        }
        if (inMultiComment) continue;

        // Check brackets
        if (pairs[char]) {
          stack.push({ char, line: i + 1 });
        } else if (closers[char]) {
          const last = stack.pop();
          if (!last || last.char !== closers[char]) {
            issues.push(
              this.createIssue(filePath, `Unmatched '${char}'`, 'error', {
                line: i + 1,
                code: 'SYNTAX_UNMATCHED_BRACKET',
              }),
            );
            this.syntaxErrors.push({
              file: filePath,
              line: i + 1,
              column: j + 1,
              message: `Unmatched '${char}'`,
              severity: 'error',
            });
          }
        }
      }
    }

    // Check for unclosed brackets
    for (const unclosed of stack) {
      issues.push(
        this.createIssue(filePath, `Unclosed '${unclosed.char}'`, 'error', {
          line: unclosed.line,
          code: 'SYNTAX_UNCLOSED_BRACKET',
        }),
      );
      this.syntaxErrors.push({
        file: filePath,
        line: unclosed.line,
        column: 1,
        message: `Unclosed '${unclosed.char}'`,
        severity: 'error',
      });
    }

    return issues;
  }

  private hasUnclosedString(line: string): boolean {
    let inString = false;
    let stringChar = '';

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const prev = line[i - 1];

      if ((char === '"' || char === "'") && prev !== '\\') {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
        }
      }
    }

    // Template literals can span lines, so ignore backticks
    return inString && stringChar !== '`';
  }
}

/**
 * Best Practices Validator
 * Enforces coding standards
 */
export class BestPracticesValidator extends BaseValidator {
  readonly name = 'best-practices' as const;
  readonly stage = 'quality' as const;

  async run(context: ValidatorContext): Promise<BestPracticesResult> {
    const baseResult = await super.run(context);
    // Transform issues to violations with proper typing
    const violations: BestPracticesResult['violations'] = baseResult.issues.map(
      (issue) => ({
        file: issue.file,
        line: issue.line ?? 0,
        rule: issue.code ?? 'best-practice',
        message: issue.message,
        suggestion: issue.suggestion ?? '',
      }),
    );
    return {
      ...baseResult,
      violations,
    };
  }

  protected async validate(
    context: ValidatorContext,
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    for (const change of context.changes) {
      const ext = change.path.split('.').pop()?.toLowerCase();

      if (!['ts', 'tsx', 'js', 'jsx'].includes(ext ?? '')) {
        continue;
      }

      // Check various best practices
      issues.push(...this.checkConsoleStatements(change.content, change.path));
      issues.push(...this.checkDebuggerStatements(change.content, change.path));
      issues.push(...this.checkVarUsage(change.content, change.path));
      issues.push(...this.checkAnyType(change.content, change.path, ext ?? ''));
      issues.push(...this.checkEmptyCatchBlocks(change.content, change.path));
      issues.push(...this.checkMagicNumbers(change.content, change.path));
      issues.push(...this.checkLongFunctions(change.content, change.path));
    }

    return issues;
  }

  private checkConsoleStatements(
    content: string,
    filePath: string,
  ): ValidationIssue[] {
    const matches = containsPattern(
      content,
      /console\.(log|warn|error|debug|info)\(/,
    );
    return matches.map((m) =>
      this.createIssue(
        filePath,
        `Console statement found (remove before production)`,
        'warning',
        { line: m.line, code: 'BP_CONSOLE_STATEMENT' },
      ),
    );
  }

  private checkDebuggerStatements(
    content: string,
    filePath: string,
  ): ValidationIssue[] {
    const matches = containsPattern(content, /\bdebugger\b/);
    return matches.map((m) =>
      this.createIssue(filePath, `Debugger statement found`, 'error', {
        line: m.line,
        code: 'BP_DEBUGGER_STATEMENT',
      }),
    );
  }

  private checkVarUsage(content: string, filePath: string): ValidationIssue[] {
    const matches = containsPattern(content, /\bvar\s+\w+/);
    return matches.map((m) =>
      this.createIssue(
        filePath,
        `Use 'const' or 'let' instead of 'var'`,
        'warning',
        {
          line: m.line,
          code: 'BP_VAR_USAGE',
          suggestion: 'Replace var with const or let',
        },
      ),
    );
  }

  private checkAnyType(
    content: string,
    filePath: string,
    ext: string,
  ): ValidationIssue[] {
    if (!['ts', 'tsx'].includes(ext)) return [];

    const matches = containsPattern(content, /:\s*any\b/);
    return matches.map((m) =>
      this.createIssue(filePath, `Avoid using 'any' type`, 'warning', {
        line: m.line,
        code: 'BP_ANY_TYPE',
        suggestion: 'Use a specific type or unknown',
      }),
    );
  }

  private checkEmptyCatchBlocks(
    content: string,
    filePath: string,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const catchRegex = /catch\s*\([^)]*\)\s*{\s*}/g;

    let match;
    while ((match = catchRegex.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      issues.push(
        this.createIssue(
          filePath,
          `Empty catch block - handle or log the error`,
          'warning',
          { line: lineNum, code: 'BP_EMPTY_CATCH' },
        ),
      );
    }

    return issues;
  }

  private checkMagicNumbers(
    content: string,
    filePath: string,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const lines = content.split('\n');

    // Regex for magic numbers (excluding 0, 1, -1, 2 and numbers in obvious contexts)
    const magicNumRegex = /(?<![.\d])([2-9]\d{2,}|[3-9]\d|\d{4,})(?!\d)/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';

      // Skip comments, imports, and obvious non-magic contexts
      if (/^\s*(\/\/|\/\*|\*|import|export)/.test(line)) continue;
      if (
        /(?:port|timeout|delay|width|height|size|length|index|version)/i.test(
          line,
        )
      )
        continue;

      if (magicNumRegex.test(line)) {
        issues.push(
          this.createIssue(
            filePath,
            `Consider extracting magic number to named constant`,
            'info',
            { line: i + 1, code: 'BP_MAGIC_NUMBER' },
          ),
        );
      }
    }

    return issues;
  }

  private checkLongFunctions(
    content: string,
    filePath: string,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const maxLines = (this.options.maxFunctionLines as number) ?? 50;

    // Simple function detection
    const functionRegex =
      /(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>|(?:async\s+)?\w+\s*\([^)]*\)\s*{)/g;

    let match;

    while ((match = functionRegex.exec(content)) !== null) {
      // Count lines until matching closing brace
      const startLine = content.substring(0, match.index).split('\n').length;
      let braceCount = 0;
      let started = false;
      let lineCount = 0;

      for (let i = match.index; i < content.length; i++) {
        if (content[i] === '{') {
          braceCount++;
          started = true;
        } else if (content[i] === '}') {
          braceCount--;
          if (started && braceCount === 0) {
            lineCount = content.substring(match.index, i).split('\n').length;
            break;
          }
        }
      }

      if (lineCount > maxLines) {
        issues.push(
          this.createIssue(
            filePath,
            `Function is ${lineCount} lines (max recommended: ${maxLines})`,
            'warning',
            {
              line: startLine,
              code: 'BP_LONG_FUNCTION',
              suggestion: 'Consider breaking into smaller functions',
            },
          ),
        );
      }
    }

    return issues;
  }
}

/**
 * Security Scanner Validator
 * Detects security vulnerabilities
 */
export class SecurityScannerValidator extends BaseValidator {
  readonly name = 'security-scanner' as const;
  readonly stage = 'quality' as const;
  protected severity = 'error' as const;

  async run(context: ValidatorContext): Promise<SecurityScannerResult> {
    const baseResult = await super.run(context);
    // Transform issues to securityIssues with proper typing
    const securityIssues: SecurityScannerResult['securityIssues'] =
      baseResult.issues.map((issue) => ({
        file: issue.file,
        line: issue.line ?? 0,
        severity: this.mapSeverity(issue.code ?? ''),
        type: this.mapSecurityType(issue.code ?? ''),
        description: issue.message,
        recommendation:
          issue.suggestion ?? this.getRecommendation(issue.code ?? ''),
      }));
    return {
      ...baseResult,
      securityIssues,
    };
  }

  private mapSeverity(code: string): 'critical' | 'high' | 'medium' | 'low' {
    if (
      code.includes('SECRET') ||
      code.includes('SQL_INJECTION') ||
      code.includes('EVAL')
    ) {
      return 'critical';
    }
    if (code.includes('XSS') || code.includes('PATH_TRAVERSAL')) {
      return 'high';
    }
    if (code.includes('INSECURE_RANDOM')) {
      return 'medium';
    }
    return 'low';
  }

  private mapSecurityType(
    code: string,
  ): 'hardcoded_secret' | 'sql_injection' | 'xss' | 'path_traversal' | 'other' {
    if (code.includes('SECRET')) return 'hardcoded_secret';
    if (code.includes('SQL_INJECTION')) return 'sql_injection';
    if (code.includes('XSS')) return 'xss';
    if (code.includes('PATH_TRAVERSAL')) return 'path_traversal';
    return 'other';
  }

  private getRecommendation(code: string): string {
    const recommendations: Record<string, string> = {
      SEC_HARDCODED_SECRET: 'Use environment variables or a secrets manager',
      SEC_SQL_INJECTION: 'Use parameterized queries or an ORM',
      SEC_XSS: 'Sanitize user input and use safe DOM APIs',
      SEC_PATH_TRAVERSAL: 'Validate and sanitize file paths',
      SEC_INSECURE_RANDOM:
        'Use crypto.randomBytes() for security-sensitive values',
      SEC_EVAL: 'Avoid dynamic code execution; use safer alternatives',
    };
    return recommendations[code] ?? 'Review and fix the security issue';
  }

  protected async validate(
    context: ValidatorContext,
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    for (const change of context.changes) {
      issues.push(...this.checkHardcodedSecrets(change.content, change.path));
      issues.push(...this.checkSqlInjection(change.content, change.path));
      issues.push(...this.checkXss(change.content, change.path));
      issues.push(...this.checkPathTraversal(change.content, change.path));
      issues.push(...this.checkInsecureRandom(change.content, change.path));
      issues.push(...this.checkEval(change.content, change.path));
    }

    return issues;
  }

  private checkHardcodedSecrets(
    content: string,
    filePath: string,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const secretPatterns = [
      {
        pattern: /['"]sk[-_](?:live|test)[-_][a-zA-Z0-9]{24,}['"]/,
        name: 'Stripe key',
      },
      {
        pattern: /['"](?:AKIA|ABIA|ACCA)[A-Z0-9]{16}['"]/,
        name: 'AWS access key',
      },
      {
        pattern: /['"][a-f0-9]{32}['"]/,
        name: 'Possible API key (32 char hex)',
      },
      {
        pattern: /password\s*[:=]\s*['"][^'"]{8,}['"]/,
        name: 'Hardcoded password',
      },
      {
        pattern: /api[-_]?key\s*[:=]\s*['"][^'"]+['"]/,
        name: 'Hardcoded API key',
      },
      { pattern: /secret\s*[:=]\s*['"][^'"]+['"]/, name: 'Hardcoded secret' },
      { pattern: /['"]ghp_[a-zA-Z0-9]{36}['"]/, name: 'GitHub token' },
    ];

    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';

      // Skip comments and env references
      if (/^\s*\/\//.test(line) || /process\.env/.test(line)) continue;

      for (const { pattern, name } of secretPatterns) {
        if (pattern.test(line)) {
          issues.push(
            this.createIssue(
              filePath,
              `Possible hardcoded ${name} detected`,
              'error',
              { line: i + 1, code: 'SEC_HARDCODED_SECRET' },
            ),
          );
        }
      }
    }

    return issues;
  }

  private checkSqlInjection(
    content: string,
    filePath: string,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const patterns = [
      /`SELECT[^`]*\$\{/i,
      /`INSERT[^`]*\$\{/i,
      /`UPDATE[^`]*\$\{/i,
      /`DELETE[^`]*\$\{/i,
      /"SELECT[^"]*"\s*\+/i,
      /query\s*\(\s*`[^`]*\$\{/i,
    ];

    for (const pattern of patterns) {
      const matches = containsPattern(content, pattern);
      for (const m of matches) {
        issues.push(
          this.createIssue(
            filePath,
            `Possible SQL injection vulnerability - use parameterized queries`,
            'error',
            { line: m.line, code: 'SEC_SQL_INJECTION' },
          ),
        );
      }
    }

    return issues;
  }

  private checkXss(content: string, filePath: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const patterns = [
      {
        pattern: /dangerouslySetInnerHTML/,
        msg: 'dangerouslySetInnerHTML usage',
      },
      { pattern: /innerHTML\s*=/, msg: 'innerHTML assignment' },
      { pattern: /document\.write\s*\(/, msg: 'document.write usage' },
      { pattern: /\.html\s*\(\s*[^)]*\$/, msg: 'jQuery .html() with variable' },
    ];

    for (const { pattern, msg } of patterns) {
      const matches = containsPattern(content, pattern);
      for (const m of matches) {
        issues.push(
          this.createIssue(
            filePath,
            `Possible XSS vulnerability: ${msg}`,
            'warning',
            { line: m.line, code: 'SEC_XSS' },
          ),
        );
      }
    }

    return issues;
  }

  private checkPathTraversal(
    content: string,
    filePath: string,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const patterns = [
      /path\.join\([^)]*req\./,
      /fs\.\w+\([^)]*req\./,
      /readFile\([^)]*\+/,
    ];

    for (const pattern of patterns) {
      const matches = containsPattern(content, pattern);
      for (const m of matches) {
        issues.push(
          this.createIssue(
            filePath,
            `Possible path traversal vulnerability - validate user input`,
            'warning',
            { line: m.line, code: 'SEC_PATH_TRAVERSAL' },
          ),
        );
      }
    }

    return issues;
  }

  private checkInsecureRandom(
    content: string,
    filePath: string,
  ): ValidationIssue[] {
    const matches = containsPattern(content, /Math\.random\s*\(\s*\)/);

    // Only flag if it looks security-related
    return matches
      .filter((m) => {
        const lines = content.split('\n');
        const line = lines[m.line - 1] ?? '';
        return /token|key|secret|password|id|uuid/i.test(line);
      })
      .map((m) =>
        this.createIssue(
          filePath,
          `Math.random() is not cryptographically secure - use crypto.randomBytes()`,
          'warning',
          { line: m.line, code: 'SEC_INSECURE_RANDOM' },
        ),
      );
  }

  private checkEval(content: string, filePath: string): ValidationIssue[] {
    const patterns = [
      { pattern: /\beval\s*\(/, msg: 'eval() usage' },
      { pattern: /new\s+Function\s*\(/, msg: 'new Function() usage' },
      { pattern: /setTimeout\s*\(\s*['"]/, msg: 'setTimeout with string' },
      { pattern: /setInterval\s*\(\s*['"]/, msg: 'setInterval with string' },
    ];

    const issues: ValidationIssue[] = [];

    for (const { pattern, msg } of patterns) {
      const matches = containsPattern(content, pattern);
      for (const m of matches) {
        issues.push(
          this.createIssue(
            filePath,
            `Dangerous ${msg} - avoid dynamic code execution`,
            'error',
            { line: m.line, code: 'SEC_EVAL' },
          ),
        );
      }
    }

    return issues;
  }
}
