import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import { findWorkspaceCredentialLookup } from '@/lib/credentials/queries'
import { getKnowledgeBaseNames } from '@/lib/knowledge/service'
import type { ExecutionContext } from '@/executor/types'
import {
  type BoundResourceKind,
  getProviderToolBindings,
  groupDuplicateToolsByCanonicalId,
  type ToolResourceBinding,
} from '@/providers/tool-binding'
import type { ProviderToolConfig } from '@/providers/types'

const logger = createLogger('ToolBindingLabels')

/** Keeps a long credential name from crowding out the tool's own description. */
const MAX_LABEL_LENGTH = 80

/** Ceiling on how many bound fields one tool states, bounding the appended text near 250 chars. */
const MAX_LABELLED_FIELDS_PER_TOOL = 2

type BindingLabelResolver = (
  ids: readonly string[],
  workspaceId: string
) => Promise<Map<string, string>>

/**
 * Reuses `findWorkspaceCredentialLookup` per id rather than one batched `inArray`: that helper
 * already encodes the workspace scope, the legacy `account.id`-second lookup, and the
 * `managed_oauth` exclusion, none of which a fresh batch query would inherit. The id list is only
 * ever the duplicated tools within one agent block, so it stays small.
 */
const resolveCredentialLabels: BindingLabelResolver = async (ids, workspaceId) => {
  const labels = new Map<string, string>()
  const rows = await Promise.all(
    ids.map((credentialId) => findWorkspaceCredentialLookup({ workspaceId, credentialId }))
  )
  ids.forEach((id, index) => {
    const displayName = rows[index]?.displayName
    if (displayName) labels.set(id, displayName)
  })
  return labels
}

const resolveKnowledgeBaseLabels: BindingLabelResolver = (ids, workspaceId) =>
  getKnowledgeBaseNames(ids, workspaceId)

/** `workflow` is absent by design — its label is already resolved by `transformBlockTool`. */
const RESOLVERS: Partial<Record<BoundResourceKind, BindingLabelResolver>> = {
  credential: resolveCredentialLabels,
  knowledgeBase: resolveKnowledgeBaseLabels,
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g

/**
 * Flattens a workspace-authored name so it cannot forge structure inside a tool description:
 * control characters and newlines collapse to spaces, and quotes are dropped so the label cannot
 * close its own quoting.
 */
function sanitizeBindingLabel(raw: string): string | undefined {
  const flattened = raw
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/["`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return flattened ? truncate(flattened, MAX_LABEL_LENGTH, '…') : undefined
}

interface LabelledField {
  fieldTitle: string
  label: string
}

/**
 * Chooses the fields a tool should state, given every sibling's resolved labels.
 *
 * A field is stated only when EVERY member of the group resolved a distinct label for it. Partial
 * labelling would be worse than saying nothing: one labelled tool beside an unlabelled twin reads
 * as "the unlabelled one is the default", and two tools sharing a label would assert a distinction
 * that does not exist — `credential.display_name` carries no uniqueness constraint.
 */
function selectDiscriminatingFields(
  tool: ProviderToolConfig,
  group: readonly ProviderToolConfig[],
  labelFor: (binding: ToolResourceBinding) => string | undefined
): LabelledField[] {
  const fields: LabelledField[] = []

  for (const binding of getProviderToolBindings(tool) ?? []) {
    if (binding.selfDescribed) continue
    const label = labelFor(binding)
    if (!label) continue

    const siblingLabels = group.map((sibling) =>
      sibling === tool
        ? label
        : getProviderToolBindings(sibling)
            ?.filter((candidate) => candidate.kind === binding.kind)
            .map(labelFor)
            .find((value) => value !== undefined)
    )
    if (siblingLabels.some((value) => value === undefined)) continue
    if (new Set(siblingLabels).size !== siblingLabels.length) continue

    fields.push({ fieldTitle: binding.fieldTitle, label })
    if (fields.length === MAX_LABELLED_FIELDS_PER_TOOL) break
  }

  return fields
}

function buildBindingLine(fields: readonly LabelledField[], groupSize: number): string {
  const bound = fields.map((field) => `${field.fieldTitle} "${field.label}"`).join(' and ')
  const distinguishedBy = [...new Set(fields.map((field) => field.fieldTitle))].join(' or ')
  return `Bound to ${bound}. This agent has ${groupSize} copies of this tool, each bound to a different ${distinguishedBy} — call the copy the request refers to.`
}

/**
 * Tells the model which instance is which when an agent holds several copies of one tool.
 *
 * Duplicate copies are byte-identical on the wire — user-filled params are stripped from the schema
 * and only `id`, `description` and `parameters` reach a provider — so without this the model picks
 * between them arbitrarily. Runs only for duplicated tools, so a single-instance tool costs no
 * lookup and its prompt is unchanged.
 *
 * Mutates `description` on the exact objects passed in. Provenance elsewhere is keyed on tool
 * identity, so no tool is ever replaced. Never throws: an unresolvable label means no line.
 */
export async function annotateDuplicateToolBindings(
  ctx: Pick<ExecutionContext, 'workspaceId' | 'toolBindingLabelCache'>,
  tools: ProviderToolConfig[]
): Promise<void> {
  const { workspaceId } = ctx
  if (!workspaceId || tools.length < 2) return

  const groups = groupDuplicateToolsByCanonicalId(tools)
  if (groups.length === 0) return

  const cache = ctx.toolBindingLabelCache ?? new Map<string, string | null>()
  const cacheKey = (kind: BoundResourceKind, id: string) => `${kind}:${id}`

  const pendingByKind = new Map<BoundResourceKind, Set<string>>()
  for (const group of groups) {
    for (const tool of group) {
      for (const binding of getProviderToolBindings(tool) ?? []) {
        if (binding.selfDescribed || binding.preresolvedLabel) continue
        if (!RESOLVERS[binding.kind]) continue
        if (cache.has(cacheKey(binding.kind, binding.id))) continue
        const pending = pendingByKind.get(binding.kind)
        if (pending) pending.add(binding.id)
        else pendingByKind.set(binding.kind, new Set([binding.id]))
      }
    }
  }

  await Promise.all(
    [...pendingByKind].map(async ([kind, ids]) => {
      const idList = [...ids]
      const resolver = RESOLVERS[kind]
      if (!resolver) return
      try {
        const resolved = await resolver(idList, workspaceId)
        for (const id of idList) cache.set(cacheKey(kind, id), resolved.get(id) ?? null)
      } catch (error) {
        // Degrade to unlabelled rather than failing the agent block over a cosmetic lookup.
        logger.warn('Failed to resolve tool binding labels', {
          kind,
          count: idList.length,
          error: getErrorMessage(error),
        })
        for (const id of idList) cache.set(cacheKey(kind, id), null)
      }
    })
  )

  const labelFor = (binding: ToolResourceBinding): string | undefined => {
    const raw =
      binding.preresolvedLabel ?? cache.get(cacheKey(binding.kind, binding.id)) ?? undefined
    return raw ? sanitizeBindingLabel(raw) : undefined
  }

  for (const group of groups) {
    for (const tool of group) {
      const fields = selectDiscriminatingFields(tool, group, labelFor)
      if (fields.length === 0) continue
      tool.description = `${tool.description}\n\n${buildBindingLine(fields, group.length)}`
    }
  }
}
