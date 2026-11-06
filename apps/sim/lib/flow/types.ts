/** Provider response contracts from https://docs.flowengineering.com/openapi/customer-api.json. */

export interface FlowProject {
  ai_model: string
  created_at: string
  id: string
  name: string
  slug: string
}

export interface FlowSearchResult {
  entity_id: string
  entity_type: string
  human_id: string | null
  legacy_human_id: string | null
  match?: 'semantic'
  name: string
  same_text_count?: number
}

export interface FlowEntity {
  branchesChangedIn?: Array<string>
  branchesCreatedIn?: Array<string>
  createdAt?: string
  defaultSortKey?: string
  deleted?: boolean
  formulaTemplates: Record<string, unknown>
  formulas: Record<string, string>
  id: string
  links: FlowEntityLinks
  type?: string
  uniqueEntityNumber?: number
  updatedAt?: string
  values: Record<string, unknown>
}

interface FlowEntityLinks {
  crosslinks: Array<string>
  inbound: Array<string>
  inboundOrder: Record<string, string>
  inboundTypes?: Record<string, string>
  outbound: Array<string>
  outboundOrder?: Record<string, string>
  outboundTypes?: Record<string, string>
  rootPlaced?: boolean
}

export interface FlowEntityPage {
  items: Array<FlowEntity>
  moreAvailable?: boolean
  nextPageStart?: string
}

export interface FlowCategory {
  builtin: boolean
  categoryType: 'folder' | 'item'
  fields: Array<FlowField>
  humanIdPrefix: string
  humanIdPrefixLocked: boolean
  id: string
  name: string
}

interface FlowField {
  key: string
  multi?: boolean
  name: string
  tags?: Array<FlowTag>
  type: string
}

interface FlowTag {
  id?: string
  name: string
}

export interface FlowBranch {
  created_at: string
  description: string
  id: string
  is_deleted: boolean
  is_protected: boolean
  live_edits_allowed: boolean
  merged_at: string | null
  name: string
  number: number
  owner_id: string | null
  parent?: string | null
  parent_name: string | null
  ready_for_review: boolean
  require_review: boolean
  required_reviewer_ids: Array<string>
  updated_at: string
}

export interface FlowComment {
  author_id: string
  branch_id?: string
  created_at: string
  entity_id: string
  id: string
  resolved: boolean
  text: string
}

export interface FlowHistoryEntry {
  actor: FlowEntityHistoryActor
  branch_id: string
  change:
    | FlowEntityCreatedChange
    | FlowEntityValueChangedChange
    | FlowEntityFormulaChangedChange
    | FlowEntityLinkAddedChange
    | FlowEntityLinkRemovedChange
    | FlowEntityCrosslinkAddedChange
    | FlowEntityCrosslinkRemovedChange
    | FlowEntityDeletedChange
    | FlowEntityRestoredChange
    | FlowEntityChildReorderedChange
    | FlowEntityMigrationNoteChange
  id: string
  reason?:
    | FlowFormulaRecomputedReason
    | FlowFieldTypeChangedReason
    | FlowDefaultFormulaChangedReason
    | FlowDefaultFormulaReappliedReason
  timestamp: string
}

interface FlowEntityHistoryActor {
  id?: string
  type: 'user' | 'agent' | 'system' | 'unknown'
}

interface FlowEntityCreatedChange {
  entity_id: string
  entity_type: string
  type: 'entity_created'
}

interface FlowEntityValueChangedChange {
  entity_id: string
  field_key: string
  type: 'value_changed'
  value: string | number | boolean | Record<string, unknown> | Array<unknown> | null
}

interface FlowEntityFormulaChangedChange {
  entity_id: string
  field_key: string
  formula: string | null
  type: 'formula_changed'
}

interface FlowEntityLinkAddedChange {
  child_entity_id: string
  parent_entity_id: string
  type: 'link_added'
}

interface FlowEntityLinkRemovedChange {
  child_entity_id: string
  parent_entity_id: string
  type: 'link_removed'
}

interface FlowEntityCrosslinkAddedChange {
  entity_ids: Array<string>
  type: 'crosslink_added'
}

interface FlowEntityCrosslinkRemovedChange {
  entity_ids: Array<string>
  type: 'crosslink_removed'
}

interface FlowEntityDeletedChange {
  entity_id: string
  type: 'entity_deleted'
}

interface FlowEntityRestoredChange {
  entity_id: string
  type: 'entity_restored'
}

interface FlowEntityChildReorderedChange {
  child_entity_id: string
  parent_entity_id: string
  type: 'child_reordered'
}

interface FlowEntityMigrationNoteChange {
  action?: string
  note?: string
  source_entity_id?: string
  source_name?: string
  type: 'migration_note'
}

interface FlowFormulaRecomputedReason {
  source_entity_id?: string
  source_field_key?: string
  type: 'formula_recomputed'
}

interface FlowFieldTypeChangedReason {
  field_name: string
  next_type: string
  previous_type: string
  type: 'field_type_changed'
}

interface FlowDefaultFormulaChangedReason {
  field_name: string
  type: 'default_formula_changed'
}

interface FlowDefaultFormulaReappliedReason {
  field_name: string
  type: 'default_formula_reapplied'
}

export interface FlowHistoryPage {
  items: Array<FlowHistoryEntry>
  next_cursor: string | null
}
