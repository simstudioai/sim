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
 * Regenerate after fixing mappers: `bun run scripts/check-mapper-operation.ts --update` (it refuses to
 * raise any file's count).
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

/** Names a binding pattern or identifier declares. */
function boundNames(name: ts.BindingName, into: Set<string> = new Set()): Set<string> {
  if (ts.isIdentifier(name)) into.add(name.text)
  else
    for (const element of name.elements)
      if (!ts.isOmittedExpression(element)) boundNames(element.name, into)
  return into
}

/** Names a nested function's own parameters declare, which shadow the outer ones in its body. */
function shadowedBy(node: ts.Node): Set<string> {
  const names = new Set<string>()
  if (isFn(node)) for (const parameter of node.parameters) boundNames(parameter.name, names)
  return names
}

/** Identifier uses of `name` inside `scope`, excluding declarations, property names, and shadowed scopes. */
function referencesOf(scope: ts.Node, name: string, declaration: ts.Node): number {
  let count = 0
  const visit = (node: ts.Node) => {
    if (node !== scope && shadowedBy(node).has(name)) return
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

/**
 * Whether `fn` returns its parameter `index` itself, a local copy of it, or an object literal spreading
 * either, so the
 * caller's result still carries the input's `operation`.
 */
function returnsInput(fn: Fn, index: number): boolean {
  const parameter = fn.parameters[index]
  if (!parameter || !ts.isIdentifier(parameter.name) || !fn.body) return false
  const names = new Set([parameter.name.text])
  const carries = (expression: ts.Expression): boolean => {
    const value = unwrap(expression)
    if (ts.isIdentifier(value)) return names.has(value.text)
    return (
      ts.isObjectLiteralExpression(value) &&
      value.properties.some(
        (property) => ts.isSpreadAssignment(property) && carries(property.expression)
      )
    )
  }
  if (!ts.isBlock(fn.body)) return carries(fn.body)
  let found = false
  const visit = (node: ts.Node) => {
    if (found || (node !== fn.body && isFn(node))) return
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      carries(node.initializer)
    ) {
      names.add(node.name.text)
    }
    if (ts.isReturnStatement(node) && node.expression && carries(node.expression)) found = true
    ts.forEachChild(node, visit)
  }
  visit(fn.body)
  return found
}

/**
 * Counts operation reads from parameter `index` of `fn`: through aliases of it, and through
 * same-file helpers it is handed to (at whichever argument position), whose returned value is
 * treated as an alias too. Names a nested function rebinds are not aliases inside it.
 */
function operationReads(source: ts.SourceFile, fn: Fn, index: number, seen: Set<string>): number {
  const key = `${fn.pos}:${index}`
  if (seen.has(key)) return 0
  seen.add(key)
  const parameter = fn.parameters[index]
  if (!parameter || !fn.body) return 0

  let reads = 0
  const initial = new Set<string>()
  if (ts.isIdentifier(parameter.name)) initial.add(parameter.name.text)
  else if (ts.isObjectBindingPattern(parameter.name)) {
    reads += usedOperationBindings(parameter.name)
    const rest = restAlias(parameter.name)
    if (rest) initial.add(rest)
  }
  if (initial.size === 0) return reads

  const isAlias = (expression: ts.Expression, aliases: Set<string>) => {
    const value = unwrap(expression)
    return ts.isIdentifier(value) && aliases.has(value.text)
  }

  /**
   * Counts reads inside a same-file helper at each argument position that receives an alias.
   * Returns whether the helper hands one of those inputs back (see {@link returnsInput}), which
   * makes its result an alias too.
   */
  const helperCall = (node: ts.Expression, aliases: Set<string>): boolean => {
    const call = unwrap(node)
    if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) return false
    const helper = findLocalFn(source, call.expression.text)
    if (!helper) return false
    let carriesInput = false
    call.arguments.forEach((argument, position) => {
      if (!isAlias(argument, aliases)) return
      reads += operationReads(source, helper, position, seen)
      if (returnsInput(helper, position)) carriesInput = true
    })
    return carriesInput
  }

  const visit = (node: ts.Node, inherited: Set<string>) => {
    let aliases = inherited
    if (node !== fn) {
      const shadowed = shadowedBy(node)
      if (shadowed.size) aliases = new Set([...inherited].filter((name) => !shadowed.has(name)))
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = unwrap(node.initializer)
      const fromAlias = isAlias(init, aliases)
      const spreadsAlias =
        ts.isObjectLiteralExpression(init) &&
        init.properties.some(
          (property) => ts.isSpreadAssignment(property) && isAlias(property.expression, aliases)
        )
      const fromHelper = helperCall(init, aliases)
      if ((fromAlias || spreadsAlias || fromHelper) && ts.isObjectBindingPattern(node.name)) {
        reads += usedOperationBindings(node.name)
        const rest = restAlias(node.name)
        if (rest) inherited.add(rest)
      } else if ((fromAlias || spreadsAlias || fromHelper) && ts.isIdentifier(node.name)) {
        inherited.add(node.name.text)
      }
      if (
        ts.isCallExpression(init) &&
        ts.isIdentifier(init.expression) &&
        findLocalFn(source, init.expression.text)
      ) {
        for (const argument of init.arguments) visit(argument, aliases)
        return
      }
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'operation') {
      if (isAlias(node.expression, aliases)) reads++
    }
    if (ts.isElementAccessExpression(node)) {
      const argument = node.argumentExpression
      if (
        isAlias(node.expression, aliases) &&
        ts.isStringLiteralLike(argument) &&
        argument.text === 'operation'
      ) {
        reads++
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (findLocalFn(source, node.expression.text)) {
        helperCall(node, aliases)
        for (const argument of node.arguments) visit(argument, aliases)
        return
      }
    }
    ts.forEachChild(node, (child) => visit(child, aliases))
  }
  visit(fn.body, initial)
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
        if (mapper) reads += operationReads(source, mapper, 0, new Set())
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
  const init = process.argv.includes('--init')
  if (!existsSync(BASELINE) && !init) {
    console.error(
      `✗ ${path.relative(ROOT, BASELINE)} is missing. Restore it from git; create one only with --update --init.`
    )
    process.exit(1)
  }
  const baseline: Record<string, number> = existsSync(BASELINE)
    ? JSON.parse(readFileSync(BASELINE, 'utf8'))
    : current

  if (process.argv.includes('--update')) {
    const raised = Object.entries(current).filter(([file, count]) => count > (baseline[file] ?? 0))
    if (raised.length) {
      console.error(
        `✗ Refused to raise the baseline for ${raised.length} file(s); fix them instead:`
      )
      for (const [file, count] of raised)
        console.error(`  ${file}: ${count} (baseline ${baseline[file] ?? 0})`)
      process.exit(1)
    }
    writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`)
    const total = Object.values(current).reduce((sum, count) => sum + count, 0)
    console.log(`Wrote ${Object.keys(current).length} files (${total} reads) to ${BASELINE}`)
    process.exit(0)
  }

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
