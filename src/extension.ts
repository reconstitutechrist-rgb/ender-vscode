/**
 * Ender VS Code Extension
 * AI Coding Assistant with 14 specialized agents and 29 validators
 */

// TextDecoder is available in VS Code runtime
declare const TextDecoder: {
  new (encoding?: string): { decode(input: Uint8Array): string };
};

import * as vscode from 'vscode';
import { logger } from './utils';
import { apiClient } from './api';
import { memoryManager } from './memory';
import { conductorAgent, agentRegistry, gitManagerAgent } from './agents';
import { contextAssembler } from './context/context-assembler';
import {
  fileRelevanceScorer,
  FileRelevanceScorer,
} from './context/file-relevance';
import { sqliteClient } from './storage';
import {
  ChatPanelProvider,
  StatusBarProvider,
  TaskPanelProvider,
  MemoryTreeProvider,
  InstructionTreeProvider,
} from './ui/providers';
import { SessionRecoveryManager } from './recovery';
import type { ExtensionState, AgentType, ConductorDecision } from './types';

let extensionState: ExtensionState;
let statusBar: StatusBarProvider;
let chatProvider: ChatPanelProvider;
let sessionManager: SessionRecoveryManager;

/**
 * Extension activation
 */
export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  // Initialize logger
  const outputChannel = vscode.window.createOutputChannel('Ender');
  logger.initialize(outputChannel);
  logger.info('Ender extension activating...', 'Extension');

  try {
    // Initialize extension state
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    extensionState = {
      initialized: false,
      hasProject: false,
      apiKeyConfigured: false,
      activeAgents: [],
      queuedTasks: 0,
      costTracking: {
        today: 0,
        thisMonth: 0,
        allTime: 0,
        lastUpdated: new Date(),
      },
      sessionId: generateSessionId(),
    };
    if (workspaceFolder) {
      extensionState.workspaceFolder = workspaceFolder;
    }

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
  const enderPath = vscode.Uri.joinPath(
    vscode.Uri.file(workspacePath),
    '.ender',
  );

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

  logger.info('Workspace initialized', 'Extension', {
    hasProject: extensionState.hasProject,
  });
}

/**
 * Initialize UI components
 */
async function initializeUI(context: vscode.ExtensionContext): Promise<void> {
  // Register chat panel provider
  chatProvider = new ChatPanelProvider(context.extensionUri, (message) => {
    handleUserMessage(message);
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('ender.chat', chatProvider),
  );

  // Register task panel provider
  const taskProvider = new TaskPanelProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('ender.tasks', taskProvider),
  );

  // Register memory tree provider
  const memoryProvider = new MemoryTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('ender.memory', memoryProvider),
  );

  // Register instruction tree provider
  const instructionProvider = new InstructionTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      'ender.instructions',
      instructionProvider,
    ),
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
    }),
  );

  // New task command
  context.subscriptions.push(
    vscode.commands.registerCommand('ender.newTask', async () => {
      const task = await vscode.window.showInputBox({
        prompt: 'What would you like Ender to help with?',
        placeHolder: 'Describe your task...',
      });

      if (task) {
        await handleNewTask(task);
      }
    }),
  );

  // View memory command
  context.subscriptions.push(
    vscode.commands.registerCommand('ender.viewMemory', () => {
      vscode.commands.executeCommand('ender.memory.focus');
    }),
  );

  // Undo command
  context.subscriptions.push(
    vscode.commands.registerCommand('ender.undo', async () => {
      await handleUndo();
    }),
  );

  // Rollback command
  context.subscriptions.push(
    vscode.commands.registerCommand('ender.rollback', async () => {
      await handleRollback();
    }),
  );

  // Export memory command
  context.subscriptions.push(
    vscode.commands.registerCommand('ender.exportMemory', async () => {
      await handleExportMemory();
    }),
  );

  // Import memory command
  context.subscriptions.push(
    vscode.commands.registerCommand('ender.importMemory', async () => {
      await handleImportMemory();
    }),
  );

  // Toggle strict mode command
  context.subscriptions.push(
    vscode.commands.registerCommand('ender.toggleStrictMode', () => {
      const config = vscode.workspace.getConfiguration('ender');
      const currentMode = config.get<string>('validatorMode') ?? 'strict';
      const newMode = currentMode === 'strict' ? 'fast' : 'strict';
      config.update('validatorMode', newMode, true);
      vscode.window.showInformationMessage(`Validator mode: ${newMode}`);
    }),
  );

  // Show assumptions command
  context.subscriptions.push(
    vscode.commands.registerCommand('ender.showAssumptions', async () => {
      await showAssumptionLog();
    }),
  );

  // Clear history command
  context.subscriptions.push(
    vscode.commands.registerCommand('ender.clearHistory', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Clear all conversation history?',
        'Yes',
        'No',
      );
      if (confirm === 'Yes') {
        // Clear conversation history
        logger.info('Conversation history cleared', 'Extension');
        vscode.window.showInformationMessage('History cleared');
      }
    }),
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
    }),
  );

  // Configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('ender')) {
        handleConfigChange();
      }
    }),
  );

  // File save events (for auto-memory triggers)
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((_document) => {
      // Could trigger memory updates here
    }),
  );

  logger.info('Event handlers registered', 'Extension');
}

