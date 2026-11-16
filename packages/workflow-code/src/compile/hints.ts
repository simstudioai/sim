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

function levenshtein(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
      rowMin = Math.min(rowMin, current[j])
    }
    if (rowMin > cap) return cap + 1
    previous = current
  }
  return previous[b.length]
}

/**
 * The closest candidate within a third of the word's length (at least 1, at most 3 edits), or
 * `null`. Ties keep the first candidate, so callers pass candidates in a stable order.
 */
function closest(word: string, candidates: Iterable<string>): string | null {
  const cap = Math.min(3, Math.max(1, Math.floor(word.length / 3)))
  let best: string | null = null
  let bestDistance = cap + 1
  for (const candidate of candidates) {
    const distance = levenshtein(word.toLowerCase(), candidate.toLowerCase(), cap)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

export function didYouMean(word: string, candidates: Iterable<string>, format = (s: string) => s) {
  const match = closest(word, candidates)
  return match === null ? undefined : `Did you mean ${format(match)}?`
}
