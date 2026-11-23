import type { Node } from '@babel/types'

/**
 * The supported form for each rejected construct. Tests assert
 * these strings, and agents act on them, so change one only on purpose.
 */
export const HINTS = {
  let: 'Use const; blocks are immutable declarations.',
  nonBuilderConst:
    'Only blocks can be named. Inline the value, or declare a workflow variable and use vars.x.',
  destructuring: 'Bind the block and use blk.field.',
  helpers:
    "Helpers aren't supported in workflow files; put logic in a function block with code: codeFile('./functions/x.js').",
  controlFlow:
    "Control flow can't create blocks. Use condition()/router() for branching and loop()/parallel() for iteration.",
  spread: 'Write each field explicitly.',
  computedKey: 'Use a literal key.',
  expressions: "Expressions aren't evaluated. Use t`` to build strings, or js`` for a condition.",
  types: 'Types come from the SDK; remove this.',
  calls: 'Only SDK calls are allowed; nothing in a workflow file runs.',
  untaggedTemplate: 'Use t`` so interpolations become references.',
  unknownTag: 'Use t`` for text, js`` for code, json`` for JSON or md`` for markdown.',
  literalKind: "Regex and BigInt literals aren't values; write the pattern or number as a string.",
  elementAccess: "Use a literal key: blk['key'] or blk[0].",
  otherImport:
    "Only '@sim/workflow-sdk' is importable; reference function files with codeFile('./functions/x.js').",
  extraStatement:
    'A workflow file holds imports and one export default workflow(...); move this inside the workflow body or delete it.',
  namedExport: 'Only export default workflow(...) is allowed; remove this export.',
  duplicateKey: 'Write each key once.',
  bindInline: 'Declare the block with const and pass its name.',
} as const

/** Names for node types a generic label reads badly for. */
const NODE_LABELS: Partial<Record<Node['type'], string>> = {
  CallExpression: 'A call',
  NewExpression: 'A constructor call',
  TemplateLiteral: 'An untagged template',
  TaggedTemplateExpression: 'This template tag',
  ArrowFunctionExpression: 'A function',
  FunctionExpression: 'A function',
  FunctionDeclaration: 'A function',
  ObjectMethod: 'A method',
  SpreadElement: 'A spread',
  RegExpLiteral: 'A regex literal',
  BigIntLiteral: 'A BigInt literal',
  ExpressionStatement: 'An expression',
  ExportNamedDeclaration: 'A named export',
  OptionalMemberExpression: 'An optional chain',
  OptionalCallExpression: 'An optional call',
  TSAsExpression: 'A type assertion',
  TSSatisfiesExpression: 'A type assertion',
  TSTypeAssertion: 'A type assertion',
  TSNonNullExpression: 'A non-null assertion',
}

/**
 * A reader's name for a node, capitalized to start a message ("A call", "An if statement"),
 * instead of its Babel type name.
 */
export function nodeLabel(node: Node): string {
  const label = NODE_LABELS[node.type]
  if (label) return label
  const words = node.type
    .replace(/^TS/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
  return `${/^[aeiou]/.test(words) ? 'An' : 'A'} ${words}`
}

/** The hint for an expression or statement outside the accepted grammar. */
export function hintForNode(node: Node): string {
  switch (node.type) {
    case 'VariableDeclaration':
      return node.kind === 'const' ? HINTS.nonBuilderConst : HINTS.let
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
    case 'ClassDeclaration':
    case 'ClassExpression':
    case 'ObjectMethod':
      return HINTS.helpers
    case 'IfStatement':
    case 'ForStatement':
    case 'ForInStatement':
    case 'ForOfStatement':
    case 'WhileStatement':
    case 'DoWhileStatement':
    case 'SwitchStatement':
    case 'TryStatement':
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
      return HINTS.controlFlow
    case 'SpreadElement':
    case 'RestElement':
      return HINTS.spread
    case 'BinaryExpression':
    case 'LogicalExpression':
    case 'ConditionalExpression':
    case 'UnaryExpression':
    case 'UpdateExpression':
    case 'AssignmentExpression':
    case 'SequenceExpression':
      return HINTS.expressions
    case 'CallExpression':
    case 'NewExpression':
    case 'AwaitExpression':
    case 'YieldExpression':
    case 'ThisExpression':
    case 'Super':
    case 'Import':
    case 'ImportExpression':
    case 'MetaProperty':
      return HINTS.calls
    case 'OptionalMemberExpression':
    case 'OptionalCallExpression':
    case 'TSNonNullExpression':
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSTypeAssertion':
    case 'TSInterfaceDeclaration':
    case 'TSTypeAliasDeclaration':
    case 'TSEnumDeclaration':
    case 'TSModuleDeclaration':
    case 'TSDeclareFunction':
    case 'TSTypeAnnotation':
    case 'TSInstantiationExpression':
      return HINTS.types
    case 'TemplateLiteral':
      return HINTS.untaggedTemplate
    case 'TaggedTemplateExpression':
      return HINTS.unknownTag
    case 'RegExpLiteral':
    case 'BigIntLiteral':
      return HINTS.literalKind
    case 'ExportNamedDeclaration':
    case 'ExportAllDeclaration':
      return HINTS.namedExport
    case 'ImportDeclaration':
      return HINTS.otherImport
    default:
      return HINTS.extraStatement
  }
}

/**
 * The edit distance between `a` and `b`, counting a swap of two adjacent characters as one edit
 * (`saev` is one edit from `save`), or `cap + 1` once it exceeds `cap`.
 */
function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  let beforePrevious: number[] = []
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        current[j] = Math.min(current[j], beforePrevious[j - 2] + 1)
      }
      rowMin = Math.min(rowMin, current[j])
    }
    if (rowMin > cap) return cap + 1
    beforePrevious = previous
    previous = current
  }
  return previous[b.length]
}

