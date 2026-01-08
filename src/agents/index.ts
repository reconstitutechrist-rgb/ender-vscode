/**
 * Agents index for Ender
 * Exports all 14 specialized agents
 */

// Base agent
export { BaseAgent } from './base-agent';

// Core agents
export { ConductorAgent, conductorAgent } from './conductor';
export { PlannerAgent, plannerAgent } from './planner';
export { CoderAgent, coderAgent } from './coder';
export { ReviewerAgent, reviewerAgent } from './reviewer';
export { DocumenterAgent, documenterAgent } from './documenter';
export { ResearcherAgent, researcherAgent } from './researcher';
export { TesterAgent, testerAgent } from './tester';
export { DebuggerAgent, debuggerAgent } from './debugger';
export { GitManagerAgent, gitManagerAgent } from './git-manager';
export { MemoryKeeperAgent, memoryKeeperAgent } from './memory-keeper';

// Specialist agents
export { HooksAgent, hooksAgent } from './hooks-agent';
export { IntegrationsAgent, integrationsAgent } from './integrations-agent';
export { InfrastructureAgent, infrastructureAgent } from './infrastructure-agent';

// Sanity checker
export { SanityCheckerAgent, sanityCheckerAgent } from './sanity-checker';

import type { AgentType } from '../types';

// Agent registry for dynamic access
import { conductorAgent } from './conductor';
import { plannerAgent } from './planner';
import { coderAgent } from './coder';
import { reviewerAgent } from './reviewer';
import { documenterAgent } from './documenter';
import { researcherAgent } from './researcher';
import { testerAgent } from './tester';
import { debuggerAgent } from './debugger';
import { gitManagerAgent } from './git-manager';
import { memoryKeeperAgent } from './memory-keeper';
import { hooksAgent } from './hooks-agent';
import { integrationsAgent } from './integrations-agent';
import { infrastructureAgent } from './infrastructure-agent';
import { sanityCheckerAgent } from './sanity-checker';
import { BaseAgent } from './base-agent';

export const agentRegistry: Record<AgentType, BaseAgent> = {
  'conductor': conductorAgent,
  'planner': plannerAgent,
  'coder': coderAgent,
  'reviewer': reviewerAgent,
  'documenter': documenterAgent,
  'researcher': researcherAgent,
  'tester': testerAgent,
  'debugger': debuggerAgent,
  'git-manager': gitManagerAgent,
  'memory-keeper': memoryKeeperAgent,
  'hooks-agent': hooksAgent,
  'integrations-agent': integrationsAgent,
  'infrastructure-agent': infrastructureAgent,
  'sanity-checker': sanityCheckerAgent
};

/**
 * Get agent by type
 */
export function getAgent(type: AgentType): BaseAgent {
  const agent = agentRegistry[type];
  if (!agent) {
    throw new Error(`Unknown agent type: ${type}`);
  }
  return agent;
}

/**
 * Get all agent types
 */
export function getAllAgentTypes(): AgentType[] {
  return Object.keys(agentRegistry) as AgentType[];
}

/**
 * Initialize all agents
 */
export function initializeAgents(workspacePath?: string): void {
  // Set workspace for git manager
  if (workspacePath) {
    gitManagerAgent.setWorkspace(workspacePath);
  }
}
