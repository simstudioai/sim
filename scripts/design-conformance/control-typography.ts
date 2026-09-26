import { posix } from 'node:path'
import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'
import * as t from '@babel/types'
import postcss, { type Rule } from 'postcss'
import valueParser from 'postcss-value-parser'
import { type ControlSource, type Diagnostic, regular } from '#control-analysis/model'
import { productScope } from '#control-analysis/scope'
import { canonical, type Finding, TOKEN_FILE } from '#design-conformance/model'

const traverse =
  typeof traverseModule === 'function'
    ? traverseModule
    : (traverseModule as unknown as { default: typeof traverseModule }).default
const editor =
  'apps/sim/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/rich-markdown-editor.css'
const loader = 'apps/sim/components/ui/thinking-loader.tsx'
const loaderCss = 'apps/sim/components/ui/thinking-loader.module.css'
const marketing = ['apps/sim/lib/content/mdx.tsx', 'apps/sim/lib/content/faq.tsx']
const weights: Record<string, string> = {
  '--font-weight-normal': '400',
  '--font-weight-medium': '500',
  '--font-weight-semibold': '600',
}
const recipes: [string, [string, string][]][] = [
  [
    '.rich-markdown-prose h1',
    [
      ['font-size', '1.6em'],
      ['margin-top', '1.4em'],
    ],
  ],
  [
    '.rich-markdown-prose h2',
    [
      ['font-size', '1.3em'],
      ['margin-top', '1.3em'],
    ],
  ],
  [
    '.rich-markdown-prose h3',
    [
      ['font-size', '1.1em'],
      ['margin-top', '1.2em'],
    ],
  ],
  [
    '.rich-markdown-prose h4',
    [
      ['font-size', '1em'],
      ['margin-top', '1.1em'],
    ],
  ],
  [
    '.rich-markdown-prose h5',
    [
      ['font-size', '0.875em'],
      ['margin-top', '1.1em'],
    ],
  ],
  [
    '.rich-markdown-prose h6',
    [
      ['font-size', '0.8em'],
      ['margin-top', '1.1em'],
      ['color', 'var(--text-secondary)'],
    ],
  ],
  [
    '.rich-markdown-prose code',
    [
      ['font-family', 'var(--font-martian-mono, ui-monospace, monospace)'],
      ['font-size', '0.875em'],
      ['background', 'var(--surface-5)'],
      ['border-radius', '4px'],
      ['padding', '0.125rem 0.375rem'],
    ],
  ],
  [
    '.rich-markdown-nodes .raw-markdown-block, .rich-markdown-nodes .raw-markdown-inline',
    [
      ['font-family', 'var(--font-martian-mono, ui-monospace, monospace)'],
      ['font-size', '0.875em'],
      ['color', 'var(--text-muted)'],
      ['background', 'var(--surface-5)'],
      ['white-space', 'pre-wrap'],
      ['overflow-wrap', 'anywhere'],
    ],
  ],
]
const selector = (text: string) => text.replace(/\s+/g, ' ').trim()
const value = (text: string): string => {
  const nodes = (parts: valueParser.Node[]): unknown[] =>
    parts.flatMap((n) =>
      n.type === 'space' || n.type === 'comment'
        ? []
        : [
            n.type === 'function'
              ? [n.type, n.value, !!n.unclosed, nodes(n.nodes)]
              : [n.type, n.value],
          ]
    )
  return canonical(nodes(valueParser(text).nodes))
}

export interface TypographyClassification {
  file: string
  line: number
  column: number
  property: string
  value: string
  disposition: 'central-reference' | 'extra' | 'marketing'
  reason: string
}
export interface TypographyReview {
  version: '1.0.0'
  classifications: TypographyClassification[]
  ownership: { file: string; status: 'verified' | 'unresolved'; owners: string[] }[]
  unchecked: Diagnostic[]
}

export const typographySource = (file: string): boolean =>
  /\.(?:[cm]?[jt]sx?|css)$/.test(file) && !/(?:\.test\.|\.spec\.|__tests__|node_modules)/.test(file)

