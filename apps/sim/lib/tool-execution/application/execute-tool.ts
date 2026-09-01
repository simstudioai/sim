import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { resolveBillingAttribution, toBillingContext } from '@/lib/billing/core/billing-attribution'
import { recordUsage } from '@/lib/billing/core/usage-log'
import {
  isBlockTypeAllowed,
  loadCatalogWorkspaceContext,
  resolveCatalogGate,
} from '@/lib/catalog/application/catalog-context'
import {
  resolveVisibleToolId,
  resolveVisibleToolOwners,
} from '@/lib/catalog/application/tool-scope'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { principalUserId } from '@/lib/integrations/principal-scope.server'
import { toolExecutionOperations } from '@/lib/tool-execution/application/operations'
import { executeTool as executeRegistryTool } from '@/tools'
import { getToolMetadata } from '@/tools/metadata'

const logger = createLogger('ExecuteToolUseCase')

const DEFAULT_TIMEOUT_SECONDS = 120

export interface ExecuteToolInput {
  workspaceId: string
  toolId: string
  input: Record<string, unknown>
  credentialId?: string
  timeoutSeconds?: number
}

export interface ExecuteToolResult {
  toolId: string
  status: 'succeeded' | 'failed'
  output: Record<string, unknown> | undefined
  error: { message: string } | null
}

/**
 * Keys the caller may not set, because the execution path assigns them.
 *
 * `_context` carries the acting identity and `enforceCredentialAccess`, and the
 * `__`-prefixed fields are the reserved transient channel `stripInternalFields`
 * documents — `__usingHostedKey` among them, which decides whether a tool bills
 * its call as hosted spend. No tool in the registry declares a parameter
 * starting with `_`, so one rule covers both and cannot collide with a real
 * argument. Refused rather than silently dropped: a caller who believed it set
 * something must not be told the call succeeded as sent.
 */
function assertNoReservedArguments(args: Record<string, unknown>): void {
  const reserved = Object.keys(args).find((key) => key.startsWith('_'))
  if (reserved) {
    throw new OrchestrationError(
      'validation',
      `input.${reserved} is reserved and cannot be supplied; Sim sets it from the authenticated caller`
    )
  }
}

/**
 * Credential fields are named once, at the top level.
 *
 * The registry accepts three spellings of the same selection — `credential`,
 * `credentialId`, `oauthCredential` — which is fine inside the executor, where
 * one caller writes one of them, and wrong on a public contract, where three
 * spellings with undefined precedence is a shape no client can reason about.
 */
const CREDENTIAL_ARGUMENT_ALIASES = ['credential', 'credentialId', 'oauthCredential'] as const

function assertNoInlineCredential(args: Record<string, unknown>): void {
  const alias = CREDENTIAL_ARGUMENT_ALIASES.find((key) => key in args)
  if (alias) {
    throw new OrchestrationError(
      'validation',
      `input.${alias} is not accepted; pass the credential as the top-level credentialId field`
    )
  }
}

/**
 * Runs one code-defined tool for an authenticated caller.
 *
 * The public counterpart of what Copilot does through `call_integration_tool`,
 * and it cannot simply reuse that path's authorization. Copilot's gate is
 * applied when the tool *schemas* are built — `projectIntegrationToolsForViewer`
 * decides what the model is even told exists — so by the time a call reaches the
 * executor the id has already been vouched for. Here the caller types the id, so
 * the same two decisions have to be made against it, in this order:
 *
 * 1. Does a block this caller can see expose the tool at all? A tool behind an
 *    unrevealed preview or a kill-switched block answers `404`, never `403`,
 *    because a `403` would confirm it exists. This is the same predicate the
 *    catalog list and detail reads use, so a tool the catalog will not name
 *    cannot be run by naming it anyway.
 * 2. Does the workspace permit its integration? This one is `403` with
 *    `INTEGRATION_NOT_ALLOWED`: the built-in catalog is public, so the denial
 *    leaks nothing, and it is a decision an organization admin made and can
 *    reverse — which a `404` would hide.
 *
 * Everything after that is the executor's own: `@/tools` resolves the credential
 * under `enforceCredentialAccess`, injects a hosted API key where Sim supplies
 * one, applies the `deniedTools` denylist against the resolved id, and projects
 * secrets out of the result.
 */
