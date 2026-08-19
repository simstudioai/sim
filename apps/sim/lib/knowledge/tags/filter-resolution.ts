import { KNOWLEDGE_TAG_FILTER_OPERATORS_BY_FIELD_TYPE } from '@/lib/api/contracts/v1/knowledge'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { SUPPORTED_FIELD_TYPES } from '@/lib/knowledge/constants'
import type { TagFilterCondition } from '@/lib/knowledge/documents/tag-filter'
import { getDocumentTagDefinitions } from '@/lib/knowledge/tags/service'
import type { DocumentTagDefinition } from '@/lib/knowledge/tags/types'
import { buildUndefinedTagsError, validateTagValue } from '@/lib/knowledge/tags/utils'
import type { StructuredFilter } from '@/lib/knowledge/types'

interface KnowledgeTagFilterBase {
  fieldType?: 'text' | 'number' | 'date' | 'boolean'
  operator: string
  value: string | number | boolean
  valueTo?: string | number
}

/**
 * A tag filter addressed by the tag's display name rather than by its storage
 * slot. Display names are the vocabulary every public read speaks: search
 * filters name tags, and search results and document reads key their tag values
 * by name. The slot is an implementation detail of the `document` row that only
 * the write surface (`tag1`..`tag7`) still exposes.
 */
export interface KnowledgeTagNameFilter extends KnowledgeTagFilterBase {
  tagName: string
  tagId?: never
}

/** Boundary shape; runtime validation below enforces its name-or-ID invariant. */
export interface KnowledgeTagFilter extends KnowledgeTagFilterBase {
  tagName?: string
  tagId?: string
}

/**
 * Rejects an operator the resolved field type does not implement, and a
 * `between` with no upper bound.
 *
 * Both filter builders end their operator switch with a `default:` arm — the
 * document list drops the predicate and returns the whole knowledge base, while
 * search falls through to equality — so an unchecked operator answered a
 * different question depending on which endpoint the caller reached. The field
 * type is only known here, after the tag name resolves to its definition.
 */
function validateTagOperator(filter: KnowledgeTagNameFilter, fieldType: string): string | null {
  const supported =
    KNOWLEDGE_TAG_FILTER_OPERATORS_BY_FIELD_TYPE[
      fieldType as keyof typeof KNOWLEDGE_TAG_FILTER_OPERATORS_BY_FIELD_TYPE
    ]
  if (!supported) return null
  if (!(supported as readonly string[]).includes(filter.operator)) {
    return `Tag "${filter.tagName}" is a ${fieldType} tag and does not support operator "${filter.operator}". Supported operators: ${supported.join(', ')}`
  }
  if (filter.operator === 'between' && filter.valueTo === undefined) {
    return `Tag "${filter.tagName}" requires valueTo when using the "between" operator`
  }
  return null
}

export interface ResolvedKnowledgeTagFilters {
  structuredFilters: StructuredFilter[]
  definitionsByKnowledgeBase: Map<string, DocumentTagDefinition[]>
}

/**
 * Resolves display-named or ID-addressed tag filters to their storage slots.
 *
 * A tag name must map to the same slot and field type in every selected
 * knowledge base; a name missing from one of several, or mapped inconsistently
 * across them, is a validation failure telling the caller to search those
 * knowledge bases separately. With one knowledge base a name that resolves to no
 * definition is reported as an undefined tag rather than dropped, so a filter is
 * never silently ignored. The operator is held to the same guarantee: one the
 * resolved field type does not implement is rejected here rather than dropped
 * downstream by the document list or coerced to equality by search. Tag IDs
 * resolve only within one selected knowledge base, which also proves that the
 * referenced definition belongs to that base.
 *
 * The loaded definitions are returned alongside the filters so a caller that
 * also needs the slot-to-name map (to project tag values back out) does not read
 * them a second time.
 */
