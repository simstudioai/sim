import path from 'node:path'
import ts from '@typescript/typescript6'

type Props = Record<string, string[]>
type Component = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression
interface Usage {
  variants: Set<string>
  recipes: Set<string>
}

/**
 * Trace JSX from product route entries through components and local render helpers.
 * Preview modules cannot establish usage. Unresolved dynamic values need a mapping at the owner.
 */
export function productUsage(app: string, program: ts.Program): Usage {
  const checker = program.getTypeChecker()
  const usage: Usage = { variants: new Set(), recipes: new Set() }
  const seen = new WeakMap<ts.Node, Set<string>>()
  const preview = path.join(app, 'platform/preview/')
  const system = path.join(app, 'platform/design-system/')
  const appDir = path.join(app, 'platform/app')
  const workbench = path.join(appDir, 'workbench/')
  function declaration(node: ts.Node) {
    let symbol = checker.getSymbolAtLocation(node)
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
    return symbol?.valueDeclaration
  }
  function component(decl: ts.Node | undefined): Component | undefined {
    if (!decl) return
    if (ts.isFunctionDeclaration(decl) || ts.isArrowFunction(decl) || ts.isFunctionExpression(decl))
      return decl
    if (ts.isVariableDeclaration(decl) && decl.initializer) {
      const inner =
        ts.isCallExpression(decl.initializer) &&
        /^(?:React\.)?memo$/.test(decl.initializer.expression.getText())
          ? decl.initializer.arguments[0]
          : decl.initializer
      if (inner && (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner))) return inner
    }
  }
  function literalCondition(node: ts.Expression) {
    const type = checker.getTypeAtLocation(node)
    return type.flags & ts.TypeFlags.BooleanLiteral
      ? checker.typeToString(type) === 'true'
      : undefined
  }
  function values(
    node: ts.Expression | undefined,
    props: Props,
    visited = new Set<ts.Node>()
  ): string[] {
    if (!node || visited.has(node)) return []
    visited.add(node)
    if (ts.isStringLiteralLike(node)) return [node.text]
    if (ts.isJsxExpression(node)) return values(node.expression, props, visited)
    if (
      ts.isAsExpression(node) ||
      ts.isParenthesizedExpression(node) ||
      ts.isSatisfiesExpression(node)
    )
      return values(node.expression, props, visited)
    if (ts.isConditionalExpression(node)) {
      const test = literalCondition(node.condition)
      return [
        ...(test === false ? [] : values(node.whenTrue, props, visited)),
        ...(test === true ? [] : values(node.whenFalse, props, visited)),
      ]
    }
    if (ts.isPropertyAccessExpression(node)) return props[node.name.text] ?? []
    if (ts.isIdentifier(node)) {
      if (props[node.text]) return props[node.text]
      const decl = declaration(node)
      if (decl && ts.isVariableDeclaration(decl)) return values(decl.initializer, props, visited)
    }
    return []
  }
  function bindObject(pattern: ts.ObjectBindingPattern, fields: Props, scope: Props) {
    for (const item of pattern.elements) {
      const key = (item.propertyName ?? item.name).getText()
      scope[item.name.getText()] = fields[key] ?? values(item.initializer, scope)
    }
  }
  function walkComponent(fn: Component, props: Props) {
    const scope = { ...props }
    const param = fn.parameters[0]?.name
    if (param && ts.isObjectBindingPattern(param)) bindObject(param, props, scope)
    walk(fn, scope)
  }
  function walkHelper(helper: Component, call: ts.CallExpression, caller: Props) {
    const scope: Props = ts.findAncestor(helper.parent, ts.isFunctionLike) ? { ...caller } : {}
    for (const [i, parameter] of helper.parameters.entries()) {
      const arg = call.arguments[i]
      const supplied =
        arg &&
        !(checker.getTypeAtLocation(arg).flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void))
      const source = supplied ? arg : parameter.initializer
      const environment = supplied ? caller : scope
      if (ts.isIdentifier(parameter.name)) {
        scope[parameter.name.text] = values(source, environment)
      } else if (ts.isObjectBindingPattern(parameter.name)) {
        const fields: Props = {}
        if (source && ts.isObjectLiteralExpression(source)) {
          for (const prop of source.properties) {
            if (ts.isPropertyAssignment(prop))
              fields[prop.name.getText()] = values(prop.initializer, environment)
            if (ts.isShorthandPropertyAssignment(prop))
              fields[prop.name.text] = values(prop.name, environment)
          }
          bindObject(parameter.name, fields, scope)
        } else {
          for (const item of parameter.name.elements) scope[item.name.getText()] = []
        }
      }
    }
    walk(helper, scope)
  }
  function walk(fn: Component, scope: Props) {
    const file = fn.getSourceFile().fileName
    if (!fn.body || file.startsWith(preview) || file.startsWith(workbench)) return
    const history = seen.get(fn) ?? new Set<string>()
    const signature = JSON.stringify(scope)
    if (history.has(signature)) return
    history.add(signature)
    seen.set(fn, history)
    const visitedValues = new Set<ts.VariableDeclaration>()
    function visit(node: ts.Node) {
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isVariableDeclaration(node) ||
        ts.isExpressionStatement(node) ||
        ts.isVoidExpression(node)
      )
        return
      if (ts.isConditionalExpression(node) || ts.isIfStatement(node)) {
        const [condition, yes, no] = ts.isConditionalExpression(node)
          ? ([node.condition, node.whenTrue, node.whenFalse] as const)
          : ([node.expression, node.thenStatement, node.elseStatement] as const)
        const test = literalCondition(condition)
        visit(condition)
        if (test !== false) visit(yes)
        if (test !== true && no) visit(no)
        return
      }
      if (
        ts.isBinaryExpression(node) &&
        [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(
          node.operatorToken.kind
        )
      ) {
        visit(node.left)
        const left = literalCondition(node.left)
        const evaluatesRight =
          node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
            ? left !== false
            : left !== true
        if (evaluatesRight) visit(node.right)
        return
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const helper = component(declaration(node.expression))
        if (helper && helper.getSourceFile() === fn.getSourceFile()) walkHelper(helper, node, scope)
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const decl = declaration(node.tagName)
        const owner = decl && component(decl)
        if (decl && owner) {
          const attrs: Props = {}
          for (const item of node.attributes.properties) {
            if (ts.isJsxAttribute(item))
              attrs[item.name.getText()] = values(item.initializer, scope)
          }
          if (
            decl.getSourceFile().fileName.startsWith(system) ||
            decl.getSourceFile().fileName.includes('/_components/')
          ) {
            const name =
              ts.isVariableDeclaration(decl) || ts.isFunctionDeclaration(decl)
                ? decl.name?.getText()
                : undefined
            if (name === 'ComponentRecipe') {
              for (const key of attrs.recipe ?? []) usage.recipes.add(key)
            }
            const param = owner.parameters[0]?.name
            if (param && ts.isObjectBindingPattern(param)) {
              for (const item of param.elements) {
                const prop = (item.propertyName ?? item.name).getText()
                for (const value of attrs[prop] ?? values(item.initializer, {}))
                  usage.variants.add(`${name}.${prop}=${value}`)
              }
            }
          }
          walkComponent(owner, attrs)
        }
      } else if (
        ts.isIdentifier(node) &&
        node.parent &&
        !ts.isJsxOpeningElement(node.parent) &&
        !ts.isJsxSelfClosingElement(node.parent)
      ) {
        const decl = declaration(node)
        if (
          decl &&
          ts.isVariableDeclaration(decl) &&
          decl.initializer &&
          !component(decl) &&
          decl.getSourceFile().fileName.startsWith(path.join(app, 'platform/')) &&
          !visitedValues.has(decl)
        ) {
          visitedValues.add(decl)
          visit(decl.initializer)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(fn.body)
  }
  function entry(sf: ts.SourceFile) {
    const module = checker.getSymbolAtLocation(sf)
    const symbol =
      module && checker.getExportsOfModule(module).find((item) => item.name === 'default')
    if (!symbol) return
    const decl = (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol)
      .valueDeclaration
    if (decl && ts.isExportAssignment(decl))
      return component(decl.expression) ?? component(declaration(decl.expression))
    return component(decl)
  }
  function walkEntry(file: string) {
    const sf = program.getSourceFile(file)
    const root = sf && entry(sf)
    if (root) walkComponent(root, {})
  }
  const segments = new Set<string>()
  for (const file of program.getRootFileNames()) {
    if (
      path.basename(file) !== 'page.tsx' ||
      !file.startsWith(appDir + path.sep) ||
      file.startsWith(workbench) ||
      path
        .relative(appDir, file)
        .split(path.sep)
        .some((segment) => segment.startsWith('_'))
    )
      continue
    walkEntry(file)
    for (let dir = path.dirname(file); !segments.has(dir); dir = path.dirname(dir)) {
      segments.add(dir)
      for (const boundary of ['layout', 'template', 'error', 'loading', 'not-found']) {
        walkEntry(path.join(dir, `${boundary}.tsx`))
      }
      if (dir === appDir) {
        walkEntry(path.join(appDir, 'global-error.tsx'))
        break
      }
    }
  }
  return usage
}
