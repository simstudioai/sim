/**
 * SubBlock type → TS param type. Every `SubBlockType` has an arm; the `never` check makes a new
 * type a compile error here.
 *
 * Types reference names exported by `core.d.ts` (`Value`, `CredentialRef`, `TableRef`, ...). A
 * basic/advanced pair is the union of its members' types, so the mode follows from the kind of
 * value written: a selector-kind constructor is basic, a plain value or reference is advanced.
 */

import type { CatalogSubBlock } from '@sim/workflow-code'
import { quoteString } from '@sim/workflow-code'
import { isCredentialIdTwin } from '@sim/workflow-code/catalog/surface'
import type { SubBlockType } from '@sim/workflow-types/blocks'
import { arrayOf, literal, union } from './emit'

interface MappedType {
  /** The TS type expression. */
  type: string
  /** Extra JSDoc lines (bounds, selector keys, hints). */
  doc: string[]
}

function staticOptions(subBlock: CatalogSubBlock): string[] | null {
  if (!Array.isArray(subBlock.options) || subBlock.options.length === 0) return null
  return subBlock.options.map((option) => literal(option.id))
}

function selectorDoc(subBlock: CatalogSubBlock): string[] {
  return subBlock.selectorKey ? [`Picked from \`${subBlock.selectorKey}\`.`] : []
}

function bounds(subBlock: CatalogSubBlock): string[] {
  const parts: string[] = []
  if (subBlock.min !== undefined) parts.push(`min ${subBlock.min}`)
  if (subBlock.max !== undefined) parts.push(`max ${subBlock.max}`)
  if (subBlock.step !== undefined) parts.push(`step ${subBlock.step}`)
  if (subBlock.integer) parts.push('integer')
  return parts.length > 0 ? [`Range: ${parts.join(', ')}.`] : []
}

/**
 * A table holds rows as the printer writes them, `[{ cells: { Key: …, Value: … } }]`, with one
 * optional cell per declared column.
 */
function tableType(subBlock: CatalogSubBlock): string {
  const { columns } = subBlock
  const cells =
    columns && columns.length > 0
      ? `{ ${columns.map((column) => `${quoteString(column)}?: Value<string>`).join('; ')} }`
      : 'Record<string, Value<string>>'
  return `Array<{ cells: ${cells} }>`
}

function codeType(subBlock: CatalogSubBlock): string {
  return subBlock.language === 'json' ? 'JsonWithRefs | Template' : 'Template | string'
}

function dropdownType(subBlock: CatalogSubBlock): string {
  const options = staticOptions(subBlock)
  const item = options ? union(options) : 'string'
  if (subBlock.multiple) return options ? arrayOf(item) : 'Value<string> | string[]'
  return options ? item : 'Value<string>'
}

/** A saved credential, narrowed to the providers the field accepts when the catalog names them. */
function credentialType(subBlock: CatalogSubBlock): string {
  const providers = subBlock.credentialProviders
  if (!providers || providers.length === 0) return 'CredentialRef'
  return `CredentialRef<CredentialKeyFor<${union(providers.map((id) => literal(id)))}>>`
}

/**
 * The param type of one canonical group: the union of its members' types. The free-text twin of a
 * credential picker takes `CredentialIdValue` instead of its own text type, so a credential param
 * accepts `credential('key')` or a run-time id, never literal text such as a pasted token.
 */
export function mapParamType(members: readonly CatalogSubBlock[]): string {
  return union(
    members.flatMap((member) => {
      if (isCredentialIdTwin(member, members)) return ['CredentialIdValue']
      const mapped = mapSubBlock(member)
      return mapped ? [mapped.type] : []
    })
  )
}

