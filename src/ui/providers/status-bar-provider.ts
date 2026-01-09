/**
 * Status Bar Provider for Ender
 * Shows agent status, cost tracking, and context usage
 */

import * as vscode from 'vscode';
import type { AgentType, CostTracking } from '../../types';

export class StatusBarProvider {
  private statusItem: vscode.StatusBarItem;
  private costItem: vscode.StatusBarItem;
  private contextItem: vscode.StatusBarItem;

  constructor() {
    // Main status item
    this.statusItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.statusItem.name = 'Ender Status';
    this.statusItem.command = 'ender.openChat';
    this.statusItem.tooltip = 'Click to open Ender chat';

    // Cost tracking item
    this.costItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      99,
    );
    this.costItem.name = 'Ender Cost';
    this.costItem.tooltip = 'API cost tracking';

    // Context usage item
    this.contextItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      98,
    );
    this.contextItem.name = 'Ender Context';
    this.contextItem.tooltip = 'Context token usage';

    // Initialize
    this.setIdle();
  }

  /**
   * Show the status bar items
   */
  show(options: { showCost?: boolean; showContext?: boolean } = {}): void {
    this.statusItem.show();

    if (options.showCost) {
      this.costItem.show();
    }

    if (options.showContext) {
      this.contextItem.show();
    }
  }

  /**
   * Hide the status bar items
   */
  hide(): void {
    this.statusItem.hide();
    this.costItem.hide();
    this.contextItem.hide();
  }

  /**
   * Set status to idle
   */
  setIdle(): void {
    this.statusItem.text = '$(circle-outline) Ender';
    this.statusItem.backgroundColor = undefined;
  }

  /**
   * Set status to working with agent name
   */
  setWorking(agent: AgentType): void {
    this.statusItem.text = `$(sync~spin) Ender: ${this.formatAgentName(agent)}`;
    this.statusItem.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.warningBackground',
    );
  }

  /**
   * Set status to waiting for approval
   */
  setWaitingApproval(): void {
    this.statusItem.text = '$(bell) Ender: Awaiting Approval';
    this.statusItem.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.prominentBackground',
    );
  }

  /**
   * Set status to error
   */
  setError(message?: string): void {
    this.statusItem.text = `$(error) Ender: ${message || 'Error'}`;
    this.statusItem.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.errorBackground',
    );
  }

  /**
   * Set status to success
   */
  setSuccess(message?: string): void {
    this.statusItem.text = `$(check) Ender: ${message || 'Complete'}`;
    this.statusItem.backgroundColor = undefined;

    // Reset to idle after 3 seconds
    setTimeout(() => this.setIdle(), 3000);
  }

  /**
   * Update cost tracking display
   */
  updateCost(tracking: CostTracking): void {
    const todayFormatted = this.formatCost(tracking.today);
    this.costItem.text = `$(credit-card) ${todayFormatted}`;

    let tooltip = `Today: ${todayFormatted}\n`;
    tooltip += `This month: ${this.formatCost(tracking.thisMonth)}\n`;
    tooltip += `All time: ${this.formatCost(tracking.allTime)}`;

    if (tracking.budget) {
      tooltip += `\n\nDaily budget: ${this.formatCost(tracking.budget.daily)}`;
      tooltip += `\nRemaining: ${this.formatCost(tracking.budget.dailyRemaining)}`;

      // Show warning if approaching limit
      const usagePercent = tracking.today / tracking.budget.daily;
      if (usagePercent >= tracking.budget.warningThreshold) {
        this.costItem.backgroundColor = new vscode.ThemeColor(
          'statusBarItem.warningBackground',
        );
      } else {
        this.costItem.backgroundColor = undefined;
      }
    }

    this.costItem.tooltip = tooltip;
  }

  /**
   * Update context usage display
   */
  updateContext(used: number, max: number): void {
    const percent = Math.round((used / max) * 100);
    this.contextItem.text = `$(symbol-namespace) ${percent}%`;
    this.contextItem.tooltip = `Context: ${this.formatTokens(used)} / ${this.formatTokens(max)} tokens`;

    if (percent >= 90) {
      this.contextItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.errorBackground',
      );
    } else if (percent >= 75) {
      this.contextItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground',
      );
    } else {
      this.contextItem.backgroundColor = undefined;
    }
  }

  /**
   * Format agent name for display
   */
  private formatAgentName(agent: AgentType): string {
    const names: Record<AgentType, string> = {
      conductor: 'Orchestrating',
      planner: 'Planning',
      coder: 'Coding',
      reviewer: 'Reviewing',
      documenter: 'Documenting',
      researcher: 'Researching',
      tester: 'Testing',
      debugger: 'Debugging',
      'git-manager': 'Git',
      'memory-keeper': 'Memory',
      'hooks-agent': 'Hooks',
      'integrations-agent': 'Integrations',
      'infrastructure-agent': 'Infrastructure',
      'sanity-checker': 'Sanity Check',
    };
    return names[agent] || agent;
  }

  /**
   * Format cost for display
   */
  private formatCost(cost: number): string {
    if (cost < 0.01) {
      return `$${cost.toFixed(4)}`;
    }
    return `$${cost.toFixed(2)}`;
  }

  /**
   * Format token count for display
   */
  private formatTokens(tokens: number): string {
    if (tokens >= 1000000) {
      return `${(tokens / 1000000).toFixed(1)}M`;
    }
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}K`;
    }
    return tokens.toString();
  }

  /**
   * Initialize the status bar - shows it and sets idle state
   */
  initialize(): void {
    this.show();
    this.setIdle();
  }

  /**
   * Set status with a unified status type
   */
  setStatus(
    status: 'idle' | 'working' | 'waiting' | 'error' | 'success',
    message?: string,
  ): void {
    switch (status) {
      case 'idle':
        this.setIdle();
        break;
      case 'working':
        this.setWorking((message as AgentType) || 'conductor');
        break;
      case 'waiting':
        this.setWaitingApproval();
        break;
      case 'error':
        this.setError(message);
        break;
      case 'success':
        this.setSuccess(message);
        break;
    }
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.statusItem.dispose();
    this.costItem.dispose();
    this.contextItem.dispose();
  }
}
