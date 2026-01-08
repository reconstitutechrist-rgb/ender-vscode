/**
 * Memory Tree Provider for Ender
 * Shows memory entries in tree view in sidebar
 */

import * as vscode from 'vscode';
import { memoryManager } from '../../memory';
import type { MemoryEntry, MemoryCategory } from '../../types';

export class MemoryTreeProvider implements vscode.TreeDataProvider<MemoryTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<MemoryTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private entries: MemoryEntry[] = [];
  private groupBy: 'category' | 'date' | 'none' = 'category';

  constructor() {
    // Listen for memory changes
    this.refresh();
  }

  refresh(): void {
    this.loadEntries();
    this._onDidChangeTreeData.fire(undefined);
  }

  private async loadEntries(): Promise<void> {
    try {
      const result = await memoryManager.search({ limit: 100 });
      this.entries = result.entries;
    } catch {
      this.entries = [];
    }
  }

  setGroupBy(groupBy: 'category' | 'date' | 'none'): void {
    this.groupBy = groupBy;
    this.refresh();
  }

  getTreeItem(element: MemoryTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: MemoryTreeItem): Promise<MemoryTreeItem[]> {
    if (!element) {
      // Root level
      if (this.groupBy === 'category') {
        return this.getCategoryGroups();
      } else if (this.groupBy === 'date') {
        return this.getDateGroups();
      } else {
        return this.getEntryItems(this.entries);
      }
    }

    // Children of a group
    if (element.type === 'category') {
      const entries = this.entries.filter(e => e.category === element.category);
      return this.getEntryItems(entries);
    }

    if (element.type === 'date') {
      const entries = this.entries.filter(e => 
        this.getDateGroup(e.timestamp) === element.label
      );
      return this.getEntryItems(entries);
    }

    return [];
  }

  private getCategoryGroups(): MemoryTreeItem[] {
    const categories = new Set(this.entries.map(e => e.category));
    const categoryLabels: Record<MemoryCategory, string> = {
      architecture: '🏗️ Architecture',
      conventions: '📏 Conventions',
      dependencies: '📦 Dependencies',
      known_issues: '⚠️ Known Issues',
      business_logic: '💼 Business Logic',
      plans: '📋 Plans',
      history: '📜 History',
      corrections: '✏️ Corrections',
      structure: '📁 Structure'
    };

    return Array.from(categories).map(cat => new MemoryTreeItem(
      categoryLabels[cat] ?? cat,
      vscode.TreeItemCollapsibleState.Collapsed,
      'category',
      cat
    ));
  }

  private getDateGroups(): MemoryTreeItem[] {
    const groups = new Set(this.entries.map(e => this.getDateGroup(e.timestamp)));
    
    return Array.from(groups).map(group => new MemoryTreeItem(
      group,
      vscode.TreeItemCollapsibleState.Collapsed,
      'date'
    ));
  }

  private getDateGroup(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return 'This Week';
    if (days < 30) return 'This Month';
    return 'Older';
  }

  private getEntryItems(entries: MemoryEntry[]): MemoryTreeItem[] {
    return entries.map(entry => {
      const item = new MemoryTreeItem(
        entry.summary,
        vscode.TreeItemCollapsibleState.None,
        'entry',
        entry.category,
        entry
      );

      // Set icon based on status
      if (entry.pinned) {
        item.iconPath = new vscode.ThemeIcon('pin');
      } else if (entry.status === 'pending') {
        item.iconPath = new vscode.ThemeIcon('question');
      } else {
        item.iconPath = new vscode.ThemeIcon('circle-filled');
      }

      // Set description
      item.description = entry.status === 'pending' ? '(pending)' : '';

      // Set tooltip
      item.tooltip = new vscode.MarkdownString();
      item.tooltip.appendMarkdown(`**${entry.summary}**\n\n`);
      item.tooltip.appendMarkdown(`${entry.detail}\n\n`);
      item.tooltip.appendMarkdown(`*Category:* ${entry.category}\n\n`);
      item.tooltip.appendMarkdown(`*Created:* ${entry.timestamp.toLocaleDateString()}\n\n`);
      if (entry.relatedFiles.length > 0) {
        item.tooltip.appendMarkdown(`*Files:* ${entry.relatedFiles.join(', ')}`);
      }

      // Set command to view/edit
      item.command = {
        command: 'ender.viewMemoryEntry',
        title: 'View Entry',
        arguments: [entry]
      };

      // Set context value for context menu
      item.contextValue = entry.pinned ? 'memoryEntryPinned' : 'memoryEntry';

      return item;
    });
  }
}

class MemoryTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly type: 'category' | 'date' | 'entry',
    public readonly category?: MemoryCategory,
    public readonly entry?: MemoryEntry
  ) {
    super(label, collapsibleState);
  }
}

/**
 * Instruction Tree Provider for Ender
 * Shows tracked instructions in sidebar
 */
export class InstructionTreeProvider implements vscode.TreeDataProvider<InstructionTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<InstructionTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private instructions: Array<{
    id: string;
    text: string;
    status: 'pending' | 'complied' | 'violated' | 'partial';
    evidence?: string;
  }> = [];

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  setInstructions(instructions: typeof this.instructions): void {
    this.instructions = instructions;
    this.refresh();
  }

  getTreeItem(element: InstructionTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: InstructionTreeItem): Promise<InstructionTreeItem[]> {
    if (element) return [];

    return this.instructions.map(inst => {
      const statusIcons: Record<string, string> = {
        pending: 'circle-outline',
        complied: 'check',
        violated: 'x',
        partial: 'circle-slash'
      };

      const statusColors: Record<string, string> = {
        pending: 'list.warningForeground',
        complied: 'testing.iconPassed',
        violated: 'testing.iconFailed',
        partial: 'list.warningForeground'
      };

      const item = new InstructionTreeItem(
        inst.text,
        vscode.TreeItemCollapsibleState.None,
        inst.id
      );

      item.iconPath = new vscode.ThemeIcon(
        statusIcons[inst.status] ?? 'circle-outline',
        new vscode.ThemeColor(statusColors[inst.status] ?? 'foreground')
      );

      item.description = inst.status;

      if (inst.evidence) {
        item.tooltip = new vscode.MarkdownString(`**Status:** ${inst.status}\n\n**Evidence:** ${inst.evidence}`);
      }

      return item;
    });
  }
}

class InstructionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly instructionId: string
  ) {
    super(label, collapsibleState);
  }
}