/** Maps one subBlock to its param type, or `null` when it is never written in source. */
export function mapSubBlock(subBlock: CatalogSubBlock): MappedType | null {
  const type: SubBlockType = subBlock.type
  if (subBlock.valueKind === 'none') return null
  const doc: string[] = []
  if (subBlock.password) doc.push('Secret: prefer `env.NAME`.')
  switch (type) {
    case 'short-input':
    case 'long-input':
      return { type: 'Value<string | number>', doc }
    case 'dropdown':
      return { type: dropdownType(subBlock), doc: [...doc, ...selectorDoc(subBlock)] }
    case 'combobox': {
      if (subBlock.id === 'model') return { type: 'Value<LiteralUnion<Model>>', doc }
      const options = staticOptions(subBlock)
      return {
        type: options ? `Value<LiteralUnion<${union(options)}>>` : 'Value<string>',
        doc: [...doc, ...selectorDoc(subBlock)],
      }
    }
    case 'slider':
      return { type: 'Value<number>', doc: [...doc, ...bounds(subBlock)] }
    case 'switch':
      return { type: 'Value<boolean>', doc }
    case 'time-input':
      return { type: 'TimeString | AnyRef | Template', doc: [...doc, 'Time as `HH:MM`.'] }
    case 'table':
      return { type: tableType(subBlock), doc }
    case 'code':
      return { type: codeType(subBlock), doc }
    case 'checkbox-list':
    case 'grouped-checkbox-list': {
      const options = staticOptions(subBlock)
      return { type: options ? arrayOf(union(options)) : 'string[]', doc }
    }
    case 'oauth-input':
      return {
        type: credentialType(subBlock),
        doc: [...doc, ...(subBlock.serviceId ? [`Service: \`${subBlock.serviceId}\`.`] : [])],
      }
    case 'channel-selector':
    case 'user-selector':
    case 'file-selector':
    case 'sheet-selector':
    case 'project-selector':
    case 'document-selector':
    case 'column-selector':
    case 'mcp-tool-selector':
      return { type: 'string', doc: [...doc, ...selectorDoc(subBlock)] }
    case 'folder-selector':
      return subBlock.resourceKind === 'file-folder'
        ? { type: 'FolderRef', doc }
        : { type: 'string', doc: [...doc, ...selectorDoc(subBlock)] }
    case 'knowledge-base-selector':
      return { type: 'KnowledgeBaseRef', doc }
    case 'mcp-server-selector':
      return { type: 'McpServerRef', doc }
    case 'table-selector':
      return { type: 'TableRef', doc }
    case 'workflow-selector':
      return { type: 'WorkflowRef', doc }
    case 'file-upload': {
      const uploaded = subBlock.multiple ? 'UploadedFile | UploadedFile[]' : 'UploadedFile'
      return { type: `${uploaded} | RefTo<SimFile | SimFile[]>`, doc }
    }
    case 'tool-input':
      return { type: 'Tool[]', doc }
    case 'skill-input':
      return { type: 'SkillRef[]', doc }
    case 'condition-input':
    case 'router-input':
      return { type: 'Record<string, BranchExpression>', doc }
    case 'input-format':
      return { type: 'InputFields', doc }
    case 'response-format':
      return { type: 'ResponseFields', doc }
    case 'messages-input':
      return { type: 'Message[]', doc }
    case 'variables-input':
      return { type: 'VariableAssignment[]', doc }
    case 'input-mapping':
    case 'workflow-input-mapper':
      return { type: 'InputMapping', doc }
    case 'filter-builder':
      return { type: 'Filter', doc }
    case 'sort-builder':
      return { type: 'Sort', doc }
    case 'knowledge-tag-filters':
      return { type: 'TagFilter[]', doc }
    case 'document-tag-entry':
      return { type: 'DocumentTag[]', doc }
    case 'mcp-dynamic-args':
      return { type: 'Record<string, JsonWithRefs>', doc }
    case 'eval-input':
      return { type: 'EvalMetric[]', doc }
    case 'model-fallback-list':
      return { type: 'ModelFallback[]', doc }
    case 'workflow-output-selector':
      return { type: 'string[]', doc: [...doc, 'Output paths, `blockName.path`.'] }
    // Display-only or server-managed: never written in source.
    case 'text':
    case 'schedule-info':
    case 'webhook-config':
    case 'modal':
      return null
    default: {
      const unhandled: never = type
      throw new Error(`map-subblock: no mapping for subBlock type ${String(unhandled)}`)
    }
  }
}
