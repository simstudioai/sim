import { parse, parseExpression } from '@babel/parser'
import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import postcss from 'postcss'
import type { ControlInventory } from '#control-analysis/inventory'
import {
  type ControlHooks,
  type ControlSource,
  compare,
  type Diagnostic,
  type InventoryFinding,
  regular,
} from '#control-analysis/model'
import { productScope } from '#control-analysis/scope'
import { centralInventory, componentContract } from '#design-conformance/contracts'
import type { GeneratedContracts } from '#design-conformance/generated-contracts'
import { canonical, type Finding, hash, TOKEN_FILE } from '#design-conformance/model'
import { utility } from '#design-conformance/normalize'

export interface ReviewItem {
  id: string
  kind: string
  file: string
  line: number
  owner: string
  value: string
  reason: string
  related?: string[]
  classification?: { status: string; rationale: string; evidence: string }
}
export interface ReviewReport {
  version: '1.0.0'
  findings: InventoryFinding[]
  unchecked: Diagnostic[]
}
const key = (node: t.Node): string =>
  t.isIdentifier(node) || t.isJSXIdentifier(node)
    ? node.name
    : t.isStringLiteral(node)
      ? node.value
      : ''
const site = (p: NodePath) => p.node?.loc?.start.line ?? p.parentPath?.node?.loc?.start.line ?? 1
const owner = (p: NodePath): string => {
  let current: NodePath | null = p
  while (current) {
    if (current.isFunctionDeclaration() && current.node.id) return current.node.id.name
    if (current.isVariableDeclarator() && t.isIdentifier(current.node.id))
      return current.node.id.name
    current = current.parentPath
  }
  return '<module>'
}
const colour = (value: string) => /^#[\da-f]{3,8}$/i.test(value)
const landingTarget = (value: string) =>
  /^@\/app\/\(landing\)\/components\//.test(value) ||
  /(?:^|\/)\(landing\)\/components\//.test(value) ||
  /^@\/lib\/content\/(?:mdx|faq)(?:$|\.)/.test(value)

