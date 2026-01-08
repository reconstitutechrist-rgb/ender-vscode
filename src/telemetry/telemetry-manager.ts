/**
 * Telemetry Module for Ender
 * Optional anonymous usage analytics (disabled by default)
 */

import * as vscode from 'vscode';
import { logger } from '../utils';

export interface TelemetryEvent {
  event: string;
  properties?: Record<string, string | number | boolean>;
  measurements?: Record<string, number>;
}

export interface TelemetryConfig {
  enabled: boolean;
  anonymousId?: string;
}

/**
 * Telemetry Manager
 * Respects user privacy - disabled by default
 */
export class TelemetryManager {
  private enabled: boolean = false;
  private anonymousId: string = '';
  private eventQueue: TelemetryEvent[] = [];
  private flushInterval: NodeJS.Timeout | null = null;

  /**
   * Initialize telemetry
   */
  async initialize(context: vscode.ExtensionContext): Promise<void> {
    // Check VS Code telemetry setting
    const vscTelemetry = vscode.env.isTelemetryEnabled;
    
    // Check Ender-specific setting
    const config = vscode.workspace.getConfiguration('ender');
    const enderTelemetry = config.get<boolean>('telemetry.enabled', false);

    this.enabled = vscTelemetry && enderTelemetry;

    if (this.enabled) {
      // Get or create anonymous ID
      this.anonymousId = context.globalState.get('ender.telemetry.anonymousId') ?? '';
      if (!this.anonymousId) {
        this.anonymousId = this.generateAnonymousId();
        await context.globalState.update('ender.telemetry.anonymousId', this.anonymousId);
      }

      // Start flush interval
      this.flushInterval = setInterval(() => this.flush(), 60000);

      logger.info('Telemetry initialized (anonymous)', 'Telemetry');
    } else {
      logger.info('Telemetry disabled', 'Telemetry');
    }
  }

  /**
   * Track an event
   */
  track(event: string, properties?: Record<string, string | number | boolean>): void {
    if (!this.enabled) return;

    this.eventQueue.push({
      event,
      properties: {
        ...properties,
        anonymousId: this.anonymousId,
        timestamp: Date.now()
      }
    });

    // Flush if queue is large
    if (this.eventQueue.length >= 10) {
      this.flush();
    }
  }

  /**
   * Track a metric
   */
  trackMetric(name: string, value: number, properties?: Record<string, string>): void {
    if (!this.enabled) return;

    this.eventQueue.push({
      event: 'metric',
      properties: {
        ...properties,
        metricName: name,
        anonymousId: this.anonymousId
      },
      measurements: { [name]: value }
    });
  }

  /**
   * Track extension activation
   */
  trackActivation(): void {
    this.track('extension_activated', {
      vscodeVersion: vscode.version,
      platform: process.platform
    });
  }

  /**
   * Track agent usage
   */
  trackAgentUsage(agent: string, duration: number, success: boolean): void {
    this.track('agent_used', {
      agent,
      success
    });
    this.trackMetric('agent_duration', duration, { agent });
  }

  /**
   * Track validation results
   */
  trackValidation(mode: string, passed: boolean, duration: number): void {
    this.track('validation_run', {
      mode,
      passed
    });
    this.trackMetric('validation_duration', duration, { mode });
  }

  /**
   * Track errors (anonymous)
   */
  trackError(component: string, errorType: string): void {
    this.track('error', {
      component,
      errorType
    });
  }

  /**
   * Flush queued events
   */
  private async flush(): Promise<void> {
    if (this.eventQueue.length === 0) return;

    const events = [...this.eventQueue];
    this.eventQueue = [];

    // In production, this would send to analytics service
    // For now, just log that we would send
    logger.debug(`Would send ${events.length} telemetry events`, 'Telemetry');
  }

  /**
   * Generate anonymous ID
   */
  private generateAnonymousId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 32; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
  }

  /**
   * Dispose telemetry
   */
  dispose(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.flush();
  }

  /**
   * Check if telemetry is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

// Singleton instance
export const telemetry = new TelemetryManager();
