/**
 * Sandbox Executor
 * Handles isolated code execution for verification
 */

import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils';

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  duration: number;
  exitCode?: number;
}

export interface SandboxConfig {
  timeout: number;
  memoryLimit: number;
  networkAccess: boolean;
  fileSystemAccess: boolean;
}

const DEFAULT_CONFIG: SandboxConfig = {
  timeout: 5000,
  memoryLimit: 512 * 1024 * 1024, // 512MB
  networkAccess: false,
  fileSystemAccess: false,
};

export class SandboxExecutor {
  private config: SandboxConfig;

  constructor(config?: Partial<SandboxConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute code in a sandboxed environment
   */
  async execute(
    code: string,
    language: string,
    timeout?: number,
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const effectiveTimeout = timeout ?? this.config.timeout;

    logger.info(
      `Executing ${language} code in sandbox (timeout: ${effectiveTimeout}ms)`,
      'Sandbox',
    );

    try {
      // Create temp file for code
      const tempDir = os.tmpdir();
      const tempFile = path.join(
        tempDir,
        `ender-sandbox-${Date.now()}.${this.getExtension(language)}`,
      );

      fs.writeFileSync(tempFile, code, 'utf-8');
      logger.debug(`Created temp file: ${tempFile}`, 'Sandbox');

      // Get runner command
      const runner = this.getRunner(language, tempFile);
      if (!runner) {
        return {
          success: false,
          output: '',
          error: `Unsupported language: ${language}`,
          duration: Date.now() - startTime,
        };
      }

      // Execute with timeout
      const result = await this.runProcess(
        runner.command,
        runner.args,
        effectiveTimeout,
      );

      // Cleanup temp file
      try {
        fs.unlinkSync(tempFile);
      } catch {
        logger.warn(`Failed to cleanup temp file: ${tempFile}`, 'Sandbox');
      }

      // Build result with optional error
      const execResult: ExecutionResult = {
        success: result.exitCode === 0,
        output: result.stdout,
        duration: Date.now() - startTime,
        exitCode: result.exitCode,
      };

      if (result.stderr) {
        execResult.error = result.stderr;
      }

      return execResult;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Execution failed';
      logger.error(`Sandbox execution failed: ${message}`, 'Sandbox');

      return {
        success: false,
        output: '',
        error: message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Get file extension for language
   */
  private getExtension(language: string): string {
    const extensions: Record<string, string> = {
      javascript: 'js',
      typescript: 'ts',
      python: 'py',
      java: 'java',
      go: 'go',
      rust: 'rs',
      ruby: 'rb',
      php: 'php',
      c: 'c',
      cpp: 'cpp',
      csharp: 'cs',
    };
    return extensions[language.toLowerCase()] || 'txt';
  }

  /**
   * Get runner command for language
   */
  private getRunner(
    language: string,
    file: string,
  ): { command: string; args: string[] } | null {
    const isWindows = process.platform === 'win32';
    const runners: Record<string, { command: string; args: string[] }> = {
      javascript: { command: 'node', args: [file] },
      typescript: {
        command: 'npx',
        args: ['ts-node', '--transpile-only', file],
      },
      python: { command: isWindows ? 'python' : 'python3', args: [file] },
      go: { command: 'go', args: ['run', file] },
      ruby: { command: 'ruby', args: [file] },
      php: { command: 'php', args: [file] },
    };

    return runners[language.toLowerCase()] || null;
  }

  /**
   * Run a process with timeout
   */
  private runProcess(
    command: string,
    args: string[],
    timeout: number,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      // Build environment - restrict network if configured
      const env: NodeJS.ProcessEnv = this.config.networkAccess
        ? { ...process.env }
        : {
            PATH: process.env['PATH'],
            HOME: process.env['HOME'],
            TEMP: process.env['TEMP'],
          };

      const proc: ChildProcess = spawn(command, args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });

      // Set up timeout
      const timeoutId = setTimeout(() => {
        killed = true;
        proc.kill('SIGKILL');
        reject(new Error(`Execution timed out after ${timeout}ms`));
      }, timeout);

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
        // Limit output size
        if (stdout.length > 100000) {
          stdout = stdout.slice(0, 100000) + '\n... (output truncated)';
          proc.kill('SIGTERM');
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
        // Limit error size
        if (stderr.length > 50000) {
          stderr = stderr.slice(0, 50000) + '\n... (error truncated)';
        }
      });

      proc.on('close', (code: number | null) => {
        clearTimeout(timeoutId);
        if (!killed) {
          resolve({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: code ?? 1,
          });
        }
      });

      proc.on('error', (err: Error) => {
        clearTimeout(timeoutId);
        if (!killed) {
          reject(err);
        }
      });
    });
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<SandboxConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): SandboxConfig {
    return { ...this.config };
  }
}

export const sandboxExecutor = new SandboxExecutor();
