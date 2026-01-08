/**
 * Request queue for Ender
 * Manages API request queuing and rate limiting
 */

import { logger, generateId, sleep } from '../utils';
import type { AgentType } from '../types';

export interface QueuedRequest {
  id: string;
  agent: AgentType;
  priority: 'high' | 'normal' | 'low';
  execute: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  createdAt: Date;
  startedAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface QueueStatus {
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
  rateLimited: boolean;
  estimatedWait: number;
  avgProcessingTime: number;
}

export interface QueueConfig {
  maxConcurrent: number;
  maxQueueSize: number;
  rateLimitDelay: number;
  requestTimeout: number;
  priorityBoost: {
    high: number;
    normal: number;
    low: number;
  };
}

export class RequestQueue {
  private queue: QueuedRequest[] = [];
  private inProgress: Set<string> = new Set();
  private config: QueueConfig;
  private rateLimited = false;
  private rateLimitUntil: Date | null = null;
  private stats = {
    completed: 0,
    failed: 0,
    totalProcessingTime: 0
  };
  private processing = false;

  constructor(config?: Partial<QueueConfig>) {
    this.config = {
      maxConcurrent: 3,
      maxQueueSize: 100,
      rateLimitDelay: 1000,
      requestTimeout: 120000, // 2 minutes
      priorityBoost: {
        high: 3,
        normal: 1,
        low: 0.5
      },
      ...config
    };
  }

  /**
   * Enqueue a request
   */
  async enqueue<T>(
    agent: AgentType,
    execute: () => Promise<T>,
    options?: {
      priority?: 'high' | 'normal' | 'low';
      metadata?: Record<string, unknown>;
    }
  ): Promise<T> {
    if (this.queue.length >= this.config.maxQueueSize) {
      throw new Error('Request queue is full. Please try again later.');
    }

    return new Promise<T>((resolve, reject) => {
      const request: QueuedRequest = {
        id: generateId(),
        agent,
        priority: options?.priority ?? 'normal',
        execute,
        resolve: resolve as (value: unknown) => void,
        reject,
        createdAt: new Date(),
        metadata: options?.metadata
      };

      this.queue.push(request);
      this.sortQueue();

      logger.debug(`Request queued: ${request.id}`, 'Queue', {
        agent,
        priority: request.priority,
        queueLength: this.queue.length
      });

      // Start processing if not already
      this.processQueue();
    });
  }

  /**
   * Process the queue
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0) {
        // Wait if rate limited
        if (this.rateLimited && this.rateLimitUntil) {
          const waitTime = this.rateLimitUntil.getTime() - Date.now();
          if (waitTime > 0) {
            logger.debug(`Rate limited, waiting ${waitTime}ms`, 'Queue');
            await sleep(waitTime);
          }
          this.rateLimited = false;
          this.rateLimitUntil = null;
        }

        // Check concurrent limit
        if (this.inProgress.size >= this.config.maxConcurrent) {
          await sleep(100);
          continue;
        }

        // Get next request
        const request = this.queue.shift();
        if (!request) break;

        // Process request
        this.processRequest(request);
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Process a single request
   */
  private async processRequest(request: QueuedRequest): Promise<void> {
    this.inProgress.add(request.id);
    request.startedAt = new Date();

    logger.debug(`Processing request: ${request.id}`, 'Queue', {
      agent: request.agent,
      waitTime: request.startedAt.getTime() - request.createdAt.getTime()
    });

    try {
      // Add timeout
      const result = await Promise.race([
        request.execute(),
        this.timeout(request.id)
      ]);

      const processingTime = Date.now() - request.startedAt.getTime();
      this.stats.completed++;
      this.stats.totalProcessingTime += processingTime;

      logger.debug(`Request completed: ${request.id}`, 'Queue', {
        processingTime
      });

      request.resolve(result);
    } catch (error) {
      this.stats.failed++;

      // Check for rate limit error
      if (this.isRateLimitError(error)) {
        const retryAfter = this.extractRetryAfter(error);
        this.handleRateLimit(retryAfter);
        
        // Re-queue the request
        this.queue.unshift(request);
        this.inProgress.delete(request.id);
        return;
      }

      logger.error(`Request failed: ${request.id}`, 'Queue', { error });
      request.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.inProgress.delete(request.id);
    }
  }

  /**
   * Create timeout promise
   */
  private timeout(requestId: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Request ${requestId} timed out after ${this.config.requestTimeout}ms`));
      }, this.config.requestTimeout);
    });
  }

  /**
   * Sort queue by priority
   */
  private sortQueue(): void {
    this.queue.sort((a, b) => {
      const aPriority = this.config.priorityBoost[a.priority];
      const bPriority = this.config.priorityBoost[b.priority];
      
      // Higher priority first
      if (aPriority !== bPriority) {
        return bPriority - aPriority;
      }
      
      // Then by creation time (FIFO)
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }

  /**
   * Handle rate limiting
   */
  handleRateLimit(retryAfter: number): void {
    this.rateLimited = true;
    this.rateLimitUntil = new Date(Date.now() + retryAfter);
    
    logger.warn(`Rate limited for ${retryAfter}ms`, 'Queue');
  }

  /**
   * Check if error is rate limit
   */
  private isRateLimitError(error: unknown): boolean {
    if (error instanceof Error) {
      return error.message.includes('rate') || 
             error.message.includes('429') ||
             error.name === 'RateLimitError';
    }
    return false;
  }

  /**
   * Extract retry-after from error
   */
  private extractRetryAfter(error: unknown): number {
    // Try to extract from error message or headers
    if (error instanceof Error && 'headers' in error) {
      const headers = (error as { headers?: Record<string, string> }).headers;
      const retryAfter = headers?.['retry-after'];
      if (retryAfter) {
        return parseInt(retryAfter, 10) * 1000;
      }
    }
    
    // Default retry delay
    return this.config.rateLimitDelay;
  }

  /**
   * Get queue status
   */
  getStatus(): QueueStatus {
    const avgProcessingTime = this.stats.completed > 0
      ? this.stats.totalProcessingTime / this.stats.completed
      : 0;

    const estimatedWait = this.queue.length * avgProcessingTime / this.config.maxConcurrent;

    return {
      pending: this.queue.length,
      inProgress: this.inProgress.size,
      completed: this.stats.completed,
      failed: this.stats.failed,
      rateLimited: this.rateLimited,
      estimatedWait,
      avgProcessingTime
    };
  }

  /**
   * Cancel pending request
   */
  cancel(requestId: string): boolean {
    const index = this.queue.findIndex(r => r.id === requestId);
    if (index === -1) return false;

    const [request] = this.queue.splice(index, 1);
    request?.reject(new Error('Request cancelled'));
    return true;
  }

  /**
   * Cancel all pending requests
   */
  cancelAll(): number {
    const count = this.queue.length;
    
    for (const request of this.queue) {
      request.reject(new Error('Request cancelled'));
    }
    
    this.queue = [];
    return count;
  }

  /**
   * Get requests for agent
   */
  getRequestsForAgent(agent: AgentType): QueuedRequest[] {
    return this.queue.filter(r => r.agent === agent);
  }

  /**
   * Pause processing
   */
  pause(): void {
    this.processing = false;
  }

  /**
   * Resume processing
   */
  resume(): void {
    if (!this.processing && this.queue.length > 0) {
      this.processQueue();
    }
  }

  /**
   * Reset stats
   */
  resetStats(): void {
    this.stats = {
      completed: 0,
      failed: 0,
      totalProcessingTime: 0
    };
  }
}

export const requestQueue = new RequestQueue();
