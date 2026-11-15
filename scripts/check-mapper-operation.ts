#!/usr/bin/env bun
/**
 * Ratchets block mappers that read the operation from their params down to zero, file by file.
 *
 * A block's `tools.config.params` mapper runs on two paths with different inputs. On the canvas it
 * receives the block's serialized inputs, `operation` included, and no second argument. On a tool
 * call (an Agent tool row, Pi, Human-in-the-loop v2) it receives the stored tool row's params merged
 * with the model's args, and the operation arrives only as `context.operation`: a stored row keeps
 * its operation outside its params, and six tools declare their own `operation` param that the model
 * fills with a tool value (Slack `edit_canvas`'s `'insert_after'`). A mapper that branches on
 * `params.operation` therefore takes its no-operation path on every tool call: it skips the
 * coercions and field renames the tool needs, drops a file the user picked, or throws
 * `Invalid operation: undefined` and leaves the tool with unmerged raw params.
 *
 * The fix is `mapperOperation(params, context)` from `@/blocks/utils`, which reads the trusted
 * context first and falls back to the canvas input. Switching to it makes branches live on tool
 * calls that never ran there, so review each one: where a branch assigns a tool param from a
 * block-only field, keep the model's value with `dedicated ?? toolCallArg(context, params.x)`.
 *
 * Flagged, inside a mapper and in same-file helpers it hands its params to:
 * - `params.operation`, `params?.operation`, `params['operation']`, through any alias of `params`
 *   (`const p = params`, `const { a, ...rest } = params`, `const p = { ...params }`);
 * - a destructured `operation` binding that is used. Strip-only destructuring
 *   (`const { operation, ...rest } = params` with `operation` unused) is not a read.
 *
 * - A file whose count rises, or a file that gains its first read, fails.
 * - A file whose count drops fails until the baseline is rewritten, so the baseline only shrinks.
 *
 * Regenerate after fixing mappers: `bun run scripts/check-mapper-operation.ts --update`.
 *
 * Run: `bun run check:mapper-operation`
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from '@typescript/typescript6'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BLOCKS_DIR = path.join(ROOT, 'apps/sim/blocks/blocks')
const BASELINE = path.join(ROOT, 'scripts/check-mapper-operation.baseline.json')

type Fn = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | ts.MethodDeclaration

function isFn(node: ts.Node): node is Fn {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node)
  )
}

function keyName(name: ts.Node | undefined): string | undefined {
  if (!name) return undefined
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text
  return undefined
}

/** Strips `(x)`, `x as T`, `x!`, and `x satisfies T` so an aliased read is still seen. */
function unwrap(node: ts.Expression): ts.Expression {
  let current = node
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function findLocalFn(source: ts.SourceFile, name: string): Fn | undefined {
  let found: Fn | undefined
  const visit = (node: ts.Node) => {
    if (found) return
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      found = node
      return
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      const init = unwrap(node.initializer)
      if (isFn(init)) {
        found = init
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/** Identifier uses of `name` inside `scope`, excluding declarations and property-name positions. */
function referencesOf(scope: ts.Node, name: string, declaration: ts.Node): number {
  let count = 0
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === name && node !== declaration) {
      const parent = node.parent
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isBindingElement(parent) && parent.propertyName === node)
      if (!isPropertyName) count++
    }
    ts.forEachChild(node, visit)
  }
  visit(scope)
  return count
}

function enclosingFn(node: ts.Node): ts.Node {
  let current: ts.Node = node
  while (current.parent && !isFn(current)) current = current.parent
  return current
}

/** Counts destructured `operation` bindings that are used afterwards. */
function usedOperationBindings(pattern: ts.ObjectBindingPattern): number {
  let reads = 0
  for (const element of pattern.elements) {
    if (element.dotDotDotToken) continue
    const key = keyName(element.propertyName) ?? keyName(element.name)
    if (key !== 'operation') continue
    if (!ts.isIdentifier(element.name)) {
      reads++
      continue
    }
    if (referencesOf(enclosingFn(element), element.name.text, element.name) > 0) reads++
  }
  return reads
}

/** Rest bindings of a destructuring are aliases of the object they were taken from. */
function restAlias(pattern: ts.ObjectBindingPattern): string | undefined {
  const rest = pattern.elements.find((element) => element.dotDotDotToken)
  return rest && ts.isIdentifier(rest.name) ? rest.name.text : undefined
}

function operationReads(source: ts.SourceFile, fn: Fn, seen: Set<Fn>): number {
  if (seen.has(fn)) return 0
  seen.add(fn)
  const first = fn.parameters[0]
  if (!first) return 0
  if (ts.isObjectBindingPattern(first.name)) return usedOperationBindings(first.name)
  if (!ts.isIdentifier(first.name) || !fn.body) return 0

  const aliases = new Set([first.name.text])
  let reads = 0
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = unwrap(node.initializer)
      const fromAlias = ts.isIdentifier(init) && aliases.has(init.text)
      const spreadsAlias =
        ts.isObjectLiteralExpression(init) &&
        init.properties.some((property) => {
          if (!ts.isSpreadAssignment(property)) return false
          const spread = unwrap(property.expression)
          return ts.isIdentifier(spread) && aliases.has(spread.text)
        })
      if (fromAlias && ts.isObjectBindingPattern(node.name)) {
        reads += usedOperationBindings(node.name)
        const rest = restAlias(node.name)
        if (rest) aliases.add(rest)
      } else if ((fromAlias || spreadsAlias) && ts.isIdentifier(node.name)) {
        aliases.add(node.name.text)
      }
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'operation') {
      const target = unwrap(node.expression)
      if (ts.isIdentifier(target) && aliases.has(target.text)) reads++
    }
    if (ts.isElementAccessExpression(node)) {
      const target = unwrap(node.expression)
      const argument = node.argumentExpression
      if (
        ts.isIdentifier(target) &&
        aliases.has(target.text) &&
        ts.isStringLiteralLike(argument) &&
        argument.text === 'operation'
      ) {
        reads++
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const passesParams = node.arguments.some((argument) => {
        const value = unwrap(argument)
        return ts.isIdentifier(value) && aliases.has(value.text)
      })
      const helper = passesParams ? findLocalFn(source, node.expression.text) : undefined
      if (helper) reads += operationReads(source, helper, seen)
    }
    ts.forEachChild(node, visit)
  }
  visit(fn.body)
  return reads
}