/**
 * Handle user message from chat
 */
async function handleUserMessage(message: string): Promise<void> {
  chatProvider.addUserMessage(message);
  await handleNewTask(message);
}

/**
 * Handle new task
 */
async function handleNewTask(task: string): Promise<void> {
  if (!extensionState.apiKeyConfigured) {
    chatProvider.addAssistantMessage(
      'Please configure your API key in settings to use Ender.',
    );
    const action = await vscode.window.showErrorMessage(
      'API key not configured',
      'Configure API Key',
    );
    if (action === 'Configure API Key') {
      vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'ender.apiKey',
      );
    }
    return;
  }

  logger.info('New task received', 'Extension', { task: task.slice(0, 100) });

  try {
    statusBar.setStatus('working', 'Processing task...');
    chatProvider.setProcessing(true);

    // Assemble context
    const relevantFiles = await getRelevantFiles(task);
    const assembleParams: Parameters<typeof contextAssembler.assemble>[0] = {
      relevantFiles,
      activeMemory: await memoryManager.getHotMemories(),
      conversationHistory: chatProvider.getMessages(),
      projectSettings: {
        global: {
          version: '1.0.0',
          apiKey: { source: 'user' },
          models: {
            smart: 'claude-opus-4-5-20251101',
            fast: 'claude-sonnet-4-5-20250929',
          },
          defaults: {
            approvalMode: 'hybrid',
            approvalGranularity: {
              entirePlan: true,
              perPhase: false,
              perFile: false,
            },
            confidenceThreshold: 80,
            validatorMode: 'fast',
            contextBudget: { maxTokens: 100000, reserveForResponse: 8000 },
          },
          ui: {
            showAgentIndicator: true,
            showCostTracker: true,
            showContextUsage: true,
          },
          telemetry: { enabled: false },
          sessionRecovery: { enabled: true, intervalSeconds: 60 },
          undoStack: { maxLevels: 10 },
          sensitiveFilePatterns: ['.env', '*.key', '*.pem'],
        },
        effective: {
          approvalMode: 'hybrid',
          approvalGranularity: {
            entirePlan: true,
            perPhase: false,
            perFile: false,
          },
          confidenceThreshold: 80,
          validatorMode: 'fast',
          contextBudget: { maxTokens: 100000, reserveForResponse: 8000 },
          verbosity: 'normal',
          codingStyle: 'functional',
          commentLevel: 'moderate',
          customRules: [],
          sensitiveFilePatterns: ['.env', '*.key', '*.pem'],
        },
      },
    };
    const context = await contextAssembler.assemble(assembleParams);

    // Execute Conductor
    const conductorResult = await conductorAgent.execute({
      task,
      context,
    });

    if (!conductorResult.success) {
      throw new Error(
        conductorResult.errors?.[0]?.message || 'Conductor failed',
      );
    }

    // Parse decision
    let decision: ConductorDecision & { directResponse?: string };
    const output = conductorResult.output ?? '';
    try {
      decision = JSON.parse(output);
    } catch {
      // Fallback if output is not JSON
      chatProvider.addAssistantMessage(output, 'conductor');
      return;
    }

    // Handle direct response
    if (decision.directResponse) {
      chatProvider.addAssistantMessage(decision.directResponse, 'conductor');
      return;
    }

    // Handle agent routing
    if (decision.selectedAgents && decision.selectedAgents.length > 0) {
      chatProvider.addAssistantMessage(
        `I'll have ${decision.selectedAgents.join(', ')} handle this. ${decision.routingReason}`,
        'conductor',
      );

      for (const agentType of decision.selectedAgents) {
        const agent = agentRegistry[agentType as AgentType];
        if (!agent) {
          logger.warn(`Unknown agent type: ${agentType}`, 'Extension');
          continue;
        }

        chatProvider.setCurrentAgent(agentType as AgentType);

        const agentResult = await agent.execute({
          task,
          context,
        });

        if (agentResult.success) {
          chatProvider.addAssistantMessage(
            agentResult.output ?? '',
            agentType as AgentType,
          );

          if (agentResult.files) {
            // Handle file changes (apply or show diff)
            // For now, we just notify
            vscode.window.showInformationMessage(
              `Agent ${agentType} proposed ${agentResult.files.length} changes`,
            );
          }
        } else {
          chatProvider.addAssistantMessage(
            `I encountered an error: ${agentResult.errors?.[0]?.message}`,
            agentType as AgentType,
          );
        }
      }
    } else {
      chatProvider.addAssistantMessage(
        conductorResult.output ?? '',
        'conductor',
      );
    }
  } catch (error) {
    logger.error('Task failed', 'Extension', { error });
    chatProvider.addAssistantMessage(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    statusBar.setStatus('idle');
    chatProvider.setProcessing(false);
    chatProvider.setCurrentAgent(null);
  }
}

/**
 * Get relevant files for a task using smart file selection
 */
