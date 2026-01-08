/**
 * Safety Provider
 * Provides dynamic UI for security alerts and safety features
 */

import * as vscode from 'vscode';
import { logger } from '../../utils';

export interface SafetyAlert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  source: 'validator' | 'hallucination' | 'compliance' | 'plan-lock' | 'instruction' | 'security';
  timestamp: Date;
  dismissible: boolean;
  actions?: Array<{ label: string; command: string }>;
}

export class SafetyProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ender.safety';
  private _view?: vscode.WebviewView;
  private alerts: SafetyAlert[] = [];
  private readonly MAX_ALERTS = 50;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this.getHtmlContent();

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message: { type: string; id?: string; command?: string }) => {
      switch (message.type) {
        case 'dismiss':
          if (message.id) {
            this.dismissAlert(message.id);
          }
          break;
        case 'action':
          if (message.command) {
            await vscode.commands.executeCommand(message.command);
          }
          break;
        case 'clearAll':
          this.clearAlerts();
          break;
        case 'refresh':
          this.updateView();
          break;
      }
    });

    // Initial render
    this.updateView();
  }

  /**
   * Add a new alert
   */
  addAlert(alert: Omit<SafetyAlert, 'id' | 'timestamp'>): void {
    const newAlert: SafetyAlert = {
      ...alert,
      id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date()
    };

    this.alerts.unshift(newAlert);

    // Keep only max alerts
    if (this.alerts.length > this.MAX_ALERTS) {
      this.alerts = this.alerts.slice(0, this.MAX_ALERTS);
    }

    logger.info(`Safety alert added: ${newAlert.title} (${newAlert.severity})`, 'SafetyProvider');

    this.updateView();

    // Show VS Code notification for critical alerts
    if (alert.severity === 'critical') {
      vscode.window.showErrorMessage(
        `Ender Safety: ${alert.title}`,
        'View Details'
      ).then((selection: string | undefined) => {
        if (selection === 'View Details') {
          vscode.commands.executeCommand('ender.safety.focus');
        }
      });
    } else if (alert.severity === 'warning') {
      vscode.window.showWarningMessage(`Ender: ${alert.title}`);
    }
  }

  /**
   * Dismiss an alert by ID
   */
  dismissAlert(id: string): void {
    const index = this.alerts.findIndex(a => a.id === id);
    if (index !== -1) {
      const alert = this.alerts[index];
      if (alert?.dismissible) {
        this.alerts.splice(index, 1);
        this.updateView();
        logger.debug(`Alert dismissed: ${id}`, 'SafetyProvider');
      }
    }
  }

  /**
   * Clear all dismissible alerts
   */
  clearAlerts(): void {
    this.alerts = this.alerts.filter(a => !a.dismissible);
    this.updateView();
    logger.info('All dismissible alerts cleared', 'SafetyProvider');
  }

  /**
   * Get all active alerts
   */
  getAlerts(): SafetyAlert[] {
    return [...this.alerts];
  }

  /**
   * Get alerts by severity
   */
  getAlertsBySeverity(severity: SafetyAlert['severity']): SafetyAlert[] {
    return this.alerts.filter(a => a.severity === severity);
  }

  /**
   * Check if there are critical alerts
   */
  hasCriticalAlerts(): boolean {
    return this.alerts.some(a => a.severity === 'critical');
  }

  /**
   * Update the webview with current alerts
   */
  private updateView(): void {
    if (this._view) {
      this._view.webview.postMessage({
        type: 'update',
        alerts: this.alerts.map(a => ({
          ...a,
          timestamp: a.timestamp.toISOString()
        }))
      });
    }
  }

  /**
   * Generate HTML content for webview
   */
  private getHtmlContent(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ender Safety</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      padding: 10px;
      background: transparent;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    .header h2 {
      font-size: 14px;
      font-weight: 600;
    }

    .header-actions {
      display: flex;
      gap: 8px;
    }

    .header-btn {
      background: transparent;
      border: none;
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      font-size: 12px;
      padding: 2px 6px;
    }

    .header-btn:hover {
      text-decoration: underline;
    }

    .stats {
      display: flex;
      gap: 12px;
      margin-bottom: 12px;
      font-size: 11px;
    }

    .stat {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .stat-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .stat-dot.critical { background: var(--vscode-errorForeground); }
    .stat-dot.warning { background: var(--vscode-editorWarning-foreground); }
    .stat-dot.info { background: var(--vscode-editorInfo-foreground); }

    .alert {
      padding: 10px;
      margin-bottom: 8px;
      border-radius: 4px;
      border-left: 3px solid;
      background: var(--vscode-editor-background);
    }

    .alert.critical {
      border-color: var(--vscode-errorForeground);
      background: var(--vscode-inputValidation-errorBackground);
    }

    .alert.warning {
      border-color: var(--vscode-editorWarning-foreground);
      background: var(--vscode-inputValidation-warningBackground);
    }

    .alert.info {
      border-color: var(--vscode-editorInfo-foreground);
      background: var(--vscode-inputValidation-infoBackground);
    }

    .alert-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 6px;
    }

    .alert-title {
      font-weight: 600;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .severity-badge {
      font-size: 10px;
      padding: 1px 5px;
      border-radius: 3px;
      text-transform: uppercase;
      font-weight: 500;
    }

    .severity-badge.critical {
      background: var(--vscode-errorForeground);
      color: white;
    }

    .severity-badge.warning {
      background: var(--vscode-editorWarning-foreground);
      color: black;
    }

    .severity-badge.info {
      background: var(--vscode-editorInfo-foreground);
      color: white;
    }

    .dismiss-btn {
      background: transparent;
      border: none;
      color: var(--vscode-foreground);
      cursor: pointer;
      opacity: 0.6;
      font-size: 16px;
      line-height: 1;
      padding: 2px;
    }

    .dismiss-btn:hover {
      opacity: 1;
    }

    .alert-desc {
      font-size: 12px;
      margin-bottom: 6px;
      opacity: 0.9;
      line-height: 1.4;
    }

    .alert-meta {
      font-size: 10px;
      opacity: 0.6;
      display: flex;
      gap: 8px;
    }

    .alert-actions {
      margin-top: 8px;
      display: flex;
      gap: 6px;
    }

    .action-btn {
      padding: 4px 10px;
      font-size: 11px;
      cursor: pointer;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 3px;
    }

    .action-btn:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .empty {
      text-align: center;
      padding: 30px 20px;
      opacity: 0.7;
    }

    .empty-icon {
      font-size: 32px;
      margin-bottom: 10px;
    }

    .empty-text {
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h2>Safety Dashboard</h2>
    <div class="header-actions">
      <button class="header-btn" onclick="refresh()">Refresh</button>
      <button class="header-btn" onclick="clearAll()">Clear All</button>
    </div>
  </div>

  <div class="stats" id="stats"></div>
  <div id="alerts"></div>

  <script>
    const vscode = acquireVsCodeApi();
    let alerts = [];

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'update') {
        alerts = message.alerts;
        render();
      }
    });

    function render() {
      renderStats();
      renderAlerts();
    }

    function renderStats() {
      const statsEl = document.getElementById('stats');
      const critical = alerts.filter(a => a.severity === 'critical').length;
      const warning = alerts.filter(a => a.severity === 'warning').length;
      const info = alerts.filter(a => a.severity === 'info').length;

      statsEl.innerHTML = \`
        <div class="stat">
          <span class="stat-dot critical"></span>
          <span>\${critical} Critical</span>
        </div>
        <div class="stat">
          <span class="stat-dot warning"></span>
          <span>\${warning} Warning</span>
        </div>
        <div class="stat">
          <span class="stat-dot info"></span>
          <span>\${info} Info</span>
        </div>
      \`;
    }

    function renderAlerts() {
      const container = document.getElementById('alerts');

      if (alerts.length === 0) {
        container.innerHTML = \`
          <div class="empty">
            <div class="empty-icon">&#x2713;</div>
            <div class="empty-text">No active security alerts</div>
          </div>
        \`;
        return;
      }

      container.innerHTML = alerts.map(alert => \`
        <div class="alert \${alert.severity}">
          <div class="alert-header">
            <span class="alert-title">
              <span class="severity-badge \${alert.severity}">\${alert.severity}</span>
              \${escapeHtml(alert.title)}
            </span>
            \${alert.dismissible ? \`<button class="dismiss-btn" onclick="dismiss('\${alert.id}')" title="Dismiss">&times;</button>\` : ''}
          </div>
          <p class="alert-desc">\${escapeHtml(alert.description)}</p>
          <div class="alert-meta">
            <span>\${alert.source}</span>
            <span>\${formatTime(alert.timestamp)}</span>
          </div>
          \${alert.actions && alert.actions.length > 0 ? \`
            <div class="alert-actions">
              \${alert.actions.map(a => \`
                <button class="action-btn" onclick="action('\${a.command}')">\${escapeHtml(a.label)}</button>
              \`).join('')}
            </div>
          \` : ''}
        </div>
      \`).join('');
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function formatTime(timestamp) {
      const date = new Date(timestamp);
      return date.toLocaleTimeString();
    }

    function dismiss(id) {
      vscode.postMessage({ type: 'dismiss', id });
    }

    function action(command) {
      vscode.postMessage({ type: 'action', command });
    }

    function clearAll() {
      vscode.postMessage({ type: 'clearAll' });
    }

    function refresh() {
      vscode.postMessage({ type: 'refresh' });
    }

    // Initial render
    render();
  </script>
</body>
</html>`;
  }
}
