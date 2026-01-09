/**
 * Diff Explanation Provider for Ender
 * Shows plain English explanations of code changes
 */

import * as vscode from 'vscode';
import type { FileChange, DiffExplanation } from '../../types';

// Helper function for HTML escaping
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m] || m);
}

export class DiffExplanationProvider {
  /**
   * Show diff explanation panel
   */
  static async showExplanation(
    changes: FileChange[],
    explanations: DiffExplanation[],
  ): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
      'enderDiffExplanation',
      'Change Explanation',
      vscode.ViewColumn.Two,
      { enableScripts: true },
    );

    panel.webview.html = DiffExplanationProvider.getHtml(changes, explanations);

    panel.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'viewDiff') {
        await DiffExplanationProvider.openFileDiff(message.file);
      }
    });
  }

  /**
   * Open file diff in editor
   */
  private static async openFileDiff(filePath: string): Promise<void> {
    try {
      const uri = vscode.Uri.file(filePath);
      await vscode.commands.executeCommand('vscode.open', uri);
    } catch (error) {
      vscode.window.showErrorMessage(`Could not open file: ${filePath}`);
    }
  }

  /**
   * Generate HTML for explanation panel
   */
  private static getHtml(
    changes: FileChange[],
    explanations: DiffExplanation[],
  ): string {
    const totalAdditions = explanations.reduce(
      (sum, e) => sum + e.summary.totalAdditions,
      0,
    );
    const totalDeletions = explanations.reduce(
      (sum, e) => sum + e.summary.totalDeletions,
      0,
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Change Explanation</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 20px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      line-height: 1.6;
    }
    h1 { margin-bottom: 5px; }
    .summary {
      background: var(--vscode-textCodeBlock-background);
      padding: 15px;
      border-radius: 4px;
      margin-bottom: 20px;
    }
    .summary-stats {
      display: flex;
      gap: 20px;
      margin-top: 10px;
    }
    .stat {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .stat.additions { color: var(--vscode-testing-iconPassed); }
    .stat.deletions { color: var(--vscode-testing-iconFailed); }
    .file-section {
      margin-bottom: 25px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      overflow: hidden;
    }
    .file-header {
      background: var(--vscode-sideBarSectionHeader-background);
      padding: 10px 15px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
    }
    .file-header:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .file-name { font-weight: 600; }
    .file-stats {
      font-size: 0.9em;
      color: var(--vscode-descriptionForeground);
    }
    .file-content {
      padding: 15px;
    }
    .change-item {
      margin-bottom: 15px;
      padding-bottom: 15px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .change-item:last-child {
      border-bottom: none;
      margin-bottom: 0;
      padding-bottom: 0;
    }
    .change-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .change-type {
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 0.85em;
      font-weight: 500;
    }
    .change-type.addition { background: var(--vscode-testing-iconPassed); color: white; }
    .change-type.modification { background: var(--vscode-editorWarning-foreground); color: black; }
    .change-type.deletion { background: var(--vscode-testing-iconFailed); color: white; }
    .change-location {
      font-size: 0.9em;
      color: var(--vscode-descriptionForeground);
    }
    .plain-english {
      background: var(--vscode-textCodeBlock-background);
      padding: 10px;
      border-radius: 4px;
      margin-bottom: 8px;
    }
    .technical-details {
      font-size: 0.9em;
      color: var(--vscode-descriptionForeground);
    }
    .technical-details summary {
      cursor: pointer;
      margin-bottom: 5px;
    }
    .impact {
      margin-top: 8px;
      padding: 8px;
      background: var(--vscode-inputValidation-infoBackground);
      border-radius: 4px;
      font-size: 0.9em;
    }
    .risk-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 0.85em;
      margin-left: 10px;
    }
    .risk-low { background: var(--vscode-testing-iconPassed); color: white; }
    .risk-medium { background: var(--vscode-editorWarning-foreground); color: black; }
    .risk-high { background: var(--vscode-testing-iconFailed); color: white; }
    button {
      padding: 6px 12px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9em;
    }
    button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
  </style>
</head>
<body>
  <h1>What's Changing</h1>
  
  <div class="summary">
    <strong>${changes.length} file${changes.length !== 1 ? 's' : ''} affected</strong>
    <div class="summary-stats">
      <span class="stat additions">+${totalAdditions} lines added</span>
      <span class="stat deletions">-${totalDeletions} lines removed</span>
    </div>
  </div>

  ${explanations
    .map(
      (exp) => `
    <div class="file-section">
      <div class="file-header" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none'">
        <span class="file-name">${escapeHtml(exp.file)}</span>
        <span class="file-stats">
          <span class="stat additions">+${exp.summary.totalAdditions}</span>
          <span class="stat deletions">-${exp.summary.totalDeletions}</span>
          <span class="risk-badge risk-${exp.summary.riskLevel}">${exp.summary.riskLevel} risk</span>
        </span>
      </div>
      <div class="file-content">
        ${exp.changes
          .map(
            (change) => `
          <div class="change-item">
            <div class="change-header">
              <span class="change-type ${change.type}">${change.type}</span>
              <span class="change-location">${escapeHtml(change.location)}</span>
            </div>
            <div class="plain-english">
              ${escapeHtml(change.plainEnglish)}
            </div>
            <details class="technical-details">
              <summary>Technical details</summary>
              <pre>${escapeHtml(change.technicalDiff)}</pre>
            </details>
            <div class="impact">
              <strong>Why:</strong> ${escapeHtml(change.reason)}<br>
              <strong>Impact:</strong> ${escapeHtml(change.impact)}
              ${change.dependencies.length > 0 ? `<br><strong>Affects:</strong> ${change.dependencies.join(', ')}` : ''}
            </div>
          </div>
        `,
          )
          .join('')}
        <button onclick="viewDiff('${escapeHtml(exp.file)}')">View Full Diff</button>
      </div>
    </div>
  `,
    )
    .join('')}

  <script>
    const vscode = acquireVsCodeApi();

    function viewDiff(file) {
      vscode.postMessage({ type: 'viewDiff', file });
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  </script>
</body>
</html>`;
  }
}