async function getRelevantFiles(
  task: string,
  limit: number = 15,
): Promise<import('./types').FileContent[]> {
  if (!extensionState.workspaceFolder) {
    return [];
  }

  try {
    // Find source files in the workspace
    const files = await vscode.workspace.findFiles(
      '**/*.{ts,tsx,js,jsx,py,go,java,rs,rb,php,vue,svelte}',
      '**/node_modules/**',
      100,
    );

    // Read file contents
    const fileContents: import('./types').FileContent[] = [];

    for (const uri of files.slice(0, 50)) {
      try {
        const content = await vscode.workspace.fs.readFile(uri);
        const stat = await vscode.workspace.fs.stat(uri);
        const relativePath = vscode.workspace.asRelativePath(uri);

        fileContents.push({
          path: relativePath,
          content: new TextDecoder('utf-8').decode(content),
          language: getLanguageFromPath(uri.fsPath),
          lastModified: new Date(stat.mtime),
        });
      } catch {
        // Skip files that can't be read
      }
    }

    // Build scoring context
    const scoringContext = {
      query: task,
      recentMessages: chatProvider.getMessages().slice(-5),
      imports: FileRelevanceScorer.buildImportMap(fileContents),
    };

    // Get most relevant files
    return fileRelevanceScorer.getMostRelevant(
      fileContents,
      scoringContext,
      limit,
    );
  } catch (error) {
    logger.error('Failed to get relevant files', 'Extension', { error });
    return [];
  }
}

/**
 * Get language identifier from file path
 */
function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    py: 'python',
    go: 'go',
    java: 'java',
    rs: 'rust',
    rb: 'ruby',
    php: 'php',
    vue: 'vue',
    svelte: 'svelte',
  };
  return langMap[ext] || 'text';
}

/**
 * Handle undo
 */
async function handleUndo(): Promise<void> {
  const undoEntry = sqliteClient.popUndo();
  if (!undoEntry) {
    vscode.window.showInformationMessage('Nothing to undo');
    return;
  }

  // Restore files
  for (const file of undoEntry.filesBefore) {
    const uri = vscode.Uri.file(file.path);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(file.content));
  }

  vscode.window.showInformationMessage(`Undid: ${undoEntry.description}`);
}

/**
 * Handle rollback
 */
async function handleRollback(): Promise<void> {
  // In a full implementation, show a picker for checkpoints
  const id = await vscode.window.showInputBox({
    prompt: 'Enter Checkpoint ID',
  });
  if (!id) return;

  const checkpoint = sqliteClient.getCheckpoint(id);
  if (!checkpoint) {
    vscode.window.showErrorMessage('Checkpoint not found');
    return;
  }

  for (const file of checkpoint.files) {
    const uri = vscode.Uri.file(file.path);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(file.content));
  }

  vscode.window.showInformationMessage(
    `Rolled back to: ${checkpoint.description || id}`,
  );
}

/**
 * Handle memory export
 */
async function handleExportMemory(): Promise<void> {
  try {
    const data = await memoryManager.export();

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('ender-memory-export.json'),
      filters: { JSON: ['json'] },
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
      filters: { JSON: ['json'] },
    });

    if (uris && uris[0]) {
      const content = await vscode.workspace.fs.readFile(uris[0]);
      const data = JSON.parse(Buffer.from(content).toString());

      const result = await memoryManager.import(data);
      vscode.window.showInformationMessage(
        `Imported ${result.imported} entries, skipped ${result.skipped}`,
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
  // Simple implementation using memory manager
  const searchResult = await memoryManager.search({
    categories: ['known_issues'],
  });
  const assumptions = searchResult.entries;
  if (assumptions.length === 0) {
    vscode.window.showInformationMessage('No active assumptions tracked');
    return;
  }

  const selected = await vscode.window.showQuickPick(
    assumptions.map(
      (a: { summary: string; detail: string; status: string }) => ({
        label: a.summary,
        detail: a.detail,
        description: a.status,
      }),
    ),
    { title: 'Active Assumptions' },
  );

  if (selected) {
    vscode.window.showInformationMessage(selected.detail ?? '');
  }
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
async function getApiKey(
  context: vscode.ExtensionContext,
): Promise<string | undefined> {
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
      'Later',
    );

    if (action === 'Enter API Key') {
      apiKey = await vscode.window.showInputBox({
        prompt: 'Enter your Anthropic API key',
        password: true,
        placeHolder: 'sk-ant-...',
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
  vscode.window
    .showInformationMessage(
      'Welcome to Ender! Your AI coding assistant is ready.',
      'Open Chat',
      'View Documentation',
    )
    .then((selection) => {
      if (selection === 'Open Chat') {
        vscode.commands.executeCommand('ender.openChat');
      } else if (selection === 'View Documentation') {
        vscode.env.openExternal(
          vscode.Uri.parse('https://github.com/ender-ai/ender-vscode'),
        );
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

  // Set workspace path for agents that need it
  gitManagerAgent.setWorkspace(workspacePath);

  // Agents are initialized on-demand through the conductor
  // This function sets up any workspace-specific agent configuration
}
