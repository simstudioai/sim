/**
 * fast-check arbitraries for round-trip fuzzing: random DAGs with nested
 * subflows, adversarial block names and strings, and JS code bodies with references in every quote
 * context. Every generated state is structurally valid (unique normalized names, edges only within
 * one scope and only forward, containers listed in `loops`/`parallels`), so a failing property
 * points at the engine and not at the generator.
 */

import { sanitizeForJsonb } from '@sim/utils/string'
import { setOwn } from '@sim/workflow-code'
import {
  type BlockState,
  type Loop,
  normalizeWorkflowBlockName,
  type Parallel,
  RESERVED_WORKFLOW_BLOCK_NAMES,
  type WorkflowState,
} from '@sim/workflow-types/workflow'
import fc from 'fast-check'

/** Names that collide with `Object.prototype` members when used as a plain-object key. */
const PROTOTYPE_KEY_NAMES = ['__proto__', 'constructor', 'prototype'] as const

/**
 * Fragments that break naive escaping: a `<` that is not a reference, a reference-looking span,
 * nested env braces, CRLF, the JS line separators U+2028/U+2029, the U+FFFD that stands in for
 * a lone surrogate (jsonb cannot store one), backticks, template openers, quotes, and
 * `Object.prototype` member names.
 */
const ADVERSARIAL_STRING_FRAGMENTS = [
  '<3 <a.b>',
  '{{ {{X}} }}',
  '{{API_KEY}}',
  '<start.input>',
  "'<start.input>'",
  '\r\n',
  '\n',
  '\u2028',
  '\u2029',
  '\uFFFD',
  '`',
  '${',
  '\u0024{x}',
  '\\',
  '"',
  "'",
  '*/',
  '</script>',
  '<variable.x>',
  '<loop.currentItem>',
  ...PROTOTYPE_KEY_NAMES,
] as const

const isUsableName = (name: string): boolean => {
  const key = normalizeWorkflowBlockName(name)
  return key.length > 0 && !(RESERVED_WORKFLOW_BLOCK_NAMES as readonly string[]).includes(key)
}

/** Text mixing adversarial fragments with arbitrary unicode (including astral characters). */
function adversarialStringArbitrary(): fc.Arbitrary<string> {
  return fc
    .array(
      fc.oneof(
        { weight: 3, arbitrary: fc.constantFrom(...ADVERSARIAL_STRING_FRAGMENTS) },
        { weight: 1, arbitrary: fc.string({ unit: 'binary', maxLength: 8 }) },
        { weight: 1, arbitrary: fc.string({ maxLength: 8 }) }
      ),
      { maxLength: 8 }
    )
    .map((parts) => sanitizeForJsonb(parts.join('')))
}

/**
 * Display names with dots, runs of spaces, mixed case, non-ASCII letters, emoji (one a ZWJ
 * sequence), right-to-left scripts and CJK, plus the exact
 * `Object.prototype` member names, always with a usable normalized key. Two draws can still
 * collide after normalization; use {@link uniqueBlockNamesArbitrary} when they must not.
 */
function blockNameArbitrary(): fc.Arbitrary<string> {
  const wordNames = fc
    .tuple(
      fc.constantFrom(
        'Agent',
        'agent',
        'AGENT',
        'My Block',
        'my.block',
        'Trigger.dev',
        'Ünïcode',
        'x',
        'Loop Body',
        '🚀 Launch',
        '👩‍💻',
        'مرحبا',
        'שלום',
        '数据处理',
        'データ'
      ),
      fc.constantFrom('', ' ', '.', '  ', '\t'),
      fc.nat(30)
    )
    .map(([word, separator, n]) => `${word}${separator}${n}`)
  return fc
    .oneof(
      { weight: 9, arbitrary: wordNames },
      { weight: 1, arbitrary: fc.constantFrom(...PROTOTYPE_KEY_NAMES) }
    )
    .filter(isUsableName)
}

/** `count` names whose normalized keys are distinct. */
function uniqueBlockNamesArbitrary(count: number): fc.Arbitrary<string[]> {
  return fc.uniqueArray(blockNameArbitrary(), {
    minLength: count,
    maxLength: count,
    selector: normalizeWorkflowBlockName,
  })
}

const REF_PATHS = ['input', 'result', 'data.items', 'response.body', 'rows[0]'] as const

/**
 * A JS function body whose references sit in every quote context: bare code, single and double
 * quotes, template text, template interpolation, line and block comments, and a `<` comparison
 * next to a reference. `refs` are normalized block names (`agent1`); each draws a path.
 */