export async function resolveKnowledgeTagFilters(
  filters: KnowledgeTagFilter[],
  knowledgeBaseIds: string[]
): Promise<ResolvedKnowledgeTagFilters> {
  const filtersWithIdentifiers = filters.map((filter) => {
    const rawTagName: unknown = filter.tagName
    const rawTagId: unknown = filter.tagId
    const tagName = typeof rawTagName === 'string' ? rawTagName.trim() : undefined
    const tagId = typeof rawTagId === 'string' ? rawTagId.trim() : undefined
    const hasInvalidTagName = rawTagName !== undefined && !tagName
    const hasInvalidTagId = rawTagId !== undefined && !tagId
    if (hasInvalidTagName || hasInvalidTagId || Boolean(tagName) === Boolean(tagId)) {
      throw new OrchestrationError(
        'validation',
        'Each tag filter must include exactly one of tagName or tagId'
      )
    }
    return { filter, tagName, tagId }
  })

  const hasTagIdFilters = filtersWithIdentifiers.some(({ tagId }) => Boolean(tagId))
  if (hasTagIdFilters && knowledgeBaseIds.length > 1) {
    throw new OrchestrationError(
      'validation',
      'Tag ID filters can only search one knowledge base at a time. Search those knowledge bases separately.'
    )
  }

  const definitionEntries = await Promise.all(
    knowledgeBaseIds.map(
      async (knowledgeBaseId) =>
        [knowledgeBaseId, await getDocumentTagDefinitions(knowledgeBaseId)] as const
    )
  )
  const definitionsByKnowledgeBase = new Map(definitionEntries)
  const invalidTagIds: string[] = []
  const singleKnowledgeBaseDefinitions = definitionEntries[0]?.[1] ?? []
  const normalizedFilters = filtersWithIdentifiers.flatMap<KnowledgeTagNameFilter>(
    ({ filter, tagName, tagId }) => {
      if (!tagId) {
        return [
          {
            tagName: tagName!,
            operator: filter.operator,
            value: filter.value,
            valueTo: filter.valueTo,
          },
        ]
      }

      const definition = singleKnowledgeBaseDefinitions.find((candidate) => candidate.id === tagId)
      if (!definition) {
        invalidTagIds.push(tagId)
        return []
      }

      return [
        {
          tagName: definition.displayName,
          operator: filter.operator,
          value: filter.value,
          valueTo: filter.valueTo,
        },
      ]
    }
  )

  if (invalidTagIds.length > 0) {
    throw new OrchestrationError(
      'validation',
      `Tag IDs not found in the selected knowledge base: ${invalidTagIds.join(', ')}`
    )
  }

  const sharedDefinitions = new Map<string, { tagSlot: string; fieldType: string }>()
  for (const [, definitions] of definitionEntries) {
    const currentByName = new Map(
      definitions.map((definition) => [
        definition.displayName,
        { tagSlot: definition.tagSlot, fieldType: definition.fieldType },
      ])
    )
    for (const filter of normalizedFilters) {
      const current = currentByName.get(filter.tagName)
      if (!current) {
        if (knowledgeBaseIds.length > 1) {
          throw new OrchestrationError(
            'validation',
            `Tag "${filter.tagName}" does not exist in all selected knowledge bases. Search those knowledge bases separately.`
          )
        }
        continue
      }
      const existing = sharedDefinitions.get(filter.tagName)
      if (
        existing &&
        (existing.tagSlot !== current.tagSlot || existing.fieldType !== current.fieldType)
      ) {
        throw new OrchestrationError(
          'validation',
          `Tag "${filter.tagName}" is not mapped consistently across the selected knowledge bases. Search those knowledge bases separately.`
        )
      }
      sharedDefinitions.set(filter.tagName, current)
    }
  }
  const undefinedTags: string[] = []
  const typeErrors: string[] = []
  for (const filter of normalizedFilters) {
    const definition = sharedDefinitions.get(filter.tagName)
    if (!definition) {
      undefinedTags.push(filter.tagName)
      continue
    }
    const validationError = validateTagValue(
      filter.tagName,
      String(filter.value),
      definition.fieldType
    )
    if (validationError) typeErrors.push(validationError)
    const operatorError = validateTagOperator(filter, definition.fieldType)
    if (operatorError) typeErrors.push(operatorError)
    if (filter.operator === 'between' && filter.valueTo !== undefined) {
      const valueToError = validateTagValue(
        filter.tagName,
        String(filter.valueTo),
        definition.fieldType
      )
      if (valueToError) {
        typeErrors.push(`The "between" upper bound is invalid. ${valueToError}`)
      }
    }
  }
  if (undefinedTags.length > 0 || typeErrors.length > 0) {
    throw new OrchestrationError(
      'validation',
      [
        ...(undefinedTags.length > 0 ? [buildUndefinedTagsError(undefinedTags)] : []),
        ...typeErrors,
      ].join('\n')
    )
  }
  return {
    structuredFilters: normalizedFilters.map((filter) => {
      const definition = sharedDefinitions.get(filter.tagName)
      if (!definition) throw new Error('Validated knowledge tag definition disappeared')
      return {
        tagSlot: definition.tagSlot,
        fieldType: definition.fieldType,
        operator: filter.operator,
        value: filter.value,
        valueTo: filter.valueTo,
      }
    }),
    definitionsByKnowledgeBase,
  }
}

/**
 * Narrows resolved filters onto the document-list filter shape. The field type
 * is stored as free text, so a definition carrying an unsupported one is a
 * validation failure rather than a silently dropped predicate.
 */
export function toKnowledgeTagFilterConditions(
  structuredFilters: StructuredFilter[]
): TagFilterCondition[] {
  return structuredFilters.map((filter) => {
    if (!(SUPPORTED_FIELD_TYPES as readonly string[]).includes(filter.fieldType)) {
      throw new OrchestrationError(
        'validation',
        `Tag slot "${filter.tagSlot}" is defined with unsupported field type "${filter.fieldType}"`
      )
    }
    return {
      tagSlot: filter.tagSlot,
      fieldType: filter.fieldType as TagFilterCondition['fieldType'],
      operator: filter.operator,
      value: filter.value,
      valueTo: filter.valueTo,
    }
  })
}
