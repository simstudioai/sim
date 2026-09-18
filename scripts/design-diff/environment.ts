import * as t from '@babel/types'
import { fingerprint, parseSource, propertyName } from '#design-diff/ast'

interface EnvironmentFields {
  fields: Map<string, string>
  options: string
}

/** Extract the literal createEnv schema convention without running validators or configuration. */
export function environmentFields(source: string, file: string): Map<string, EnvironmentFields> {
  const ast = parseSource(source, file)
  const factories = new Set<string>()
  for (const node of ast.program.body)
    if (t.isImportDeclaration(node) && /^@t3-oss\/env-/.test(node.source.value))
      for (const specifier of node.specifiers)
        if (t.isImportSpecifier(specifier) && propertyName(specifier.imported) === 'createEnv')
          factories.add(specifier.local.name)
  const result = new Map<string, EnvironmentFields>()
  for (const statement of ast.program.body) {
    const node = t.isExportNamedDeclaration(statement) ? statement.declaration : statement
    if (!t.isVariableDeclaration(node)) continue
    for (const declaration of node.declarations) {
      const call = declaration.init
      if (
        !t.isIdentifier(declaration.id) ||
        !t.isCallExpression(call) ||
        !t.isIdentifier(call.callee) ||
        !factories.has(call.callee.name) ||
        call.arguments.length !== 1 ||
        !t.isObjectExpression(call.arguments[0])
      )
        continue
      const fields = new Map<string, string[]>()
      const options: t.Node[] = []
      let supported = true
      for (const section of call.arguments[0].properties) {
        if (!t.isObjectProperty(section) || section.computed) {
          supported = false
          break
        }
        const name = propertyName(section.key)
        if (
          !['server', 'client', 'shared', 'runtimeEnv', 'experimental__runtimeEnv'].includes(name)
        ) {
          options.push(section)
          continue
        }
        if (!t.isObjectExpression(section.value)) {
          supported = false
          break
        }
        for (const property of section.value.properties) {
          if (!t.isObjectProperty(property) || property.computed) {
            supported = false
            break
          }
          const key = propertyName(property.key)
          fields.set(key, [...(fields.get(key) ?? []), fingerprint([name, property.value])])
        }
      }
      if (supported)
        result.set(declaration.id.name, {
          fields: new Map([...fields].map(([key, values]) => [key, fingerprint(values)])),
          options: fingerprint(options),
        })
    }
  }
  return result
}
