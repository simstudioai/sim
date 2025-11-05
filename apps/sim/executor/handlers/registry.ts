/**
 * Handler Registry
 *
 * Central registry for all block handlers.
 * Creates handlers for real user blocks (not infrastructure like sentinels).
 */

import type { BlockHandler } from '@/executor/types'
import { AgentBlockHandler } from './agent/agent-handler'
import { ApiBlockHandler } from './api/api-handler'
import { ConditionBlockHandler } from './condition/condition-handler'
import { EvaluatorBlockHandler } from './evaluator/evaluator-handler'
import { FunctionBlockHandler } from './function/function-handler'
import { GenericBlockHandler } from './generic/generic-handler'
import { ResponseBlockHandler } from './response/response-handler'
import { PauseResumeBlockHandler } from './pause-resume/pause-resume-handler'
import { RouterBlockHandler } from './router/router-handler'
import { TriggerBlockHandler } from './trigger/trigger-handler'
import { VariablesBlockHandler } from './variables/variables-handler'
import { WaitBlockHandler } from './wait/wait-handler'
import { WorkflowBlockHandler } from './workflow/workflow-handler'

/**
 * Create all block handlers
 *
 * Note: Sentinels are NOT included here - they're infrastructure handled
 * by NodeExecutionOrchestrator, not user blocks.
 */
export function createBlockHandlers(): BlockHandler[] {
  return [
    // Core block handlers
    new TriggerBlockHandler(),
    new FunctionBlockHandler(),
    new ApiBlockHandler(),
    new ConditionBlockHandler(),
    new RouterBlockHandler(),
    new ResponseBlockHandler(),
    new PauseResumeBlockHandler(),
    new AgentBlockHandler(),
    new VariablesBlockHandler(),
    new WorkflowBlockHandler(),
    new WaitBlockHandler(),
    new EvaluatorBlockHandler(),

    // Generic handler must be last (fallback)
    new GenericBlockHandler(),
  ]
}
