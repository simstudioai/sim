import { requestJson } from '@/lib/api/client/request'
import {
  type NetSuiteObjectsSelectorBody,
  type NetSuiteSelectorKind,
  netsuiteObjectsSelectorContract,
} from '@/lib/api/contracts/selectors/netsuite'
import { ensureCredential, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type {
  SelectorDefinition,
  SelectorKey,
  SelectorOption,
  SelectorQueryArgs,
} from '@/hooks/selectors/types'

type NetSuiteSelectorKey = Extract<SelectorKey, `netsuite.${string}`>

interface NetSuiteSelectorSpec {
  kind: NetSuiteSelectorKind
  requiresJob: boolean
}

const NETSUITE_SELECTOR_SPECS: Record<NetSuiteSelectorKey, NetSuiteSelectorSpec> = {
  'netsuite.recordTypes': { kind: 'record_types', requiresJob: false },
  'netsuite.asyncTasks': { kind: 'async_tasks', requiresJob: true },
}

function scopeSatisfied(spec: NetSuiteSelectorSpec, args: SelectorQueryArgs): boolean {
  return Boolean(
    args.context.oauthCredential &&
      args.context.workflowId &&
      (!spec.requiresJob || args.context.jobId)
  )
}

function toOption(object: { id: string; label: string; detail: string | null }): SelectorOption {
  return {
    id: object.id,
    label: object.label,
    ...(object.detail ? { meta: { detail: object.detail } } : {}),
  }
}

function buildSelector(key: NetSuiteSelectorKey): SelectorDefinition {
  const spec = NETSUITE_SELECTOR_SPECS[key]

  const fetchObjects = async ({ context, signal }: SelectorQueryArgs) => {
    const credential = ensureCredential(context, key)
    if (!context.workflowId) throw new Error(`Missing workflow ID for selector ${key}`)

    let body: NetSuiteObjectsSelectorBody
    if (spec.kind === 'async_tasks') {
      if (!context.jobId) throw new Error(`Missing job ID for selector ${key}`)
      body = {
        credential,
        workflowId: context.workflowId,
        kind: spec.kind,
        jobId: context.jobId,
      }
    } else {
      body = { credential, workflowId: context.workflowId, kind: spec.kind }
    }

    return requestJson(netsuiteObjectsSelectorContract, { body, signal })
  }

  return {
    key,
    contracts: [netsuiteObjectsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      key,
      context.workflowId ?? 'none',
      context.oauthCredential ?? 'none',
      ...(spec.requiresJob ? [context.jobId ?? 'none'] : []),
    ],
    enabled: (args) => scopeSatisfied(spec, args),
    fetchList: async (args) => (await fetchObjects(args)).objects.map(toOption),
    fetchById: async (args) => {
      if (!args.detailId || !scopeSatisfied(spec, args)) return null
      const match = (await fetchObjects(args)).objects.find((object) => object.id === args.detailId)
      return match ? toOption(match) : null
    },
    resolvesUnknownIds: true,
  }
}

export const netsuiteSelectors = {
  'netsuite.recordTypes': buildSelector('netsuite.recordTypes'),
  'netsuite.asyncTasks': buildSelector('netsuite.asyncTasks'),
} satisfies Record<NetSuiteSelectorKey, SelectorDefinition>
