/**
 * Handler Registry
 *
 * Central registry for all block handlers.
 * Creates handlers for real user blocks (not infrastructure like sentinels).
 */

import { AgentBlockHandler } from '@/executor/handlers/agent/handler'
import { ApiBlockHandler } from '@/executor/handlers/api/handler'
import { ConditionBlockHandler } from '@/executor/handlers/condition/handler'
import { CredentialBlockHandler } from '@/executor/handlers/credential/handler'
import { CredentialGroupBlockHandler } from '@/executor/handlers/credential-group/handler'
import { EvaluatorBlockHandler } from '@/executor/handlers/evaluator/handler'
import { FunctionBlockHandler } from '@/executor/handlers/function/handler'
import { GenericBlockHandler } from '@/executor/handlers/generic/handler'
import { HumanInTheLoopBlockHandler } from '@/executor/handlers/human-in-the-loop/handler'
import { MothershipBlockHandler } from '@/executor/handlers/mothership/handler'
import { PiBlockHandler } from '@/executor/handlers/pi/handler'
import { ResponseBlockHandler } from '@/executor/handlers/response/handler'
import { RouterBlockHandler } from '@/executor/handlers/router/handler'
import { TriggerBlockHandler } from '@/executor/handlers/trigger/handler'
import { VariablesBlockHandler } from '@/executor/handlers/variables/handler'
import { WaitBlockHandler } from '@/executor/handlers/wait/handler'
import { WorkflowBlockHandler } from '@/executor/handlers/workflow/handler'
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
    new MothershipBlockHandler(),
    new PiBlockHandler(),
    new VariablesBlockHandler(),
    new WorkflowBlockHandler(),
    new WaitBlockHandler(),
    new EvaluatorBlockHandler(),
    new CredentialGroupBlockHandler(),
    new CredentialBlockHandler(),
    new GenericBlockHandler(),
  ]
}
