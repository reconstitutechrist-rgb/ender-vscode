/**
 * Conductor Agent for Ender
 * Central orchestrating agent that coordinates all other agents
 */

import { BaseAgent, AgentExecuteParams } from './base-agent';
import { AnthropicClient } from '../api/anthropic-client';
import { apiClient } from '../api';
import { logger } from '../utils';
import type {
  AgentConfig,
  AgentResult,
  AgentType,
  TaskType,
  ConductorDecision,
  ContextBundle
} from '../types';

const CONDUCTOR_SYSTEM_PROMPT = `You are the Conductor agent for Ender, an AI coding assistant. Your role is to:

1. **Interpret Requests**: Understand what the user wants to accomplish
2. **Route to Agents**: Decide which specialized agent(s) should handle the task
3. **Enforce Scope**: Ensure work stays within approved boundaries
4. **Aggregate Responses**: Combine outputs from multiple agents coherently
5. **Manage Plans**: Lock and enforce approved implementation plans
6. **Assess Confidence**: Determine confidence levels for automated vs manual approval

## Available Agents
- **Planner**: Break down complex tasks into phases, create implementation plans
- **Coder**: Write code, modify files, implement plan phases
- **Reviewer**: Run validators, quality gate, approve/reject changes
- **Documenter**: Plain English explanations, code comments, documentation
- **Researcher**: Fetch external documentation (Context7), answer "how do I" questions
- **Tester**: Generate tests, run test suites, report coverage
- **Debugger**: Analyze errors, trace issues, suggest fixes
- **Git Manager**: Handle commits, branches, merges, conflict resolution
- **Memory Keeper**: Update memory, extract learnings, summarization
- **Hooks Agent**: Framework hooks, lifecycle, event systems, middleware
- **Integrations Agent**: Third-party APIs, webhooks, authentication flows
- **Infrastructure Agent**: Environment configs, Docker/K8s, cloud services
- **Sanity Checker**: Verify no hallucinations, check instruction compliance

## Routing Guidelines
- Simple questions → Researcher or respond directly
- Code changes → Planner first (if complex) → Coder → Reviewer → Sanity Checker
- Bug fixes → Debugger → Coder → Reviewer → Sanity Checker
- Documentation → Documenter
- Testing → Tester
- External APIs → Integrations Agent → Coder
- React/Vue hooks → Hooks Agent → Coder
- Infrastructure → Infrastructure Agent

## Response Format
Respond with a JSON object containing your routing decision:
\`\`\`json
{
  "selectedAgents": ["agent1", "agent2"],
  "routingReason": "Brief explanation of why these agents",
  "estimatedComplexity": "low|medium|high",
  "requiresApproval": true|false,
  "directResponse": "Only if you can answer directly without agents",
  "clarificationNeeded": "Question to ask if unclear"
}
\`\`\``;

export class ConductorAgent extends BaseAgent {
  constructor(apiClient: AnthropicClient) {
    const config: AgentConfig = {
      type: 'conductor',
      model: 'claude-opus-4-5-20251101',
      systemPrompt: CONDUCTOR_SYSTEM_PROMPT,
      capabilities: [
        'request_interpretation',
        'agent_routing',
        'scope_enforcement',
        'response_aggregation',
        'plan_lock_management',
        'confidence_assessment'
      ],
      maxTokens: 4096
    };
    super(config, apiClient);
  }

  /**
   * Execute conductor routing
   */
  async execute(params: AgentExecuteParams): Promise<AgentResult> {
    const startTime = Date.now();
    this.log('Starting request analysis', { task: params.task.slice(0, 100) });

    try {
      // Build context-aware system prompt
      const systemPrompt = this.buildSystemPrompt(params.context);

      // Build messages
      const messages = this.buildMessages(params.task, params.context);

      // Make API call
      const response = await this.callApi({
        model: this.defaultModel,
        system: systemPrompt,
        messages,
        maxTokens: this.maxTokens,
        metadata: {
          agent: this.type,
          taskId: params.planId || 'direct',
          planId: params.planId
        }
      });

      // Parse the routing decision
      const decision = this.parseRoutingDecision(response.content);

      this.log('Routing decision made', decision);

      // If direct response is available
      if (decision.directResponse) {
        return this.createSuccessResult(decision.directResponse, {
          confidence: 90,
          tokensUsed: response.usage,
          startTime,
          explanation: decision.routingReason
        });
      }

      // If clarification is needed
      if (decision.clarificationNeeded) {
        return this.createSuccessResult(decision.clarificationNeeded, {
          confidence: 50,
          tokensUsed: response.usage,
          startTime,
          explanation: 'Clarification needed before proceeding'
        });
      }

      // Return routing decision for orchestrator to act on
      return this.createSuccessResult(JSON.stringify(decision), {
        confidence: this.calculateConfidence(decision),
        tokensUsed: response.usage,
        startTime,
        explanation: decision.routingReason,
        nextAgent: decision.selectedAgents[0] as AgentType
      });

    } catch (error) {
      this.log('Error in conductor', { error });
      return this.createErrorResult(
        error instanceof Error ? error : new Error(String(error)),
        startTime
      );
    }
  }