export const executeToolForCaller = defineAuthorizedWorkspaceUseCase({
  operation: toolExecutionOperations.execute,
  resolveContext: ({ input }: { input: ExecuteToolInput }) =>
    loadCatalogWorkspaceContext(input.workspaceId),
  authorizationOptions: {},
  execute: async ({ principal, input, context }): Promise<ExecuteToolResult> => {
    assertNoReservedArguments(input.input)
    assertNoInlineCredential(input.input)

    const gate = await resolveCatalogGate(principal, context)

    /**
     * Resolved against an unrestricted gate so "no such tool" and "not permitted
     * here" stay separable. Reusing the caller's own gate would collapse a
     * denied integration into a 404 — the same answer an unrevealed preview
     * gets — and a member whose admin denied Slack would be told Slack does not
     * exist.
     */
    const owners = await resolveVisibleToolOwners({ ...gate, allowedIntegrations: null })
    const toolId = resolveVisibleToolId(input.toolId, owners)
    const owningBlockTypes = owners.get(toolId)
    if (!owningBlockTypes) {
      throw new OrchestrationError('not_found', 'Tool not found')
    }

    if (!owningBlockTypes.some((blockType) => isBlockTypeAllowed(blockType, gate))) {
      throw new ForbiddenOperationError(
        'INTEGRATION_NOT_ALLOWED',
        `${toolId} belongs to an integration this workspace does not permit`
      )
    }

    const metadata = getToolMetadata(toolId)
    if (metadata?.oauth?.required && !input.credentialId) {
      throw new OrchestrationError(
        'validation',
        `credentialId is required: ${toolId} authenticates with a ${metadata.oauth.provider} credential`
      )
    }

    const userId = principalUserId(principal)
    if (!userId) {
      throw new OrchestrationError('forbidden', 'Tool execution requires an acting user')
    }

    const billingAttribution = await resolveBillingAttribution({
      actorUserId: userId,
      workspaceId: context.workspaceId,
    })

    const params: Record<string, unknown> = {
      ...input.input,
      ...(input.credentialId ? { credential: input.credentialId } : {}),
      _context: {
        userId,
        workspaceId: context.workspaceId,
        enforceCredentialAccess: true,
        /**
         * Explicit `{{VAR}}` only. The bare-name form the Copilot surface also
         * accepts reads any identifier-shaped value as a variable lookup, which
         * would silently swap a caller's literal secret for a different one.
         */
        envReferenceMode: 'explicit' as const,
        billingAttribution,
      },
    }

    const result = await executeRegistryTool(toolId, params, {
      signal: AbortSignal.timeout((input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000),
      operationContext: {
        /**
         * No workflow owns this call. The empty string is what the Copilot
         * in-band route already passes for the same reason — the field is
         * required because most in-process tool operations run inside a run,
         * and a direct API call is one of the few that does not.
         */
        workflowId: '',
        userId,
        workspaceId: context.workspaceId,
        billingAttribution,
      },
    })

    await meterHostedKeySpend({
      toolId,
      userId,
      workspaceId: context.workspaceId,
      billingAttribution,
      output: result.output,
    })

    return {
      toolId,
      status: result.success ? 'succeeded' : 'failed',
      output: result.output,
      error: result.success ? null : { message: result.error ?? `${toolId} did not succeed` },
    }
  },
})

/**
 * Charges hosted-key spend this call incurred.
 *
 * `@/tools` computes the cost and hands it back on `output.cost.total`, but it
 * writes no ledger row: a workflow run bills through the execution ledger and
 * Copilot bills through Go's `_serviceCost`, and this surface is neither. Its
 * own doc comment says so — "any new caller of executeTool that is not Copilot
 * must arrange its own metering" — and this is that arrangement.
 *
 * The provider already ran and already charged Sim's key by the time this runs,
 * so a metering failure must not destroy the caller's result: it is logged for
 * reconciliation and the call still answers, the same choice
 * `applyHostedKeyCostToResult` makes one layer down.
 */
async function meterHostedKeySpend(args: {
  toolId: string
  userId: string
  workspaceId: string
  billingAttribution: Awaited<ReturnType<typeof resolveBillingAttribution>>
  output: Record<string, unknown> | undefined
}): Promise<void> {
  const cost = (args.output?.cost as { total?: unknown } | undefined)?.total
  if (typeof cost !== 'number' || !(cost > 0)) return

  const { billingEntity, billingPeriod } = toBillingContext(args.billingAttribution)
  try {
    await recordUsage({
      userId: args.userId,
      workspaceId: args.workspaceId,
      billingEntity,
      billingPeriod,
      entries: [
        {
          category: 'tool',
          source: 'api-tool',
          description: `Tool call: ${args.toolId}`,
          cost,
        },
      ],
    })
  } catch (error) {
    logger.error('Hosted-key metering failed; tool call succeeded unbilled', {
      toolId: args.toolId,
      workspaceId: args.workspaceId,
      cost,
      error: getErrorMessage(error),
    })
  }
}
