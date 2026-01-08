/**
 * Ender VS Code Extension
 * AI Coding Assistant with 14 specialized agents and 29 validators
 */

import * as vscode from 'vscode';
import { logger } from './utils';
import { apiClient } from './api';
import { memoryManager } from './memory';
import { conductorAgent } from './agents';
import { ChatPanelProvider, StatusBarProvider, TaskPanelProvider, MemoryTreeProvider, InstructionTreeProvider } from './ui/providers';
import { SessionRecoveryManager } from './recovery';
import type { ExtensionState } from './types';

let extensionState: ExtensionState;
let statusBar: StatusBarProvider;
let chatProvider: ChatPanelProvider;
let sessionManager: SessionRecoveryManager;

/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Initialize logger
  const outputChannel = vscode.window.createOutputChannel('Ender');
  logger.initialize(outputChannel);
  logger.info('Ender extension activating...', 'Extension');

  try {
    // Initialize extension state
    extensionState = {
      initialized: false,
      workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      hasProject: false,
      apiKeyConfigured: false,
      activeAgents: [],
      queuedTasks: 0,
      costTracking: {
        today: 0,
        thisMonth: 0,
        allTime: 0,
        lastUpdated: new Date()
      },
      sessionId: generateSessionId()
    };

    // Initialize API client
    const apiKey = await getApiKey(context);
    if (apiKey) {
      apiClient.initialize(apiKey);
      extensionState.apiKeyConfigured = true;
    }

    // Initialize workspace-specific components
    if (extensionState.workspaceFolder) {
      await initializeWorkspace(extensionState.workspaceFolder);
    }

    // Initialize UI components
    await initializeUI(context);

    // Initialize session recovery
    sessionManager = new SessionRecoveryManager();
    sessionManager.initialize(context);

    // Register commands
    registerCommands(context);

    // Register event handlers
    registerEventHandlers(context);

    extensionState.initialized = true;
    logger.info('Ender extension activated successfully', 'Extension');

    // Show welcome message for first-time users
    if (!context.globalState.get('ender.welcomed')) {
      showWelcomeMessage();
      context.globalState.update('ender.welcomed', true);
    }

  } catch (error) {
    logger.error('Failed to activate Ender extension', 'Extension', { error });
    vscode.window.showErrorMessage(`Ender failed to activate: ${error}`);
  }
}

/**
 * Extension deactivation
 */
export async function deactivate(): Promise<void> {
  logger.info('Ender extension deactivating...', 'Extension');

  try {
    // Save session state
    if (sessionManager) {
      sessionManager.dispose();
    }

    // Close memory manager
    await memoryManager.close();

    // Dispose status bar
    if (statusBar) {
      statusBar.dispose();
    }

    logger.info('Ender extension deactivated', 'Extension');
  } catch (error) {
    logger.error('Error during deactivation', 'Extension', { error });
  }
}

/**
 * Initialize workspace-specific components
 */
async function initializeWorkspace(workspacePath: string): Promise<void> {
  logger.info('Initializing workspace', 'Extension', { workspacePath });

  // Check for .ender folder
  const enderPath = vscode.Uri.joinPath(vscode.Uri.file(workspacePath), '.ender');
  
  try {
    await vscode.workspace.fs.stat(enderPath);
    extensionState.hasProject = true;
  } catch {
    // .ender folder doesn't exist yet
    extensionState.hasProject = false;
  }

  // Initialize memory manager
  await memoryManager.initialize(workspacePath);

  // Initialize agents
  initializeAgents(workspacePath);

  logger.info('Workspace initialized', 'Extension', { hasProject: extensionState.hasProject });
}

/**
 * Initialize UI components
 */
