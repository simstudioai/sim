/**
 * Stored values for corpus fixtures, one generator per subBlock type, in the shapes the editor
 * persists (the sub-block components' `useSubBlockValue` types and `validateValueForSubBlockType`).
 * Free text always carries the adversarial payload: a reference in code position, a reference
 * inside quotes, `{{API_KEY}}`, a newline, a backtick and `${`. Values that must be ids (dropdown
 * options, selector picks, credentials) are ids instead, because a payload there is a value the
 * editor could never have stored; the advanced member of a selector pair is free text and carries
 * the payload.
 */

import type { SeededRandom } from '@/lib/workflows/code/corpus/random'
import type { SubBlockConfig } from '@/blocks/types'

/** The upstream start block every case has; its key is `start`. */
export const CORPUS_START_NAME = 'Start'

/** The workflow variable every case declares, referenced as `<variable.corpusnote>`. */
export const CORPUS_VARIABLE_NAME = 'corpusNote'

/**
 * The workspace skill corpus agents pick. The round-trip harness resolves it, so it takes the
 * lifted `skill('key')` path; the other picked skill resolves nowhere and stays verbatim.
 */
export const CORPUS_SKILL = { id: 'corpus-skill', key: 'corpus-skill', name: 'Corpus skill' }

/** The six markers every free-text corpus string carries. */
export const CORPUS_TEXT_MARKERS = [
  '<start.input>',
  "'<start.name>'",
  '{{API_KEY}}',
  '\n',
  '`',
  '${',
] as const

export const CORPUS_TEXT = [
  'Reply to <start.input> as',
  "'<start.name>' using {{API_KEY}} and <variable.corpusnote>",
  'second line with a `backtick` and a literal \u0024{notInterpolated} and <3 hearts',
].join('\n')

const JS_CODE = [
  'const input = <start.input>',
  "const label = '<start.name> {{API_KEY}}'",
  'const note = `tick \u0024{label}` // \u0024{',
  'return { input, label, note, key: {{API_KEY}} }',
].join('\n')

const PYTHON_CODE = [
  'value = <start.input>',
  "label = '<start.name> {{API_KEY}}'",
  'note = f"`tick` \u0024{label}"',
  'return {"value": value, "label": label}',
].join('\n')

const SHELL_CODE = [
  'INPUT=<start.input>',
  "echo '<start.name> {{API_KEY}}'",
  'echo "`date` \u0024{HOME}"',
].join('\n')

/** JSON code fields must stay parseable, so the payload lives inside JSON strings. */
const JSON_CODE = JSON.stringify(
  {
    input: '<start.input>',
    quoted: "'<start.name>'",
    key: '{{API_KEY}}',
    text: CORPUS_TEXT,
  },
  null,
  2
)

const RESPONSE_FORMAT = JSON.stringify(
  {
    name: 'corpus_result',
    schema: {
      type: 'object',
      properties: { summary: { type: 'string', description: CORPUS_TEXT } },
      required: ['summary'],
      additionalProperties: false,
    },
    strict: true,
  },
  null,
  2
)

export interface FillContext {
  rng: SeededRandom
  /** Values filled so far on this block, for option functions that read siblings. */
  values: Record<string, unknown>
  /** A uuid source for row ids inside structured values. */
  newId: () => string
  /** A registry block type with an operation dropdown, for tool-input entries. */
  toolType: { type: string; operations: string[] } | null
}

type OptionList = Array<{ id: string; hidden?: boolean }>

/** A subBlock's options for these values, or `null` when it has none or they can't be evaluated. */
export function resolveOptions(
  subBlock: SubBlockConfig,
  values: Record<string, unknown>
): OptionList | null {
  const { options } = subBlock
  if (!options) return null
  try {
    const list: OptionList = typeof options === 'function' ? options({ values }) : options
    const visible = list.filter((option) => !option.hidden && typeof option.id === 'string')
    return visible.length > 0 ? visible : null
  } catch {
    return null
  }
}

/** SubBlock types the user never writes (display, server-managed, modal launchers). */
const NON_VALUE_TYPES = new Set<SubBlockConfig['type']>([
  'text',
  'schedule-info',
  'webhook-config',
  'modal',
])

export function isWritableSubBlock(subBlock: SubBlockConfig): boolean {
  return !NON_VALUE_TYPES.has(subBlock.type) && !subBlock.readOnly
}

function codeFor(subBlock: SubBlockConfig, values: Record<string, unknown>): string {
  const language = String(subBlock.language ?? values.language ?? 'javascript').toLowerCase()
  if (language === 'json') return JSON_CODE
  if (language === 'python') return PYTHON_CODE
  if (language === 'shell' || language === 'bash' || language === 'sh') return SHELL_CODE
  return JS_CODE
}

function pickOption(subBlock: SubBlockConfig, ctx: FillContext): string | null {
  const options = resolveOptions(subBlock, ctx.values)
  return options ? ctx.rng.pick(options).id : null
}

function toolEntries(ctx: FillContext): unknown[] {
  if (!ctx.toolType) return []
  const { type, operations } = ctx.toolType
  const first = operations[0]
  const second = operations[1] ?? first
  const entry = (operation: string | undefined, title: string) => ({
    type,
    title,
    ...(operation ? { operation } : {}),
    params: { corpusText: CORPUS_TEXT, emptyValue: '' },
    isExpanded: false,
    usageControl: 'auto',
  })
  return [entry(first, `${type} one`), entry(second, `${type} two`)]
}

