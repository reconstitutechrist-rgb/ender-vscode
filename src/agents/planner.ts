/**
 * Planner Agent for Ender
 * Creates structured implementation plans with phases
 */

import { BaseAgent, AgentExecuteParams } from './base-agent';
import { AnthropicClient } from '../api/anthropic-client';
import { apiClient } from '../api';
import { generateId } from '../utils';
import type {
  AgentConfig,
  AgentResult,
  Plan,
  PlanPhase,
  PlanTask,
  PlanMetadata,
  TaskType
} from '../types';

const PLANNER_SYSTEM_PROMPT = `You are the Planner agent for Ender, an AI coding assistant. Your role is to:

1. **Break Down Tasks**: Decompose complex requests into manageable phases
2. **Create Implementation Plans**: Detailed, step-by-step plans that other agents can follow
3. **Estimate Complexity**: Assess effort, token usage, and potential risks
4. **Identify Dependencies**: Determine what needs to happen in what order
5. **Define Scope**: Clearly specify which files will be affected

## Plan Structure
Each plan should have:
- Clear title and description
- Multiple phases (2-5 typically)
- Each phase has specific tasks
- Explicit file list per phase
- Estimated complexity and tokens

## Response Format
Respond with a JSON plan:
\`\`\`json
{
  "title": "Plan title",
  "description": "What this plan accomplishes",
  "estimatedComplexity": "low|medium|high",
  "estimatedTokens": 5000,
  "phases": [
    {
      "title": "Phase 1: Setup",
      "description": "What this phase does",
      "tasks": [
        {
          "description": "Create user model",
          "type": "single_file_small_change",
          "targetFile": "src/models/user.ts",
          "expectedChanges": "New file with User interface and validation"
        }
      ],
      "affectedFiles": ["src/models/user.ts"],
      "estimatedTokens": 1000
    }
  ],
  "metadata": {
    "originalRequest": "The user's original request",
    "assumptions": ["Assumption 1", "Assumption 2"],
    "risks": ["Potential risk 1"],
    "dependencies": ["External dependency 1"],
    "testingStrategy": "How to test this",
    "rollbackPlan": "How to undo if needed"
  }
}
\`\`\`

## Guidelines
- Keep phases focused and testable independently
- Be explicit about what files will be created/modified/deleted
- Include all assumptions that need user verification
- Provide clear rollback instructions
- Consider edge cases and error handling in the plan`;

export class PlannerAgent extends BaseAgent {
  constructor(apiClient: AnthropicClient) {
    const config: AgentConfig = {
      type: 'planner',
      model: 'claude-opus-4-5-20251101',
      systemPrompt: PLANNER_SYSTEM_PROMPT,
      capabilities: [
        'task_breakdown',
        'implementation_planning',
        'complexity_estimation',
        'dependency_identification',
        'scope_definition'
      ],
      maxTokens: 8192
    };
    super(config, apiClient);
  }

  /**
   * Execute planning
   */
  async execute(params: AgentExecuteParams): Promise<AgentResult> {
    const startTime = Date.now();
    this.log('Starting planning', { task: params.task.slice(0, 100) });

    try {
      const systemPrompt = this.buildSystemPrompt(params.context);
      const messages = this.buildMessages(params.task, params.context);

      const response = await this.callApi({
        model: this.defaultModel,
        system: systemPrompt,
        messages,
        maxTokens: this.maxTokens,
        metadata: {
          agent: this.type,
          taskId: generateId(),
          planId: params.planId
        }
      });

      // Parse the plan
      const plan = this.parsePlan(response.content, params.task);

      if (!plan) {
        return this.createSuccessResult(response.content, {
          confidence: 60,
          tokensUsed: response.usage,
          startTime,
          explanation: 'Could not parse structured plan, returning raw response',
          warnings: ['Plan could not be parsed into structured format']
        });
      }

      this.log('Plan created', { 
        planId: plan.id, 
        phases: plan.phases.length,
        files: plan.affectedFiles.length 
      });

      return this.createSuccessResult(JSON.stringify(plan, null, 2), {
        confidence: this.calculatePlanConfidence(plan),
        tokensUsed: response.usage,
        startTime,
        explanation: `Created plan with ${plan.phases.length} phases affecting ${plan.affectedFiles.length} files`,
        nextAgent: 'coder'
      });

    } catch (error) {
      this.log('Error in planner', { error });
      return this.createErrorResult(
        error instanceof Error ? error : new Error(String(error)),
        startTime
      );
    }
  }

