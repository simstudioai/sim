/**
 * Doc builders for the few expression shapes printed workflow files contain, each laid out the
 * way Biome lays it out: objects and arrays with es5 trailing commas, call arguments with
 * last-argument hugging, and object properties that break after the colon only where Biome does.
 */

import {
  breakParent,
  conditionalGroup,
  type Doc,
  fill,
  group,
  hardline,
  ifBreak,
  indent,
  join,
  line,
  softline,
  stringWidth,
  willBreak,
} from './doc'

/** The syntactic shape of a printed expression, which drives Biome's layout choices. */
type ExprShape =
  | 'string'
  | 'template'
  | 'number'
  | 'literal'
  | 'identifier'
  | 'member'
  | 'object'
  | 'array'
  | 'call'
  | 'arrow'

export interface Expr {
  doc: Doc
  shape: ExprShape
  /** True for a non-empty object or array literal (Biome's `couldExpandArg`). */
  expandable?: boolean
  /** True for a number literal, or `-` applied to one. */
  numeric?: boolean
  /** Property or element count of an object or array literal. */
  size?: number
  /** A number-only array, which Biome fills like text instead of one element per line. */
  concise?: boolean
}

export interface Property {
  key: string
  value: Expr
  leading?: Doc[]
  trailing?: Doc[]
}

/** Keys narrower than this never break after the colon (Biome's short-key rule: width < tab + 3). */
const SHORT_KEY_WIDTH = 5

function printProperty(property: Property): Doc {
  const { key, value } = property
  const breakAfterColon =
    stringWidth(key) >= SHORT_KEY_WIDTH && (value.shape === 'string' || value.shape === 'member')
  const body: Doc = breakAfterColon
    ? group([key, ':', group(indent([line, value.doc]))])
    : group([key, ': ', value.doc])
  const leading = property.leading ?? []
  return [...leading.map((comment) => [comment, hardline]), body]
}

export function objectExpr(properties: Property[]): Expr {
  if (properties.length === 0) return { doc: '{}', shape: 'object' }
  const parts: Doc[] = []
  properties.forEach((property, index) => {
    const isLast = index === properties.length - 1
    const trailing = property.trailing ?? []
    parts.push(printProperty(property))
    if (!isLast) parts.push(',')
    else parts.push(ifBreak(','))
    parts.push(trailing)
    if (!isLast) parts.push(line)
  })
  return {
    doc: group(['{', indent([line, parts]), line, '}']),
    shape: 'object',
    expandable: true,
    size: properties.length,
  }
}

export function arrayExpr(elements: Expr[]): Expr {
  if (elements.length === 0) return { doc: '[]', shape: 'array' }
  const concise = elements.length > 1 && elements.every((element) => element.numeric === true)
  if (concise) {
    const parts: Doc[] = []
    elements.forEach((element, index) => {
      if (index > 0) parts.push([',', line])
      parts.push(element.doc)
    })
    return {
      doc: group(['[', indent([softline, fill(parts)]), ifBreak(','), softline, ']']),
      shape: 'array',
      expandable: true,
      size: elements.length,
      concise: true,
    }
  }
  const shouldBreak =
    elements.length > 1 &&
    elements.every(
      (element) =>
        (element.shape === 'object' || element.shape === 'array') &&
        element.shape === elements[0]?.shape &&
        (element.size ?? 0) > 1
    )
  return {
    doc: group(
      [
        '[',
        indent([
          softline,
          join(
            [',', line],
            elements.map((element) => element.doc)
          ),
        ]),
        ifBreak(','),
        softline,
        ']',
      ],
      { shouldBreak }
    ),
    shape: 'array',
    expandable: true,
    size: elements.length,
  }
}

/** Call arguments with Biome's last-argument hugging (`fn('Name', {` … `})`). */
function callArgs(args: Expr[]): Doc {
  if (args.length === 0) return '()'
  const docs = args.map((arg) => arg.doc)
  const separated: Doc[] = []
  docs.forEach((doc, index) => {
    if (index > 0) separated.push([',', line])
    separated.push(doc)
  })
  const allBroken = group(['(', indent([line, separated]), line, ')'], { shouldBreak: true })
  const last = args.at(-1)
  const penultimate = args.at(-2)
  const shouldGroupLast =
    last !== undefined &&
    (last.expandable === true || last.shape === 'arrow') &&
    (penultimate === undefined || penultimate.shape !== last.shape) &&
    !(args.length === 2 && penultimate?.shape === 'arrow' && last.shape === 'array') &&
    !(args.length > 1 && last.concise === true)
  if (!shouldGroupLast || last === undefined) {
    return group(['(', indent([softline, separated]), softline, ')'])
  }
  const leading = docs.slice(0, -1)
  if (leading.some(willBreak)) return allBroken
  const leadingSeparated: Doc[] = leading.map((doc) => [doc, ',', line])
  return [
    docs.some(willBreak) ? breakParent : '',
    conditionalGroup([
      ['(', separated, ')'],
      ['(', leadingSeparated, group(last.doc, { shouldBreak: true }), ')'],
      allBroken,
    ]),
  ]
}

export function callExpr(callee: string, args: Expr[]): Expr {
  return { doc: [callee, callArgs(args)], shape: 'call' }
}

/** `(params) => { statements }`, with an empty body printed `{}`. */
export function arrowExpr(params: string, statements: Doc[]): Expr {
  const body: Doc =
    statements.length === 0
      ? '{}'
      : ['{', indent([hardline, join(hardline, statements)]), hardline, '}']
  return { doc: [`(${params}) => `, body], shape: 'arrow' }
}