  /**
   * Parse routing decision from response
   */
  private parseRoutingDecision(content: string): ConductorDecision & {
    directResponse?: string;
    clarificationNeeded?: string;
  } {
    // Try to extract JSON from response
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
    
    if (jsonMatch?.[1]) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        return {
          selectedAgents: parsed.selectedAgents || [],
          routingReason: parsed.routingReason || 'No reason provided',
          estimatedComplexity: parsed.estimatedComplexity || 'medium',
          requiresApproval: parsed.requiresApproval ?? true,
          directResponse: parsed.directResponse,
          clarificationNeeded: parsed.clarificationNeeded
        };
      } catch {
        // JSON parsing failed
      }
    }

    // Fallback: try to infer from text
    return this.inferRoutingFromText(content);
  }

  /**
   * Infer routing decision from text response
   */
  private inferRoutingFromText(content: string): ConductorDecision & {
    directResponse?: string;
    clarificationNeeded?: string;
  } {
    const lowerContent = content.toLowerCase();
    const selectedAgents: AgentType[] = [];

    // Detect agent mentions
    const agentKeywords: Record<AgentType, string[]> = {
      'planner': ['plan', 'break down', 'phases', 'implementation plan'],
      'coder': ['code', 'implement', 'write', 'modify', 'create file'],
      'reviewer': ['review', 'validate', 'check', 'approve'],
      'documenter': ['document', 'explain', 'comment'],
      'researcher': ['research', 'look up', 'find documentation', 'how to'],
      'tester': ['test', 'testing', 'coverage', 'unit test'],
      'debugger': ['debug', 'error', 'bug', 'fix issue', 'trace'],
      'git-manager': ['commit', 'branch', 'merge', 'git'],
      'memory-keeper': ['remember', 'memory', 'learn', 'save'],
      'hooks-agent': ['hook', 'useEffect', 'lifecycle', 'middleware'],
      'integrations-agent': ['api', 'integration', 'webhook', 'oauth'],
      'infrastructure-agent': ['docker', 'deploy', 'environment', 'kubernetes'],
      'sanity-checker': ['verify', 'sanity', 'check assumption'],
      'conductor': [] // Never route to self
    };

    for (const [agent, keywords] of Object.entries(agentKeywords)) {
      if (keywords.some(kw => lowerContent.includes(kw))) {
        selectedAgents.push(agent as AgentType);
      }
    }

    // Default to coder if nothing detected and it looks like a code request
    if (selectedAgents.length === 0) {
      if (lowerContent.includes('code') || lowerContent.includes('implement')) {
        selectedAgents.push('coder');
      } else {
        // Direct response if no agents needed
        return {
          selectedAgents: [],
          routingReason: 'Direct response - no agent routing needed',
          estimatedComplexity: 'low',
          requiresApproval: false,
          directResponse: content
        };
      }
    }

    // Determine complexity
    let complexity: 'low' | 'medium' | 'high' = 'medium';
    if (selectedAgents.length > 3) complexity = 'high';
    if (selectedAgents.length === 1 && !selectedAgents.includes('planner')) complexity = 'low';

    return {
      selectedAgents,
      routingReason: `Inferred routing based on content analysis`,
      estimatedComplexity: complexity,
      requiresApproval: complexity !== 'low' || selectedAgents.includes('coder')
    };
  }

  /**
   * Calculate confidence based on routing decision
   */
  private calculateConfidence(decision: ConductorDecision): number {
    let confidence = 80;

    // Lower confidence for complex tasks
    if (decision.estimatedComplexity === 'high') {
      confidence -= 15;
    } else if (decision.estimatedComplexity === 'medium') {
      confidence -= 5;
    }

    // Lower confidence for many agents
    if (decision.selectedAgents.length > 3) {
      confidence -= 10;
    }

    // Higher confidence if approval not required
    if (!decision.requiresApproval) {
      confidence += 10;
    }

    return Math.max(50, Math.min(95, confidence));
  }

  /**
   * Determine task type from request
   */
  determineTaskType(request: string, context: ContextBundle): TaskType {
    const lowerRequest = request.toLowerCase();

    // Check for specific patterns
    if (lowerRequest.includes('refactor') && context.relevantFiles && context.relevantFiles.length > 3) {
      return 'complex_refactoring';
    }
    if (lowerRequest.includes('architecture') || lowerRequest.includes('design')) {
      return 'architecture_decision';
    }
    if (lowerRequest.includes('security') || lowerRequest.includes('vulnerability')) {
      return 'security_scanning';
    }
    if (lowerRequest.includes('debug') || lowerRequest.includes('fix') || lowerRequest.includes('error')) {
      return 'debugging';
    }
    if (lowerRequest.includes('test')) {
      return 'test_generation';
    }
    if (lowerRequest.includes('document') || lowerRequest.includes('explain')) {
      return 'documentation_generation';
    }
    if (lowerRequest.match(/what|how|why|when|where/i) && request.length < 200) {
      return 'simple_question';
    }
    if (lowerRequest.includes('hook') || lowerRequest.includes('useEffect')) {
      return 'hook_validation';
    }
    if (lowerRequest.includes('api') || lowerRequest.includes('integration')) {
      return 'integration_check';
    }
    if (lowerRequest.includes('docker') || lowerRequest.includes('deploy')) {
      return 'infrastructure_config';
    }

    // Default based on file count
    if (context.relevantFiles && context.relevantFiles.length > 2) {
      return 'multi_file_changes';
    }

    return 'single_file_small_change';
  }

  /**
   * Validate that plan is being followed
   */
  validatePlanScope(
    proposedFiles: string[],
    context: ContextBundle
  ): { valid: boolean; violations: string[] } {
    if (!context.currentPlan) {
      return { valid: true, violations: [] };
    }

    const violations: string[] = [];
    const allowedFiles = new Set(context.currentPlan.affectedFiles);

    for (const file of proposedFiles) {
      if (!allowedFiles.has(file)) {
        violations.push(`File "${file}" is not in the approved plan scope`);
      }
    }

    return {
      valid: violations.length === 0,
      violations
    };
  }
}

export const conductorAgent = new ConductorAgent(apiClient);
