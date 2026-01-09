/**
 * Auto Memory Manager
 * Triggers automatic memory updates based on project events
 */

import { logger } from '../utils';
import { memoryManager } from './memory-manager';
// MemoryEntry type available for full implementation

export class AutoMemoryManager {
  /**
   * Handle file save event
   */
  async onFileSave(filePath: string, _content: string): Promise<void> {
    // Identify if this is a significant architectural file
    if (this.isArchitecturalFile(filePath)) {
      logger.info(`Architectural file saved: ${filePath}`, 'AutoMemory');
      // In a full implementation, we would analyze changes and propose memory updates
      // For now, we just log
    }
  }

  /**
   * Handle plan completion
   */
  async onPlanComplete(planId: string, summary: string): Promise<void> {
    await memoryManager.addEntry({
      category: 'history',
      summary: `Completed plan: ${summary}`,
      detail: `Plan ID: ${planId} completed successfully.`,
      relatedFiles: [],
      source: 'auto',
      tags: ['plan-completion'],
      status: 'confirmed', // Auto-confirmed? Or pending? Architecture says pending usually.
      pinned: false,
      tier: 'warm',
      confidence: 100,
    });
  }

  private isArchitecturalFile(filePath: string): boolean {
    return /config|architecture|schema|interface|types/i.test(filePath);
  }
}

export const autoMemoryManager = new AutoMemoryManager();
