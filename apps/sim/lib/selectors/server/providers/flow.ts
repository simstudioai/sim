import { truncate } from '@sim/utils/string'
import { z } from 'zod'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { flowHeaders, normalizeFlowOrigin, normalizeFlowWorkspaceId } from '@/lib/flow'
import { MAX_SELECTOR_OPTIONS } from '@/lib/selectors/limits'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'
import { flatSelectorResult } from '@/lib/selectors/server/providers/flat-results'
import { selectorProviderStatusError } from '@/lib/selectors/server/providers/http'
import {
  definePreparedSelectorAttachment,
  type ExecuteServerSelectorArgs,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'
import { safeUrlPathSegment } from '@/tools/url-path'

type FlowSelectorKey = Extract<ServerSelectorKey, `flow.${string}`>

interface FlowDestination {
  domain: string
  accessToken: string
  providerWorkspaceId: string
}

const namedItemSchema = z.object({
  id: z.string().min(1).max(512),
  name: z.string(),
})
const namedItemsSchema = z.array(namedItemSchema).max(MAX_SELECTOR_OPTIONS)
const PROJECT_LIMIT = 100

async function prepareFlowDestination(args: ExecuteServerSelectorArgs): Promise<FlowDestination> {
  const bundle = await resolveSelectorCredentialBundle({
    credential: args.credential,
    protectedValues: args.protectedValues,
  })
  if (!bundle.domain || !bundle.providerWorkspaceId) throw new SelectorConnectionUnavailableError()
  try {
    return {
      domain: normalizeFlowOrigin(bundle.domain),
      providerWorkspaceId: normalizeFlowWorkspaceId(bundle.providerWorkspaceId),
      accessToken: bundle.accessToken,
    }
  } catch {
    throw new SelectorConnectionUnavailableError()
  }
}

async function executeFlow(args: ExecuteServerSelectorArgs, destination: FlowDestination) {
  let path: string
  let projectId: string | undefined
  if (args.selectorKey === 'flow.projects') {
    path = `/project?limit=${PROJECT_LIMIT}`
  } else {
    if (!args.context.projectId) throw new SelectorContextUnavailableError()
    try {
      projectId = safeUrlPathSegment(args.context.projectId, 'projectId')
    } catch {
      throw new SelectorContextUnavailableError()
    }
    path = `/project/${projectId}/${args.selectorKey === 'flow.categories' ? 'data-model' : 'branch'}`
  }

  try {
    const response = await secureFetchWithValidation(`${destination.domain}${path}`, {
      profile: 'configuredEndpoint',
      method: 'GET',
      headers: flowHeaders(destination),
      timeout: 15_000,
      maxResponseBytes: 4 * 1024 * 1024,
      maxRedirects: 0,
      signal: args.signal,
      logUrlValidationDetails: false,
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw selectorProviderStatusError(response.status)
    }
    const parsed = namedItemsSchema.safeParse(await response.json())
    if (!parsed.success) throw new SelectorOptionsUnavailableError()
    const items: SafeSelectorOption[] = parsed.data.map((item) => ({
      id: item.id,
      label: truncate(item.name || item.id, 200),
    }))
    const truncated = args.selectorKey === 'flow.projects' && items.length >= PROJECT_LIMIT
    return flatSelectorResult(
      args.request,
      items,
      true,
      truncated ? { truncated: { reason: 'provider-cap', limit: PROJECT_LIMIT } } : undefined
    )
  } catch (error) {
    if (args.signal?.aborted) throw error
    if (error instanceof SelectorConnectionUnavailableError) throw error
    if (error instanceof SelectorOptionsUnavailableError) throw error
    throw new SelectorOptionsUnavailableError()
  }
}

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['flow'],
} as const

export const flowSelectorAttachments = {
  'flow.projects': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes: ['flow'],
    destination: { kind: 'credential-bound', prepare: prepareFlowDestination },
    execute: executeFlow,
  }),
  'flow.categories': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes: ['flow'],
    destination: { kind: 'credential-bound', prepare: prepareFlowDestination },
    execute: executeFlow,
  }),
  'flow.branches': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes: ['flow'],
    destination: { kind: 'credential-bound', prepare: prepareFlowDestination },
    execute: executeFlow,
  }),
} satisfies ServerSelectorAttachmentMap<FlowSelectorKey>
