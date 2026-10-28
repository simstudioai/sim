import type { ToolResponse } from '@/tools/types'

/**
 * Every entity in Crunchbase carries an identifier object rather than a bare id.
 * Shared by `identifier`, `categories`, `investor_identifiers`, and friends.
 */
export interface CrunchbaseEntityIdentifier {
  uuid: string
  entity_def_id: string
  value?: string
  permalink?: string
  image_id?: string
}

/**
 * Entity properties are shaped by the requested `field_ids`, so the payload is
 * a dynamic bag rather than a fixed record.
 */
export type CrunchbaseProperties = Record<string, unknown>

/** One row of a search result: the entity uuid plus its requested properties. */
export interface CrunchbaseSearchEntity {
  uuid?: string
  properties?: CrunchbaseProperties
}

/** One autocomplete suggestion. */
export interface CrunchbaseAutocompleteEntity {
  identifier: CrunchbaseEntityIdentifier
  facet_ids?: string[]
  short_description?: string
}

/** A single `query` filter. Crunchbase combines predicates with AND only. */
export interface CrunchbasePredicate {
  type: 'predicate'
  field_id: string
  operator_id: string
  values?: Array<string | number | boolean>
}

/** A single `order` clause. */
export interface CrunchbaseOrder {
  field_id: string
  sort: 'asc' | 'desc'
  nulls?: 'first' | 'last'
}

interface CrunchbaseBaseParams {
  apiKey: string
}

export interface CrunchbaseSearchParams extends CrunchbaseBaseParams {
  query?: CrunchbasePredicate[] | string
  fieldIds?: string[] | string
  order?: CrunchbaseOrder[] | string
  limit?: number | string
  afterId?: string
  beforeId?: string
}

export interface CrunchbaseEntityParams extends CrunchbaseBaseParams {
  entityId: string
  fieldIds?: string[] | string
  cardIds?: string[] | string
}

export interface CrunchbaseAutocompleteParams extends CrunchbaseBaseParams {
  query: string
  collectionIds?: string[] | string
  limit?: number | string
}

export interface CrunchbaseSearchResponse extends ToolResponse {
  output: {
    count: number | null
    entities: CrunchbaseSearchEntity[]
    nextAfterId: string | null
  }
}

export interface CrunchbaseEntityResponse extends ToolResponse {
  output: {
    uuid: string | null
    name: string | null
    permalink: string | null
    properties: CrunchbaseProperties
    cards: Record<string, unknown> | null
  }
}

export interface CrunchbaseAutocompleteResponse extends ToolResponse {
  output: {
    entities: CrunchbaseAutocompleteEntity[]
  }
}