/**
 * The closest candidate within a third of the word's length (at least 1, at most 3 edits), or
 * `null`. Ties keep the first candidate, so callers pass candidates in a stable order.
 */
export function closest(word: string, candidates: Iterable<string>): string | null {
  const cap = Math.min(3, Math.max(1, Math.floor(word.length / 3)))
  let best: string | null = null
  let bestDistance = cap + 1
  for (const candidate of candidates) {
    const distance = editDistance(word.toLowerCase(), candidate.toLowerCase(), cap)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

/** `Did you mean <closest>?` for the closest candidate (see `closest`), or `undefined`. */
export function didYouMean(word: string, candidates: Iterable<string>, format = (s: string) => s) {
  const match = closest(word, candidates)
  return match === null ? undefined : `Did you mean ${format(match)}?`
}

/** Verbs agents use interchangeably for one action, so `slack.postMessage` finds `sendMessage`. */
const VERB_SYNONYMS: ReadonlyArray<readonly string[]> = [
  ['send', 'post', 'create', 'add', 'write', 'insert', 'publish', 'new'],
  ['get', 'read', 'fetch', 'retrieve', 'find', 'lookup'],
  ['list', 'search', 'query', 'browse'],
  ['update', 'edit', 'modify', 'patch', 'set', 'change'],
  ['delete', 'remove', 'destroy', 'archive'],
]

/** `postMessage` → `['post', 'message']`: the leading lowercase verb and the rest, lowercased. */
function splitVerb(method: string): [string, string] {
  const verb = /^[a-z]*/.exec(method)?.[0] ?? ''
  return [verb, method.slice(verb.length).toLowerCase()]
}

/**
 * Names agents reach for that the SDK spells differently and no edit distance finds: the HTTP
 * request block is `api` (`http.request(…)`, `fetch(…)`), the function block `fn`.
 */
const BUILDER_ALIASES: Readonly<Record<string, string>> = {
  http: 'api',
  https: 'api',
  fetch: 'api',
  request: 'api',
  httprequest: 'api',
  javascript: 'fn',
  code: 'fn',
}

/** How many builder paths a hint lists when nothing is close. */
const LISTED_BUILDERS = 15

/**
 * The hint for a builder path no catalog builder has, from most to least specific: the builder a
 * common other name stands for (`http.request` → `api`), a builder of the same namespace whose method differs only by a synonymous verb (`postMessage` → `sendMessage`),
 * the closest path by edit distance, the one builder of the namespace whose method starts with the
 * written one, the namespace's builders listed (those it starts first), else the closest namespace.
 */
export function suggestBuilder(written: string, paths: readonly string[]): string | undefined {
  const alias = BUILDER_ALIASES[(written.split('.')[0] ?? written).toLowerCase()]
  if (alias !== undefined && paths.includes(alias)) return `Did you mean ${alias}?`
  const dot = written.lastIndexOf('.')
  const namespace = dot === -1 ? '' : written.slice(0, dot)
  const method = dot === -1 ? written : written.slice(dot + 1)
  const siblings = paths.filter(
    (path) => path.lastIndexOf('.') === namespace.length && path.startsWith(`${namespace}.`)
  )
  if (namespace !== '' && siblings.length > 0) {
    const [verb, rest] = splitVerb(method)
    const group = VERB_SYNONYMS.find((verbs) => verbs.includes(verb))
    const synonym = group
      ? siblings.find((path) => {
          const [otherVerb, otherRest] = splitVerb(path.slice(namespace.length + 1))
          return otherVerb !== verb && group.includes(otherVerb) && otherRest === rest
        })
      : undefined
    if (synonym) return `Did you mean ${synonym}?`
  }
  const near = didYouMean(written, paths)
  if (near) return near
  if (siblings.length > 0) {
    // A method written short (`slack.send`) names the builders it starts: one is the answer, and
    // several lead the list, which would otherwise start at whatever sorts first.
    const start = method.toLowerCase()
    const started = start
      ? siblings.filter((path) =>
          path
            .slice(namespace.length + 1)
            .toLowerCase()
            .startsWith(start)
        )
      : []
    if (started.length === 1) return `Did you mean ${started[0]}?`
    const ranked = [...started, ...siblings.filter((path) => !started.includes(path))]
    const shown = ranked.slice(0, LISTED_BUILDERS).join(', ')
    const more =
      siblings.length > LISTED_BUILDERS ? `, and ${siblings.length - LISTED_BUILDERS} more` : ''
    return `${namespace} has: ${shown}${more}.`
  }
  const namespaces = [
    ...new Set(
      paths.flatMap((path) => (path.includes('.') ? [path.slice(0, path.indexOf('.'))] : []))
    ),
  ]
  const root = namespace === '' ? written : (namespace.split('.')[0] ?? namespace)
  return didYouMean(root, namespaces, (name) => `${name}.*`)
}
