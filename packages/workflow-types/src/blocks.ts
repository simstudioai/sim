export type PrimitiveValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'json'
  | 'array'
  | 'file'
  | 'file[]'
  | 'any'

export type SubBlockType =
  | 'short-input'
  | 'long-input'
  | 'dropdown'
  | 'combobox'
  | 'slider'
  | 'table'
  | 'code'
  | 'switch'
  | 'tool-input'
  | 'skill-input'
  | 'checkbox-list'
  | 'grouped-checkbox-list'
  | 'condition-input'
  | 'eval-input'
  | 'time-input'
  | 'oauth-input'
  | 'webhook-config'
  | 'schedule-info'
  | 'file-selector'
  | 'sheet-selector'
  | 'project-selector'
  | 'channel-selector'
  | 'user-selector'
  | 'folder-selector'
  | 'knowledge-base-selector'
  | 'knowledge-tag-filters'
  | 'document-selector'
  | 'document-tag-entry'
  | 'mcp-server-selector'
  | 'mcp-tool-selector'
  | 'mcp-dynamic-args'
  | 'input-format'
  | 'response-format'
  | 'filter-builder'
  | 'sort-builder'
  | 'file-upload'
  | 'input-mapping'
  | 'variables-input'
  | 'messages-input'
  | 'workflow-selector'
  | 'workflow-input-mapper'
  | 'text'
  | 'router-input'
  | 'table-selector'
  | 'modal'

export interface OutputCondition {
  field: string
  value: string | number | boolean | Array<string | number | boolean>
  not?: boolean
  and?: {
    field: string
    value:
      | string
      | number
      | boolean
      | Array<string | number | boolean | undefined | null>
      | undefined
      | null
    not?: boolean
  }
}

export type OutputFieldDefinition =
  | PrimitiveValueType
  | {
      type: PrimitiveValueType
      description?: string
      condition?: OutputCondition
      hiddenFromDisplay?: boolean
    }

export function isHiddenFromDisplay(def: unknown): boolean {
  return Boolean(
    def && typeof def === 'object' && 'hiddenFromDisplay' in def && def.hiddenFromDisplay
  )
}
