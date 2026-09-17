import ts from '@typescript/typescript6'

function unwrap(expression: ts.Expression): ts.Expression {
  while (
    ts.isSatisfiesExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isParenthesizedExpression(expression)
  ) {
    expression = expression.expression
  }
  return expression
}

function property(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  const member = object.properties.find(
    (member) =>
      ts.isPropertyAssignment(member) &&
      (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) &&
      member.name.text === name
  )
  return member && ts.isPropertyAssignment(member) ? member.initializer : undefined
}

/** Extracts inline subblock IDs from their owning declaration, including satisfies-style blocks. */
export function extractInlineBlockSubBlockIds(source: string): Record<string, string[]> {
  const file = ts.createSourceFile('block.ts', source, ts.ScriptTarget.Latest, true)
  const blocks: Record<string, string[]> = {}
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!declaration.initializer) continue
      const object = unwrap(declaration.initializer)
      if (!ts.isObjectLiteralExpression(object)) continue
      const type = property(object, 'type')
      const subBlocks = property(object, 'subBlocks')
      if (
        !type ||
        !ts.isStringLiteral(type) ||
        !subBlocks ||
        !ts.isArrayLiteralExpression(subBlocks)
      )
        continue
      blocks[type.text] = subBlocks.elements.flatMap((element) => {
        if (!ts.isObjectLiteralExpression(element)) return []
        const id = property(element, 'id')
        return id && ts.isStringLiteral(id) ? [id.text] : []
      })
    }
  }
  return blocks
}
