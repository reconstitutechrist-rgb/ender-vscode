/**
 * Instruction Tracker for Ender
 * Tracks user instructions and verifies compliance
 */

import { generateId, logger } from '../utils';
import type {
  TrackedInstruction,
  InstructionComplianceReport
} from '../types';

export class InstructionTracker {
  private instructions: Map<string, TrackedInstruction> = new Map();

  /**
   * Add an instruction to track
   */
  addInstruction(
    text: string,
    source: 'user' | 'approved_plan',
    priority: 'must' | 'should' | 'nice_to_have' = 'must'
  ): TrackedInstruction {
    const instruction: TrackedInstruction = {
      id: generateId(),
      text,
      source,
      timestamp: new Date(),
      priority,
      status: 'pending'
    };

    this.instructions.set(instruction.id, instruction);
    logger.debug('Instruction tracked', 'Sanity', { text, priority });

    return instruction;
  }

  /**
   * Extract instructions from user message
   */
  extractInstructions(message: string): TrackedInstruction[] {
    const extracted: TrackedInstruction[] = [];
    
    // Look for explicit instructions
    const patterns = [
      // Must do patterns
      { regex: /(?:must|have to|need to|required to|always)\s+(.+?)(?:\.|$)/gi, priority: 'must' as const },
      { regex: /(?:don't|do not|never|avoid)\s+(.+?)(?:\.|$)/gi, priority: 'must' as const },
      { regex: /(?:make sure|ensure|verify)\s+(.+?)(?:\.|$)/gi, priority: 'must' as const },
      
      // Should do patterns  
      { regex: /(?:should|prefer|try to)\s+(.+?)(?:\.|$)/gi, priority: 'should' as const },
      { regex: /(?:ideally|preferably)\s+(.+?)(?:\.|$)/gi, priority: 'should' as const },
      
      // Nice to have patterns
      { regex: /(?:if possible|optionally|bonus if)\s+(.+?)(?:\.|$)/gi, priority: 'nice_to_have' as const },
      { regex: /(?:would be nice|could also)\s+(.+?)(?:\.|$)/gi, priority: 'nice_to_have' as const },
    ];

    for (const { regex, priority } of patterns) {
      let match;
      while ((match = regex.exec(message)) !== null) {
        if (match[1] && match[1].length > 5) {
          const instruction = this.addInstruction(
            match[1].trim(),
            'user',
            priority
          );
          extracted.push(instruction);
        }
      }
    }

    return extracted;
  }

  /**
   * Extract instructions from plan
   */
  extractFromPlan(planDescription: string, tasks: string[]): TrackedInstruction[] {
    const extracted: TrackedInstruction[] = [];

    // Add main plan goal
    if (planDescription) {
      const instruction = this.addInstruction(
        planDescription,
        'approved_plan',
        'must'
      );
      extracted.push(instruction);
    }

    // Add each task as an instruction
    for (const task of tasks) {
      const instruction = this.addInstruction(
        task,
        'approved_plan',
        'must'
      );
      extracted.push(instruction);
    }

    return extracted;
  }

  /**
   * Mark instruction as complied
   */
  markComplied(instructionId: string, evidence: string): void {
    const instruction = this.instructions.get(instructionId);
    if (instruction) {
      instruction.status = 'complied';
      instruction.evidence = evidence;
    }
  }

  /**
   * Mark instruction as violated
   */
  markViolated(instructionId: string, explanation: string): void {
    const instruction = this.instructions.get(instructionId);
    if (instruction) {
      instruction.status = 'violated';
      instruction.explanation = explanation;
    }
  }

  /**
   * Mark instruction as partial
   */
  markPartial(instructionId: string, evidence: string, explanation: string): void {
    const instruction = this.instructions.get(instructionId);
    if (instruction) {
      instruction.status = 'partial';
      instruction.evidence = evidence;
      instruction.explanation = explanation;
    }
  }

  /**
   * Mark instruction as not applicable
   */
  markNotApplicable(instructionId: string, explanation: string): void {
    const instruction = this.instructions.get(instructionId);
    if (instruction) {
      instruction.status = 'not_applicable';
      instruction.explanation = explanation;
    }
  }

  /**
   * Verify compliance of all instructions against output
   */
  verifyCompliance(output: string, changedFiles: string[]): void {
    const outputLower = output.toLowerCase();
    const filesLower = changedFiles.map(f => f.toLowerCase());

    for (const [id, instruction] of this.instructions) {
      if (instruction.status !== 'pending') continue;

      const textLower = instruction.text.toLowerCase();
      
      // Check if instruction is addressed in output
      const keywords = textLower.split(/\s+/).filter(w => w.length > 3);
      const matchingKeywords = keywords.filter(k => outputLower.includes(k));
      const matchRatio = keywords.length > 0 ? matchingKeywords.length / keywords.length : 0;

      // Check for negation instructions
      const isNegation = /^(?:don't|do not|never|avoid|no)\s/i.test(instruction.text);

      if (isNegation) {
        // For negations, we need to verify the thing isn't done
        const forbiddenContent = textLower.replace(/^(?:don't|do not|never|avoid|no)\s+/i, '');
        if (!outputLower.includes(forbiddenContent)) {
          this.markComplied(id, 'Forbidden content not found in output');
        } else {
          this.markViolated(id, 'Forbidden content found in output');
        }
      } else if (matchRatio >= 0.6) {
        this.markComplied(id, `Found ${matchingKeywords.length}/${keywords.length} keywords`);
      } else if (matchRatio >= 0.3) {
        this.markPartial(id, 
          `Found ${matchingKeywords.length}/${keywords.length} keywords`,
          'Partial match - may need verification'
        );
      }
      // Leave as pending if no match
    }
  }

  /**
   * Generate compliance report
   */
  generateReport(): InstructionComplianceReport {
    const all = Array.from(this.instructions.values());
    
    const complied = all.filter(i => i.status === 'complied').length;
    const violated = all.filter(i => i.status === 'violated').length;
    const partial = all.filter(i => i.status === 'partial').length;
    const notApplicable = all.filter(i => i.status === 'not_applicable').length;
    const pending = all.filter(i => i.status === 'pending').length;

    // Calculate score (must = 2 points, should = 1 point, nice_to_have = 0.5 points)
    let totalPossible = 0;
    let totalEarned = 0;

    for (const instruction of all) {
      const weight = instruction.priority === 'must' ? 2 :
                     instruction.priority === 'should' ? 1 : 0.5;
      totalPossible += weight;

      if (instruction.status === 'complied') {
        totalEarned += weight;
      } else if (instruction.status === 'partial') {
        totalEarned += weight * 0.5;
      } else if (instruction.status === 'not_applicable') {
        totalPossible -= weight; // Don't count N/A against score
      }
    }

    const overallScore = totalPossible > 0 
      ? Math.round((totalEarned / totalPossible) * 100)
      : 100;

    return {
      totalInstructions: all.length,
      complied,
      violated,
      partial,
      notApplicable,
      details: all,
      overallScore
    };
  }

  /**
   * Get all tracked instructions
   */
  getAll(): TrackedInstruction[] {
    return Array.from(this.instructions.values());
  }

  /**
   * Get instructions by status
   */
  getByStatus(status: TrackedInstruction['status']): TrackedInstruction[] {
    return Array.from(this.instructions.values()).filter(i => i.status === status);
  }

  /**
   * Get pending instructions
   */
  getPending(): TrackedInstruction[] {
    return this.getByStatus('pending');
  }

  /**
   * Get violated instructions
   */
  getViolated(): TrackedInstruction[] {
    return this.getByStatus('violated');
  }

  /**
   * Clear all instructions
   */
  clear(): void {
    this.instructions.clear();
  }

  /**
   * Get summary for display
   */
  getSummary(): string {
    const report = this.generateReport();
    
    if (report.totalInstructions === 0) {
      return 'No instructions tracked';
    }

    const lines: string[] = [
      `Compliance: ${report.overallScore}%`,
      `✓ ${report.complied} complied`,
    ];

    if (report.violated > 0) {
      lines.push(`✗ ${report.violated} violated`);
    }
    if (report.partial > 0) {
      lines.push(`◐ ${report.partial} partial`);
    }
    if (report.notApplicable > 0) {
      lines.push(`- ${report.notApplicable} N/A`);
    }

    return lines.join(' | ');
  }
}

// Factory function to create new tracker per conversation
export function createInstructionTracker(): InstructionTracker {
  return new InstructionTracker();
}