function jsCodeBodyArbitrary(refs: readonly string[]): fc.Arbitrary<string> {
  const names = refs.length > 0 ? refs : ['start']
  const reference = fc
    .tuple(fc.constantFrom(...names), fc.constantFrom(...REF_PATHS))
    .map(([name, path]) => `<${name}.${path}>`)

  const statement = fc.tuple(fc.nat(9), reference, fc.nat(99)).map(([shape, ref, n]) => {
    switch (shape) {
      case 0:
        return `const v${n} = ${ref}`
      case 1:
        return `const s${n} = '${ref} {{API_KEY}}'`
      case 2:
        return `const d${n} = "${ref}"`
      case 3:
        return `const t${n} = \`${ref} \${v${n}}\``
      case 4:
        return `const u${n} = \`\${${ref}}\``
      case 5:
        return `// ${ref} {{API_KEY}}`
      case 6:
        return `/* ${ref} */`
      case 7:
        return `if (${ref} <3) { return {{API_KEY}} }`
      case 8:
        return `const k${n} = {{API_KEY}}`
      default:
        return `return ${ref}`
    }
  })

  return fc
    .tuple(fc.array(statement, { minLength: 1, maxLength: 6 }), fc.constantFrom('\n', '\r\n'))
    .map(([lines, eol]) => lines.join(eol))
}

type PlannedKind = 'function' | 'note' | 'loop' | 'parallel'

interface WorkflowPlan {
  names: string[]
  ids: string[]
  kinds: PlannedKind[]
  parentPicks: number[]
  variants: number[]
  edgePicks: Array<[number, number, 'source' | 'error']>
  codes: string[]
  texts: string[]
}

export interface WorkflowArbitraryOptions {
  /** Blocks including the start trigger. Default 8. */
  maxBlocks?: number
  /** Deepest container nesting. Default 2. */
  maxDepth?: number
}

const LOOP_TYPES = ['for', 'forEach', 'while', 'doWhile'] as const
const PARALLEL_TYPES = ['count', 'collection'] as const

/**
 * A random workflow: a `start_trigger` at the root, then function, note, loop and parallel blocks,
 * about one in seven disabled (a disabled container's children keep their own flag, as after the
 * editor re-enables one), containers nested up to `maxDepth`, forward `source`/`error` edges
 * within a scope, and a `*-start-source` edge from every non-empty container into its first child.
 */
export function workflowStateArbitrary(
  options: WorkflowArbitraryOptions = {}
): fc.Arbitrary<WorkflowState> {
  const maxBlocks = Math.max(2, options.maxBlocks ?? 8)
  const maxDepth = options.maxDepth ?? 2

  return fc
    .integer({ min: 2, max: maxBlocks })
    .chain((count) =>
      uniqueBlockNamesArbitrary(count).chain((names) => {
        const refs = names.map(normalizeWorkflowBlockName)
        return fc.record({
          names: fc.constant(names),
          ids: fc.uniqueArray(fc.uuid(), { minLength: count, maxLength: count }),
          kinds: fc.array(
            fc.constantFrom<PlannedKind>('function', 'function', 'note', 'loop', 'parallel'),
            {
              minLength: count,
              maxLength: count,
            }
          ),
          parentPicks: fc.array(fc.nat(), { minLength: count, maxLength: count }),
          variants: fc.array(fc.nat(), { minLength: count, maxLength: count }),
          edgePicks: fc.array(
            fc.tuple(fc.nat(), fc.nat(), fc.constantFrom<'source' | 'error'>('source', 'error')),
            {
              maxLength: count * 2,
            }
          ),
          codes: fc.array(jsCodeBodyArbitrary(refs), { minLength: count, maxLength: count }),
          texts: fc.array(adversarialStringArbitrary(), { minLength: count, maxLength: count }),
        })
      })
    )
    .map((plan) => buildPlannedState(plan, maxDepth))
}

