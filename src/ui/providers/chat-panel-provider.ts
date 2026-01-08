/**
 * Chat Panel Provider for Ender
 * Provides the main chat interface in the sidebar
 */

import * as vscode from 'vscode';
import { generateId, logger } from '../../utils';
import type { ConversationMessage, AgentType, AgentStatus } from '../../types';

export class ChatPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ender.chat';
  
  private _view?: vscode.WebviewView;
  private _messages: ConversationMessage[] = [];
  private _currentAgent: AgentType | null = null;
  private _isProcessing = false;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _onSendMessage?: (message: string) => void
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(data => {
      switch (data.type) {
        case 'sendMessage':
          if (this._onSendMessage) {
            this._onSendMessage(data.message);
          }
          break;
        case 'clearChat':
          this.clearMessages();
          break;
        case 'copyCode':
          vscode.env.clipboard.writeText(data.code);
          vscode.window.showInformationMessage('Code copied to clipboard');
          break;
      }
    });

    // Restore messages if any
    this._updateWebview();
  }

  /**
   * Add a user message
   */
  public addUserMessage(content: string): ConversationMessage {
    const message: ConversationMessage = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: new Date()
    };

    this._messages.push(message);
    this._updateWebview();
    
    return message;
  }

  /**
   * Add an assistant message
   */
  public addAssistantMessage(content: string, agent?: AgentType): ConversationMessage {
    const message: ConversationMessage = {
      id: generateId(),
      role: 'assistant',
      content,
      timestamp: new Date(),
      agent
    };

    this._messages.push(message);
    this._updateWebview();
    
    return message;
  }

  /**
   * Stream content to the last assistant message
   */
  public streamContent(content: string): void {
    const lastMessage = this._messages[this._messages.length - 1];
    if (lastMessage && lastMessage.role === 'assistant') {
      lastMessage.content += content;
      this._updateWebview();
    }
  }

  /**
   * Set current agent
   */
  public setCurrentAgent(agent: AgentType | null): void {
    this._currentAgent = agent;
    this._updateAgentIndicator();
  }

  /**
   * Set processing state
   */
  public setProcessing(isProcessing: boolean): void {
    this._isProcessing = isProcessing;
    this._updateProcessingState();
  }

  /**
   * Clear all messages
   */
  public clearMessages(): void {
    this._messages = [];
    this._updateWebview();
  }

  /**
   * Get all messages
   */
  public getMessages(): ConversationMessage[] {
    return [...this._messages];
  }

  /**
   * Update webview with current state
   */
  private _updateWebview(): void {
    if (this._view) {
      this._view.webview.postMessage({
        type: 'updateMessages',
        messages: this._messages
      });
    }
  }

  /**
   * Update agent indicator
   */
  private _updateAgentIndicator(): void {
    if (this._view) {
      this._view.webview.postMessage({
        type: 'updateAgent',
        agent: this._currentAgent
      });
    }
  }

  /**
   * Update processing state
   */
  private _updateProcessingState(): void {
    if (this._view) {
      this._view.webview.postMessage({
        type: 'updateProcessing',
        isProcessing: this._isProcessing
      });
    }
  }

  /**
   * Generate HTML for the webview
   */
  private _getHtmlForWebview(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'resources', 'chat.css')
    );

    const nonce = generateId();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Ender Chat</title>
  <style>
    :root {
      --vscode-font-family: var(--vscode-editor-font-family, 'Segoe UI', sans-serif);
    }
    
    body {
      padding: 0;
      margin: 0;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    
    .chat-container {
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    
    .agent-indicator {
      padding: 8px 12px;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .agent-indicator .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--vscode-charts-green);
    }
    
    .agent-indicator .dot.working {
      animation: pulse 1s infinite;
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }
    
    .message {
      margin-bottom: 16px;
      padding: 8px 12px;
      border-radius: 8px;
      max-width: 90%;
    }
    
    .message.user {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      margin-left: auto;
    }
    
    .message.assistant {
      background: var(--vscode-editor-inactiveSelectionBackground);
    }
    
    .message .agent-tag {
      font-size: 10px;
      opacity: 0.7;
      margin-bottom: 4px;
    }
    
    .message pre {
      background: var(--vscode-textCodeBlock-background);
      padding: 8px;
      border-radius: 4px;
      overflow-x: auto;
      position: relative;
    }
    
    .message pre .copy-btn {
      position: absolute;
      top: 4px;
      right: 4px;
      background: var(--vscode-button-secondaryBackground);
      border: none;
      padding: 4px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
    }
    
    .message pre .copy-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    
    .input-area {
      padding: 12px;
      border-top: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
    }
    
    .input-wrapper {
      display: flex;
      gap: 8px;
    }
    
    .input-wrapper textarea {
      flex: 1;
      padding: 8px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 4px;
      resize: none;
      font-family: inherit;
      font-size: inherit;
      min-height: 60px;
    }
    
    .input-wrapper textarea:focus {
      outline: 1px solid var(--vscode-focusBorder);
    }
    
    .input-wrapper button {
      padding: 8px 16px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      align-self: flex-end;
    }
    
    .input-wrapper button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    
    .input-wrapper button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    .typing-indicator {
      display: none;
      padding: 8px;
      font-style: italic;
      opacity: 0.7;
    }
    
    .typing-indicator.visible {
      display: block;
    }
  </style>
</head>
<body>
  <div class="chat-container">
    <div class="agent-indicator">
      <span class="dot" id="statusDot"></span>
      <span id="agentName">Ready</span>
    </div>
    
    <div class="messages" id="messages"></div>
    
    <div class="typing-indicator" id="typingIndicator">
      Thinking...
    </div>
    
    <div class="input-area">
      <div class="input-wrapper">
        <textarea 
          id="messageInput" 
          placeholder="Ask Ender anything..."
          rows="3"
        ></textarea>
        <button id="sendButton">Send</button>
      </div>
    </div>
  </div>
  
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendButton');
    const statusDot = document.getElementById('statusDot');
    const agentName = document.getElementById('agentName');
    const typingIndicator = document.getElementById('typingIndicator');
    
    let isProcessing = false;
    
    // Send message
    function sendMessage() {
      const message = inputEl.value.trim();
      if (!message || isProcessing) return;
      
      vscode.postMessage({ type: 'sendMessage', message });
      inputEl.value = '';
    }
    
    sendBtn.addEventListener('click', sendMessage);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    
    // Format message content
    function formatContent(content) {
      // Basic markdown-like formatting
      let html = content
        .replace(/\`\`\`(\\w+)?\\n([\\s\\S]*?)\`\`\`/g, (_, lang, code) => {
          return \`<pre><button class="copy-btn" onclick="copyCode(this)">Copy</button><code>\${escapeHtml(code.trim())}</code></pre>\`;
        })
        .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
        .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
        .replace(/\\n/g, '<br>');
      return html;
    }
    
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    window.copyCode = function(btn) {
      const code = btn.nextElementSibling.textContent;
      vscode.postMessage({ type: 'copyCode', code });
    };
    
    // Render messages
    function renderMessages(messages) {
      messagesEl.innerHTML = messages.map(msg => {
        const agentTag = msg.agent ? \`<div class="agent-tag">\${msg.agent}</div>\` : '';
        return \`
          <div class="message \${msg.role}">
            \${agentTag}
            <div class="content">\${formatContent(msg.content)}</div>
          </div>
        \`;
      }).join('');
      
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    
    // Handle messages from extension
    window.addEventListener('message', event => {
      const data = event.data;
      
      switch (data.type) {
        case 'updateMessages':
          renderMessages(data.messages);
          break;
        case 'updateAgent':
          agentName.textContent = data.agent || 'Ready';
          statusDot.className = 'dot' + (data.agent ? ' working' : '');
          break;
        case 'updateProcessing':
          isProcessing = data.isProcessing;
          sendBtn.disabled = isProcessing;
          typingIndicator.className = 'typing-indicator' + (isProcessing ? ' visible' : '');
          break;
      }
    });
  </script>
</body>
</html>`;
  }
}
