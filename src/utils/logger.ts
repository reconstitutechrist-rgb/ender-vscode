/**
 * Logger utility for Ender
 * Structured logging with levels and output channel support
 */

import * as vscode from 'vscode';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  context?: string;
  data?: unknown;
}

class Logger {
  private outputChannel: vscode.OutputChannel | null = null;
  private logLevel: LogLevel = 'info';
  private logs: LogEntry[] = [];
  private maxLogs = 1000;

  initialize(outputChannel: vscode.OutputChannel): void {
    this.outputChannel = outputChannel;
  }

  setLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.logLevel);
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    context?: string,
  ): string {
    const timestamp = new Date().toISOString();
    const prefix = context ? `[${context}]` : '';
    return `${timestamp} [${level.toUpperCase()}]${prefix} ${message}`;
  }

  private log(
    level: LogLevel,
    message: string,
    context?: string,
    data?: unknown,
  ): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
    };
    if (context) {
      entry.context = context;
    }
    if (data !== undefined) {
      entry.data = data;
    }

    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    const formatted = this.formatMessage(level, message, context);

    if (this.outputChannel) {
      this.outputChannel.appendLine(formatted);
      if (data) {
        this.outputChannel.appendLine(
          `  Data: ${JSON.stringify(data, null, 2)}`,
        );
      }
    }

    // Also log to console in development
    if (process.env.NODE_ENV === 'development') {
      const consoleFn =
        level === 'error'
          ? console.error
          : level === 'warn'
            ? console.warn
            : console.log;
      consoleFn(formatted, data || '');
    }
  }

  debug(message: string, context?: string, data?: unknown): void {
    this.log('debug', message, context, data);
  }

  info(message: string, context?: string, data?: unknown): void {
    this.log('info', message, context, data);
  }

  warn(message: string, context?: string, data?: unknown): void {
    this.log('warn', message, context, data);
  }

  error(message: string, context?: string, data?: unknown): void {
    this.log('error', message, context, data);
  }

  // Agent-specific logging
  agent(agent: string, action: string, data?: unknown): void {
    this.info(`${action}`, `Agent:${agent}`, data);
  }

  // Validator-specific logging
  validator(validator: string, result: 'pass' | 'fail', data?: unknown): void {
    const level = result === 'pass' ? 'info' : 'warn';
    this.log(level, `Validation ${result}`, `Validator:${validator}`, data);
  }

  // API call logging
  api(
    method: string,
    tokens: { input: number; output: number },
    duration: number,
  ): void {
    this.debug(`API call completed`, 'API', {
      method,
      tokens,
      duration: `${duration}ms`,
    });
  }

  // Get recent logs
  getRecentLogs(count = 100): LogEntry[] {
    return this.logs.slice(-count);
  }

  // Get logs by level
  getLogsByLevel(level: LogLevel): LogEntry[] {
    return this.logs.filter((log) => log.level === level);
  }

  // Clear logs
  clear(): void {
    this.logs = [];
    this.outputChannel?.clear();
  }

  // Show output channel
  show(): void {
    this.outputChannel?.show();
  }
}

export const logger = new Logger();