  /**
   * Parse plan from response
   */
  private parsePlan(content: string, originalRequest: string): Plan | null {
    // Extract JSON from response
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
    
    if (!jsonMatch?.[1]) {
      return null;
    }

    try {
      const parsed = JSON.parse(jsonMatch[1]);
      const planId = generateId();

      // Build phases
      const phases: PlanPhase[] = (parsed.phases || []).map((phase: Record<string, unknown>, index: number) => {
        const phaseId = generateId();
        
        const tasks: PlanTask[] = ((phase.tasks as Record<string, unknown>[]) || []).map((task: Record<string, unknown>) => ({
          id: generateId(),
          phaseId,
          description: task.description as string || '',
          type: (task.type as TaskType) || 'single_file_small_change',
          status: 'pending' as const,
          targetFile: task.targetFile as string,
          targetFunction: task.targetFunction as string,
          expectedChanges: task.expectedChanges as string
        }));

        return {
          id: phaseId,
          planId,
          index,
          title: phase.title as string || `Phase ${index + 1}`,
          description: phase.description as string || '',
          status: 'pending' as const,
          tasks,
          affectedFiles: (phase.affectedFiles as string[]) || [],
          estimatedTokens: (phase.estimatedTokens as number) || 1000,
          actualTokensUsed: 0
        };
      });

      // Collect all affected files
      const allAffectedFiles = new Set<string>();
      for (const phase of phases) {
        for (const file of phase.affectedFiles) {
          allAffectedFiles.add(file);
        }
      }

      // Build metadata
      const metadata: PlanMetadata = {
        originalRequest,
        assumptions: parsed.metadata?.assumptions || [],
        risks: parsed.metadata?.risks || [],
        dependencies: parsed.metadata?.dependencies || [],
        testingStrategy: parsed.metadata?.testingStrategy,
        rollbackPlan: parsed.metadata?.rollbackPlan
      };

      const plan: Plan = {
        id: planId,
        title: parsed.title || 'Implementation Plan',
        description: parsed.description || '',
        status: 'draft',
        phases,
        currentPhaseIndex: 0,
        estimatedComplexity: parsed.estimatedComplexity || 'medium',
        estimatedTokens: parsed.estimatedTokens || phases.reduce((sum, p) => sum + p.estimatedTokens, 0),
        actualTokensUsed: 0,
        affectedFiles: [...allAffectedFiles],
        createdAt: new Date(),
        metadata
      };

      return plan;

    } catch (error) {
      this.log('Failed to parse plan JSON', { error });
      return null;
    }
  }

  /**
   * Calculate confidence in the plan
   */
  private calculatePlanConfidence(plan: Plan): number {
    let confidence = 85;

    // More phases = slightly lower confidence
    if (plan.phases.length > 5) {
      confidence -= 10;
    } else if (plan.phases.length > 3) {
      confidence -= 5;
    }

    // Many assumptions = lower confidence
    if (plan.metadata.assumptions.length > 5) {
      confidence -= 15;
    } else if (plan.metadata.assumptions.length > 2) {
      confidence -= 5;
    }

    // High complexity = lower confidence
    if (plan.estimatedComplexity === 'high') {
      confidence -= 10;
    }

    // Risks present = lower confidence
    if (plan.metadata.risks.length > 0) {
      confidence -= plan.metadata.risks.length * 3;
    }

    // No rollback plan = lower confidence
    if (!plan.metadata.rollbackPlan) {
      confidence -= 5;
    }

    return Math.max(50, Math.min(95, confidence));
  }

  /**
   * Validate a plan before execution
   */
  validatePlan(plan: Plan): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    // Check for required fields
    if (!plan.title) {
      issues.push('Plan missing title');
    }
    if (plan.phases.length === 0) {
      issues.push('Plan has no phases');
    }
    if (plan.affectedFiles.length === 0) {
      issues.push('Plan has no affected files listed');
    }

    // Check each phase
    for (let i = 0; i < plan.phases.length; i++) {
      const phase = plan.phases[i];
      if (!phase) continue;
      
      if (!phase.title) {
        issues.push(`Phase ${i + 1} missing title`);
      }
      if (phase.tasks.length === 0) {
        issues.push(`Phase ${i + 1} has no tasks`);
      }
      if (phase.affectedFiles.length === 0) {
        issues.push(`Phase ${i + 1} has no affected files`);
      }
    }

    // Check for circular dependencies (simplified)
    const phaseFiles = plan.phases.map(p => new Set(p.affectedFiles));
    for (let i = 0; i < phaseFiles.length - 1; i++) {
      for (let j = i + 1; j < phaseFiles.length; j++) {
        const overlap = [...(phaseFiles[i] || [])].filter(f => phaseFiles[j]?.has(f));
        if (overlap.length > 0) {
          // This is actually okay - later phases can modify files from earlier phases
          // But we should note it
          this.log('Overlapping files between phases', { phases: [i + 1, j + 1], files: overlap });
        }
      }
    }

    return {
      valid: issues.length === 0,
      issues
    };
  }

  /**
   * Update plan after phase completion
   */
  advancePlan(plan: Plan, tokensUsed: number): Plan {
    const updatedPlan = { ...plan };
    
    // Update current phase
    const currentPhase = updatedPlan.phases[updatedPlan.currentPhaseIndex];
    if (currentPhase) {
      currentPhase.status = 'completed';
      currentPhase.completedAt = new Date();
      currentPhase.actualTokensUsed = tokensUsed;
    }

    // Move to next phase
    if (updatedPlan.currentPhaseIndex < updatedPlan.phases.length - 1) {
      updatedPlan.currentPhaseIndex++;
      updatedPlan.status = 'in_progress';
    } else {
      updatedPlan.status = 'completed';
      updatedPlan.completedAt = new Date();
    }

    // Update total tokens
    updatedPlan.actualTokensUsed += tokensUsed;

    return updatedPlan;
  }
}

export const plannerAgent = new PlannerAgent(apiClient);
