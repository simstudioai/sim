import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
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
import { isHosted } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { principalUserId } from '@/lib/integrations/principal-scope.server'
import { toolExecutionOperations } from '@/lib/tool-execution/application/operations'
import { executeTool as executeRegistryTool } from '@/tools'
import type { ExecutableToolConfig } from '@/tools/types'
import { getTool } from '@/tools/utils'

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
 * The parameter Sim's hosted key would fill for this call, or `undefined`.
 *
 * Mirrors `injectHostedKeyIfNeeded`'s tests, in its order, so the two cannot
 * disagree about whether a value is coming: the tool declares `hosting`, the
 * deployment hosts keys, any `enabled` predicate accepts these params, and the
 * caller has not brought a key of their own — which wins where present.
 *
 * Read twice, for the two questions that both turn on it. A required parameter
 * Sim fills is not missing, and spend is only Sim's to bill when Sim's key paid
 * for it.
 */
function hostedKeyParamFor(
  tool: ExecutableToolConfig,
  params: Record<string, unknown>
): string | undefined {
  if (!isHosted || !tool.hosting) return undefined
  if (tool.hosting.enabled && !tool.hosting.enabled(params)) return undefined
  const supplied = params[tool.hosting.apiKeyParam]
  if (typeof supplied === 'string' && supplied.trim().length > 0) return undefined
  return tool.hosting.apiKeyParam
}

/**
 * Refuses an input key the tool does not declare.
 *
 * Strict rather than a denylist, because the denylist was already wrong twice
 * over. `_context` carries the acting identity and `enforceCredentialAccess`;
 * the `__`-prefixed fields are the reserved transient channel, `__usingHostedKey`
 * among them, which decides whether a call bills as hosted spend; and
 * `impersonateUserEmail` is read straight out of params by the executor and
 * forwarded to credential-token resolution as an impersonation request. Naming
 * those three is guesswork about a surface that keeps growing — a declared
 * parameter list is the actual boundary, and it is what
 * `GET /api/v2/tools/{toolId}` already publishes.
 *
 * Together with the `hidden` refusal above, the accept-set is exactly the
 * publish-set: a key is taken if and only if `GET /api/v2/tools/{toolId}`
 * lists it as something the caller may send.
 *
 * Also collapses the credential spellings. The executor accepts `credential`,
 * `credentialId` and `oauthCredential` interchangeably, which is fine where one
 * caller writes one of them and wrong on a public contract: three spellings with
 * undefined precedence is a shape no client can reason about. The credential is
 * named once, at the top level.
 */
function assertNoUndeclaredInputs(
  tool: ExecutableToolConfig,
  toolId: string,
  args: Record<string, unknown>
): void {
  const params = tool.params ?? {}

  /**
   * Declared is not the same as accepted. A `hidden` parameter is Sim's to fill
   * — a resolved credential's `accessToken`, a hosted key, a block-composed
   * shape — and `createUserToolSchema` omits it from what this endpoint and
   * Copilot publish. Accepting it anyway either lets a caller pre-empt the
   * executor's value or silently discards theirs when the executor overwrites
   * it, and both are a contract the published schema does not make.
   */
  const hidden = Object.keys(args).filter((key) => params[key]?.visibility === 'hidden')
  if (hidden.length > 0) {
    throw new OrchestrationError(
      'validation',
      `${hidden.map((key) => `input.${key}`).join(', ')} ${hidden.length === 1 ? 'is' : 'are'} supplied by Sim, not by the caller`
    )
  }

  const undeclared = Object.keys(args).filter((key) => !Object.hasOwn(params, key))
  if (undeclared.length === 0) return

  const credentialAlias = undeclared.find((key) =>
    ['credential', 'credentialId', 'oauthCredential'].includes(key)
  )
  if (credentialAlias) {
    throw new OrchestrationError(
      'validation',
      `input.${credentialAlias} is not accepted; pass the credential as the top-level credentialId field`
    )
  }

  throw new OrchestrationError(
    'validation',
    `${toolId} does not accept ${undeclared.map((key) => `input.${key}`).join(', ')}`
  )
}

/**
 * Refuses a call missing a required parameter the caller was supposed to send.
 *
 * `visibility` is an editor-role concept: it says whether a value comes from a
 * human filling a block field (`user-only`), the agent block's model choosing an
 * argument (`llm-only`), either (`user-or-llm`), or neither (`hidden`). A direct
 * call has no editor and no agent block, so those roles collapse — the caller is
 * the only source there is. `createUserToolSchema`, which is what both this
 * endpoint and Copilot's `call_integration_tool` publish, already says as much
 * by omitting `hidden` and nothing else.
 *
 * So the rule here is not about roles: **Sim supplies it, or the caller must.**
 * `hidden` is skipped because Sim fills it from a resolved credential or a
 * hosted key — and `check-tool-param-reachability` is what makes that safe to
 * assume, since it fails any required `hidden` parameter without a declared
 * filler.
 *
 * Nothing else had checked these. `validateRequiredParametersAfterMerge` covers
 * `user-or-llm` alone, because on the workflow path the rest were validated
 * during serialization against the block fields holding them, and this path has
 * no serialization step. Omitting `zendesk_get_ticket`'s `subdomain` reached
 * Zendesk as `undefined` and came back a provider authentication failure — the
 * same undiagnosable shape this branch set out to remove.
 */
function assertRequiredCallerInputsPresent(
  tool: ExecutableToolConfig,
  toolId: string,
  params: Record<string, unknown>
): void {
  const hostedKeyParam = hostedKeyParamFor(tool, params)

  const missing = Object.entries(tool.params ?? {})
    .filter(([name, declaration]) => {
      if (!declaration?.required) return false
      if (declaration.visibility === 'hidden') return false
      if (name === hostedKeyParam) return false
      const value = params[name]
      return value === undefined || value === null || value === ''
    })
    .map(([name]) => name)

  if (missing.length > 0) {
    throw new OrchestrationError(
      'validation',
      `${toolId} requires ${missing.map((name) => `input.${name}`).join(', ')}`
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

    const tool = getTool(toolId)
    if (!tool) throw new OrchestrationError('not_found', 'Tool not found')
    if (tool.oauth?.required && !input.credentialId) {
      throw new OrchestrationError(
        'validation',
        `credentialId is required: ${toolId} authenticates with a ${tool.oauth.provider} credential`
      )
    }
    assertNoUndeclaredInputs(tool, toolId, input.input)
    assertRequiredCallerInputsPresent(tool, toolId, input.input)

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

    /**
     * The ledger de-duplicates on `eventKey`, and the derived key is a hash of
     * actor, workspace, source and description — identical for every call to the
     * same tool. Without a per-call id `onConflictDoNothing` silently billed the
     * first hosted-key call and nothing after it. A workflow run has an
     * `executionId` to distinguish its rows; a direct call has nothing, so it
     * mints one.
     */
    const callId = generateId()

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

    /**
     * Only a successful call that spent Sim's key. `output.cost` is not a
     * hosted-key marker: `knowledge_upload_chunk` and the enrichment runner
     * report their own cost there, and billing those as `api-tool` spend would
     * charge a second time for something already metered elsewhere. The registry
     * writes hosted-key cost under the same two conditions
     * (`hostedKeyInfo.isUsingHostedKey && finalResult.success`).
     */
    if (result.success && hostedKeyParamFor(tool, params)) {
      await meterHostedKeySpend({
        callId,
        toolId,
        userId,
        workspaceId: context.workspaceId,
        billingAttribution,
        output: result.output,
      })
    }

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
  callId: string
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
          eventKey: args.callId,
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
