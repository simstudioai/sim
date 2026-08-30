import { createLogger } from '@sim/logger'
import type { ExecuteSelectorRequest } from '@/lib/api/contracts/selectors/execute'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { type CredentialAuditRequest, recordCredentialAccess } from '@/lib/oauth/token-resolution'
import { selectorOperations } from '@/lib/selectors/application/operations'
import {
  resolveSelectorApplicationContext,
  type SelectorApplicationContext,
} from '@/lib/selectors/application/resolve-scope'
import { isSelectorReady, type ServerSelectorKey } from '@/lib/selectors/manifest'
import { authorizeSelectorCredential } from '@/lib/selectors/server/credentials'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { resolveSelectorReferences } from '@/lib/selectors/server/references'
import { getServerSelectorAttachment } from '@/lib/selectors/server/registry'
import { sanitizeSelectorResult } from '@/lib/selectors/server/sanitize'
import type { ResolvedSelectorReference } from '@/lib/selectors/server/types'
import type { SelectorExecutionResult, SelectorRequest } from '@/lib/selectors/types'

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
    const resolved = await resolveSelectorReferences({
      selectorKey: args.input.selectorKey as ServerSelectorKey,
      context: args.input.context,
      request: args.input.request,
      requesterUserId: args.principal.userId,
      workspaceId: args.context.workspaceId,
      protectedValues,
    })
    if (!isSelectorReady(args.input.selectorKey, resolved.context)) {
      throw new SelectorContextUnavailableError()
    }

    const credential = attachment.credential
      ? await authorizeSelectorCredential({
          principal: args.principal,
          context: resolved.context,
          scope: args.input.scope,
          workspaceId: args.context.workspaceId,
          policy: attachment.credential,
          protectedValues,
          references: resolved.references,
        })
      : undefined

    const credentialAccess = credential?.access
    let credentialUseRecorded = false
    const recordCredentialUse =
      attachment.auditCredentialUse && credentialAccess?.resolvedCredentialId
        ? (providerId: string) => {
            if (credentialUseRecorded) return
            credentialUseRecorded = true
            recordCredentialAccess({
              actorId: args.principal.userId,
              workspaceId: args.context.workspaceId,
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
      context: resolved.context,
      request: resolved.request,
      scope: args.input.scope,
      workspaceId: args.context.workspaceId,
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
      resolvedRequest: resolved.request,
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
      resolvedRequest: resolved.request,
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
      error instanceof SelectorOptionsUnavailableError
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

export const executeSelector = defineAuthorizedWorkspaceUseCase({
  operation: selectorOperations.execute,
  resolveContext: ({ input }) =>
    resolveSelectorApplicationContext({
      selectorKey: input.selectorKey as ServerSelectorKey,
      scope: input.scope,
    }),
  authorizationOptions: {},
  authorizeResource: ({ input, context }) => validateAuthorizedInput(input, context),
  execute: executeAuthorizedSelector,
})
