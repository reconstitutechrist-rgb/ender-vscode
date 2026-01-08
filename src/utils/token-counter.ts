/**
 * Token Counter Utility
 * Estimates token usage for text content
 */

export class TokenCounter {
  /**
   * Estimate token count for a string
   * Uses a simple heuristic: 1 token ~= 4 characters
   * or ~3.5 chars for code
   */
  count(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 3.5);
  }

  /**
   * Truncate text to token limit
   */
  truncate(text: string, maxTokens: number): string {
    const estimatedTokens = this.count(text);
    if (estimatedTokens <= maxTokens) return text;

    const targetLength = Math.floor(maxTokens * 3.5);
    return text.slice(0, targetLength) + '... (truncated)';
  }

  /**
   * Count tokens for a list of messages
   */
  countMessages(messages: Array<{ content: string }>): number {
    return messages.reduce((sum, msg) => sum + this.count(msg.content), 0);
  }
}

export const tokenCounter = new TokenCounter();