/**
 * The stored value for one writable subBlock, or `null` when this type has no value the corpus
 * can stand behind (a dynamic dropdown with nothing to pick).
 */
export function fillSubBlockValue(subBlock: SubBlockConfig, ctx: FillContext): unknown {
  const { rng, newId } = ctx
  switch (subBlock.type) {
    case 'short-input':
    case 'long-input':
      return CORPUS_TEXT
    case 'combobox':
      return (
        pickOption(subBlock, ctx) ??
        (subBlock.defaultValue !== undefined
          ? structuredClone(subBlock.defaultValue)
          : typeof subBlock.options === 'function'
            ? null
            : CORPUS_TEXT)
      )
    case 'dropdown': {
      const picked = pickOption(subBlock, ctx)
      if (picked === null) return subBlock.options ? null : 'corpus-option'
      return subBlock.multiSelect ? [picked] : picked
    }
    case 'slider': {
      const min = subBlock.min ?? 0
      const max = subBlock.max ?? Math.max(min + 1, 10)
      return subBlock.integer ? rng.int(Math.ceil(min), Math.floor(max)) : min + (max - min) / 2
    }
    case 'switch':
      return rng.bool()
    case 'code':
      return codeFor(subBlock, ctx.values)
    case 'response-format':
      return RESPONSE_FORMAT
    case 'time-input':
      return `${String(rng.int(0, 23)).padStart(2, '0')}:${String(rng.int(0, 59)).padStart(2, '0')}`
    case 'table':
      return [
        {
          id: newId(),
          cells: Object.fromEntries(
            (subBlock.columns ?? ['Key', 'Value']).map((c) => [c, CORPUS_TEXT])
          ),
        },
      ]
    case 'checkbox-list':
    case 'grouped-checkbox-list': {
      const options = resolveOptions(subBlock, ctx.values) ?? []
      return Object.fromEntries(options.map((option, i) => [option.id, i % 2 === 0]))
    }
    case 'tool-input':
      return toolEntries(ctx)
    case 'skill-input':
      return [
        { skillId: CORPUS_SKILL.id, name: CORPUS_SKILL.name },
        { skillId: 'corpus-skill-deleted', name: 'Deleted skill' },
      ]
    case 'condition-input':
      return JSON.stringify([
        { id: newId(), title: 'if', value: '<start.input> === "a"' },
        { id: newId(), title: 'else', value: '' },
      ])
    case 'router-input':
      return JSON.stringify([
        { id: newId(), title: 'Route 1', value: CORPUS_TEXT },
        { id: newId(), title: 'Route 2', value: 'Everything else' },
      ])
    case 'eval-input':
      return [
        { id: newId(), name: 'accuracy', description: CORPUS_TEXT, range: { min: 0, max: 10 } },
      ]
    case 'input-format':
      return [
        { id: newId(), name: 'name', type: 'string', value: '', collapsed: false },
        { id: newId(), name: 'count', type: 'number', value: '', collapsed: false },
      ]
    case 'messages-input':
      return [
        { role: 'system', content: CORPUS_TEXT },
        { role: 'user', content: '<start.input>' },
      ]
    case 'variables-input':
      return [
        {
          id: newId(),
          variableName: CORPUS_VARIABLE_NAME,
          type: 'string',
          value: CORPUS_TEXT,
          isExisting: true,
        },
      ]
    case 'knowledge-tag-filters':
      return JSON.stringify([
        { id: newId(), tagName: 'topic', fieldType: 'text', operator: 'eq', tagValue: CORPUS_TEXT },
      ])
    case 'document-tag-entry':
      return JSON.stringify([
        { id: newId(), tagName: 'topic', fieldType: 'text', value: CORPUS_TEXT },
      ])
    case 'filter-builder':
      return [
        { id: newId(), logicalOperator: 'and', column: 'name', operator: 'eq', value: CORPUS_TEXT },
      ]
    case 'sort-builder':
      return [{ id: newId(), column: 'name', direction: 'asc' }]
    case 'input-mapping':
    case 'workflow-input-mapper':
      return JSON.stringify({ name: CORPUS_TEXT, count: '<start.count>' })
    case 'mcp-dynamic-args':
      return { query: CORPUS_TEXT }
    case 'workflow-output-selector':
      return ['start.input']
    case 'file-upload': {
      const file = {
        name: 'corpus.txt',
        path: '/api/files/serve/corpus.txt',
        size: 12,
        type: 'text/plain',
      }
      return subBlock.multiple ? [file] : file
    }
    case 'model-fallback-list':
      return []
    case 'oauth-input':
      return 'corpus-credential'
    case 'knowledge-base-selector':
    case 'document-selector':
    case 'file-selector':
    case 'sheet-selector':
    case 'project-selector':
    case 'channel-selector':
    case 'user-selector':
    case 'folder-selector':
    case 'mcp-server-selector':
    case 'mcp-tool-selector':
    case 'workflow-selector':
    case 'table-selector':
    case 'column-selector':
      return subBlock.multiSelect ? ['corpus-pick-1', 'corpus-pick-2'] : 'corpus-pick-1'
    default:
      return null
  }
}
