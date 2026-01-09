/**
 * Approval Modal Provider for Ender
 * Shows approval dialogs for plans and changes
 */

import * as vscode from 'vscode';
import { logger } from '../../utils';
import type { PlanPhase, FileChange, PlanApprovalRequest } from '../../types';

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

export interface ApprovalResult {
  approved: boolean;
  modifications?: string;
  reason?: string;
}

export class ApprovalModalProvider {
  /**
   * Show plan approval modal
   */
  static async showPlanApproval(
    request: PlanApprovalRequest,
  ): Promise<ApprovalResult> {
    logger.info('Showing plan approval modal', 'Approval', {
      planId: request.plan.id,
      confidence: request.confidence,
    });

    const panel = vscode.window.createWebviewPanel(
      'enderApproval',
      `Approve Plan: ${request.plan.title}`,
      vscode.ViewColumn.One,
      { enableScripts: true },
    );

    return new Promise((resolve) => {
      panel.webview.html = ApprovalModalProvider.getPlanApprovalHtml(request);

      panel.webview.onDidReceiveMessage((message) => {
        switch (message.type) {
          case 'approve':
            resolve({ approved: true });
            panel.dispose();
            break;
          case 'reject':
            resolve({ approved: false, reason: message.reason });
            panel.dispose();
            break;
          case 'modify':
            resolve({ approved: false, modifications: message.modifications });
            panel.dispose();
            break;
        }
      });

      panel.onDidDispose(() => {
        resolve({ approved: false, reason: 'Dialog closed' });
      });
    });
  }

  /**
   * Show phase approval
   */
  static async showPhaseApproval(
    phase: PlanPhase,
    files: FileChange[],
  ): Promise<ApprovalResult> {
    const detail = files
      .map(
        (f) =>
          `${f.operation === 'create' ? '➕' : f.operation === 'delete' ? '❌' : '✏️'} ${f.path}`,
      )
      .join('\n');

    const result = await vscode.window.showInformationMessage(
      `Phase ${phase.index + 1}: ${phase.title}`,
      { modal: true, detail },
      'Approve',
      'Reject',
      'View Details',
    );

    if (result === 'View Details') {
      // Show detailed diff view
      await ApprovalModalProvider.showFileChanges(files);
      return ApprovalModalProvider.showPhaseApproval(phase, files);
    }

    const approvalResult: ApprovalResult = {
      approved: result === 'Approve',
    };
    if (result === 'Reject') {
      approvalResult.reason = 'User rejected phase';
    }
    return approvalResult;
  }

  /**
   * Show file-level approval
   */
  static async showFileApproval(file: FileChange): Promise<ApprovalResult> {
    const action =
      file.operation === 'create'
        ? 'Create'
        : file.operation === 'delete'
          ? 'Delete'
          : 'Modify';

    const result = await vscode.window.showInformationMessage(
      `${action}: ${file.path}`,
      { modal: true, detail: file.explanation ?? 'No explanation provided' },
      'Approve',
      'Reject',
      'View Diff',
    );

    if (result === 'View Diff' && file.diff) {
      await ApprovalModalProvider.showDiff(file);
      return ApprovalModalProvider.showFileApproval(file);
    }

    const fileApprovalResult: ApprovalResult = {
      approved: result === 'Approve',
    };
    if (result === 'Reject') {
      fileApprovalResult.reason = 'User rejected file change';
    }
    return fileApprovalResult;
  }

  /**
   * Show file changes summary
   */
  private static async showFileChanges(files: FileChange[]): Promise<void> {
    const items: vscode.QuickPickItem[] = files.map((f) => {
      const item: vscode.QuickPickItem = {
        label: `${f.operation === 'create' ? '$(add)' : f.operation === 'delete' ? '$(trash)' : '$(edit)'} ${f.path}`,
        description: f.operation,
      };
      if (f.explanation) {
        item.detail = f.explanation;
      }
      return item;
    });

    const selected = await vscode.window.showQuickPick(items, {
      title: 'File Changes',
      placeHolder: 'Select a file to view diff',
    });

    if (selected) {
      const file = files.find((f) => selected.label.includes(f.path));
      if (file?.diff) {
        await ApprovalModalProvider.showDiff(file);
      }
    }
  }

  /**
   * Show diff for a file
   */
  private static async showDiff(file: FileChange): Promise<void> {
    // Create virtual documents for diff view
    const originalUri = vscode.Uri.parse(`ender-original:${file.path}`);
    const modifiedUri = vscode.Uri.parse(`ender-modified:${file.path}`);

    await vscode.commands.executeCommand(
      'vscode.diff',
      originalUri,
      modifiedUri,
      `${file.path} (Changes)`,
    );
  }