/** Counts operation reads across every `tools.config.params` mapper in one block file. */
export function countMapperOperationReads(fileName: string, text: string): number {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true)
  let reads = 0
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      keyName(node.name) === 'config' &&
      ts.isObjectLiteralExpression(node.initializer) &&
      ts.isPropertyAssignment(node.parent.parent) &&
      keyName(node.parent.parent.name) === 'tools'
    ) {
      for (const property of node.initializer.properties) {
        if (keyName(property.name) !== 'params') continue
        let mapper: Fn | undefined
        if (ts.isMethodDeclaration(property)) mapper = property
        else if (ts.isPropertyAssignment(property)) {
          const init = unwrap(property.initializer)
          mapper = isFn(init)
            ? init
            : ts.isIdentifier(init)
              ? findLocalFn(source, init.text)
              : undefined
        } else if (ts.isShorthandPropertyAssignment(property)) {
          mapper = findLocalFn(source, property.name.text)
        }
        if (mapper) reads += operationReads(source, mapper, new Set())
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return reads
}

function collect(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const entry of readdirSync(BLOCKS_DIR).sort()) {
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue
    const file = path.join(BLOCKS_DIR, entry)
    const reads = countMapperOperationReads(entry, readFileSync(file, 'utf8'))
    if (reads > 0) counts[path.relative(ROOT, file)] = reads
  }
  return counts
}

if (import.meta.main) {
  const current = collect()
  if (process.argv.includes('--update')) {
    writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`)
    const total = Object.values(current).reduce((sum, count) => sum + count, 0)
    console.log(`Wrote ${Object.keys(current).length} files (${total} reads) to ${BASELINE}`)
    process.exit(0)
  }

  const baseline: Record<string, number> = existsSync(BASELINE)
    ? JSON.parse(readFileSync(BASELINE, 'utf8'))
    : {}
  const rose: string[] = []
  const dropped: string[] = []
  for (const file of new Set([...Object.keys(baseline), ...Object.keys(current)])) {
    const was = baseline[file] ?? 0
    const now = current[file] ?? 0
    if (now > was) rose.push(`  ${file}: ${was} → ${now}`)
    else if (now < was) dropped.push(`  ${file}: ${was} → ${now}`)
  }

  if (rose.length) {
    console.error(
      '✗ Block mappers read the operation from params, which is undefined on tool calls:'
    )
    for (const line of rose) console.error(line)
    console.error(
      'Read it with `mapperOperation(params, context)` from `@/blocks/utils` (declare the mapper as ' +
        '`(params, context?: BlockToolParamsContext)`), and keep model args in branches that become live ' +
        'with `dedicated ?? toolCallArg(context, params.x)`.'
    )
  }
  if (dropped.length) {
    console.error('✗ Mapper operation reads dropped; shrink the baseline:')
    for (const line of dropped) console.error(line)
    console.error('Run: bun run scripts/check-mapper-operation.ts --update')
  }
  if (rose.length || dropped.length) process.exit(1)

  const total = Object.values(current).reduce((sum, count) => sum + count, 0)
  console.log(
    `✓ Mapper operation reads match the baseline (${total} in ${Object.keys(current).length} files)`
  )
}
