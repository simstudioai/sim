import { createLogger } from '@sim/logger'
import {
  type ExecuteSelectorRequest,
  selectorContextSchema,
  selectorRequestSchema,
} from '@/lib/api/contracts/selectors/execute'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { requireOrganizationMembership } from '@/lib/core/application/organization-authorization'
import { type CredentialAuditRequest, recordCredentialAccess } from '@/lib/oauth/token-resolution'
import { selectorOperations } from '@/lib/selectors/application/operations'
import {
  resolveSelectorApplicationContext,
  type SelectorApplicationContext,
  type WorkspaceSelectorApplicationContext,
} from '@/lib/selectors/application/resolve-scope'
import { isSelectorReady, type ServerSelectorKey } from '@/lib/selectors/manifest'
import { authorizeSelectorCredential } from '@/lib/selectors/server/credentials'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import {
  assertSelectorIntegrationAllowed,
  selectorIntegrationBlockTypes,
} from '@/lib/selectors/server/integration-access'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { resolveSelectorReferences } from '@/lib/selectors/server/references'
import { getServerSelectorAttachment } from '@/lib/selectors/server/registry'
import { sanitizeSelectorResult } from '@/lib/selectors/server/sanitize'
import type { ResolvedSelectorReference } from '@/lib/selectors/server/types'
import type { SelectorExecutionResult, SelectorRequest } from '@/lib/selectors/types'
import { IntegrationNotAllowedError } from '@/ee/access-control/utils/permission-check'

const logger = createLogger('ExecuteSelector')

export interface ExecuteSelectorInput extends ExecuteSelectorRequest {
  signal?: AbortSignal
  auditRequest?: CredentialAuditRequest
}

function validateAuthorizedInput(
  input: ExecuteSelectorInput,
  context: SelectorApplicationContext
): void {
  const manifest = context.selectorManifest
  if (!manifest.scopeKinds.includes(input.scope.kind)) {
    throw new SelectorContextUnavailableError()
  }

  if (input.request.kind === 'detail' && !manifest.supportsDetail) {
    throw new SelectorContextUnavailableError()
  }
  if (
    input.request.kind === 'list' &&
    ((input.request.search !== undefined && !manifest.supportsSearch) ||
      (input.request.cursor !== undefined && manifest.listMode !== 'paginated'))
  ) {
    throw new SelectorContextUnavailableError()
  }

  const allowedContext = new Set<string>(manifest.context.allowed)
  if (Object.keys(input.context).some((field) => !allowedContext.has(field))) {
    throw new SelectorContextUnavailableError()
  }
  if (!isSelectorReady(input.selectorKey, input.context)) {
    throw new SelectorContextUnavailableError()
  }
}

function restoreReferencedDetailValues(input: {
  originalRequest: SelectorRequest
  resolvedRequest: SelectorRequest
  result: SelectorExecutionResult
  references: ReadonlyMap<string, ResolvedSelectorReference>
}): SelectorExecutionResult {
  if (
    input.originalRequest.kind !== 'detail' ||
    input.resolvedRequest.kind !== 'detail' ||
    input.result.kind !== 'detail' ||
    !input.result.item ||
    !input.references.has('request.id')
  ) {
    return input.result
  }

  const item = input.result.item
  const resolvedId = input.resolvedRequest.id
  const originalId = input.originalRequest.id
  const meta = item.meta
    ? Object.fromEntries(
        Object.entries(item.meta).map(([key, value]) => [
          key,
          value === resolvedId ? originalId : value,
        ])
      )
    : undefined

  return {
    kind: 'detail',
    item: {
      ...item,
      id: originalId,
      label: item.label === resolvedId ? originalId : item.label,
      ...(meta ? { meta } : {}),
    },
  }
}

function getReferencedDetailResolvedId(input: {
  originalRequest: SelectorRequest
  resolvedRequest: SelectorRequest
  references: ReadonlyMap<string, ResolvedSelectorReference>
}): string | undefined {
  if (
    input.originalRequest.kind !== 'detail' ||
    input.resolvedRequest.kind !== 'detail' ||
    !input.references.has('request.id')
  ) {
    return undefined
  }
  return input.resolvedRequest.id
}