const fullControlRecipes = /#(?:chipVariants|chipGeometryClass|dropdownMenuRowClass)$/
const repeatedVisualTreatment = (classes: string): boolean => {
  const tokens = classes.split(/\s+/)
  const visual = tokens.filter((token) =>
    /(?:^|:)(?:bg-|border(?:-|$)|rounded(?:-|$)|shadow(?:-|$)|ring(?:-|$)|text-\[var\(|text-(?:xs|sm|base|lg|xl|micro|caption|small|md)|font-(?:medium|semibold|bold))/.test(
      token
    )
  )
  const interactive = tokens.some((token) =>
    /(?:^|:)(?:hover|focus|focus-visible|active|disabled|data-\[|aria-\[)/.test(token)
  )
  // Shared layout and a lone text/icon token do not establish shared chrome.
  return visual.length >= 2 || (visual.length >= 1 && interactive)
}

const recipeTail = (record: ControlInventory['records'][number]) => {
  const expression = record.inputs.className?.expression
  const visual = new Set<string>()
  let unresolved = !expression
  if (!expression) return { visual: [] as string[], unresolved }
  const recipes = new Set(record.recipes.map((recipe) => recipe.split('#').at(-1)))
  const visit = (node: t.Node) => {
    if (t.isCallExpression(node)) {
      if (t.isIdentifier(node.callee) && recipes.has(node.callee.name)) return
      if (t.isIdentifier(node.callee, { name: 'cn' })) {
        for (const arg of node.arguments) visit(arg)
        return
      }
      unresolved = true
      return
    }
    if (t.isStringLiteral(node)) {
      for (const token of node.value.split(/\s+/).filter(Boolean)) {
        const { base } = utility(token)
        if (
          supplementalProperties(token).some(({ category }) =>
            [
              'colours',
              'font-size',
              'font-family',
              'font-weight',
              'line-height',
              'padding',
              'gap',
              'height',
              'border-radius',
              'borders',
              'box-shadow',
            ].includes(category)
          ) ||
          /^(?:opacity-|\[opacity:)/.test(base)
        )
          visual.add(token)
      }
      return
    }
    if (t.isIdentifier(node)) {
      if (!recipes.has(node.name)) unresolved = true
      return
    }
    if (t.isConditionalExpression(node)) {
      visit(node.consequent)
      visit(node.alternate)
      return
    }
    if (t.isLogicalExpression(node)) {
      visit(node.right)
      return
    }
    if (t.isTemplateLiteral(node)) {
      for (const part of node.quasis) visit(t.stringLiteral(part.value.cooked ?? part.value.raw))
      if (node.expressions.length) unresolved = true
      return
    }
    if (t.isArrayExpression(node)) {
      for (const item of node.elements) if (item) visit(item)
      return
    }
    if (t.isNullLiteral(node) || t.isBooleanLiteral(node) || t.isNumericLiteral(node)) return
    unresolved = true
  }
  try {
    visit(parseExpression(expression, { plugins: ['typescript', 'jsx'] }))
  } catch {
    unresolved = true
  }
  return { visual: [...visual].sort(compare), unresolved }
}

const supplementalProperties = (token: string): { property: string; category: string }[] => {
  const { base } = utility(token)
  if (/^rounded(?:-|$)/.test(base))
    return [{ property: 'border-radius', category: 'border-radius' }]
  if (
    /^border-(?:\[(?:color:)?(?:var\(|#)|(?:transparent|current|inherit|white|black)(?:$|\/)|[a-z]+-\d)/.test(
      base
    )
  )
    return [{ property: 'border-color', category: 'borders' }]
  if (/^border-(?:solid|dashed|dotted|double|none)$/.test(base))
    return [{ property: 'border-style', category: 'borders' }]
  if (/^border(?:-|$)/.test(base)) return [{ property: 'border-width', category: 'borders' }]
  if (/^bg-/.test(base)) return [{ property: 'background-color', category: 'colours' }]
  if (/^text-(?:xs|sm|base|lg|xl|micro|caption|small|md|\[length:|\[\d)/.test(base))
    return [{ property: 'font-size', category: 'font-size' }]
  if (/^text-(?!left|right|center|justify|clip|ellipsis)/.test(base))
    return [{ property: 'color', category: 'colours' }]
  if (/^font-(?:thin|light|normal|medium|semibold|bold|extrabold|black|\[\d)/.test(base))
    return [{ property: 'font-weight', category: 'font-weight' }]
  if (/^font-/.test(base)) return [{ property: 'font-family', category: 'font-family' }]
  if (/^p(?:[xytrblse])?-/.test(base)) return [{ property: 'padding', category: 'padding' }]
  if (/^gap(?:-[xy])?-/.test(base)) return [{ property: 'gap', category: 'gap' }]
  if (/^size-/.test(base))
    return [
      { property: 'width', category: 'width' },
      { property: 'height', category: 'height' },
    ]
  if (/^w-/.test(base)) return [{ property: 'width', category: 'width' }]
  if (/^h-/.test(base)) return [{ property: 'height', category: 'height' }]
  if (/^shadow(?:-|$)/.test(base)) return [{ property: 'box-shadow', category: 'box-shadow' }]
  if (/^overflow(?:-|$)/.test(base)) return [{ property: 'overflow', category: 'overflow' }]
  if (/^whitespace-/.test(base)) return [{ property: 'white-space', category: 'white-space' }]
  if (/^text-(?:clip|ellipsis)$/.test(base))
    return [{ property: 'text-overflow', category: 'text-overflow' }]
  if (/^leading-/.test(base)) return [{ property: 'line-height', category: 'line-height' }]
  if (/^\[(?:-webkit-)?mask-image:/.test(base))
    return [{ property: 'mask-image', category: 'mask-image' }]
  return []
}

/** Source styling inventory. It never executes application modules or approves styling. */
export class ReviewCollector {
  private readonly items = new Map<string, ReviewItem>()
  private readonly findings = new Map<string, InventoryFinding>()
  private readonly unchecked = new Map<string, Diagnostic>()
  private readonly bundles = new Map<string, { file: string; line: number; owner: string }[]>()
  private readonly globalHex = new Map<string, string[]>()
  private readonly visualCandidates = new Map<string, { line: number; owner: string }>()
  private readonly chromeCandidates: {
    file: string
    line: number
    siteKey: number
    owner: string
    target: string
    classes: string[]
  }[] = []
  private resolve?: (ref: string) => string[]

  constructor(
    source: ControlSource,
    private readonly metadata?: GeneratedContracts
  ) {
    const globals = source.entries.find((entry) => entry.path === TOKEN_FILE)
    if (globals && regular(globals)) {
      postcss.parse(source.read(globals)).walkDecls((decl) => {
        if (!decl.prop.startsWith('--') || !colour(decl.value.trim())) return
        const names = this.globalHex.get(decl.value.toLowerCase()) ?? []
        names.push(decl.prop)
        this.globalHex.set(decl.value.toLowerCase(), names)
      })
    }
    for (const entry of source.entries) {
      if (!regular(entry) || entry.bytes > 2 * 1024 * 1024 || !entry.path.endsWith('.css')) continue
      if (productScope(entry.path) !== 'check' || entry.path === TOKEN_FILE) continue
      try {
        const css = postcss.parse(source.read(entry))
        css.walkDecls((decl) => {
          for (const match of decl.value.matchAll(/var\(\s*(--landing-[\w-]+)/g))
            this.landingFinding(
              entry.path,
              decl.source?.start?.line ?? 1,
              decl.parent?.type === 'rule' ? decl.parent.selector : 'css',
              match[1]
            )
          if (!['line-height', 'letter-spacing'].includes(decl.prop) || /var\(--/.test(decl.value))
            return
          this.add(
            'local-typography',
            entry.path,
            decl.source?.start?.line ?? 1,
            'css',
            `${decl.prop}: ${decl.value}`,
            'Authored typography detail; review a shared type recipe or document-content Extra'
          )
        })
        css.walkRules((rule) => {
          if (!/(?:input|button|select|textarea)\s*(?:\[|:)/.test(rule.selector)) return
          this.add(
            'styled-native-control',
            entry.path,
            rule.source?.start?.line ?? 1,
            'css',
            rule.selector,
            'CSS styles a native control that may be generated outside the JSX inventory'
          )
        })
      } catch (error) {
        this.note(
          entry.path,
          1,
          'css',
          `Native-control CSS review could not parse source: ${String(error).slice(0, 160)}`
        )
      }
    }
    const mixedIcons = source.entries.find(
      (entry) => entry.path === 'apps/sim/components/icons.tsx'
    )
    if (mixedIcons && regular(mixedIcons)) {
      try {
        const ast = parse(source.read(mixedIcons), {
          sourceType: 'module',
          plugins: ['typescript', 'jsx'],
        })
        for (const statement of ast.program.body) {
          if (
            !t.isExportNamedDeclaration(statement) ||
            !t.isFunctionDeclaration(statement.declaration) ||
            !statement.declaration.id
          )
            continue
          const name = statement.declaration.id.name
          if (!['SearchIcon', 'AgentIcon', 'ApiIcon', 'WorkflowIcon'].includes(name)) continue
          this.add(
            'mixed-product-artwork',
            mixedIcons.path,
            statement.loc?.start.line ?? 1,
            name,
            name,
            'Product block glyph is authored in a mixed provider-artwork file; review as a retained Extra or central asset'
          )
        }
      } catch (error) {
        this.note(
          mixedIcons.path,
          1,
          'artwork',
          `Mixed artwork export inventory failed: ${String(error).slice(0, 160)}`
        )
      }
    }
  }

  private add(
    kind: string,
    file: string,
    line: number,
    ownerName: string,
    value: string,
    reason: string,
    related?: string[]
  ) {
    const id = hash(canonical([kind, file, ownerName, value, line]))
    this.items.set(id, {
      id,
      kind,
      file,
      line,
      owner: ownerName,
      value,
      reason,
      ...(related ? { related } : {}),
    })
  }
  private note(file: string, line: number, context: string, reason: string) {
    const diagnostic = { file, line, context, reason }
    this.unchecked.set(canonical(diagnostic), diagnostic)
  }
  private finding(
    file: string,
    line: number,
    ownerName: string,
    property: string,
    value: string,
    reason: string
  ) {
    const id = hash(canonical([file, ownerName, property, value, reason]))
    this.findings.set(id, {
      id,
      observedFrom: [file],
      kind: 'usage-violation',
      contract: 'central-colour',
      rule: 'central-colour',
      category: 'colours',
      property,
      value,
      reason,
      file,
      line,
      column: 1,
      context: ownerName,
      provenance: {
        source: `${TOKEN_FILE}#colour-tokens`,
        input: value,
        permitted: 'Use a product colour from globals.css or record a reviewed Extra',
      },
    })
  }
  private landingFinding(file: string, line: number, ownerName: string, value: string) {
    const id = hash(canonical([file, ownerName, 'central-token', value]))
    this.findings.set(id, {
      id,
      observedFrom: [file],
      kind: 'usage-violation',
      contract: 'central-token',
      rule: 'central-token',
      category: 'tokens',
      property: 'custom-property',
      value,
      reason: 'Landing-only token is used in product styling',
      file,
      line,
      column: 1,
      context: ownerName,
      provenance: {
        source: `${TOKEN_FILE}#landing-tokens`,
        input: value,
        permitted: 'Use product globals.css tokens or record a reviewed Extra',
      },
    })
  }
  private componentFinding(
    file: string,
    line: number,
    ownerName: string,
    target: string,
    token: string,
    overrideProperty?: string,
    occurrence?: number
  ) {
    const base = token.split(':').at(-1) ?? token
    const property =
      overrideProperty ??
      (/^(?:rounded-)/.test(base)
        ? 'border-radius'
        : /^(?:p[xytrblse]?-)/.test(base)
          ? 'padding'
          : /^(?:text-(?:xs|sm|caption|small|md|lg|xl|\[\d))/.test(base)
            ? 'font-size'
            : /^font-/.test(base)
              ? 'font-family'
              : /^(?:bg-|text-|border-)/.test(base)
                ? 'color'
                : /^shadow-/.test(base)
                  ? 'box-shadow'
                  : /^h-/.test(base) && target === '@sim/emcn#Input'
                    ? 'height'
                    : undefined)
    if (!property) return
    const context = `${ownerName} / ${target} / className`
    const id = hash(
      canonical(
        occurrence === undefined
          ? [file, context, property, token]
          : [file, context, property, token, occurrence]
      )
    )
    this.findings.set(id, {
      id,
      observedFrom: [file],
      kind: 'usage-violation',
      contract: 'component-chrome',
      rule: 'component-chrome',
      category: property,
      property,
      value: token,
      reason: 'Consumer restyles chrome owned by the EMCN component',
      file,
      line,
      column: 1,
      context,
      provenance: {
        source: 'scripts/design-conformance/contracts.generated.json#exports',
        input: token,
        permitted: 'Use the EMCN component API or review a shared variant',
      },
    })
  }

  complete: NonNullable<ControlHooks['complete']> = ({ resolve }) => {
    this.resolve = resolve
  }

  program: NonNullable<ControlHooks['program']> = ({ file, path, reference }) => {
    if (productScope(file) !== 'check') return
    const importTarget = (value: string, p: NodePath) => {
      if (landingTarget(value))
        this.note(
          file,
          site(p),
          owner(p),
          `Product styling dependency enters excluded landing source: ${value}`
        )
    }
    path.traverse({
      ImportDeclaration: (p) => importTarget(p.node.source.value, p),
      ExportNamedDeclaration: (p) => {
        if (p.node.source) importTarget(p.node.source.value, p)
      },
      ObjectProperty: (p) => {
        if (!/^apps\/sim\/blocks\/blocks\/[^/]+\.ts$/.test(file)) return
        const name = key(p.node.key)
        if (!['bgColor', 'iconColor'].includes(name) || !t.isStringLiteral(p.node.value)) return
        // Every registered block owns its tile and glyph colours. Keep inspecting
        // the file for other product styling, but do not turn block metadata
        // into a design-review item.
        if (
          p.parentPath?.isObjectExpression() &&
          p.parentPath.node.properties.some(
            (sibling) =>
              t.isObjectProperty(sibling) &&
              key(sibling.key) === 'category' &&
              t.isStringLiteral(sibling.value) &&
              ['blocks', 'triggers', 'tools'].includes(sibling.value.value)
          )
        )
          return
        this.add(
          'block-colour',
          file,
          site(p),
          owner(p),
          `${name}: ${p.node.value.value}`,
          'Block metadata colours reach product tiles; review global-token provenance or provider brand Extra'
        )
      },
      StringLiteral: (p) => {
        if (!file.startsWith('packages/emcn/src/')) return
        for (const match of p.node.value.matchAll(/(?:bg|text|border)-\[(#[\da-f]{3,8})\]/gi)) {
          const tokens = this.globalHex.get(match[1].toLowerCase()) ?? []
          if (tokens.length)
            this.add(
              'central-duplicate-colour',
              file,
              site(p),
              owner(p),
              match[0],
              `Central styling duplicates global colour ${tokens.join(', ')}; review semantic token use`
            )
        }
      },
      VariableDeclarator: (p) => {
        if (!t.isIdentifier(p.node.id, { name: 'color' })) return
        const binding = p.scope.getBinding('color')
        if (
          !binding ||
          !binding.referencePaths.some((use) =>
            use.findParent(
              (parent) => parent.isJSXAttribute() && key(parent.node.name) === 'className'
            )
          )
        )
          return
        const values = [
          p.node.init,
          ...binding.constantViolations
            .filter((violation) => violation.isAssignmentExpression())
            .map((violation) => (violation.node as t.AssignmentExpression).right),
        ]
        for (const value of values)
          if (
            t.isStringLiteral(value) &&
            /(?:^|\s)bg-(?:gray|emerald|amber|red)-\d/.test(value.value)
          )
            this.add(
              'semantic-status-colour',
              file,
              value.loc?.start.line ?? site(p),
              owner(p),
              value.value,
              'Status colour uses a global primitive without a semantic status recipe'
            )
      },
      JSXElement: (p) => {
        if (
          /^apps\/sim\/components\/ui\/[^/]+\.tsx$/.test(file) &&
          p.node.openingElement.attributes.some(
            (attribute) => t.isJSXAttribute(attribute) && key(attribute.name) === 'className'
          )
        )
          this.visualCandidates.set(file, { line: site(p), owner: owner(p) })
        const target = reference(p.node.openingElement.name, p)
        for (const attribute of p.node.openingElement.attributes) {
          if (!t.isJSXAttribute(attribute) || key(attribute.name) !== 'className') continue
          const texts: string[] = []
          if (t.isStringLiteral(attribute.value)) texts.push(attribute.value.value)
          else if (t.isJSXExpressionContainer(attribute.value)) {
            const value = p
              .get('openingElement')
              .get('attributes')
              .find((candidate) => candidate.node === attribute)
            value?.traverse({
              StringLiteral: (literal) => {
                texts.push(literal.node.value)
              },
            })
          }
          this.chromeCandidates.push({
            file,
            line: site(p),
            siteKey: p.node.start ?? site(p),
            owner: owner(p),
            target,
            classes: texts,
          })
        }
        if (!t.isJSXIdentifier(p.node.openingElement.name, { name: 'style' })) return
        const dynamic = p.node.children.find(
          (child): child is t.JSXExpressionContainer =>
            t.isJSXExpressionContainer(child) && !t.isStringLiteral(child.expression)
        )
        if (!dynamic) return
        const expr = dynamic.expression
        const binding = t.isIdentifier(expr) ? p.scope.getBinding(expr.name)?.path.node : undefined
        const initializer = t.isVariableDeclarator(binding) ? binding.init : expr
        const css = t.isTemplateLiteral(initializer)
          ? initializer.quasis.map((part) => part.value.cooked ?? part.value.raw).join('')
          : t.isStringLiteral(initializer)
            ? initializer.value
            : ''
        const callback = t.isCallExpression(initializer) ? initializer.arguments[0] : undefined
        const callbackBody = t.isArrowFunctionExpression(callback) ? callback.body : undefined
        const branding =
          file === 'apps/sim/ee/whitelabeling/components/branding-provider.tsx' &&
          t.isCallExpression(initializer) &&
          t.isIdentifier(initializer.callee, { name: 'useMemo' }) &&
          p.scope.getBinding('generateOrgThemeCSS')?.path.isImportSpecifier() === true &&
          (p.scope.getBinding('generateOrgThemeCSS')?.path.parent as t.ImportDeclaration).source
            .value === '@/ee/whitelabeling/org-branding-utils' &&
          t.isConditionalExpression(callbackBody) &&
          t.isCallExpression(callbackBody.consequent) &&
          t.isIdentifier(callbackBody.consequent.callee, { name: 'generateOrgThemeCSS' })
        const editorTooltip =
          css.includes('[data-find-tooltip-fix] .context-view') &&
          !/(?:color\s*:|background\s*:|--[\w-]+\s*:)/.test(css)
        const readonlyPreview =
          css.includes('.readonly-preview [disabled]') && /opacity:\s*1\s*!important/.test(css)
        const cursorPreview =
          t.isTemplateLiteral(initializer) &&
          css.includes('.preview-mode .react-flow') &&
          initializer.expressions.some((part) => t.isIdentifier(part, { name: 'cursorStyle' }))
        const kind = branding
          ? 'runtime-style-customer-brand'
          : editorTooltip
            ? 'runtime-style-editor-tooltip'
            : readonlyPreview
              ? 'runtime-style-preview-disabled'
              : cursorPreview
                ? 'runtime-style-preview-cursor'
                : 'runtime-style'
        const reason = branding
          ? 'Customer-selected brand CSS enters product tokens; review generator changes and customer input separately'
          : editorTooltip
            ? 'Scoped Monaco tooltip geometry; no product colour or token assignment is present in this source'
            : readonlyPreview
              ? 'Preview CSS overrides disabled opacity and interaction on product fields; move to an owned read-only presentation API'
              : cursorPreview
                ? 'Canvas cursor CSS uses a shared preview selector; scope it to this preview instance'
                : 'Runtime CSS may override product tokens; inspect its source and affected variables'
        this.add(kind, file, site(p), owner(p), '<style>{computed CSS}</style>', reason)
        this.note(file, site(p), owner(p), `${reason}; computed style remains unchecked`)
      },
      JSXAttribute: (p) => {
        if (key(p.node.name) === 'style' && t.isJSXExpressionContainer(p.node.value)) {
          const value = p.get('value') as NodePath<t.JSXExpressionContainer>
          value.traverse({
            StringLiteral: (literal) => {
              for (const match of literal.node.value.matchAll(/var\(\s*(--landing-[\w-]+)/g))
                this.landingFinding(file, site(literal), owner(p), match[1])
            },
          })
        }
        if (key(p.node.name) !== 'className') return
        const strings: string[] = []
        if (t.isStringLiteral(p.node.value)) strings.push(p.node.value.value)
        else if (t.isJSXExpressionContainer(p.node.value)) {
          const value = p.get('value') as NodePath<t.JSXExpressionContainer>
          value.traverse({
            StringLiteral: (literal) => {
              strings.push(literal.node.value)
            },
          })
        }
        for (const classes of strings) {
          for (const match of classes.matchAll(/var\(\s*(--landing-[\w-]+)/g))
            this.landingFinding(file, site(p), owner(p), match[1])
          const tokens = classes.trim().split(/\s+/).filter(Boolean)
          if (tokens.length >= 3) {
            const normalized = [...new Set(tokens)].sort(compare).join(' ')
            const sites = this.bundles.get(normalized) ?? []
            sites.push({ file, line: site(p), owner: owner(p) })
            this.bundles.set(normalized, sites)
          }
          for (const token of tokens) {
            const kind = /(?:^|:)leading-\[|(?:^|:)tracking-\[/.test(token)
              ? 'local-typography'
              : /(?:^|:)shadow-(?:xs|sm|md|lg|xl)(?:$|\s)/.test(token)
                ? 'stock-shadow'
                : /(?:color-mix\(|(?:^|:)(?:bg|text|border)-(?:black|white)\/\d+)/.test(token)
                  ? 'local-alpha'
                  : undefined
            if (kind)
              this.add(
                kind,
                file,
                site(p),
                owner(p),
                token,
                'Local visual decision; review for an existing token, shared recipe, or retained Extra'
              )
          }
        }
      },
      CallExpression: (p) => {
        const callee = p.node.callee
        if (!t.isMemberExpression(callee) || key(callee.property) !== 'defineTheme') return
        // Monaco owns its editor chrome and syntax palette. Keep the product
        // module in scope, but do not review values passed to Monaco's theme API.
        const editor = callee.object
        if (
          t.isMemberExpression(editor) &&
          t.isIdentifier(editor.object, { name: 'monaco' }) &&
          key(editor.property) === 'editor'
        )
          return
        const theme = p.node.arguments[1]
        if (!t.isObjectExpression(theme)) return
        for (const prop of theme.properties) {
          if (!t.isObjectProperty(prop)) continue
          const name = key(prop.key)
          const candidate = t.isIdentifier(prop.value)
            ? p.scope.getBinding(prop.value.name)?.path.node
            : undefined
          const source = t.isVariableDeclarator(candidate) ? candidate.init : prop.value
          if (name === 'colors' && t.isObjectExpression(source))
            for (const entry of source.properties)
              if (
                t.isObjectProperty(entry) &&
                t.isStringLiteral(entry.value) &&
                colour(entry.value.value)
              )
                this.finding(
                  file,
                  entry.value.loc?.start.line ?? site(p),
                  owner(p),
                  key(entry.key),
                  entry.value.value,
                  'Monaco editor chrome has a local literal colour'
                )
          if (name === 'rules' && t.isArrayExpression(source))
            for (const entry of source.elements)
              if (t.isObjectExpression(entry))
                for (const field of entry.properties)
                  if (
                    t.isObjectProperty(field) &&
                    key(field.key) === 'foreground' &&
                    t.isStringLiteral(field.value)
                  )
                    this.add(
                      'syntax-colour',
                      file,
                      field.value.loc?.start.line ?? site(p),
                      owner(p),
                      field.value.value,
                      'Syntax highlighting palette needs explicit Extra or shared theme ownership'
                    )
        }
      },
      NewExpression: (p) => {
        if (!t.isIdentifier(p.node.callee, { name: 'Blob' })) return
        const options = p.node.arguments[1]
        if (
          !t.isObjectExpression(options) ||
          !options.properties.some(
            (part) =>
              t.isObjectProperty(part) &&
              key(part.key) === 'type' &&
              t.isStringLiteral(part.value, { value: 'text/html' })
          )
        )
          return
        const content = p.node.arguments[0]
        const first = t.isArrayExpression(content) ? content.elements[0] : undefined
        const binding = t.isIdentifier(first)
          ? p.scope.getBinding(first.name)?.path.node
          : undefined
        const template = t.isVariableDeclarator(binding) ? binding.init : first
        if (!t.isTemplateLiteral(template)) {
          this.note(file, site(p), owner(p), 'Rendered HTML Blob has unresolved CSS content')
          return
        }
        const css = template.quasis.map((part) => part.value.cooked ?? part.value.raw).join('')
        if (!/<style[\s>]/i.test(css)) return
        if (template.expressions.length)
          this.note(
            file,
            template.loc?.start.line ?? site(p),
            owner(p),
            'Rendered HTML CSS template substitutions are unchecked'
          )
        for (const match of css.matchAll(
          /(?:background(?:-color)?|color|border-color)\s*:\s*(#[\da-f]{3,8})\b/gi
        ))
          this.finding(
            file,
            template.loc?.start.line ?? site(p),
            owner(p),
            'generated-css',
            match[1],
            'Rendered HTML contains a local literal CSS colour'
          )
      },
    })
  }

  finish(controls: ControlInventory): ReviewReport {
    for (const candidate of this.chromeCandidates) {
      if (candidate.file.startsWith('packages/emcn/')) continue
      const targets = [candidate.target, ...(this.resolve?.(candidate.target) ?? [])]
      const names = Object.entries(this.metadata?.exports ?? {})
        .filter(([name, entry]) =>
          targets.some(
            (target) =>
              target === `@sim/emcn#${name}` ||
              target === `?packages/emcn/src/index:missing#${name}` ||
              target.replace(/^\?/, '').replace(/@\d+$/, '') ===
                `${entry.source.file.replace(/\.[cm]?[jt]sx?$/, '')}#${entry.source.name}` ||
              target.replace(/^\?/, '').replace(/@\d+$/, '') ===
                `${entry.source.file}#${entry.source.name}`
          )
        )
        .map(([name]) => name)
      if (names.length !== 1) continue
      const name = names[0]
      const contract = componentContract(`@sim/emcn#${name}`, this.metadata)
      const slot = contract?.slotOwnership?.className
      if (!slot) continue
      for (const classes of candidate.classes)
        for (const token of classes.trim().split(/\s+/)) {
          const variants = utility(token).variants
          if (/(?:^|:)(?:before|after|\*|\*\*):|\[&[_>+~ ]|&::(?:before|after)/.test(variants))
            continue
          for (const { property, category } of supplementalProperties(token))
            if (
              slot.protected.some((p) => p === '*' || p === property || p === category) &&
              !slot.allowed.some((p) => p === '*' || p === property || p === category)
            )
              this.componentFinding(
                candidate.file,
                candidate.line,
                candidate.owner,
                `@sim/emcn#${name}`,
                token,
                property,
                candidate.siteKey
              )
        }
    }
    const sharedRows = controls.records.filter(
      (record) =>
        !record.projection &&
        record.tag === 'SettingsResourceRow' &&
        record.origin === 'interaction-candidate'
    )
    if (sharedRows.length >= 3) {
      const first = sharedRows[0]
      this.add(
        'shared-product-recipe',
        first.file,
        first.line,
        first.owner,
        'SettingsResourceRow',
        'Widely reused app-level treatment lacks resolved visual ownership',
        [...new Set(sharedRows.map((row) => row.file))].sort(compare)
      )
    }
    for (const [file, candidate] of this.visualCandidates)
      if (
        !centralInventory(file) &&
        !controls.records.some((record) => record.file === file && !record.projection)
      )
        this.add(
          'local-visual-primitive',
          file,
          candidate.line,
          candidate.owner,
          file,
          'Reusable styled product visual has no control-origin record; review EMCN or Extra ownership'
        )
    for (const record of controls.records) {
      if (
        centralInventory(record.file) ||
        record.projection ||
        record.hidden ||
        record.origin !== 'local-control' ||
        !record.appearance.localInputs
      )
        continue
      if (record.recipes.some((recipe) => fullControlRecipes.test(recipe))) {
        const { visual, unresolved } = recipeTail(record)
        if (visual.length || unresolved)
          this.add(
            'emcn-recipe-override',
            record.file,
            record.line,
            record.owner,
            `${record.tag}: ${visual.join(' ') || '<unresolved classes>'}`,
            'EMCN supplies the base recipe, but caller visual classes or unresolved class inputs need design review'
          )
        continue
      }
      this.add(
        'local-control',
        record.file,
        record.line,
        record.owner,
        record.tag,
        'Locally styled product control; review EMCN reuse or an explicit Extra'
      )
    }
    for (const [classes, sites] of this.bundles) {
      if (!repeatedVisualTreatment(classes)) continue
      const distinct = [...new Set(sites.map((site) => `${site.file}#${site.owner}`))]
      if (distinct.length < 3) continue
      const first = sites[0]
      this.add(
        'repeated-treatment',
        first.file,
        first.line,
        first.owner,
        classes,
        'Identical local class treatment repeats across product owners; review shared ownership',
        distinct
      )
    }
    const sort = <T>(values: T[]) => values.sort((a, b) => compare(canonical(a), canonical(b)))
    return {
      version: '1.0.0',
      findings: sort([
        ...this.findings.values(),
        ...[...this.items.values()].map((item) => ({
          id: item.id,
          observedFrom: [item.file],
          kind: 'usage-violation' as const,
          rule: item.kind,
          category: item.kind,
          property: item.kind,
          file: item.file,
          line: item.line,
          column: 1,
          context: item.owner,
          value: item.value,
          reason: item.reason,
          legacyFingerprint: hash(
            canonical(['review-item', item.file, item.owner, item.kind, item.value])
          ),
          ...(item.related ? { related: item.related } : {}),
        })),
      ]),
      unchecked: sort([...this.unchecked.values()]),
    }
  }
}

/** Merge independent passes without multiplying the same authored occurrence. */
export function mergeSourceFindings<T extends Finding>(primary: T[], additional: T[]): T[] {
  const key = (f: Finding) => canonical([f.file, f.line, f.rule, f.property, f.value])
  const counts = new Map<string, number>()
  for (const f of primary) counts.set(key(f), (counts.get(key(f)) ?? 0) + 1)
  const output = [...primary]
  for (const f of additional) {
    const id = key(f)
    const count = counts.get(id) ?? 0
    if (count) counts.set(id, count - 1)
    else output.push(f)
  }
  return output
}
