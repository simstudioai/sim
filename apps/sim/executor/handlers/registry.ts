/**
 * Handler Registry
 *
 * Central registry for all block handlers.
 * Creates handlers for real user blocks (not infrastructure like sentinels).
 */

import { AgentBlockHandler } from '@/executor/handlers/agent/agent-handler'
import { ApiBlockHandler } from '@/executor/handlers/api/api-handler'
import { ConditionBlockHandler } from '@/executor/handlers/condition/condition-handler'
import { EvaluatorBlockHandler } from '@/executor/handlers/evaluator/evaluator-handler'
import { FunctionBlockHandler } from '@/executor/handlers/function/function-handler'
import { GenericBlockHandler } from '@/executor/handlers/generic/generic-handler'
import { HumanInTheLoopBlockHandler } from '@/executor/handlers/human-in-the-loop/human-in-the-loop-handler'
import { ResponseBlockHandler } from '@/executor/handlers/response/response-handler'
import { RouterBlockHandler } from '@/executor/handlers/router/router-handler'
import { TriggerBlockHandler } from '@/executor/handlers/trigger/trigger-handler'
import { VariablesBlockHandler } from '@/executor/handlers/variables/variables-handler'
import { WaitBlockHandler } from '@/executor/handlers/wait/wait-handler'
import { WorkflowBlockHandler } from '@/executor/handlers/workflow/workflow-handler'
import type { BlockHandler } from '@/executor/types'

/**
 * Create all block handlers
 *
 * Note: Sentinels are NOT included here - they're infrastructure handled
 * by NodeExecutionOrchestrator, not user blocks.
 */
export function createBlockHandlers(): BlockHandler[] {
  return [
    new TriggerBlockHandler(),
    new FunctionBlockHandler(),
    new ApiBlockHandler(),
    new ConditionBlockHandler(),
    new RouterBlockHandler(),
    new ResponseBlockHandler(),
    new HumanInTheLoopBlockHandler(),
    new AgentBlockHandler(),
    new VariablesBlockHandler(),
    new WorkflowBlockHandler(),
    new WaitBlockHandler(),
    new EvaluatorBlockHandler(),
    new GenericBlockHandler(),
  ]
}
