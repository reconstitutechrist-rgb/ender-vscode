/**
 * Anthropic API client for Ender
 * Handles communication with Claude API
 */

import Anthropic from '@anthropic-ai/sdk';
import { logger, CostTracker, createTokenUsage, retry } from '../utils';
import type {
  ModelId,
  AgentType,
  ConversationMessage,
  TokenUsage,
} from '../types';

export interface ChatParams {
  model: ModelId;
  system: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  maxTokens: number;
  temperature?: number;
  metadata?: {
    agent: AgentType;
    taskId: string;
    planId?: string;
  };
}

export interface ChatResponse {
  id: string;
  content: string;
  stopReason: string | null;
  usage: TokenUsage;
  model: string;
}

export interface StreamChunk {
  type: 'text' | 'usage' | 'done' | 'error';
  content?: string;
  usage?: TokenUsage;
  error?: Error;
}

export class AnthropicClient {
  private client: Anthropic | null = null;
  private costTracker: CostTracker;
  private isInitialized = false;

  constructor(costTracker?: CostTracker) {
    this.costTracker = costTracker ?? new CostTracker();
  }

  /**
   * Initialize the client with API key
   */
  initialize(apiKey: string): void {
    this.client = new Anthropic({ apiKey });
    this.isInitialized = true;
    logger.info('Anthropic client initialized', 'API');
  }

  /**
   * Check if client is initialized
   */
  isReady(): boolean {
    return this.isInitialized && this.client !== null;
  }

  /**
   * Ensure client is ready
   */
  private ensureReady(): Anthropic {
    if (!this.client) {
      throw new Error(
        'Anthropic client not initialized. Call initialize() first.',
      );
    }
    return this.client;
  }

  /**
   * Send a chat message and get response
   */
  async chat(params: ChatParams): Promise<ChatResponse> {
    const client = this.ensureReady();
    const startTime = Date.now();

    logger.debug('Sending chat request', 'API', {
      model: params.model,
      messageCount: params.messages.length,
      maxTokens: params.maxTokens,
      agent: params.metadata?.agent,
    });

    try {
      const response = await retry(
        async () => {
          return client.messages.create({
            model: params.model,
            max_tokens: params.maxTokens,
            temperature: params.temperature ?? 0.7,
            system: params.system,
            messages: params.messages,
          });
        },
        {
          maxRetries: 3,
          initialDelay: 1000,
          shouldRetry: (error) => {
            // Retry on rate limits and temporary errors
            if (error instanceof Anthropic.RateLimitError) return true;
            if (error instanceof Anthropic.InternalServerError) return true;
            return false;
          },
        },
      );

      const duration = Date.now() - startTime;
      const usage = createTokenUsage(
        params.model,
        response.usage.input_tokens,
        response.usage.output_tokens,
      );

      // Track cost
      this.costTracker.addCost(usage.cost);

      // Extract text content
      const content = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      logger.api(params.model, usage, duration);

      return {
        id: response.id,
        content,
        stopReason: response.stop_reason,
        usage,
        model: response.model,
      };
    } catch (error) {
      logger.error('Chat request failed', 'API', {
        error,
        params: { ...params, system: '[redacted]' },
      });
      throw this.handleError(error);
    }
  }

  /**
   * Stream chat response
   */
  async *chatStream(params: ChatParams): AsyncIterableIterator<StreamChunk> {
    const client = this.ensureReady();
    const startTime = Date.now();

    logger.debug('Starting chat stream', 'API', {
      model: params.model,
      agent: params.metadata?.agent,
    });

    try {
      const stream = client.messages.stream({
        model: params.model,
        max_tokens: params.maxTokens,
        temperature: params.temperature ?? 0.7,
        system: params.system,
        messages: params.messages,
      });

      let inputTokens = 0;
      let outputTokens = 0;

      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield { type: 'text', content: event.delta.text };
          }
        } else if (event.type === 'message_delta') {
          if (event.usage) {
            outputTokens = event.usage.output_tokens;
          }
        } else if (event.type === 'message_start') {
          if (event.message.usage) {
            inputTokens = event.message.usage.input_tokens;
          }
        }
      }

      const usage = createTokenUsage(params.model, inputTokens, outputTokens);
      this.costTracker.addCost(usage.cost);

      const duration = Date.now() - startTime;
      logger.api(
        params.model,
        { input: inputTokens, output: outputTokens },
        duration,
      );

      yield { type: 'usage', usage };
      yield { type: 'done' };
    } catch (error) {
      logger.error('Chat stream failed', 'API', { error });
      yield { type: 'error', error: this.handleError(error) };
    }
  }

  /**
   * Count tokens for content (estimate)
   * Uses character-based estimation since countTokens API may not be available
   */
  async countTokens(
    content: string,
    _model: ModelId = 'claude-sonnet-4-5-20250929',
  ): Promise<number> {
    // Use character-based estimation (roughly 3.5 chars per token)
    return Math.ceil(content.length / 3.5);
  }

  /**
   * Get cost tracker
   */
  getCostTracker(): CostTracker {
    return this.costTracker;
  }

  /**
   * Handle API errors
   */
  private handleError(error: unknown): Error {
    if (error instanceof Anthropic.APIError) {
      switch (error.status) {
        case 400:
          return new Error(`Bad request: ${error.message}`);
        case 401:
          return new Error('Invalid API key. Please check your configuration.');
        case 403:
          return new Error(
            'Access denied. Your API key may not have the required permissions.',
          );
        case 404:
          return new Error(
            'Model not found. The requested model may not be available.',
          );
        case 429:
          return new Error(
            'Rate limited. Please wait before making more requests.',
          );
        case 500:
        case 502:
        case 503:
          return new Error(
            'Anthropic service temporarily unavailable. Please try again.',
          );
        default:
          return new Error(`API error: ${error.message}`);
      }
    }

    if (error instanceof Error) {
      return error;
    }

    return new Error('Unknown error occurred');
  }
}

/**
 * Convert conversation messages to API format
 */
export function formatMessagesForApi(
  messages: ConversationMessage[],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));
}

/**
 * Create a default client instance
 */
export const apiClient = new AnthropicClient();
