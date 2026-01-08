/**
 * Task Panel Provider for Ender
 * Shows current and queued tasks in bottom panel
 */

import * as vscode from 'vscode';
import { logger } from '../../utils';
import type { AgentStatus, Plan, PlanPhase } from '../../types';

interface TaskItem {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
  progress?: number;
  agent?: string;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export class TaskPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ender.tasks';
  private _view?: vscode.WebviewView;
  private tasks: TaskItem[] = [];
  private currentPlan?: Plan;
  private agentStatuses: Map<string, AgentStatus> = new Map();

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'pause':
          await this.pauseTask(message.taskId);
          break;
        case 'resume':
          await this.resumeTask(message.taskId);
          break;
        case 'cancel':
          await this.cancelTask(message.taskId);
          break;
        case 'retry':
          await this.retryTask(message.taskId);
          break;
        case 'viewDetails':
          await this.viewTaskDetails(message.taskId);
          break;
      }
    });

    // Initial update
    this.updateView();
  }

  /**
   * Add a new task
   */
  addTask(task: TaskItem): void {
    this.tasks.push(task);
    this.updateView();
    logger.info('Task added', 'TaskPanel', { taskId: task.id, title: task.title });
  }

  /**
   * Update task status
   */
  updateTask(taskId: string, updates: Partial<TaskItem>): void {
    const task = this.tasks.find(t => t.id === taskId);
    if (task) {
      Object.assign(task, updates);
      this.updateView();
    }
  }

  /**
   * Set current plan
   */
  setCurrentPlan(plan: Plan): void {
    this.currentPlan = plan;
    this.updateView();
  }

  /**
   * Update agent status
   */
  updateAgentStatus(agent: string, status: AgentStatus): void {
    this.agentStatuses.set(agent, status);
    this.updateView();
  }

  /**
   * Clear completed tasks
   */
  clearCompleted(): void {
    this.tasks = this.tasks.filter(t => t.status !== 'completed');
    this.updateView();
  }

  private async pauseTask(taskId: string): Promise<void> {
    this.updateTask(taskId, { status: 'paused' });
    vscode.window.showInformationMessage('Task paused');
  }

  private async resumeTask(taskId: string): Promise<void> {
    this.updateTask(taskId, { status: 'running' });
    vscode.window.showInformationMessage('Task resumed');
  }

  private async cancelTask(taskId: string): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      'Cancel this task?',
      'Yes', 'No'
    );
    if (confirm === 'Yes') {
      this.tasks = this.tasks.filter(t => t.id !== taskId);
      this.updateView();
      vscode.window.showInformationMessage('Task cancelled');
    }
  }

  private async retryTask(taskId: string): Promise<void> {
    this.updateTask(taskId, { status: 'pending', error: undefined });
  }

  private async viewTaskDetails(taskId: string): Promise<void> {
    const task = this.tasks.find(t => t.id === taskId);
    if (task) {
      const panel = vscode.window.createWebviewPanel(
        'enderTaskDetails',
        `Task: ${task.title}`,
        vscode.ViewColumn.Two,
        { enableScripts: true }
      );
      panel.webview.html = this.getTaskDetailsHtml(task);
    }
  }

  private updateView(): void {
    if (this._view) {
      this._view.webview.postMessage({
        type: 'update',
        tasks: this.tasks,
        plan: this.currentPlan,
        agents: Array.from(this.agentStatuses.values())
      });
    }
  }

  private getHtmlContent(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline';">
  <title>Ender Tasks</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-panel-background);
      padding: 10px;
      margin: 0;
    }
    .task-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .task-item {
      padding: 10px;
      margin-bottom: 8px;
      background: var(--vscode-editor-background);
      border-radius: 4px;
      border-left: 3px solid var(--vscode-activityBarBadge-background);
    }
    .task-item.completed {
      border-left-color: var(--vscode-testing-iconPassed);
      opacity: 0.7;
    }
    .task-item.failed {
      border-left-color: var(--vscode-testing-iconFailed);
    }
    .task-item.running {
      border-left-color: var(--vscode-progressBar-background);
    }
    .task-item.paused {
      border-left-color: var(--vscode-editorWarning-foreground);
    }
    .task-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 5px;
    }
    .task-title {
      font-weight: 600;
    }
    .task-status {
      font-size: 0.9em;
      padding: 2px 6px;
      border-radius: 3px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .task-description {
      font-size: 0.9em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 8px;
    }
    .task-progress {
      height: 4px;
      background: var(--vscode-progressBar-background);
      border-radius: 2px;
      margin-bottom: 8px;
    }
    .task-progress-bar {
      height: 100%;
      background: var(--vscode-activityBarBadge-background);
      border-radius: 2px;
      transition: width 0.3s ease;
    }
    .task-actions {
      display: flex;
      gap: 8px;
    }
    .task-actions button {
      padding: 4px 8px;
      font-size: 0.85em;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      border-radius: 3px;
      cursor: pointer;
    }
    .task-actions button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .agent-status {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 0;
      font-size: 0.9em;
    }
    .agent-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--vscode-testing-iconSkipped);
    }
    .agent-indicator.working {
      background: var(--vscode-progressBar-background);
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .empty-state {
      text-align: center;
      padding: 20px;
      color: var(--vscode-descriptionForeground);
    }
    .section-title {
      font-weight: 600;
      margin: 15px 0 10px;
      color: var(--vscode-foreground);
    }
  </style>
</head>
<body>
  <div id="app">
    <div class="empty-state" id="emptyState">
      No active tasks
    </div>
    <div id="agentSection" style="display:none;">
      <div class="section-title">Active Agents</div>
      <div id="agentList"></div>
    </div>
    <div id="taskSection" style="display:none;">
      <div class="section-title">Tasks</div>
      <ul class="task-list" id="taskList"></ul>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    window.addEventListener('message', event => {
      const { type, tasks, plan, agents } = event.data;
      
      if (type === 'update') {
        renderTasks(tasks);
        renderAgents(agents);
      }
    });

    function renderTasks(tasks) {
      const taskList = document.getElementById('taskList');
      const taskSection = document.getElementById('taskSection');
      const emptyState = document.getElementById('emptyState');

      if (!tasks || tasks.length === 0) {
        taskSection.style.display = 'none';
        emptyState.style.display = tasks && tasks.length === 0 ? 'block' : 'none';
        return;
      }

      emptyState.style.display = 'none';
      taskSection.style.display = 'block';

      taskList.innerHTML = tasks.map(task => \`
        <li class="task-item \${task.status}">
          <div class="task-header">
            <span class="task-title">\${escapeHtml(task.title)}</span>
            <span class="task-status">\${task.status}</span>
          </div>
          <div class="task-description">\${escapeHtml(task.description)}</div>
          \${task.progress !== undefined ? \`
            <div class="task-progress">
              <div class="task-progress-bar" style="width: \${task.progress}%"></div>
            </div>
          \` : ''}
          <div class="task-actions">
            \${task.status === 'running' ? '<button onclick="pauseTask(\\'' + task.id + '\\')">Pause</button>' : ''}
            \${task.status === 'paused' ? '<button onclick="resumeTask(\\'' + task.id + '\\')">Resume</button>' : ''}
            \${task.status === 'failed' ? '<button onclick="retryTask(\\'' + task.id + '\\')">Retry</button>' : ''}
            \${['pending', 'running', 'paused'].includes(task.status) ? '<button onclick="cancelTask(\\'' + task.id + '\\')">Cancel</button>' : ''}
            <button onclick="viewDetails('\\'' + task.id + '\\'')">Details</button>
          </div>
        </li>
      \`).join('');
    }

    function renderAgents(agents) {
      const agentList = document.getElementById('agentList');
      const agentSection = document.getElementById('agentSection');

      if (!agents || agents.length === 0) {
        agentSection.style.display = 'none';
        return;
      }

      const workingAgents = agents.filter(a => a.status === 'working');
      if (workingAgents.length === 0) {
        agentSection.style.display = 'none';
        return;
      }

      agentSection.style.display = 'block';
      agentList.innerHTML = workingAgents.map(agent => \`
        <div class="agent-status">
          <div class="agent-indicator working"></div>
          <span>\${agent.agent}: \${agent.currentTask || 'Working...'}</span>
        </div>
      \`).join('');
    }

    function pauseTask(id) {
      vscode.postMessage({ type: 'pause', taskId: id });
    }

    function resumeTask(id) {
      vscode.postMessage({ type: 'resume', taskId: id });
    }

    function cancelTask(id) {
      vscode.postMessage({ type: 'cancel', taskId: id });
    }

    function retryTask(id) {
      vscode.postMessage({ type: 'retry', taskId: id });
    }

    function viewDetails(id) {
      vscode.postMessage({ type: 'viewDetails', taskId: id });
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

  private getTaskDetailsHtml(task: TaskItem): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Task Details</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 20px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    h1 { font-size: 1.5em; margin-bottom: 20px; }
    .field { margin-bottom: 15px; }
    .label { font-weight: 600; color: var(--vscode-descriptionForeground); }
    .value { margin-top: 5px; }
    .error { color: var(--vscode-errorForeground); }
    pre {
      background: var(--vscode-textCodeBlock-background);
      padding: 10px;
      border-radius: 4px;
      overflow-x: auto;
    }
  </style>
</head>
<body>
  <h1>${task.title}</h1>
  <div class="field">
    <div class="label">Status</div>
    <div class="value">${task.status}</div>
  </div>
  <div class="field">
    <div class="label">Description</div>
    <div class="value">${task.description}</div>
  </div>
  ${task.agent ? `
  <div class="field">
    <div class="label">Agent</div>
    <div class="value">${task.agent}</div>
  </div>
  ` : ''}
  ${task.startedAt ? `
  <div class="field">
    <div class="label">Started</div>
    <div class="value">${task.startedAt.toLocaleString()}</div>
  </div>
  ` : ''}
  ${task.completedAt ? `
  <div class="field">
    <div class="label">Completed</div>
    <div class="value">${task.completedAt.toLocaleString()}</div>
  </div>
  ` : ''}
  ${task.error ? `
  <div class="field">
    <div class="label">Error</div>
    <div class="value error"><pre>${task.error}</pre></div>
  </div>
  ` : ''}
</body>
</html>`;
  }
}