async function executeAuthorizedSelector(args: {
  principal: { kind: 'session'; userId: string; sessionId: string }
  input: ExecuteSelectorInput
  context: SelectorApplicationContext
}): Promise<SelectorExecutionResult> {
  const startedAt = Date.now()
  const protectedValues = createSelectorProtectedValues()

  try {
    const attachment = getServerSelectorAttachment(args.input.selectorKey as ServerSelectorKey)
    const organizationId =
      args.input.scope.kind === 'organization' ? args.input.scope.organizationId : undefined
    const resolved = await resolveSelectorReferences({
      selectorKey: args.input.selectorKey as ServerSelectorKey,
      context: args.input.context,
      request: args.input.request,
      requesterUserId: args.principal.userId,
      workspaceId: args.context.workspaceId,
      protectedValues,
    })
    const parsedContext = selectorContextSchema.safeParse(resolved.context)
    const parsedRequest = selectorRequestSchema.safeParse(resolved.request)
    if (!parsedContext.success || !parsedRequest.success) {
      throw new SelectorContextUnavailableError()
    }
    const resolvedContext = parsedContext.data
    const resolvedRequest = parsedRequest.data

    if (!isSelectorReady(args.input.selectorKey, resolvedContext)) {
      throw new SelectorContextUnavailableError()
    }

    const credential = attachment.credential
      ? {
          ...(await authorizeSelectorCredential({
            principal: args.principal,
            context: resolvedContext,
            scope: args.input.scope,
            workspaceId: args.context.workspaceId,
            organizationId,
            policy: attachment.credential,
            protectedValues,
            references: resolved.references,
          })),
          signal: args.input.signal,
        }
      : undefined

    /**
     * Enforces the permission group's `allowedIntegrations` decision, which the
     * funnel cannot apply because it never sees which integration a selector
     * reaches. Not a `permission-group-enforced:` annotation because that names
     * a capability, and this key's enforcement mechanism is `executor`, not
     * `capability`.
     *
     * Judged against the selector's own resource — the API it calls — not the
     * set of credentials it accepts, and not the bound credential's provider.
     * A selector the OAuth catalog cannot identify (raw-context credentials, an
     * API-key integration) declares its block types instead of resolving to
     * none and passing untested. Placed before the provider call so a denied
     * integration is never reached.
     */
    await assertSelectorIntegrationAllowed({
      principal: args.principal,
      workspaceId: args.context.workspaceId,
      organizationId,
      blockTypes: selectorIntegrationBlockTypes(attachment),
    })

    const credentialAccess = credential?.access
    let credentialUseRecorded = false
    const recordCredentialUse =
      attachment.auditCredentialUse && credentialAccess?.resolvedCredentialId
        ? (providerId: string) => {
            if (credentialUseRecorded) return
            credentialUseRecorded = true
            recordCredentialAccess({
              actorId: args.principal.userId,
              workspaceId: args.context.workspaceId ?? null,
              resourceId: credentialAccess.resolvedCredentialId!,
              providerId: credential?.providerId ?? providerId,
              credentialType:
                credentialAccess.credentialType === 'service_account' ? 'service_account' : 'oauth',
              auditRequest: args.input.auditRequest,
            })
          }
        : undefined

    const selectorArgs = {
      selectorKey: args.input.selectorKey as ServerSelectorKey,
      context: resolvedContext,
      request: resolvedRequest,
      scope: args.input.scope,
      workspaceId: args.context.workspaceId,
      organizationId,
      principal: args.principal,
      requesterUserId: args.principal.userId,
      credential,
      references: resolved.references,
      signal: args.input.signal,
      protectedValues,
      ...(recordCredentialUse ? { recordCredentialUse } : {}),
    }
    const preparedDestination =
      attachment.destination === 'fixed'
        ? undefined
        : await attachment.destination.prepare(selectorArgs)
    const providerResult = await attachment.execute(selectorArgs, preparedDestination)
    args.input.signal?.throwIfAborted()
    if (providerResult.diagnostics?.truncated) {
      logger.warn('Selector provider result reached a configured cap', {
        selectorKey: args.input.selectorKey,
        requestKind: args.input.request.kind,
        scopeKind: args.input.scope.kind,
        workspaceId: args.context.workspaceId,
        reason: providerResult.diagnostics.truncated.reason,
        limit: providerResult.diagnostics.truncated.limit,
        pages: providerResult.diagnostics.truncated.pages,
      })
    }
    const referencedDetailResolvedId = getReferencedDetailResolvedId({
      originalRequest: args.input.request,
      resolvedRequest,
      references: resolved.references,
    })
    const sanitizedProviderResult = sanitizeSelectorResult(
      providerResult,
      protectedValues,
      referencedDetailResolvedId
        ? { allowedDetailExactProtectedValue: referencedDetailResolvedId }
        : undefined
    )
    const result = restoreReferencedDetailValues({
      originalRequest: args.input.request,
      resolvedRequest,
      result: sanitizedProviderResult,
      references: resolved.references,
    })

    logger.info('Executed selector', {
      selectorKey: args.input.selectorKey,
      requestKind: args.input.request.kind,
      scopeKind: args.input.scope.kind,
      workspaceId: args.context.workspaceId,
      workflowId: args.input.scope.kind === 'workflow' ? args.input.scope.workflowId : undefined,
      durationMs: Date.now() - startedAt,
      itemCount: result.kind === 'list' ? result.items.length : result.item ? 1 : 0,
    })
    return result
  } catch (error) {
    if (args.input.signal?.aborted) throw error
    if (
      error instanceof SelectorContextUnavailableError ||
      error instanceof SelectorConnectionUnavailableError ||
      error instanceof SelectorOptionsUnavailableError ||
      // A refusal, not a provider failure: it reaches the caller as its own 403
      // rather than being folded into "Options unavailable".
      error instanceof IntegrationNotAllowedError
    ) {
      throw error
    }
    logger.warn('Selector provider execution failed', {
      selectorKey: args.input.selectorKey,
      requestKind: args.input.request.kind,
      scopeKind: args.input.scope.kind,
      workspaceId: args.context.workspaceId,
      durationMs: Date.now() - startedAt,
    })
    throw new SelectorOptionsUnavailableError()
  }
}

