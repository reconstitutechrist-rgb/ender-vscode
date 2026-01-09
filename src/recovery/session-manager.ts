/**
 * Session Recovery Manager for Ender
 * Handles session state persistence and crash recovery
 */

import * as vscode from 'vscode';
import { logger, generateId } from '../utils';
import type {
  SessionState,
  Plan,
  FileChange,
  ConversationMessage,
} from '../types';

export interface RecoveryConfig {
  enabled: boolean;
  intervalSeconds: number;
  maxSnapshots: number;
}

const DEFAULT_CONFIG: RecoveryConfig = {
  enabled: true,
  intervalSeconds: 60,
  maxSnapshots: 5,
};

export class SessionRecoveryManager {
  private config: RecoveryConfig;
  private currentSession: SessionState | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private context: vscode.ExtensionContext | null = null;
  private sessionKey = 'ender.sessionState';
  private snapshotsKey = 'ender.sessionSnapshots';

  constructor(config?: Partial<RecoveryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize with extension context
   */
  initialize(context: vscode.ExtensionContext): void {
    this.context = context;

    if (this.config.enabled) {
      this.startAutoSave();
    }

    logger.info('Session recovery initialized', 'Recovery');
  }

  /**
   * Start a new session
   */
  startSession(): string {
    const sessionId = generateId();

    this.currentSession = {
      id: sessionId,
      timestamp: new Date(),
      pendingChanges: [],
      conversationHistory: [],
      memorySnapshot: [],
      lastSuccessfulAction: '',
      incompleteActions: [],
    };

    this.saveSession();
    logger.info(`Session started: ${sessionId}`, 'Recovery');

    return sessionId;
  }

  /**
   * Update session state
   */
  updateSession(updates: Partial<SessionState>): void {
    if (!this.currentSession) {
      this.startSession();
    }

    this.currentSession = {
      ...this.currentSession!,
      ...updates,
      timestamp: new Date(),
    };
  }

  /**
   * Set active plan
   */
  setActivePlan(plan: Plan | undefined): void {
    const update: Partial<SessionState> = {};
    if (plan) {
      update.activePlan = plan;
      update.currentPhase = plan.currentPhaseIndex;
    }
    this.updateSession(update);
  }

  /**
   * Add pending changes
   */
  addPendingChanges(changes: FileChange[]): void {
    if (!this.currentSession) return;

    this.currentSession.pendingChanges = [
      ...this.currentSession.pendingChanges,
      ...changes,
    ];
  }

  /**
   * Clear pending changes
   */
  clearPendingChanges(): void {
    if (!this.currentSession) return;
    this.currentSession.pendingChanges = [];
  }

  /**
   * Add conversation message
   */
  addMessage(message: ConversationMessage): void {
    if (!this.currentSession) return;

    this.currentSession.conversationHistory.push(message);

    // Keep last 50 messages in session
    if (this.currentSession.conversationHistory.length > 50) {
      this.currentSession.conversationHistory =
        this.currentSession.conversationHistory.slice(-50);
    }
  }

  /**
   * Record successful action
   */
  recordSuccessfulAction(action: string): void {
    if (!this.currentSession) return;

    this.currentSession.lastSuccessfulAction = action;
    this.currentSession.incompleteActions =
      this.currentSession.incompleteActions.filter((a) => a !== action);
  }

  /**
   * Record incomplete action
   */
  recordIncompleteAction(action: string): void {
    if (!this.currentSession) return;

    if (!this.currentSession.incompleteActions.includes(action)) {
      this.currentSession.incompleteActions.push(action);
    }
  }

  /**
   * Save session to storage
   */
  private async saveSession(): Promise<void> {
    if (!this.context || !this.currentSession) return;

    try {
      await this.context.globalState.update(
        this.sessionKey,
        JSON.stringify(this.currentSession),
      );

      // Save snapshot
      await this.saveSnapshot();

      logger.debug('Session saved', 'Recovery');
    } catch (error) {
      logger.error('Failed to save session', 'Recovery', error);
    }
  }

  /**
   * Save session snapshot
   */
  private async saveSnapshot(): Promise<void> {
    if (!this.context || !this.currentSession) return;

    const snapshotsJson = this.context.globalState.get<string>(
      this.snapshotsKey,
    );
    let snapshots: SessionState[] = [];

    if (snapshotsJson) {
      try {
        snapshots = JSON.parse(snapshotsJson);
      } catch {
        snapshots = [];
      }
    }

    // Add current session
    snapshots.push({ ...this.currentSession });

    // Keep only recent snapshots
    if (snapshots.length > this.config.maxSnapshots) {
      snapshots = snapshots.slice(-this.config.maxSnapshots);
    }

    await this.context.globalState.update(
      this.snapshotsKey,
      JSON.stringify(snapshots),
    );
  }

  /**
   * Load previous session
   */
  async loadPreviousSession(): Promise<SessionState | null> {
    if (!this.context) return null;

    const sessionJson = this.context.globalState.get<string>(this.sessionKey);
    if (!sessionJson) return null;

    try {
      const session = JSON.parse(sessionJson) as SessionState;
      session.timestamp = new Date(session.timestamp);

      logger.info('Previous session loaded', 'Recovery', {
        id: session.id,
        hasActivePlan: !!session.activePlan,
        pendingChanges: session.pendingChanges.length,
        incompleteActions: session.incompleteActions.length,
      });

      return session;
    } catch (error) {
      logger.error('Failed to load session', 'Recovery', error);
      return null;
    }
  }

  /**
   * Check if recovery is needed
   */
  async checkRecoveryNeeded(): Promise<{
    needed: boolean;
    session?: SessionState;
    reason?: string;
  }> {
    const session = await this.loadPreviousSession();
    if (!session) return { needed: false };

    // Check for incomplete actions
    if (session.incompleteActions.length > 0) {
      return {
        needed: true,
        session,
        reason: `Found ${session.incompleteActions.length} incomplete action(s)`,
      };
    }

    // Check for pending changes
    if (session.pendingChanges.length > 0) {
      return {
        needed: true,
        session,
        reason: `Found ${session.pendingChanges.length} pending change(s)`,
      };
    }

    // Check for active plan
    if (session.activePlan && session.activePlan.status === 'in_progress') {
      return {
        needed: true,
        session,
        reason: 'Active plan was interrupted',
      };
    }

    return { needed: false };
  }

  /**
   * Restore session
   */
  async restoreSession(session: SessionState): Promise<void> {
    this.currentSession = {
      ...session,
      timestamp: new Date(),
    };

    logger.info('Session restored', 'Recovery', { id: session.id });
  }

  /**
   * Clear recovery state
   */
  async clearRecoveryState(): Promise<void> {
    if (!this.context) return;

    await this.context.globalState.update(this.sessionKey, undefined);
    await this.context.globalState.update(this.snapshotsKey, undefined);
    this.currentSession = null;

    logger.info('Recovery state cleared', 'Recovery');
  }

  /**
   * Start auto-save timer
   */
  private startAutoSave(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
    }

    this.saveTimer = setInterval(
      () => this.saveSession(),
      this.config.intervalSeconds * 1000,
    );

    logger.debug(
      `Auto-save started (${this.config.intervalSeconds}s interval)`,
      'Recovery',
    );
  }

  /**
   * Stop auto-save timer
   */
  stopAutoSave(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
  }

  /**
   * Get current session
   */
  getCurrentSession(): SessionState | null {
    return this.currentSession;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RecoveryConfig>): void {
    this.config = { ...this.config, ...config };

    if (this.config.enabled && !this.saveTimer) {
      this.startAutoSave();
    } else if (!this.config.enabled && this.saveTimer) {
      this.stopAutoSave();
    }
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.stopAutoSave();
    this.saveSession(); // Final save
  }
}

// Singleton instance
export const sessionRecoveryManager = new SessionRecoveryManager();
