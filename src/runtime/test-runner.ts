/**
 * Test Runner
 * Handles execution of test suites with framework detection
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils';

export interface TestResult {
  passed: boolean;
  total: number;
  success: number;
  failed: number;
  duration: number;
  failures: Array<{ test: string; message: string; stack?: string }>;
  coverage?: { lines: number; functions: number; branches: number };
}

export type TestFramework = 'jest' | 'mocha' | 'vitest' | 'unknown';

export interface TestRunOptions {
  framework?: TestFramework;
  coverage?: boolean;
  timeout?: number;
  watch?: boolean;
}

export class TestRunner {
  private workspacePath: string = '';

  /**
   * Set workspace path for test execution
   */
  setWorkspacePath(workspacePath: string): void {
    this.workspacePath = workspacePath;
    logger.info(`TestRunner workspace set to: ${workspacePath}`, 'TestRunner');
  }

  /**
   * Run tests for specific files
   */
  async runTests(
    testFiles: string[],
    options?: TestRunOptions,
  ): Promise<TestResult> {
    const startTime = Date.now();
    const framework = options?.framework ?? this.detectFramework();
    const timeout = options?.timeout ?? 60000;

    logger.info(
      `Running tests with ${framework} for ${testFiles.length} files`,
      'TestRunner',
    );

    if (!this.workspacePath) {
      logger.error('Workspace path not set', 'TestRunner');
      return {
        passed: false,
        total: 0,
        success: 0,
        failed: 0,
        duration: Date.now() - startTime,
        failures: [{ test: 'Setup', message: 'Workspace path not configured' }],
      };
    }

    try {
      const { command, args } = this.getTestCommand(
        framework,
        testFiles,
        options?.coverage,
      );

      logger.info(`Executing: ${command} ${args.join(' ')}`, 'TestRunner');

      const result = await this.executeTests(command, args, timeout);
      const parsed = this.parseResults(
        framework,
        result.stdout,
        result.stderr,
        result.exitCode,
      );

      return {
        ...parsed,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Test execution failed: ${message}`, 'TestRunner');

      return {
        passed: false,
        total: 0,
        success: 0,
        failed: 0,
        duration: Date.now() - startTime,
        failures: [{ test: 'Test Execution', message }],
      };
    }
  }

  /**
   * Detect test framework from package.json
   */
  detectFramework(): TestFramework {
    const pkgPath = path.join(this.workspacePath, 'package.json');

    if (!fs.existsSync(pkgPath)) {
      logger.warn(
        'No package.json found, defaulting to unknown framework',
        'TestRunner',
      );
      return 'unknown';
    }

    try {
      const pkgContent = fs.readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(pkgContent) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        scripts?: Record<string, string>;
      };

      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      // Check in order of preference
      if (deps['jest'] || deps['@jest/core']) {
        logger.info('Detected Jest framework', 'TestRunner');
        return 'jest';
      }

      if (deps['vitest']) {
        logger.info('Detected Vitest framework', 'TestRunner');
        return 'vitest';
      }

      if (deps['mocha']) {
        logger.info('Detected Mocha framework', 'TestRunner');
        return 'mocha';
      }

      // Check scripts for hints
      const testScript = pkg.scripts?.['test'] ?? '';
      if (testScript.includes('jest')) return 'jest';
      if (testScript.includes('vitest')) return 'vitest';
      if (testScript.includes('mocha')) return 'mocha';

      logger.warn('Could not detect test framework', 'TestRunner');
      return 'unknown';
    } catch (error) {
      logger.error(
        'Failed to parse package.json for framework detection',
        'TestRunner',
      );
      return 'unknown';
    }
  }

  /**
   * Get test command for framework
   */
  private getTestCommand(
    framework: TestFramework,
    files: string[],
    coverage?: boolean,
  ): { command: string; args: string[] } {
    const fileArgs = files.length > 0 ? files : [];

    switch (framework) {
      case 'jest':
        return {
          command: 'npx',
          args: [
            'jest',
            '--json',
            '--testLocationInResults',
            ...(coverage
              ? ['--coverage', '--coverageReporters=json-summary']
              : []),
            ...fileArgs,
          ],
        };

      case 'vitest':
        return {
          command: 'npx',
          args: [
            'vitest',
            'run',
            '--reporter=json',
            ...(coverage ? ['--coverage'] : []),
            ...fileArgs,
          ],
        };

      case 'mocha':
        return {
          command: 'npx',
          args: ['mocha', '--reporter', 'json', ...fileArgs],
        };

      default:
        // Fallback to npm test
        return {
          command: 'npm',
          args: ['test', '--', ...fileArgs],
        };
    }
  }

  /**
   * Execute tests and capture output
   */
  private executeTests(
    command: string,
    args: string[],
    timeout: number,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      const proc = spawn(command, args, {
        cwd: this.workspacePath,
        shell: true,
        env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
      });

      const timeoutId = setTimeout(() => {
        killed = true;
        proc.kill('SIGTERM');
        resolve({
          stdout,
          stderr: stderr + '\nTest execution timed out',
          exitCode: 124,
        });
      }, timeout);

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code: number | null) => {
        if (!killed) {
          clearTimeout(timeoutId);
          resolve({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: code ?? 1,
          });
        }
      });

      proc.on('error', (err: Error) => {
        if (!killed) {
          clearTimeout(timeoutId);
          resolve({
            stdout,
            stderr: err.message,
            exitCode: 1,
          });
        }
      });
    });
  }

  /**
   * Parse test results based on framework
   */
  private parseResults(
    framework: TestFramework,
    stdout: string,
    stderr: string,
    exitCode: number,
  ): Omit<TestResult, 'duration'> {
    try {
      switch (framework) {
        case 'jest':
          return this.parseJestOutput(stdout);
        case 'mocha':
          return this.parseMochaOutput(stdout);
        case 'vitest':
          return this.parseVitestOutput(stdout);
        default:
          return this.parseFallbackOutput(exitCode, stderr);
      }
    } catch (error) {
      logger.warn(
        `Failed to parse ${framework} output, using fallback`,
        'TestRunner',
      );
      return this.parseFallbackOutput(exitCode, stderr);
    }
  }

  /**
   * Parse Jest JSON output
   */
  private parseJestOutput(output: string): Omit<TestResult, 'duration'> {
    // Find JSON in output (Jest may output other things before/after JSON)
    const jsonMatch = output.match(/\{[\s\S]*"numTotalTests"[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No Jest JSON output found');
    }

    const json = JSON.parse(jsonMatch[0]) as {
      success: boolean;
      numTotalTests: number;
      numPassedTests: number;
      numFailedTests: number;
      testResults: Array<{
        assertionResults: Array<{
          status: string;
          fullName: string;
          failureMessages: string[];
        }>;
      }>;
      coverageSummary?: {
        lines: { pct: number };
        functions: { pct: number };
        branches: { pct: number };
      };
    };

    const failures: Array<{ test: string; message: string }> = [];

    for (const result of json.testResults) {
      for (const assertion of result.assertionResults) {
        if (assertion.status === 'failed') {
          failures.push({
            test: assertion.fullName,
            message: assertion.failureMessages.join('\n'),
          });
        }
      }
    }

    const testResult: Omit<TestResult, 'duration'> = {
      passed: json.success,
      total: json.numTotalTests,
      success: json.numPassedTests,
      failed: json.numFailedTests,
      failures,
    };

    if (json.coverageSummary) {
      testResult.coverage = {
        lines: json.coverageSummary.lines.pct,
        functions: json.coverageSummary.functions.pct,
        branches: json.coverageSummary.branches.pct,
      };
    }

    return testResult;
  }

  /**
   * Parse Mocha JSON output
   */
  private parseMochaOutput(output: string): Omit<TestResult, 'duration'> {
    const json = JSON.parse(output) as {
      stats: {
        tests: number;
        passes: number;
        failures: number;
      };
      failures: Array<{
        fullTitle: string;
        err: { message: string; stack?: string };
      }>;
    };

    return {
      passed: json.stats.failures === 0,
      total: json.stats.tests,
      success: json.stats.passes,
      failed: json.stats.failures,
      failures: json.failures.map((f) => {
        const failure: { test: string; message: string; stack?: string } = {
          test: f.fullTitle,
          message: f.err.message,
        };
        if (f.err.stack) {
          failure.stack = f.err.stack;
        }
        return failure;
      }),
    };
  }

  /**
   * Parse Vitest JSON output
   */
  private parseVitestOutput(output: string): Omit<TestResult, 'duration'> {
    // Find JSON in output
    const jsonMatch = output.match(/\{[\s\S]*"testResults"[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No Vitest JSON output found');
    }

    const json = JSON.parse(jsonMatch[0]) as {
      success: boolean;
      testResults: Array<{
        name: string;
        status: 'passed' | 'failed' | 'skipped';
        message?: string;
      }>;
    };

    const tests = json.testResults || [];
    const failed = tests.filter((t) => t.status === 'failed');
    const passed = tests.filter((t) => t.status === 'passed');

    return {
      passed: failed.length === 0,
      total: tests.length,
      success: passed.length,
      failed: failed.length,
      failures: failed.map((f) => ({
        test: f.name,
        message: f.message ?? 'Test failed',
      })),
    };
  }

  /**
   * Fallback parsing when framework-specific parsing fails
   */
  private parseFallbackOutput(
    exitCode: number,
    stderr: string,
  ): Omit<TestResult, 'duration'> {
    const passed = exitCode === 0;
    const hasError =
      stderr.toLowerCase().includes('fail') ||
      stderr.toLowerCase().includes('error');

    return {
      passed: passed && !hasError,
      total: 0,
      success: 0,
      failed: passed ? 0 : 1,
      failures: passed
        ? []
        : [
            {
              test: 'Test Suite',
              message:
                stderr.slice(0, 1000) ||
                'Tests failed (exit code: ' + exitCode + ')',
            },
          ],
    };
  }

  /**
   * Check if a test file exists
   */
  async testFileExists(testPath: string): Promise<boolean> {
    const fullPath = path.isAbsolute(testPath)
      ? testPath
      : path.join(this.workspacePath, testPath);

    return fs.existsSync(fullPath);
  }

  /**
   * Find test files matching a pattern
   */
  async findTestFiles(pattern?: string): Promise<string[]> {
    // Pattern and default patterns available for future glob implementation
    void pattern;
    const defaultPatterns = [
      '**/*.test.ts',
      '**/*.test.js',
      '**/*.spec.ts',
      '**/*.spec.js',
      '**/test/**/*.ts',
      '**/test/**/*.js',
      '**/__tests__/**/*.ts',
      '**/__tests__/**/*.js',
    ];
    void defaultPatterns;

    // This is a simple implementation - in production, use glob
    const testDir = path.join(this.workspacePath, 'test');
    const files: string[] = [];

    if (fs.existsSync(testDir)) {
      const entries = fs.readdirSync(testDir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.isFile() &&
          (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.js'))
        ) {
          files.push(path.join('test', entry.name));
        }
      }
    }

    return files;
  }
}

export const testRunner = new TestRunner();
