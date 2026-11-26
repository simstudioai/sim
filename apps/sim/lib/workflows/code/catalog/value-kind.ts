import type {
  CatalogStructuredKind,
  CatalogValueKind,
  ParamStorage,
  ResourceKind,
} from '@sim/workflow-code'
import type { SubBlockConfig, SubBlockType } from '@/blocks/types'

/**
 * How a subBlock's value is written in source, checked, and preferably stored
 * (including the JSON-in-string encodings).
 */
interface SubBlockValueShape {
  valueKind: CatalogValueKind
  resourceKind?: ResourceKind
  storage: ParamStorage
  structured?: CatalogStructuredKind
  acceptsNumber?: boolean
  neverDecoded?: boolean
  tableFilter?: boolean
}

interface TypeRule {
  valueKind: CatalogValueKind
  resourceKind?: ResourceKind
  storage?: ParamStorage
  structured?: CatalogStructuredKind
  /** Free text the runtime also takes as a number: the tools that read one coerce it. */
  acceptsNumber?: true
  /** User text whose JSON-looking content canonicalize never decodes. */
  neverDecoded?: true
  /** A table filter, whose shape compile checks against the table runtime's grammar. */
  tableFilter?: true
}

/**
 * One rule per subBlock type. `Record<SubBlockType, …>` makes a new registry type a type error
 * here rather than a silent `string`.
 */
const TYPE_RULES: Record<SubBlockType, TypeRule> = {
  'short-input': { valueKind: 'string', acceptsNumber: true },
  'long-input': { valueKind: 'string', acceptsNumber: true, neverDecoded: true },
  'time-input': { valueKind: 'string' },
  dropdown: { valueKind: 'string' },
  combobox: { valueKind: 'string' },
  slider: { valueKind: 'number' },
  switch: { valueKind: 'boolean' },
  table: { valueKind: 'array', structured: 'tableRows' },
  code: { valueKind: 'code', neverDecoded: true },
  'tool-input': { valueKind: 'tools', structured: 'tools' },
  'skill-input': { valueKind: 'array', structured: 'skills' },
  'checkbox-list': { valueKind: 'array' },
  'grouped-checkbox-list': { valueKind: 'array' },
  'condition-input': { valueKind: 'branches', storage: 'json-string', structured: 'branches' },
  'router-input': { valueKind: 'branches', storage: 'json-string', structured: 'branches' },
  'eval-input': { valueKind: 'array' },
  'oauth-input': { valueKind: 'resource', resourceKind: 'credential' },
  'webhook-config': { valueKind: 'none' },
  'schedule-info': { valueKind: 'none' },
  'file-selector': { valueKind: 'picked' },
  'sheet-selector': { valueKind: 'picked' },
  'project-selector': { valueKind: 'picked' },
  'channel-selector': { valueKind: 'picked' },
  'user-selector': { valueKind: 'picked' },
  'folder-selector': { valueKind: 'picked' },
  'document-selector': { valueKind: 'picked' },
  'column-selector': { valueKind: 'picked' },
  'mcp-tool-selector': { valueKind: 'picked' },
  'mcp-server-selector': { valueKind: 'resource', resourceKind: 'mcp-server' },
  'knowledge-base-selector': { valueKind: 'resource', resourceKind: 'knowledge-base' },
  'table-selector': { valueKind: 'resource', resourceKind: 'table' },
  'workflow-selector': { valueKind: 'resource', resourceKind: 'workflow' },
  'knowledge-tag-filters': { valueKind: 'array', storage: 'json-string' },
  'document-tag-entry': { valueKind: 'array', storage: 'json-string' },
  'mcp-dynamic-args': { valueKind: 'object' },
  'input-format': { valueKind: 'array', structured: 'inputFormat' },
  'response-format': { valueKind: 'json' },
  'filter-builder': { valueKind: 'json', tableFilter: true },
  'sort-builder': { valueKind: 'json' },
  'file-upload': { valueKind: 'upload' },
  'input-mapping': { valueKind: 'object' },
  'workflow-input-mapper': { valueKind: 'object' },
  'variables-input': { valueKind: 'array', structured: 'variables' },
  'messages-input': { valueKind: 'array' },
  'workflow-output-selector': { valueKind: 'array' },
  text: { valueKind: 'none' },
  'model-fallback-list': { valueKind: 'array' },
  modal: { valueKind: 'none' },
}

/**
 * Derives a subBlock's value shape from its type plus the few config flags that change it: a
 * JSON-language code field holds JSON, a multi-select dropdown holds an array, a `readOnly` field
 * is display-only (`isDisplayOnlySubBlock` in triggers/index.ts), and a folder selector bound to
 * workspace files (`resourceType: 'file'`) points at a Sim file folder rather than a provider id.
 */
export function deriveValueShape(subBlock: SubBlockConfig): SubBlockValueShape {
  const rule = TYPE_RULES[subBlock.type] ?? { valueKind: 'json' }
  let valueKind = rule.valueKind
  let resourceKind = rule.resourceKind

  if (subBlock.type === 'code' && subBlock.language === 'json') valueKind = 'json'
  if ((subBlock.type === 'dropdown' || subBlock.type === 'combobox') && subBlock.multiSelect) {
    valueKind = 'array'
  }
  if (subBlock.type === 'folder-selector' && subBlock.resourceType === 'file') {
    valueKind = 'resource'
    resourceKind = 'file-folder'
  }

  if (subBlock.readOnly === true) valueKind = 'none'

  const shape: SubBlockValueShape = { valueKind, storage: rule.storage ?? 'native' }
  if (valueKind === 'resource' && resourceKind) shape.resourceKind = resourceKind
  if (rule.structured) shape.structured = rule.structured
  if (rule.acceptsNumber) shape.acceptsNumber = true
  if (rule.neverDecoded) shape.neverDecoded = true
  if (rule.tableFilter) shape.tableFilter = true
  return shape
}
