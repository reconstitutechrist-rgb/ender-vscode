/**
 * Assumption Log for Ender
 * Tracks and verifies assumptions made during code generation
 */

import { generateId, logger } from '../utils';
import type { Assumption, AssumptionLog } from '../types';

export class AssumptionTracker {
  private assumptions: Map<string, Assumption> = new Map();

  /**
   * Add an assumption
   */
  addAssumption(
    assumption: string,
    category: Assumption['category'],
    risk: Assumption['risk'] = 'medium'
  ): Assumption {
    const entry: Assumption = {
      id: generateId(),
      assumption,
      category,
      verified: false,
      risk,
      createdAt: new Date()
    };

    this.assumptions.set(entry.id, entry);
    logger.debug('Assumption logged', 'Sanity', { assumption, category, risk });

    return entry;
  }

  /**
   * Extract assumptions from reasoning text
   */
  extractAssumptions(text: string): Assumption[] {
    const extracted: Assumption[] = [];
    
    // Patterns that indicate assumptions
    const patterns = [
      // Technical assumptions
      { regex: /(?:assuming|assume|presuming|presume)\s+(?:that\s+)?(.+?)(?:\.|,|$)/gi, category: 'technical' as const },
      { regex: /(?:I'll|I will)\s+(?:assume|presume)\s+(.+?)(?:\.|,|$)/gi, category: 'technical' as const },
      
      // Requirement assumptions
      { regex: /(?:I understand|understood|interpreting)\s+(?:that\s+)?(.+?)(?:\.|,|$)/gi, category: 'requirement' as const },
      { regex: /(?:based on|given)\s+(?:that\s+)?(.+?)(?:\.|,|$)/gi, category: 'requirement' as const },
      
      // Environment assumptions
      { regex: /(?:expecting|expect)\s+(?:that\s+)?(.+?)(?:to be|is)\s+(.+?)(?:\.|,|$)/gi, category: 'environment' as const },
      { regex: /(?:configured|set up)\s+(?:with|for)\s+(.+?)(?:\.|,|$)/gi, category: 'environment' as const },
      
      // User intent assumptions
      { regex: /(?:I think|believe|seems like)\s+(?:you want|you need|the goal is)\s+(.+?)(?:\.|,|$)/gi, category: 'user_intent' as const },
      { regex: /(?:it looks like|appears)\s+(?:you're|you are)\s+(.+?)(?:\.|,|$)/gi, category: 'user_intent' as const },
    ];

    for (const { regex, category } of patterns) {
      let match;
      while ((match = regex.exec(text)) !== null) {
        const assumptionText = match[1]?.trim();
        if (assumptionText && assumptionText.length > 10) {
          const risk = this.assessRisk(assumptionText, category);
          const assumption = this.addAssumption(assumptionText, category, risk);
          extracted.push(assumption);
        }
      }
    }

    return extracted;
  }

  /**
   * Assess risk level of an assumption
   */
  private assessRisk(text: string, category: Assumption['category']): Assumption['risk'] {
    const textLower = text.toLowerCase();

    // High risk indicators
    const highRiskKeywords = [
      'database', 'security', 'authentication', 'password', 'token',
      'payment', 'production', 'deployment', 'migration', 'delete',
      'remove', 'breaking', 'api', 'endpoint'
    ];

    // Low risk indicators
    const lowRiskKeywords = [
      'style', 'format', 'naming', 'convention', 'prefer',
      'comment', 'documentation', 'test'
    ];

    if (highRiskKeywords.some(k => textLower.includes(k))) {
      return 'high';
    }

    if (lowRiskKeywords.some(k => textLower.includes(k))) {
      return 'low';
    }

    // Category-based defaults
    if (category === 'environment' || category === 'technical') {
      return 'medium';
    }

    return 'medium';
  }

  /**
   * Mark assumption as verified
   */
  verify(
    id: string,
    method: string,
    result: string
  ): void {
    const assumption = this.assumptions.get(id);
    if (assumption) {
      assumption.verified = true;
      assumption.verificationMethod = method;
      assumption.verificationResult = result;
      assumption.verifiedAt = new Date();
    }
  }

  /**
   * Verify assumption against codebase
   */
  verifyAgainstCodebase(
    id: string,
    codebaseContent: string
  ): boolean {
    const assumption = this.assumptions.get(id);
    if (!assumption) return false;

    const textLower = assumption.assumption.toLowerCase();
    const codeLower = codebaseContent.toLowerCase();

    // Extract key terms from assumption
    const keyTerms = textLower
      .split(/\s+/)
      .filter(w => w.length > 3)
      .filter(w => !['that', 'with', 'this', 'will', 'have'].includes(w));

    // Check if key terms exist in codebase
    const matchingTerms = keyTerms.filter(t => codeLower.includes(t));
    const matchRatio = keyTerms.length > 0 ? matchingTerms.length / keyTerms.length : 0;

    const verified = matchRatio >= 0.5;
    
    this.verify(
      id,
      'codebase_search',
      verified 
        ? `Found ${matchingTerms.length}/${keyTerms.length} key terms in codebase`
        : `Only ${matchingTerms.length}/${keyTerms.length} key terms found`
    );

    return verified;
  }

  /**
   * Get assumption log summary
   */
  getLog(): AssumptionLog {
    const all = Array.from(this.assumptions.values());
    
    return {
      assumptions: all,
      unverifiedCount: all.filter(a => !a.verified).length,
      highRiskCount: all.filter(a => a.risk === 'high').length
    };
  }

  /**
   * Get unverified assumptions
   */
  getUnverified(): Assumption[] {
    return Array.from(this.assumptions.values()).filter(a => !a.verified);
  }

  /**
   * Get high risk assumptions
   */
  getHighRisk(): Assumption[] {
    return Array.from(this.assumptions.values()).filter(a => a.risk === 'high');
  }

  /**
   * Get unverified high risk assumptions
   */
  getUnverifiedHighRisk(): Assumption[] {
    return Array.from(this.assumptions.values())
      .filter(a => !a.verified && a.risk === 'high');
  }

  /**
   * Generate user-facing summary
   */
  getSummaryForUser(): string {
    const log = this.getLog();
    
    if (log.assumptions.length === 0) {
      return 'No assumptions made.';
    }

    const lines: string[] = [`I made ${log.assumptions.length} assumption(s):`];
    
    // Group by category
    const byCategory = new Map<string, Assumption[]>();
    for (const a of log.assumptions) {
      if (!byCategory.has(a.category)) {
        byCategory.set(a.category, []);
      }
      byCategory.get(a.category)!.push(a);
    }

    for (const [category, assumptions] of byCategory) {
      lines.push(`\n**${this.formatCategory(category)}:**`);
      for (const a of assumptions) {
        const status = a.verified ? '✓' : (a.risk === 'high' ? '⚠️' : '?');
        lines.push(`${status} ${a.assumption}`);
      }
    }

    if (log.unverifiedCount > 0) {
      lines.push(`\n⚠️ ${log.unverifiedCount} unverified assumption(s) - please confirm these are correct.`);
    }

    return lines.join('\n');
  }

  /**
   * Format category for display
   */
  private formatCategory(category: Assumption['category']): string {
    const formats: Record<Assumption['category'], string> = {
      technical: 'Technical',
      requirement: 'Requirements',
      environment: 'Environment',
      user_intent: 'Your Intent'
    };
    return formats[category];
  }

  /**
   * Clear all assumptions
   */
  clear(): void {
    this.assumptions.clear();
  }

  /**
   * Should pause for user verification?
   */
  shouldPauseForVerification(): boolean {
    // Pause if there are unverified high-risk assumptions
    return this.getUnverifiedHighRisk().length > 0;
  }

  /**
   * Get all assumptions
   */
  getAll(): Assumption[] {
    return Array.from(this.assumptions.values());
  }
}

// Factory function to create new tracker
export function createAssumptionTracker(): AssumptionTracker {
  return new AssumptionTracker();
}
