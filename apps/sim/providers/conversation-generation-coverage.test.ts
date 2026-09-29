import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from '@typescript/typescript6'
import { describe, expect, it } from 'vitest'

function providerSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) return entry.name.startsWith('__') ? [] : providerSources(file)
    return entry.isFile() && file.endsWith('.ts') && !file.endsWith('.test.ts') ? [file] : []
  })
}

function insideNamedAncestor(node: ts.Node, name: string): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent) && parent.name?.text === name) return true
    if (ts.isPropertyAssignment(parent) && parent.name.getText() === name) return true
    if (ts.isVariableDeclaration(parent) && parent.name.getText() === name) return true
  }
  return false
}

function preparedPayload(node: ts.Node): boolean {
  if (ts.isIdentifier(node)) return preparedBinding(node)
  return (
    ts.isAwaitExpression(node) &&
    ts.isCallExpression(node.expression) &&
    node.expression.expression.getText() === 'prepareConversationGeneration'
  )
}

/**
 * Whether the nearest declaration of `identifier` is a `const` bound to a prepared payload.
 * Retried sends prepare once and replay the binding, since preparing can itself call a model
 * to compact history. The nearest declaration decides, so an inner shadow must be prepared too.
 */
function preparedBinding(identifier: ts.Identifier): boolean {
  const declares = (name: ts.BindingName): boolean =>
    ts.isIdentifier(name)
      ? name.text === identifier.text
      : name.elements.some((element) => !ts.isOmittedExpression(element) && declares(element.name))
  for (let scope = identifier.parent; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope) && scope.parameters.some((parameter) => declares(parameter.name)))
      return false
    if (
      ts.isCatchClause(scope) &&
      scope.variableDeclaration &&
      declares(scope.variableDeclaration.name)
    )
      return false
    if (
      (ts.isForStatement(scope) || ts.isForInStatement(scope) || ts.isForOfStatement(scope)) &&
      scope.initializer &&
      ts.isVariableDeclarationList(scope.initializer) &&
      scope.initializer.declarations.some((declaration) => declares(declaration.name))
    )
      return false
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement)) continue
      const declaration = statement.declarationList.declarations.find((d) => declares(d.name))
      if (!declaration) continue
      return (
        Boolean(statement.declarationList.flags & ts.NodeFlags.Const) &&
        declaration.initializer !== undefined &&
        preparedPayload(declaration.initializer)
      )
    }
  }
  return false
}

describe('provider generation context coverage', () => {
  it('guards every model SDK send, shared stream callback, retry and finalizer', () => {
    const uncovered: string[] = []
    let guarded = 0
    for (const file of providerSources(path.join(process.cwd(), 'providers'))) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true
      )
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
          const callee = node.expression.getText(source)
          let argument: number | undefined
          if (/\.chat\.completions\.create$/.test(callee)) {
            /** Provider callbacks receive the already-prepared shared streaming-loop payload. */
            if (!insideNamedAncestor(node, 'createStream')) argument = 0
          } else if (/\.models\.generateContent(Stream)?$/.test(callee)) {
            argument = 0
          } else if (/^Converse(Stream)?Command$/.test(callee)) {
            argument = 0
          } else if (/anthropic\.messages\.(create|stream)$/.test(callee)) {
            /** Both Anthropic helper branches receive a prepared payload at every call site. */
            if (!insideNamedAncestor(node, 'createMessage')) argument = 0
          } else if (callee === 'createMessage' && file.endsWith('/anthropic/core.ts')) {
            argument = 1
          } else if (
            callee === 'createStream' &&
            file.endsWith('/openai-compat/streaming-tool-loop.ts')
          ) {
            argument = 0
          } else if (callee === 'JSON.stringify' && insideNamedAncestor(node, 'post')) {
            argument = 0
          }
          if (argument !== undefined) {
            const payload = node.arguments?.[argument]
            if (payload && preparedPayload(payload)) guarded++
            else {
              const position = source.getLineAndCharacterOfPosition(node.getStart(source))
              uncovered.push(`${path.relative(process.cwd(), file)}:${position.line + 1} ${callee}`)
            }
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
    expect(uncovered).toEqual([])
    /** Guard discovery must be nonempty; consolidation can reduce the number of SDK sends. */
    expect(guarded).toBeGreaterThan(0)
  })
})