function buildPlannedState(plan: WorkflowPlan, maxDepth: number): WorkflowState {
  const count = plan.ids.length
  const blocks: Record<string, BlockState> = {}
  const loops: Record<string, Loop> = {}
  const parallels: Record<string, Parallel> = {}
  const parentIndex: Array<number | null> = []
  const depth: number[] = []
  const kinds: Array<PlannedKind | 'start'> = []

  for (let i = 0; i < count; i++) {
    const id = plan.ids[i] ?? `block-${i}`
    const name = plan.names[i] ?? `Block ${i}`
    const variant = plan.variants[i] ?? 0
    const kind: PlannedKind | 'start' = i === 0 ? 'start' : (plan.kinds[i] ?? 'function')
    kinds.push(kind)

    const containerCandidates: Array<number | null> = [null]
    for (let j = 1; j < i; j++) {
      if ((kinds[j] === 'loop' || kinds[j] === 'parallel') && (depth[j] ?? 0) < maxDepth) {
        containerCandidates.push(j)
      }
    }
    const parent =
      i === 0
        ? null
        : (containerCandidates[(plan.parentPicks[i] ?? 0) % containerCandidates.length] ?? null)
    parentIndex.push(parent)
    depth.push(parent === null ? 0 : (depth[parent] ?? 0) + 1)
    const parentId = parent === null ? undefined : plan.ids[parent]

    const base: BlockState = {
      id,
      type: kind === 'start' ? 'start_trigger' : kind,
      name,
      position: { x: i * 240, y: (depth[i] ?? 0) * 160 },
      subBlocks: {},
      outputs: {},
      enabled: i === 0 || variant % 7 !== 6,
      ...(parentId ? { data: { parentId, extent: 'parent' as const } } : {}),
    }

    if (kind === 'function') {
      base.subBlocks = {
        code: { id: 'code', type: 'code', value: plan.codes[i] ?? '' },
        language: { id: 'language', type: 'dropdown', value: 'javascript' },
      }
    } else if (kind === 'note') {
      base.subBlocks = {
        content: { id: 'content', type: 'long-input', value: plan.texts[i] ?? '' },
      }
    } else if (kind === 'loop') {
      const loopType = LOOP_TYPES[variant % LOOP_TYPES.length] ?? 'for'
      base.data = {
        ...base.data,
        loopType,
        count: (variant % 5) + 1,
        collection: loopType === 'forEach' ? '<start.input>' : '',
        whileCondition: loopType === 'while' ? '<start.input> <3' : '',
        doWhileCondition: loopType === 'doWhile' ? '<start.input> <3' : '',
      }
      setOwn(loops, id, {
        id,
        nodes: [],
        iterations: (variant % 5) + 1,
        loopType,
        forEachItems: loopType === 'forEach' ? '<start.input>' : '',
        whileCondition: loopType === 'while' ? '<start.input> <3' : '',
        doWhileCondition: loopType === 'doWhile' ? '<start.input> <3' : '',
        enabled: base.enabled,
      })
    } else if (kind === 'parallel') {
      const parallelType = PARALLEL_TYPES[variant % PARALLEL_TYPES.length] ?? 'count'
      base.data = {
        ...base.data,
        parallelType,
        count: (variant % 4) + 1,
        collection: parallelType === 'collection' ? '<start.input>' : '',
      }
      setOwn(parallels, id, {
        id,
        nodes: [],
        count: (variant % 4) + 1,
        distribution: parallelType === 'collection' ? '<start.input>' : '',
        parallelType,
        enabled: base.enabled,
      })
    }

    setOwn(blocks, id, base)
  }

  const edges: WorkflowState['edges'] = []
  const seen = new Set<string>()
  const addEdge = (source: string, sourceHandle: string, target: string) => {
    const key = `${source}\u0000${sourceHandle}\u0000${target}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push({
      id: `${source}-${sourceHandle}-${target}`,
      source,
      target,
      sourceHandle,
      targetHandle: 'target',
    })
  }

  for (let i = 1; i < count; i++) {
    const parent = parentIndex[i]
    if (parent === null || parent === undefined) continue
    const parentId = plan.ids[parent]
    const childId = plan.ids[i]
    if (!parentId || !childId) continue
    const container = parallels[parentId] ?? loops[parentId]
    container?.nodes.push(childId)
    if (container && container.nodes.length === 1 && kinds[i] !== 'note') {
      addEdge(parentId, `${kinds[parent]}-start-source`, childId)
    }
  }

  for (const [a, b, handle] of plan.edgePicks) {
    const from = a % count
    const to = b % count
    if (from >= to || to === 0) continue
    if (parentIndex[from] !== parentIndex[to]) continue
    if (kinds[from] === 'note' || kinds[to] === 'note') continue
    if (handle === 'error' && kinds[from] !== 'function') continue
    const source = plan.ids[from]
    const target = plan.ids[to]
    const sourceKind = kinds[from]
    const sourceHandle =
      sourceKind === 'loop' || sourceKind === 'parallel' ? `${sourceKind}-end-source` : handle
    if (source && target) addEdge(source, sourceHandle, target)
  }

  return { blocks, edges, loops, parallels, variables: {} }
}
