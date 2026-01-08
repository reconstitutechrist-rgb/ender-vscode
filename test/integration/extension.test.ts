/**
 * Integration tests for Ender extension
 */

import * as vscode from 'vscode';
import * as assert from 'assert';

suite('Extension Test Suite', () => {
  vscode.window.showInformationMessage('Starting Ender integration tests');

  test('Extension should be present', () => {
    const extension = vscode.extensions.getExtension('ender.ender-vscode');
    assert.ok(extension, 'Extension should be installed');
  });

  test('Extension should activate', async () => {
    const extension = vscode.extensions.getExtension('ender.ender-vscode');
    if (extension) {
      await extension.activate();
      assert.ok(extension.isActive, 'Extension should be active');
    }
  });

  test('Commands should be registered', async () => {
    const commands = await vscode.commands.getCommands();
    
    const enderCommands = [
      'ender.openChat',
      'ender.newTask',
      'ender.viewMemory',
      'ender.undo',
      'ender.rollback',
      'ender.exportMemory',
      'ender.importMemory'
    ];

    for (const cmd of enderCommands) {
      assert.ok(
        commands.includes(cmd),
        `Command ${cmd} should be registered`
      );
    }
  });

  test('Views should be registered', async () => {
    // Check that view containers exist
    const chatView = vscode.window.createTreeView('ender.chat', {
      treeDataProvider: {
        getTreeItem: () => new vscode.TreeItem('test'),
        getChildren: () => []
      }
    });
    
    assert.ok(chatView, 'Chat view should be creatable');
    chatView.dispose();
  });
});
