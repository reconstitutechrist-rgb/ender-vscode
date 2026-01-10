/**
 * VS Code Extension Tests
 * Tests extension activation, commands, and views
 */

import * as vscode from 'vscode';
import * as assert from 'assert';

suite('Ender Extension Test Suite', () => {
  test('VS Code Test Suite runs', () => {
    console.log('VS Code version:', vscode.version);
    console.log('Extensions available:', vscode.extensions.all.length);
    assert.ok(true, 'Test suite is running');
  });

  test('Configuration namespace exists', () => {
    const config = vscode.workspace.getConfiguration('ender');
    // Config namespace exists even if extension isn't loaded
    assert.ok(config, 'Configuration namespace should exist');
  });

  test('Extension should be present', () => {
    // The extension ID format is publisher.name from package.json
    const extension = vscode.extensions.getExtension('ender-ai.ender');
    if (!extension) {
      console.log('Extension not found. Searching for dev extensions...');
      const devExtensions = vscode.extensions.all.filter(
        (e) => e.extensionPath.includes('ender'),
      );
      devExtensions.forEach((e) =>
        console.log(`  Found: ${e.id} at ${e.extensionPath}`),
      );
    }
    assert.ok(extension, 'Extension should be installed');
  });

  test('Extension should activate', async () => {
    const extension = vscode.extensions.getExtension('ender-ai.ender');
    if (extension) {
      try {
        await extension.activate();
        assert.ok(extension.isActive, 'Extension should be active');
      } catch (err) {
        console.error('Extension activation failed:', err);
        throw err;
      }
    } else {
      assert.fail('Extension not found, cannot test activation');
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
      'ender.approveChange',
      'ender.rejectChange',
      'ender.viewDiff',
      'ender.exportMemory',
      'ender.importMemory',
      'ender.toggleStrictMode',
      'ender.showAssumptions',
      'ender.clearHistory',
    ];

    for (const cmd of enderCommands) {
      if (!commands.includes(cmd)) {
        console.log(`Missing command: ${cmd}`);
      }
      assert.ok(commands.includes(cmd), `Command ${cmd} should be registered`);
    }
  });

  test('Configuration should have default values', () => {
    const config = vscode.workspace.getConfiguration('ender');

    assert.strictEqual(config.get('approvalMode'), 'hybrid');
    assert.strictEqual(config.get('validatorMode'), 'strict');
    assert.strictEqual(config.get('confidenceThreshold'), 80);
    assert.strictEqual(config.get('showAgentIndicator'), true);
    assert.strictEqual(config.get('showCostTracker'), true);
  });
});