/** Only exact reviewed source treatments gain an Extra; ordinary component overrides stay visible. */
export function inspectTypography(source: ControlSource): TypographyReview {
  const report: TypographyReview = {
    version: '1.0.0',
    classifications: [],
    ownership: [],
    unchecked: [],
  }
  const texts = new Map<string, string>()
  const ownershipTexts = new Map<string, string>()
  for (const entry of source.entries) {
    if (!typographySource(entry.path)) continue
    const excluded = productScope(entry.path) === 'exclude'
    if (excluded) continue
    if (!regular(entry)) {
      report.unchecked.push({
        file: entry.path,
        line: 1,
        context: 'typography source ownership',
        reason: 'Unsupported source; no complete ownership proof',
      })
      continue
    }
    if (entry.bytes > 2 * 1024 * 1024) {
      try {
        if (!/\.[cm]?[jt]sx?$/.test(entry.path) || !source.readOwnership)
          throw new Error('Ownership source unavailable')
        ownershipTexts.set(entry.path, source.readOwnership(entry))
      } catch {
        report.unchecked.push({
          file: entry.path,
          line: 1,
          context: 'typography source ownership',
          reason: 'Unsupported source; no complete ownership proof',
        })
      }
      continue
    }
    const text = source.read(entry)
    if (!excluded) texts.set(entry.path, text)
    ownershipTexts.set(entry.path, text)
  }
  const css = new Map<string, postcss.Root>()
  for (const [file, text] of texts)
    if (file.endsWith('.css')) {
      try {
        css.set(file, postcss.parse(text))
      } catch {
        report.unchecked.push({
          file,
          line: 1,
          context: 'typography',
          reason: 'CSS parse failure; no typography exception approved for this source',
        })
      }
    }
  const globalTokens = new Set<string>()
  for (const [name, expected] of Object.entries({ ...weights, '--text-sm': '0.875rem' })) {
    const definitions: { file: string; decl: postcss.Declaration }[] = []
    for (const [file, root] of css)
      root.walkDecls(name, (decl) => {
        definitions.push({ file, decl })
      })
    if (
      definitions.length === 1 &&
      definitions[0].file === TOKEN_FILE &&
      definitions[0].decl.value === expected &&
      !definitions[0].decl.important &&
      definitions[0].decl.parent?.type === 'atrule' &&
      definitions[0].decl.parent.name === 'theme' &&
      definitions[0].decl.parent.parent?.type === 'root' &&
      (name === '--text-sm' ||
        ![...texts].some(([file, text]) => !file.endsWith('.css') && text.includes(name)))
    )
      globalTokens.add(name)
  }
  for (const [file, root] of css) {
    if (file === TOKEN_FILE) continue
    root.walkDecls('font-weight', (decl) => {
      const name = decl.value.match(/^var\(\s*(--[\w-]+)\s*\)$/)?.[1]
      if (name && globalTokens.has(name))
        report.classifications.push({
          file,
          line: decl.source?.start?.line ?? 1,
          column: decl.source?.start?.column ?? 1,
          property: 'font-weight',
          value: decl.value,
          disposition: 'central-reference',
          reason: `Unshadowed ${name} is explicitly defined as ${weights[name]} in globals.css`,
        })
    })
  }
  for (const [expectedSelector, expectedDeclarations] of recipes) {
    const rules: Rule[] = []
    css.get(editor)?.walkRules((rule) => {
      if (selector(rule.selector) === expectedSelector) rules.push(rule)
    })
    if (rules.length !== 1 || rules[0].parent?.type !== 'root') continue
    const rule = rules[0]
    const declarations = rule.nodes
      .filter((n) => n.type !== 'comment')
      .map((n) => (n.type === 'decl' ? [n.prop, value(n.value), !!n.important] : ['unsupported']))
    if (
      canonical(declarations) !==
      canonical(expectedDeclarations.map(([p, v]) => [p, value(v), false]))
    )
      continue
    const decl = rule.nodes.find(
      (n) => n.type === 'decl' && n.prop === 'font-size'
    ) as postcss.Declaration
    report.classifications.push({
      file: editor,
      line: decl.source?.start?.line ?? 1,
      column: decl.source?.start?.column ?? 1,
      property: 'font-size',
      value: decl.value,
      disposition: 'extra',
      reason: `Exact relative document recipe: ${expectedSelector}; scales with document text`,
    })
  }
  // A name or a fallback alone never proves this dynamic size. Verify the one writer,
  // its immutable component parameters, owning style object, and both CSS consumers.
  let loaderWriter = false
  const loaderMentions = [...texts].filter(([, text]) => text.includes('--tl-label-size'))
  if (loaderMentions.every(([file]) => file === loader || file === loaderCss)) {
    try {
      const ast = parse(texts.get(loader) ?? '', {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      })
      let writers = 0
      traverse(ast, {
        ObjectProperty(path) {
          if (!t.isStringLiteral(path.node.key, { value: '--tl-label-size' })) return
          writers++
          const v = path.node.value
          const fn = path.getFunctionParent()
          const attr = path.findParent((p) => p.isJSXAttribute())
          const expr =
            t.isTemplateLiteral(v) && v.expressions.length === 1 ? v.expressions[0] : undefined
          const params = ['size', 'labelRatio'].map((name) => path.scope.getBinding(name))
          loaderWriter =
            !path.node.computed &&
            t.isTemplateLiteral(v) &&
            v.quasis.length === 2 &&
            v.quasis[0].value.cooked === '' &&
            v.quasis[1].value.cooked === 'px' &&
            t.isBinaryExpression(expr, { operator: '*' }) &&
            t.isIdentifier(expr.left, { name: 'size' }) &&
            t.isIdentifier(expr.right, { name: 'labelRatio' }) &&
            !!fn?.isFunctionDeclaration() &&
            fn.node.id?.name === 'ThinkingLoader' &&
            params.every((b) => b?.kind === 'param' && b.constant && b.scope.path === fn) &&
            t.isObjectPattern(fn.node.params[0]) &&
            (['size', 'labelRatio'] as const).every(
              (name) =>
                t.isObjectPattern(fn.node.params[0]) &&
                fn.node.params[0].properties.some(
                  (p) =>
                    t.isObjectProperty(p) &&
                    !p.computed &&
                    t.isIdentifier(p.key, { name }) &&
                    t.isAssignmentPattern(p.value) &&
                    t.isIdentifier(p.value.left, { name }) &&
                    t.isNumericLiteral(p.value.right, { value: name === 'size' ? 20 : 0.7 })
                )
            ) &&
            !!attr?.isJSXAttribute() &&
            t.isJSXIdentifier(attr.node.name, { name: 'style' }) &&
            attr.parentPath.isJSXOpeningElement() &&
            t.isJSXIdentifier(attr.parentPath.node.name, { name: 'output' }) &&
            path.parentPath.isObjectExpression() &&
            path.parentPath.node.properties.length === 2 &&
            path.parentPath.node.properties.every((p) => t.isObjectProperty(p) && !p.computed)
        },
      })
      loaderWriter &&=
        writers === 1 && (texts.get(loader)?.match(/--tl-label-size/g)?.length ?? 0) === 1
    } catch {
      loaderWriter = false
    }
  }
  const loaderRules: Rule[] = []
  css.get(loaderCss)?.walkRules((rule) => {
    if (rule.selector === '.label' || rule.selector === '.labelStatic') loaderRules.push(rule)
  })
  let cssWriters = false
  for (const root of css.values())
    root.walkDecls('--tl-label-size', () => {
      cssWriters = true
    })
  if (
    loaderWriter &&
    !cssWriters &&
    loaderRules.length === 2 &&
    new Set(loaderRules.map((r) => r.selector)).size === 2 &&
    (texts.get(loaderCss)?.match(/--tl-label-size/g)?.length ?? 0) === 2
  ) {
    for (const rule of loaderRules) {
      const decls = rule.nodes.filter(
        (n): n is postcss.Declaration => n.type === 'decl' && n.prop === 'font-size'
      )
      if (
        rule.parent?.type === 'root' &&
        decls.length === 1 &&
        !decls[0].important &&
        value(decls[0].value) === value('var(--tl-label-size, var(--text-sm))') &&
        globalTokens.has('--text-sm')
      ) {
        const decl = decls[0]
        report.classifications.push({
          file: loaderCss,
          line: decl.source?.start?.line ?? 1,
          column: decl.source?.start?.column ?? 1,
          property: 'font-size',
          value: decl.value,
          disposition: 'extra',
          reason:
            'Verified immutable size × labelRatio writer on ThinkingLoader output; central body-size fallback',
        })
      }
    }
  }
  // Walk reverse literal imports, including aliases, re-exports and dynamic imports.
  // Only known marketing helpers qualify; a new product importer revokes their classification.
  const moduleInfo = new Map<string, { deps: string[]; unresolved: boolean; jsx: boolean }>()
  const resolve = (file: string, spec: string) => {
    const base =
      spec.startsWith('@/') && file.startsWith('apps/sim/')
        ? `apps/sim/${spec.slice(2)}`
        : spec.startsWith('.')
          ? posix.normalize(posix.join(posix.dirname(file), spec))
          : spec
    const matches = [
      base,
      ...['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'].map((ext) => base + ext),
    ].filter((p) => ownershipTexts.has(p))
    return matches.length === 1 ? matches[0] : undefined
  }
  const info = (file: string) => {
    const cached = moduleInfo.get(file)
    if (cached) return cached
    const item = { deps: [] as string[], unresolved: false, jsx: false }
    try {
      const ast = parse(ownershipTexts.get(file) ?? '', {
        sourceType: 'unambiguous',
        plugins: ['typescript', 'jsx', 'decorators-legacy'],
      })
      const dependency = (node: t.Node | null | undefined) => {
        if (!t.isStringLiteral(node)) {
          item.unresolved = true
          return
        }
        const dep = resolve(file, node.value)
        if (dep) item.deps.push(dep)
      }
      traverse(ast, {
        ImportDeclaration(p) {
          dependency(p.node.source)
        },
        ExportNamedDeclaration(p) {
          if (p.node.source) dependency(p.node.source)
        },
        ExportAllDeclaration(p) {
          dependency(p.node.source)
        },
        CallExpression(p) {
          if (t.isImport(p.node.callee) || t.isIdentifier(p.node.callee, { name: 'require' }))
            dependency(p.node.arguments[0])
        },
        ImportExpression(p) {
          dependency(p.node.source)
        },
        JSXElement() {
          item.jsx = true
        },
      })
    } catch {
      item.unresolved = true
    }
    moduleInfo.set(file, item)
    return item
  }
  const mightImport = (file: string, text: string, target: string): boolean => {
    if (file === target || !/\.[cm]?[jt]sx?$/.test(file)) return false
    const stem = target.replace(/\.[cm]?[jt]sx?$/, '')
    const alias = stem.startsWith('apps/sim/') ? `@/${stem.slice('apps/sim/'.length)}` : stem
    const relative = posix.relative(posix.dirname(file), stem)
    const local = relative.startsWith('.') ? relative : `./${relative}`
    if (text.includes(alias) || text.includes(local)) return true
    if (posix.basename(stem) === 'index' && text.includes(alias.slice(0, -'/index'.length)))
      return true
    if (!/\b(?:import|require)\s*\(/.test(text)) return false
    const aliasDirectory = `${posix.dirname(alias)}/`
    const localDirectory = `${posix.dirname(local)}/`
    return text.includes(aliasDirectory) || text.includes(localDirectory)
  }
  for (const file of marketing.filter((p) => ownershipTexts.has(p))) {
    const visited = new Set<string>()
    const owners = new Set<string>()
    let valid = !report.unchecked.some(
      (item) => item.context === 'typography source ownership' && /\.[cm]?[jt]sx?$/.test(item.file)
    )
    const walk = (target: string, stack: Set<string>) => {
      if (stack.has(target)) {
        valid = false
        return
      }
      if (visited.has(target)) return
      visited.add(target)
      const candidates = [...ownershipTexts].filter(([p, text]) => mightImport(p, text, target))
      if (candidates.some(([p]) => info(p).unresolved)) valid = false
      const callers = candidates.filter(([p]) => info(p).deps.includes(target)).map(([p]) => p)
      if (!callers.length) valid = false
      for (const caller of callers) {
        const details = info(caller)
        if (details.unresolved) valid = false
        if (
          caller.startsWith('apps/sim/app/(landing)/') ||
          caller.startsWith('apps/docs/') ||
          caller.startsWith('apps/sim/app/(docs)/') ||
          (caller === 'apps/sim/app/sitemap.ts' && !details.jsx)
        )
          owners.add(caller)
        else if (caller.startsWith('apps/sim/lib/')) walk(caller, new Set(stack).add(target))
        else valid = false
      }
    }
    walk(file, new Set())
    report.ownership.push({
      file,
      status: valid && owners.size ? 'verified' : 'unresolved',
      owners: [...owners].sort(),
    })
  }
  return report
}

export function classifyTypography<T extends Finding>(
  findings: T[],
  review: TypographyReview
): T[] {
  return findings.filter((f) => {
    if (review.ownership.some((o) => o.file === f.file && o.status === 'verified')) {
      review.classifications.push({
        file: f.file,
        line: f.line,
        column: f.column,
        property: f.property,
        value: f.value,
        disposition: 'marketing',
        reason:
          'Verified literal-import ownership reaches only landing/docs routes or the non-UI sitemap',
      })
      return false
    }
    if (f.rule !== 'central-typography') return true
    return !review.classifications.some(
      (c) =>
        c.file === f.file &&
        c.line === f.line &&
        c.column === f.column &&
        c.property === f.property &&
        value(c.value) === value(f.provenance?.input ?? f.value)
    )
  })
}