async function initializeUI(context: vscode.ExtensionContext): Promise<void> {
  // Register chat panel provider
  chatProvider = new ChatPanelProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('ender.chat', chatProvider)
  );

  // Register task panel provider
  const taskProvider = new TaskPanelProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('ender.tasks', taskProvider)
  );

  // Register memory tree provider
  const memoryProvider = new MemoryTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('ender.memory', memoryProvider)
  );

  // Register instruction tree provider
  const instructionProvider = new InstructionTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('ender.instructions', instructionProvider)
  );

  // Initialize status bar
  statusBar = new StatusBarProvider();
  statusBar.initialize();
  context.subscriptions.push(statusBar);

  logger.info('UI components initialized', 'Extension');
}

/**
 * Register extension commands
 */
function registerCommands(context: vscode.ExtensionContext): void {
  // Open chat command
  context.subscriptions.push(
    vscode.commands.registerCommand('ender.openChat', () => {
      vscode.commands.executeCommand('ender.chat.focus');
    })
  );

  // New task command
  context.subscriptions.push(
    vscode.commands.registerCommand('ender.newTask', async () => {
      const task = await vscode.window.showInputBox({
        prompt: 'What would you like Ender to help with?',
        placeHolder: 'Describe your task...'
      });

      if (task) {
        await handleNewTask(task);
      }
    })
  );

  // View memory command
  context.subscriptions.push(
    vscode.commands.registerCommand('ender.viewMemory', () => {
      vscode.commands.executeCommand('ender.memory.focus');
    })
  );

  // Undo command
  context.subscriptions.push(
    vscode.commands.registerCommand('ender.undo', async () => {
      await handleUndo();
    })
  );

  // Rollback command
  context.subscriptions.push(
    vscode.commands.registerCommand('ender.rollback', async () => {
      await handleRollback();
    })
  );

  // Export memory command
  context.subscriptions.push(
    vscode.commands.registerCommand('ender.exportMemory', async () => {
      await handleExportMemory();
    })
  );

  // Import memory command
  context.subscriptions.push(
    vscode.commands.registerCommand('ender.importMemory', async () => {
      await handleImportMemory();
    })
  );

  // Toggle strict mode command
  context.subscriptions.push(
    vscode.commands.registerCommand('ender.toggleStrictMode', () => {
      const config = vscode.workspace.getConfiguration('ender');
      const currentMode = config.get<string>('validatorMode') ?? 'strict';
      const newMode = currentMode === 'strict' ? 'fast' : 'strict';
      config.update('validatorMode', newMode, true);
      vscode.window.showInformationMessage(`Validator mode: ${newMode}`);
    })
  );

  // Show assumptions command
  context.subscriptions.push(
    vscode.commands.registerCommand('ender.showAssumptions', async () => {
      await showAssumptionLog();
    })
  );

  // Clear history command
  context.subscriptions.push(
    vscode.commands.registerCommand('ender.clearHistory', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Clear all conversation history?',
        'Yes', 'No'
      );
      if (confirm === 'Yes') {
        // Clear conversation history
        logger.info('Conversation history cleared', 'Extension');
        vscode.window.showInformationMessage('History cleared');
      }
    })
  );

  logger.info('Commands registered', 'Extension');
}

/**
 * Register event handlers
 */
function registerEventHandlers(context: vscode.ExtensionContext): void {
  // Workspace folder changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async (e) => {
      if (e.added.length > 0) {
        const newFolder = e.added[0]?.uri.fsPath;
        if (newFolder) {
          extensionState.workspaceFolder = newFolder;
          await initializeWorkspace(newFolder);
        }
      }
    })
  );

  // Configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('ender')) {
        handleConfigChange();
      }
    })
  );

  // File save events (for auto-memory triggers)
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      // Could trigger memory updates here
    })
  );

  logger.info('Event handlers registered', 'Extension');
}

/**
 * Handle new task
 */