  /**
   * Show destructive operation confirmation
   */
  static async showDestructiveConfirmation(
    operation: string,
    items: string[],
    typedConfirmation?: string,
  ): Promise<boolean> {
    const detail = `This will affect:\n${items.slice(0, 10).join('\n')}${items.length > 10 ? `\n... and ${items.length - 10} more` : ''}`;

    const result = await vscode.window.showWarningMessage(
      `⚠️ ${operation}`,
      { modal: true, detail },
      'Proceed',
      'Cancel',
    );

    if (result !== 'Proceed') {
      return false;
    }

    // Require typed confirmation for critical operations
    if (typedConfirmation) {
      const input = await vscode.window.showInputBox({
        prompt: `Type "${typedConfirmation}" to confirm`,
        placeHolder: typedConfirmation,
      });

      return input === typedConfirmation;
    }

    return true;
  }

  /**
   * Get HTML for plan approval modal
   */
  private static getPlanApprovalHtml(request: PlanApprovalRequest): string {
    const { plan, confidence, explanation, warnings } = request;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Approve Plan</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 20px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    h1 { margin-bottom: 5px; }
    .confidence {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 0.9em;
      margin-bottom: 20px;
    }
    .confidence.high { background: var(--vscode-testing-iconPassed); color: white; }
    .confidence.medium { background: var(--vscode-editorWarning-foreground); color: black; }
    .confidence.low { background: var(--vscode-testing-iconFailed); color: white; }
    .section { margin-bottom: 20px; }
    .section-title { font-weight: bold; margin-bottom: 10px; }
    .phase-list { list-style: none; padding: 0; }
    .phase-item {
      padding: 10px;
      margin-bottom: 8px;
      background: var(--vscode-textCodeBlock-background);
      border-radius: 4px;
      border-left: 3px solid var(--vscode-activityBarBadge-background);
    }
    .phase-title { font-weight: 600; }
    .phase-files { font-size: 0.9em; color: var(--vscode-descriptionForeground); margin-top: 5px; }
    .warnings {
      background: var(--vscode-inputValidation-warningBackground);
      border: 1px solid var(--vscode-inputValidation-warningBorder);
      padding: 10px;
      border-radius: 4px;
      margin-bottom: 20px;
    }
    .warning-item { margin-bottom: 5px; }
    .actions {
      display: flex;
      gap: 10px;
      margin-top: 20px;
    }
    button {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 1em;
    }
    .approve {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .approve:hover { background: var(--vscode-button-hoverBackground); }
    .reject {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .modify {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .explanation {
      background: var(--vscode-textCodeBlock-background);
      padding: 15px;
      border-radius: 4px;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(plan.title)}</h1>
  <span class="confidence ${confidence >= 85 ? 'high' : confidence >= 70 ? 'medium' : 'low'}">
    Confidence: ${confidence}%
  </span>

  <div class="section">
    <div class="section-title">Explanation</div>
    <div class="explanation">${escapeHtml(explanation)}</div>
  </div>

  ${
    warnings.length > 0
      ? `
  <div class="warnings">
    <div class="section-title">⚠️ Warnings</div>
    ${warnings.map((w) => `<div class="warning-item">• ${escapeHtml(w)}</div>`).join('')}
  </div>
  `
      : ''
  }

  <div class="section">
    <div class="section-title">Phases (${plan.phases.length})</div>
    <ul class="phase-list">
      ${plan.phases
        .map(
          (phase, i) => `
        <li class="phase-item">
          <div class="phase-title">${i + 1}. ${escapeHtml(phase.title)}</div>
          <div class="phase-files">${phase.affectedFiles.join(', ')}</div>
        </li>
      `,
        )
        .join('')}
    </ul>
  </div>

  <div class="section">
    <div class="section-title">Affected Files (${plan.affectedFiles.length})</div>
    <div style="font-size: 0.9em; color: var(--vscode-descriptionForeground);">
      ${plan.affectedFiles.slice(0, 10).join(', ')}
      ${plan.affectedFiles.length > 10 ? `... and ${plan.affectedFiles.length - 10} more` : ''}
    </div>
  </div>

  <div class="actions">
    <button class="approve" onclick="approve()">✓ Approve Plan</button>
    <button class="modify" onclick="modify()">✎ Request Changes</button>
    <button class="reject" onclick="reject()">✗ Reject</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    function approve() {
      vscode.postMessage({ type: 'approve' });
    }

    function reject() {
      const reason = prompt('Reason for rejection (optional):');
      vscode.postMessage({ type: 'reject', reason });
    }

    function modify() {
      const modifications = prompt('What changes would you like?');
      if (modifications) {
        vscode.postMessage({ type: 'modify', modifications });
      }
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
