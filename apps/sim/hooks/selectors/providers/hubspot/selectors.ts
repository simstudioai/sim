import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { ensureCredential, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type {
  SelectorContext,
  SelectorDefinition,
  SelectorKey,
  SelectorQueryArgs,
} from '@/hooks/selectors/types'

/**
 * HubSpot's default CRM object. A picker renders before the user has touched the object-type
 * dropdown, and the dropdown itself already displays `contact` — so resolving to nothing there
 * would render every dependent picker empty against a control that visibly shows a selection.
 */
const DEFAULT_OBJECT_TYPE = 'contact'

/**
 * The object type a picker is scoped to.
 *
 * `custom` is an indirection rather than a type: the real id lives in a sibling field, and
 * until that is filled in there is no object to query. Returning `null` for that case keeps
 * the dependent pickers empty instead of querying HubSpot for an object called "custom".
 */
function resolveObjectType(context: SelectorContext): string | null {
  const selected = context.objectType ?? DEFAULT_OBJECT_TYPE
  if (selected !== 'custom') return selected
  const customId = context.customObjectTypeId?.trim()
  return customId ? customId : null
}

export const hubspotSelectors = {
  'hubspot.properties': {
    key: 'hubspot.properties',
    contracts: [selectorContracts.hubspotPropertiesSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'hubspot.properties',
      context.oauthCredential ?? 'none',
      resolveObjectType(context) ?? 'none',
    ],
    enabled: ({ context }) =>
      Boolean(context.oauthCredential) && resolveObjectType(context) !== null,
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'hubspot.properties')
      const objectType = resolveObjectType(context)
      if (!objectType) return []
      const data = await requestJson(selectorContracts.hubspotPropertiesSelectorContract, {
        query: { credentialId, objectType },
        signal,
      })
      return data.properties.map((property) => ({ id: property.id, label: property.name }))
    },
  },
  'hubspot.lists': {
    key: 'hubspot.lists',
    contracts: [selectorContracts.hubspotListsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'hubspot.lists',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'hubspot.lists')
      const data = await requestJson(selectorContracts.hubspotListsSelectorContract, {
        query: { credentialId },
        signal,
      })
      return data.lists.map((list) => ({ id: list.id, label: list.name }))
    },
  },
  'hubspot.pipelines': {
    key: 'hubspot.pipelines',
    contracts: [selectorContracts.hubspotPipelinesSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'hubspot.pipelines',
      context.oauthCredential ?? 'none',
      resolveObjectType(context) ?? 'none',
    ],
    enabled: ({ context }) =>
      Boolean(context.oauthCredential) && resolveObjectType(context) !== null,
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'hubspot.pipelines')
      const objectType = resolveObjectType(context)
      if (!objectType) return []
      const data = await requestJson(selectorContracts.hubspotPipelinesSelectorContract, {
        query: { credentialId, objectType },
        signal,
      })
      return data.pipelines.map((pipeline) => ({ id: pipeline.id, label: pipeline.name }))
    },
  },
  /**
   * Stages live INSIDE the pipelines payload rather than behind an endpoint of their own, so
   * this reads the same contract and narrows to the selected pipeline. Sharing HubSpot's one
   * response is also why both selectors stay in step — a stage list can never describe a
   * pipeline the sibling picker is not showing.
   */
  'hubspot.pipelineStages': {
    key: 'hubspot.pipelineStages',
    contracts: [selectorContracts.hubspotPipelinesSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'hubspot.pipelineStages',
      context.oauthCredential ?? 'none',
      resolveObjectType(context) ?? 'none',
      context.pipelineId ?? 'none',
    ],
    enabled: ({ context }) =>
      Boolean(context.oauthCredential && context.pipelineId) && resolveObjectType(context) !== null,
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'hubspot.pipelineStages')
      const objectType = resolveObjectType(context)
      if (!objectType || !context.pipelineId) return []
      const data = await requestJson(selectorContracts.hubspotPipelinesSelectorContract, {
        query: { credentialId, objectType },
        signal,
      })
      const pipeline = data.pipelines.find((entry) => entry.id === context.pipelineId)
      return (pipeline?.stages ?? []).map((stage) => ({ id: stage.id, label: stage.label }))
    },
  },
  'hubspot.owners': {
    key: 'hubspot.owners',
    contracts: [selectorContracts.hubspotOwnersSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'hubspot.owners',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'hubspot.owners')
      const data = await requestJson(selectorContracts.hubspotOwnersSelectorContract, {
        query: { credentialId },
        signal,
      })
      return data.owners.map((owner) => ({ id: owner.id, label: owner.name }))
    },
  },
} satisfies Partial<Record<SelectorKey, SelectorDefinition>>
