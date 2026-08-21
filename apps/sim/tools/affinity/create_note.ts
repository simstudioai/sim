import type { AffinityCreateNoteParams, AffinityEntityResponse } from '@/tools/affinity/types'
import { NOTE_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  requireId,
  requireOneOf,
  requireParam,
  toIdReferences,
  transformEntity,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

/** The three note shapes the create endpoint accepts. */
const NOTE_TYPES = ['entities', 'interaction', 'user-reply'] as const

/** Interactions a note can be anchored to. Emails cannot carry a new note. */
const NOTE_INTERACTION_TYPES = ['meeting', 'call', 'chat-message'] as const

export const affinityCreateNoteTool: ToolConfig<
  AffinityCreateNoteParams,
  AffinityEntityResponse<Record<string, unknown>>
> = {
  id: 'affinity_create_note',
  name: 'Affinity Create Note',
  description:
    'Write a note — attached to companies, persons, and opportunities, anchored to a meeting, call, or chat message, or posted as a reply to an existing note.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Note shape: entities to attach it to records, interaction to anchor it to a meeting, call, or chat message, or user-reply to reply to a note',
    },
    html: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The note body as HTML',
    },
    companyIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Companies to attach the note to, e.g. [1, 2]. Not used on a reply',
    },
    personIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Persons to attach the note to, e.g. [1, 2]. Not used on a reply',
    },
    opportunityIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opportunities to attach the note to, e.g. [1, 2]. Not used on a reply',
    },
    interactionId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The interaction to anchor the note to. Required for an interaction note',
    },
    interactionType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Kind of the anchoring interaction: meeting, call, or chat-message. Required for an interaction note',
    },
    parentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The note being replied to. Required for a user-reply note',
    },
    creatorId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Attribute the note to another internal person. Defaults to the API key holder',
    },
    createdAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Backdate the note to this ISO 8601 timestamp',
    },
  },

  request: {
    url: () => buildAffinityUrl('/notes'),
    method: 'POST',
    headers: (params) => affinityHeaders(params.apiKey, true),
    body: (params) => {
      const type = requireOneOf(params.type, NOTE_TYPES, 'type')
      const body: Record<string, unknown> = {
        type,
        content: { html: requireParam(params.html, 'html') },
      }

      if (params.creatorId) body.creator = { id: requireId(params.creatorId, 'creatorId') }
      if (params.createdAt) body.createdAt = params.createdAt

      if (type === 'user-reply') {
        body.parent = { id: requireId(params.parentId, 'parentId') }
        return body
      }

      if (type === 'interaction') {
        body.interaction = {
          id: requireId(params.interactionId, 'interactionId'),
          type: requireOneOf(params.interactionType, NOTE_INTERACTION_TYPES, 'interactionType'),
        }
      }

      const companies = toIdReferences(params.companyIds, 'companyIds')
      const persons = toIdReferences(params.personIds, 'personIds')
      const opportunities = toIdReferences(params.opportunityIds, 'opportunityIds')
      if (companies) body.companies = companies
      if (persons) body.persons = persons
      if (opportunities) body.opportunities = opportunities

      if (type === 'entities' && !companies && !persons && !opportunities) {
        throw new Error(
          'Affinity Create Note needs at least one company, person, or opportunity for an entities note'
        )
      }

      return body
    },
  },

  transformResponse: transformEntity(),

  outputs: NOTE_OUTPUT_PROPERTIES,
}