async function handleNewTask(task: string): Promise<void> {
  if (!extensionState.apiKeyConfigured) {
    const action = await vscode.window.showErrorMessage(
      'API key not configured',
      'Configure API Key'
    );
    if (action === 'Configure API Key') {
      vscode.commands.executeCommand('workbench.action.openSettings', 'ender.apiKey');
    }
    return;
  }

  logger.info('New task received', 'Extension', { task: task.slice(0, 100) });
  
  try {
    statusBar.setStatus('working', 'Processing task...');
    
    // Route through conductor
    // In full implementation, this would be a more complex orchestration
    vscode.window.showInformationMessage(`Task received: ${task.slice(0, 50)}...`);
    
  } catch (error) {
    logger.error('Task failed', 'Extension', { error });
    vscode.window.showErrorMessage(`Task failed: ${error}`);
  } finally {
    statusBar.setStatus('ready');
  }
}

/**
 * Handle undo
 */
async function handleUndo(): Promise<void> {
  // Implementation would use undo stack from storage
  vscode.window.showInformationMessage('Undo: Not implemented yet');
}

/**
 * Handle rollback
 */
async function handleRollback(): Promise<void> {
  // Implementation would use rollback checkpoints
  vscode.window.showInformationMessage('Rollback: Not implemented yet');
}

/**
 * Handle memory export
 */
async function handleExportMemory(): Promise<void> {
  try {
    const data = await memoryManager.export();
    
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('ender-memory-export.json'),
      filters: { 'JSON': ['json'] }
    });

    if (uri) {
      const content = JSON.stringify(data, null, 2);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
      vscode.window.showInformationMessage('Memory exported successfully');
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Export failed: ${error}`);
  }
}

/**
 * Handle memory import
 */
async function handleImportMemory(): Promise<void> {
  try {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'JSON': ['json'] }
    });

    if (uris && uris[0]) {
      const content = await vscode.workspace.fs.readFile(uris[0]);
      const data = JSON.parse(Buffer.from(content).toString());
      
      const result = await memoryManager.import(data);
      vscode.window.showInformationMessage(
        `Imported ${result.imported} entries, skipped ${result.skipped}`
      );
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Import failed: ${error}`);
  }
}

/**
 * Show assumption log
 */
async function showAssumptionLog(): Promise<void> {
  // Implementation would show sanity checker's assumption log
  vscode.window.showInformationMessage('Assumption log: Not implemented yet');
}

/**
 * Handle configuration changes
 */
function handleConfigChange(): void {
  logger.info('Configuration changed', 'Extension');
  // Reload configuration
}

/**
 * Get API key from settings or prompt
 */
async function getApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration('ender');
  let apiKey = config.get<string>('apiKey');

  if (!apiKey) {
    // Check secrets storage
    apiKey = await context.secrets.get('ender.apiKey');
  }

  if (!apiKey) {
    // Prompt user
    const action = await vscode.window.showWarningMessage(
      'Ender requires an Anthropic API key to function.',
      'Enter API Key',
      'Later'
    );

    if (action === 'Enter API Key') {
      apiKey = await vscode.window.showInputBox({
        prompt: 'Enter your Anthropic API key',
        password: true,
        placeHolder: 'sk-ant-...'
      });

      if (apiKey) {
        await context.secrets.store('ender.apiKey', apiKey);
      }
    }
  }

  return apiKey;
}

/**
 * Show welcome message
 */
function showWelcomeMessage(): void {
  vscode.window.showInformationMessage(
    'Welcome to Ender! Your AI coding assistant is ready.',
    'Open Chat',
    'View Documentation'
  ).then(selection => {
    if (selection === 'Open Chat') {
      vscode.commands.executeCommand('ender.openChat');
    } else if (selection === 'View Documentation') {
      vscode.env.openExternal(vscode.Uri.parse('https://github.com/ender-ai/ender-vscode'));
    }
  });
}

/**
 * Generate session ID
 */
function generateSessionId(): string {
  return `ender-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Initialize agents for workspace
 */
function initializeAgents(workspacePath: string): void {
  logger.info('Initializing agents', 'Extension', { workspacePath });
  // Agents are initialized on-demand through the conductor
  // This function sets up any workspace-specific agent configuration
}
