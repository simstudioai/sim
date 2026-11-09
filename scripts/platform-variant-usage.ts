import path from 'node:path'
import ts from '@typescript/typescript6'
import { PRODUCT_ROUTES } from './platform-product-routes'

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
  const systems = ['emcn', 'emcn-platform'].map(
    (name) => path.resolve(app, '../../packages', name, 'src') + path.sep
  )
  const zoneRoutes = path.join(app, 'platform/app')
  const productRoutes = path.resolve(app, PRODUCT_ROUTES)
  const workbench = path.join(zoneRoutes, 'workbench/')
  /** `platform/embedded` has no pages; these routes mount its views. */
  const organizationRoutes = path.join(app, 'app/o')
  function declaration(node: ts.Node) {
    let symbol = checker.getSymbolAtLocation(node)
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
    return symbol?.valueDeclaration
  }
  /** The component behind `dynamic(() => import('x'))` or `dynamic(() => import('x').then((module) => module.Name))`. */
  function dynamicComponent(init: ts.Expression): Component | undefined {
    if (!ts.isCallExpression(init) || init.expression.getText() !== 'dynamic') return
    const load = init.arguments[0]
    if (!load || !ts.isArrowFunction(load) || !ts.isCallExpression(load.body)) return
    const then = load.body
    if (then.expression.kind === ts.SyntaxKind.ImportKeyword && then.arguments[0]) {
      const sourceFile = checker
        .getSymbolAtLocation(then.arguments[0])
        ?.declarations?.find(ts.isSourceFile)
      return sourceFile && entry(sourceFile)
    }
    if (!ts.isPropertyAccessExpression(then.expression) || then.expression.name.text !== 'then')
      return
    const imported = then.expression.expression
    const pick = then.arguments[0]
    if (
      !ts.isCallExpression(imported) ||
      imported.expression.kind !== ts.SyntaxKind.ImportKeyword ||
      !imported.arguments[0] ||
      !pick ||
      !ts.isArrowFunction(pick) ||
      !ts.isPropertyAccessExpression(pick.body)
    )
      return
    const target = checker.getSymbolAtLocation(imported.arguments[0])
    if (!target) return
    const name = pick.body.name.text
    const member = checker.getExportsOfModule(target).find((item) => item.getName() === name)
    return component(member?.declarations?.[0])
  }
  /** Each component a `const Section = TABLE[key]` may render, for a table of `dynamic()` loaders. */
  function dynamicRegistry(decl: ts.Node | undefined): Component[] {
    if (
      !decl ||
      !ts.isVariableDeclaration(decl) ||
      !decl.initializer ||
      !ts.isElementAccessExpression(decl.initializer)
    )
      return []
    const table = declaration(decl.initializer.expression)
    if (
      !table ||
      !ts.isVariableDeclaration(table) ||
      !table.initializer ||
      !ts.isObjectLiteralExpression(table.initializer)
    )
      return []
    return table.initializer.properties.flatMap((member) => {
      if (!ts.isPropertyAssignment(member)) return []
      const loaded = dynamicComponent(member.initializer)
      return loaded ? [loaded] : []
    })
  }
  /** React Flow renders these itself, so no JSX in this app names them. */
  function flowNodeComponents(node: ts.JsxOpeningLikeElement): Component[] {
    return node.attributes.properties.flatMap((item) => {
      if (!ts.isJsxAttribute(item) || item.name.getText() !== 'nodeTypes') return []
      const value =
        item.initializer && ts.isJsxExpression(item.initializer)
          ? item.initializer.expression
          : undefined
      const table = value && declaration(value)
      if (
        !table ||
        !ts.isVariableDeclaration(table) ||
        !table.initializer ||
        !ts.isObjectLiteralExpression(table.initializer)
      )
        return []
      return table.initializer.properties.flatMap((member) => {
        if (!ts.isPropertyAssignment(member)) return []
        const found = component(declaration(member.initializer))
        return found ? [found] : []
      })
    })
  }
  function component(decl: ts.Node | undefined): Component | undefined {
    if (!decl) return
    if (ts.isFunctionDeclaration(decl) || ts.isArrowFunction(decl) || ts.isFunctionExpression(decl))
      return decl
    if (ts.isVariableDeclaration(decl) && decl.initializer) {
      const loaded = dynamicComponent(decl.initializer)
      if (loaded) return loaded
      const inner =
        ts.isCallExpression(decl.initializer) &&
        /^(?:React\.)?memo$/.test(decl.initializer.expression.getText())
          ? decl.initializer.arguments[0]
          : decl.initializer
      if (inner && (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner))) return inner
    }
  }
  /** Resolve the component actually rendered from a literal import or indexed lazy registry. */
  function lazyEntries(decl: ts.BindingElement): ts.SourceFile[] {
    const variable = decl.parent.parent
    if (
      !ts.isVariableDeclaration(variable) ||
      !variable.initializer ||
      !ts.isAwaitExpression(variable.initializer)
    )
      return []
    const call = variable.initializer.expression
    if (!ts.isCallExpression(call)) return []
    function fromImport(node: ts.Expression): ts.SourceFile[] {
      if (
        !ts.isCallExpression(node) ||
        node.expression.kind !== ts.SyntaxKind.ImportKeyword ||
        !node.arguments[0]
      )
        return []
      return (
        checker.getSymbolAtLocation(node.arguments[0])?.declarations?.filter(ts.isSourceFile) ?? []
      )
    }
    if (!ts.isPropertyAccessExpression(call.expression)) return fromImport(call)
    const slot = declaration(call.expression.expression)
    if (
      !slot ||
      !ts.isVariableDeclaration(slot) ||
      !slot.initializer ||
      !ts.isElementAccessExpression(slot.initializer)
    )
      return []
    const table = declaration(slot.initializer.expression)
    if (
      !table ||
      !ts.isVariableDeclaration(table) ||
      !table.initializer ||
      !ts.isObjectLiteralExpression(table.initializer)
    )
      return []
    const method = call.expression.name.text
    return table.initializer.properties.flatMap((member) => {
      if (!ts.isPropertyAssignment(member) || !ts.isObjectLiteralExpression(member.initializer))
        return []
      const loader = member.initializer.properties.find((item) => item.name?.getText() === method)
      return loader &&
        ts.isPropertyAssignment(loader) &&
        ts.isArrowFunction(loader.initializer) &&
        ts.isExpression(loader.initializer.body)
        ? fromImport(loader.initializer.body)
        : []
    })
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
        for (const flowNode of flowNodeComponents(node)) walkComponent(flowNode, {})
        const decl = declaration(node.tagName)
        const owner = decl && component(decl)
        if (!owner && decl && ts.isBindingElement(decl)) {
          const name = (decl.propertyName ?? decl.name).getText()
          for (const module of lazyEntries(decl)) walkEntry(module.fileName, name)
        }
        if (!owner) {
          for (const loaded of dynamicRegistry(decl)) walkComponent(loaded, {})
        }
        if (decl && owner) {
          const attrs: Props = {}
          for (const item of node.attributes.properties) {
            if (ts.isJsxAttribute(item))
              attrs[item.name.getText()] = values(item.initializer, scope)
          }
          if (
            systems.some((system) => decl.getSourceFile().fileName.startsWith(system)) ||
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
          [path.join(app, 'platform/'), productRoutes + path.sep].some((root) =>
            decl.getSourceFile().fileName.startsWith(root)
          ) &&
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
  function entry(sf: ts.SourceFile, name = 'default') {
    const module = checker.getSymbolAtLocation(sf)
    const symbol = module && checker.getExportsOfModule(module).find((item) => item.name === name)
    if (!symbol) return
    const decl = (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol)
      .valueDeclaration
    if (decl && ts.isExportAssignment(decl))
      return component(decl.expression) ?? component(declaration(decl.expression))
    return component(decl)
  }
  function walkEntry(file: string, name = 'default') {
    const sf = program.getSourceFile(file)
    const root = sf && entry(sf, name)
    if (root) walkComponent(root, {})
  }
  const segments = new Set<string>()
  for (const file of program.getRootFileNames()) {
    const routes = [zoneRoutes, productRoutes, organizationRoutes].find((root) =>
      file.startsWith(root + path.sep)
    )
    if (
      !routes ||
      path.basename(file) !== 'page.tsx' ||
      file.startsWith(workbench) ||
      path
        .relative(routes, file)
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
      if (dir === routes) {
        walkEntry(path.join(routes, 'global-error.tsx'))
        break
      }
    }
  }
  return usage
}
