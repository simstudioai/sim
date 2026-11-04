import path from 'node:path'
import ts from '@typescript/typescript6'

type Props = Record<string, string[]>
type Component = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression
interface Usage {
  variants: Set<string>
  recipes: Set<string>
}

/**
 * Follow JSX from actual App Router pages and their layouts, resolving imports,
 * barrels, default props, conditionals and wrapper props. Preview modules cannot
 * establish usage. Unresolved dynamic values require an explicit mapping at the owner.
 */
export function productUsage(app: string, files: string[]): Usage | null {
  const program = ts.createProgram(files, {
    noLib: true,
    noResolve: true,
    types: [],
    jsx: ts.JsxEmit.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    paths: { '@/platform/*': [path.join(app, 'platform/*')] },
  })
  const checker = program.getTypeChecker()
  const usage: Usage = { variants: new Set(), recipes: new Set() }
  const seen = new WeakMap<ts.Node, Set<string>>()
  const preview = path.join(app, 'platform/preview/')
  const system = path.join(app, 'platform/design-system/')
  function declaration(node: ts.Node) {
    let symbol = checker.getSymbolAtLocation(node)
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
    return symbol?.valueDeclaration
  }
  function component(decl: ts.Declaration | undefined): Component | undefined {
    if (!decl) return
    if (ts.isFunctionDeclaration(decl)) return decl
    if (
      ts.isVariableDeclaration(decl) &&
      decl.initializer &&
      (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
    )
      return decl.initializer
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
    if (ts.isConditionalExpression(node))
      return [...values(node.whenTrue, props, visited), ...values(node.whenFalse, props, visited)]
    if (ts.isPropertyAccessExpression(node)) return props[node.name.text] ?? []
    if (ts.isIdentifier(node)) {
      if (props[node.text]) return props[node.text]
      const decl = declaration(node)
      if (decl && ts.isVariableDeclaration(decl)) return values(decl.initializer, props, visited)
    }
    return []
  }
  function walk(fn: Component, props: Props) {
    if (!fn.body || fn.getSourceFile().fileName.startsWith(preview)) return
    const history = seen.get(fn) ?? new Set<string>()
    const signature = JSON.stringify(props)
    if (history.has(signature)) return
    history.add(signature)
    seen.set(fn, history)
    const scope = { ...props }
    const param = fn.parameters[0]?.name
    if (param && ts.isObjectBindingPattern(param)) {
      for (const item of param.elements) {
        const prop = (item.propertyName ?? item.name).getText()
        scope[item.name.getText()] = props[prop] ?? values(item.initializer, scope)
      }
    }
    function visit(node: ts.Node) {
      if (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) return
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const decl = declaration(node.tagName)
        const owner = decl && component(decl)
        if (decl && owner) {
          const attrs: Props = {}
          for (const item of node.attributes.properties) {
            if (ts.isJsxAttribute(item))
              attrs[item.name.getText()] = values(item.initializer, scope)
          }
          if (decl.getSourceFile().fileName.startsWith(system)) {
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
          walk(owner, attrs)
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
          !ts.isArrowFunction(decl.initializer) &&
          decl.getSourceFile().fileName.startsWith(path.join(app, 'platform/')) &&
          !seen.has(decl)
        ) {
          seen.set(decl, new Set())
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
    if (decl && ts.isExportAssignment(decl)) return component(declaration(decl.expression))
    return component(decl)
  }
  function previewOnly(fn: Component) {
    const targets: (ts.Declaration | undefined)[] = []
    function collect(node: ts.Node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
        targets.push(declaration(node.tagName))
      ts.forEachChild(node, collect)
    }
    if (fn.body) collect(fn.body)
    return (
      targets.length > 0 &&
      targets.every((target) => target?.getSourceFile().fileName.startsWith(preview))
    )
  }
  let pages = 0
  for (const file of files.filter(
    (file) =>
      path.basename(file) === 'page.tsx' &&
      file.startsWith(path.join(app, 'platform/app/')) &&
      !path
        .relative(path.join(app, 'platform/app'), file)
        .split(path.sep)
        .some((segment) => segment.startsWith('_'))
  )) {
    const sf = program.getSourceFile(file)
    const root = sf && entry(sf)
    if (!root || previewOnly(root)) continue
    pages++
    walk(root, {})
    for (
      let dir = path.dirname(file);
      dir.startsWith(path.join(app, 'platform/app'));
      dir = path.dirname(dir)
    ) {
      const layout = program.getSourceFile(path.join(dir, 'layout.tsx'))
      const fn = layout && entry(layout)
      if (fn) walk(fn, {})
    }
  }
  return pages ? usage : null
}