const executeWorkspaceSelector = defineAuthorizedWorkspaceUseCase<
  typeof selectorOperations.execute,
  ExecuteSelectorInput,
  WorkspaceSelectorApplicationContext,
  SelectorExecutionResult
>({
  operation: selectorOperations.execute,
  resolveContext: async ({
    input,
  }: {
    input: ExecuteSelectorInput
  }): Promise<WorkspaceSelectorApplicationContext> => {
    const context = await resolveSelectorApplicationContext({
      selectorKey: input.selectorKey as ServerSelectorKey,
      scope: input.scope,
    })
    if (context.workspaceId === undefined) throw new SelectorContextUnavailableError()
    return context
  },
  authorizationOptions: {},
  authorizeResource: ({ input, context }) => validateAuthorizedInput(input, context),
  execute: executeAuthorizedSelector,
})

/** Organization pickers use the admin's scoped connection without a workspace context. */
export const executeSelector: OperationUseCase<
  typeof selectorOperations.execute,
  ExecuteSelectorInput,
  SelectorExecutionResult
> = {
  operation: selectorOperations.execute,
  async execute(args) {
    if (args.input.scope.kind !== 'organization') return executeWorkspaceSelector.execute(args)
    if (args.principal.kind !== 'session') throw new SelectorContextUnavailableError()
    await requireOrganizationMembership(
      args.principal,
      args.input.scope.organizationId,
      'admin',
      'knowledge.use'
    )
    const context = await resolveSelectorApplicationContext({
      selectorKey: args.input.selectorKey as ServerSelectorKey,
      scope: args.input.scope,
    })
    validateAuthorizedInput(args.input, context)
    return executeAuthorizedSelector({ principal: args.principal, input: args.input, context })
  },
}
