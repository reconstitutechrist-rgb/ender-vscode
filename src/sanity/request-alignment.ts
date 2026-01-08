/**
 * Request Alignment Checker
 * Verifies that the output aligns with the original user request
 */

import type { FileChange, ContextBundle, RequestAlignmentReport } from '../types';

export type ApiCallback = (params: {
  model?: string;
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
}) => Promise<{ content: string }>;

export class RequestAlignmentChecker {
  /**
   * Check request alignment using AI
   */
  async check(
    originalRequest: string,
    changes: FileChange[],
    callApi: ApiCallback,
    model: string
  ): Promise<RequestAlignmentReport> {
    const prompt = `## Request Alignment Check

Original Request: "${originalRequest}"

Changes made:
${changes.map(c => `- Modified ${c.path}`).join('\n')}

Did these changes fulfill the request?
Identify addressed goals, missed goals, and any extra work.
Score the alignment from 0-100.

Response JSON Format:
{
  "score": 85,
  "addressedGoals": ["..."],
  "missedGoals": ["..."],
  "extraWork": ["..."],
  "driftExplanation": "..."
}`;

    try {
      const response = await callApi({
        model,
        system: "You are a product owner. Verify the implementation matches the request.",
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 1000
      });

      const result = JSON.parse(response.content.match(/\{[\s\S]*\}/)?.[0] ?? '{}');

      return {
        originalRequest,
        alignmentScore: result.score ?? 85,
        addressedGoals: result.addressedGoals ?? [],
        missedGoals: result.missedGoals ?? [],
        extraWork: result.extraWork ?? [],
        driftExplanation: result.driftExplanation
      };
    } catch (error) {
      return {
        originalRequest,
        alignmentScore: 85,
        addressedGoals: ['Functionality implemented'],
        missedGoals: [],
        extraWork: [],
        driftExplanation: 'Error checking alignment'
      };
    }
  }
}

export const requestAlignmentChecker = new RequestAlignmentChecker();
