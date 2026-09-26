import { posix } from 'node:path'
import { parse } from '@babel/parser'
import traverse, { type NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import { type DefaultTreeAdapterMap, parse as parseHtml } from 'parse5'
import postcss from 'postcss'
import { artworkSyntax } from '#design-conformance/artwork'
import { componentContract } from '#design-conformance/contracts'
import type { Reference } from '#design-conformance/design-system'
import { iconScope } from '#design-conformance/icon-scope'
import {
  type Atom,
  type Facts,
  hash,
  type Surface,
  type UnresolvedInput,
} from '#design-conformance/model'
import {
  htmlArtwork,
  htmlSink,
  presentationProperty,
  presentationValue,
  renderedHtml,
  visibleHtmlText,
} from '#design-conformance/rendered-html'
import { modulePath, type Route, summarize } from '#design-conformance/source-summary'

const classHelpers = new Set(['cn', 'clsx', 'classNames', 'twMerge'])
const media = new Set([
  'svg',
  'img',
  'image',
  'video',
  'audio',
  'canvas',
  'picture',
  'source',
  'Image',
])
const kebab = (key: string) =>
  key.startsWith('--') ? key : key.replace(/[A-Z]/g, (x) => `-${x.toLowerCase()}`)
/** Parse source as data. Trees and lexical bindings live only for this call. */
export function extract(
  text: string,
  file: string,
  appearance = true,
  options?: { conformance: boolean; resolve: (ref: string) => Reference | undefined }
): Facts {
  const facts: Facts = { atoms: [], unchecked: [], surfaces: [] }
  let current: Surface | undefined
  const surface = (
    kind: Surface['kind'],
    owner: string,
    target: string,
    line = 1,
    column = 1,
    shared = false
  ): Surface => {
    const result: Surface = { kind, owner, target, shared, line, column, atoms: [], references: [] }
    facts.surfaces?.push(result)
    return result
  }
  const within = (s: Surface, run: () => void) => {
    const previous = current
    current = s
    try {
      run()
    } finally {
      current = previous
    }
  }
  if (Buffer.byteLength(text) > 2 * 1024 * 1024)
    return {
      atoms: [],
      unchecked: [{ line: 1, context: '', reason: 'Source exceeds the 2 MiB parsing limit' }],
    }
  const add = (
    kind: Atom['kind'],
    property: string,
    value: string,
    line = 1,
    column = 1,
    context = '',
    reference?: string
  ) => {
    const atom: Atom = {
      kind,
      property,
      value,
      line,
      column,
      context,
      ...(reference ? { reference } : {}),
    }
    facts.atoms.push(atom)
    current?.atoms.push(atom)
  }
  const css = (source: string, lineOffset = 0, inline = false) => {
    const root = postcss.parse(inline ? `x{${source}}` : source)
    const groups = new Map<unknown, Surface>()
    root.walkDecls((d) => {
      const context: string[] = []
      let parent = d.parent
      while (parent && parent.type !== 'root') {
        if (parent.type === 'rule' && !inline) context.unshift(parent.selector)
        if (parent.type === 'atrule') context.unshift(`@${parent.name} ${parent.params}`)
        parent = parent.parent
      }
      const record = () =>
        add(
          d.prop.startsWith('--') ? 'token' : 'style',
          d.prop,
          d.value + (d.important ? ' !important' : ''),
          (d.source?.start?.line ?? 1) + lineOffset,
          d.source?.start?.column ?? 1,
          context.join(' > ')
        )
      if (inline && current) record()
      else {
        let group = groups.get(d.parent)
        if (!group) {
          group = surface(
            'definition',
            'css',
            context.join(' > '),
            (d.source?.start?.line ?? 1) + lineOffset
          )
          groups.set(d.parent, group)
        }
        within(group, record)
      }
    })
    root.walkAtRules((rule) => {
      if (!['plugin', 'custom-variant', 'source', 'import'].includes(rule.name)) return
      within(
        surface('definition', 'css-infrastructure', `@${rule.name}`, rule.source?.start?.line),
        () => add('style', `@${rule.name}`, rule.params, rule.source?.start?.line)
      )
    })
  }
  let parsed = false
  try {
    if (file.endsWith('.css')) {
      css(text)
      return facts
    }
    if (/\.html?$/.test(file)) {
      const visit = (node: DefaultTreeAdapterMap['node'], excluded = false, inSvg = false) => {
        const element = node as DefaultTreeAdapterMap['element']
        const svg = inSvg || element.tagName === 'svg'
        const skip =
          excluded ||
          (options?.conformance ? htmlArtwork(element, svg) : media.has(element.tagName))
        if (!skip) {
          const group = surface(
            'element',
            'html',
            element.tagName ?? 'document',
            element.sourceCodeLocation?.startLine
          )
          within(group, () => {
            for (const a of element.attrs ?? []) {
              const loc = element.sourceCodeLocation?.attrs?.[a.name]
              if (a.name === 'class')
                for (const value of a.value.split(/\s+/).filter(Boolean))
                  add('class', 'class', value, loc?.startLine, loc?.startCol)
              if (a.name === 'style') css(a.value, (loc?.startLine ?? 1) - 1, true)
              const property = options?.conformance ? presentationProperty(a.name) : undefined
              if (
                property &&
                (!svg || !['svg', 'g'].includes(element.tagName) || visibleHtmlText(element))
              )
                add(
                  'style',
                  property,
                  presentationValue(property, a.value),
                  loc?.startLine,
                  loc?.startCol,
                  'attribute'
                )
            }
            if (element.tagName === 'style')
              css(
                (element.childNodes ?? []).map((n) => ('value' in n ? n.value : '')).join(''),
                (element.sourceCodeLocation?.startLine ?? 1) - 1
              )
          })
        }
        for (const child of 'childNodes' in node ? node.childNodes : [])
          visit(child, skip || (!options?.conformance && media.has(element.tagName)), svg)
      }
      visit(parseHtml(text, { sourceCodeLocationInfo: true }))
      return facts
    }
    const ast = parse(text, {
      sourceType: 'unambiguous',
      plugins: ['typescript', 'jsx'],
      errorRecovery: false,
    })
    parsed = true
    if (options?.conformance) facts.syntax = summarize(ast, file)
    const emitted = new Set<string>()
    const mediaNames = new Set(media)
    for (const statement of ast.program.body)
      if (
        t.isImportDeclaration(statement) &&
        /^(?:next\/(?:legacy\/)?image|lucide-react|react-icons(?:\/|$)|@sim\/emcn\/icons$)|(?:^|\/)icons(?:\.|\/|$)/.test(
          statement.source.value
        )
      )
        for (const specifier of statement.specifiers) mediaNames.add(specifier.local.name)
    const note = (
      p: NodePath,
      reason: string,
      channel: UnresolvedInput['channel'] = 'class',
      property = '*'
    ) => {
      if (current) {
        const route: string[] = []
        let q: NodePath | null = p
        while (q && !q.isJSXElement() && !q.isVariableDeclarator()) {
          route.unshift(`${q.listKey ?? ''}:${q.key}:${q.node?.type ?? 'empty'}`)
          if (q.isJSXAttribute()) break
          q = q.parentPath
        }
        const expression = hash(
          JSON.stringify(p.node, (key, value) => {
            if (
              [
                'start',
                'end',
                'loc',
                'extra',
                'leadingComments',
                'trailingComments',
                'innerComments',
              ].includes(key)
            )
              return undefined
            if (value && typeof value === 'object' && value.type === 'Identifier')
              return { type: 'Identifier', name: imported(p, value.name) ?? value.name }
            return value
          })
        )
        current.unresolved ??= []
        current.unresolved.push({
          channel,
          property,
          expression,
          position: route.join('/'),
          line: p.node?.loc?.start.line ?? p.parentPath?.node?.loc?.start.line ?? 1,
        })
      }
      const node = p.node ?? p.parentPath?.node
      const input = text.slice(node?.start ?? 0, node?.end ?? 0).replace(/\s+/g, ' ')
      facts.unchecked.push({
        line: p.node?.loc?.start.line ?? p.parentPath?.node?.loc?.start.line ?? 1,
        context: node?.type ?? 'empty-expression',
        reason: appearance
          ? `${reason}; ${channel}:${property} input ${input.length > 180 ? `${input.slice(0, 180)}…` : input}`
          : reason,
      })
    }
    const name = (p: NodePath): string => {
      if (p.isIdentifier()) return p.node.name
      if (p.isStringLiteral()) return p.node.value
      return ''
    }
    const owner = (p: NodePath): string => {
      if (options?.conformance) {
        let q: NodePath | null = p.parentPath
        while (q) {
          if (q.isFunctionDeclaration()) return q.node.id?.name ?? 'default'
          if (q.isFunction() && q.parentPath.isVariableDeclarator())
            return name(q.parentPath.get('id'))
          q = q.parentPath
        }
      }
      const fn = p.findParent((q) => q.isFunction())
      if (fn?.isFunctionDeclaration()) return fn.node.id?.name ?? 'default'
      if (fn?.parentPath?.isVariableDeclarator()) return name(fn.parentPath.get('id'))
      const decl = p.findParent((q) => q.isVariableDeclarator())
      return decl?.isVariableDeclarator() ? name(decl.get('id')) : 'module'
    }
    const imported = (p: NodePath, local: string, depth = 0): string | undefined => {
      if (depth >= 12) return undefined
      if (options?.conformance && local.includes('.')) {
        const [first, ...rest] = local.split('.')
        const ref = imported(p, first, depth + 1)
        return ref
          ? ref.endsWith('#*')
            ? ref.slice(0, -1) + rest.join('.')
            : `${ref}.${rest.join('.')}`
          : undefined
      }
      const b = p.scope.getBinding(local)
      if (options?.conformance && b?.constant && b.path.isVariableDeclarator()) {
        const init = b.path.get('init')
        if (init.isIdentifier()) return imported(init, init.node.name, depth + 1)
        if (
          init.isMemberExpression() &&
          !init.node.computed &&
          t.isIdentifier(init.node.object) &&
          t.isIdentifier(init.node.property)
        )
          return imported(init, `${init.node.object.name}.${init.node.property.name}`, depth + 1)
      }
      if (
        b &&
        (b.path.isImportSpecifier() ||
          b.path.isImportDefaultSpecifier() ||
          b.path.isImportNamespaceSpecifier())
      ) {
        const declaration = b.path.parentPath
        if (declaration.isImportDeclaration()) {
          const source = declaration.node.source.value
          const resolved = source.startsWith('.')
            ? posix.normalize(posix.join(posix.dirname(file), source))
            : source.startsWith('@/') && file.startsWith('apps/sim/')
              ? `apps/sim/${source.slice(2)}`
              : source
          return `${resolved.replace(/\.[cm]?[jt]sx?$/, '')}#${b.path.isImportSpecifier() ? name(b.path.get('imported')) : b.path.isImportDefaultSpecifier() ? 'default' : '*'}`
        }
      }
      return undefined
    }
    const helper = (p: NodePath): string => {
      const n = name(p)
      const binding = p.scope.getBinding(n)
      if (binding?.path.isImportSpecifier()) return name(binding.path.get('imported'))
      if (
        binding?.path.isImportDefaultSpecifier() &&
        binding.path.parentPath.isImportDeclaration()
      ) {
        const source = binding.path.parentPath.node.source.value
        if (source === 'clsx') return 'clsx'
        if (source === 'classnames') return 'classNames'
      }
      return n
    }
    const isIcon = iconScope(imported)
    const jsxName = (node: t.JSXElement['openingElement']['name']): string =>
      t.isJSXIdentifier(node)
        ? node.name
        : t.isJSXMemberExpression(node)
          ? `${jsxName(node.object)}.${node.property.name}`
          : ''
    const targetFor = (p: NodePath, node: t.JSXElement['openingElement']['name']): string => {
      const tag = jsxName(node)
      return imported(p, tag) ?? tag
    }
    const referenceFor = (p: NodePath, node: t.JSXElement['openingElement']['name']): string => {
      const tag = jsxName(node)
      return imported(p, tag) ?? (/^[A-Z]/.test(tag) ? `${modulePath(file)}#${tag}` : tag)
    }
    const routesFor = (p: NodePath): Route[] => {
      const routes: Route[] = []
      let parent: NodePath | null = p.parentPath
      let slot = 'children'
      while (parent) {
        if (parent.isFunction()) {
          const call = parent.parentPath
          if (
            !call.isCallExpression() ||
            !t.isMemberExpression(call.node.callee) ||
            !t.isIdentifier(call.node.callee.property, { name: 'map' })
          )
            break
        }
        if (parent.isJSXAttribute())
          slot = t.isJSXIdentifier(parent.node.name) ? parent.node.name.name : 'children'
        if (parent.isJSXElement()) {
          routes.push({ target: referenceFor(parent, parent.node.openingElement.name), slot })
          slot = 'children'
        }
        parent = parent.parentPath
      }
      return routes
    }
    const emit = (
      p: NodePath,
      kind: Atom['kind'],
      property: string,
      value: string,
      context = '',
      reference?: string
    ) => {
      const key = `${p.node.start}:${kind}:${property}:${value}`
      if (emitted.has(key)) {
        current?.atoms.push({
          kind,
          property,
          value,
          ...(reference ? { reference } : {}),
          context,
          line: p.node.loc?.start.line ?? 1,
          column: (p.node.loc?.start.column ?? 0) + 1,
        })
        return
      }
      emitted.add(key)
      add(
        kind,
        property,
        value,
        p.node.loc?.start.line,
        (p.node.loc?.start.column ?? 0) + 1,
        context,
        reference
      )
    }
    const literal = (p: NodePath, active = new Set<t.Node>(), depth = 0): string | undefined => {
      if (!p.node || depth > 12 || active.has(p.node)) return undefined
      const next = new Set(active).add(p.node)
      if (p.isStringLiteral() || p.isNumericLiteral()) return String(p.node.value)
      if (p.isUnaryExpression({ operator: '-' })) {
        const x = literal(p.get('argument'), next, depth + 1)
        return x !== undefined ? `-${x}` : undefined
      }
      if (p.isTSAsExpression() || p.isTSNonNullExpression() || p.isTSSatisfiesExpression())
        return literal(p.get('expression') as NodePath, next, depth + 1)
      if (p.isIdentifier()) {
        const b = p.scope.getBinding(p.node.name)
        if (b?.constant && b.path.isVariableDeclarator())
          return literal(b.path.get('init') as NodePath, next, depth + 1)
      }
      if (p.isTemplateLiteral()) {
        let out = p.node.quasis[0].value.cooked ?? p.node.quasis[0].value.raw
        for (const [i, e] of (p.get('expressions') as NodePath[]).entries()) {
          const v = literal(e, next, depth + 1)
          if (v === undefined) return undefined
          out += v + (p.node.quasis[i + 1].value.cooked ?? p.node.quasis[i + 1].value.raw)
        }
        return out
      }
      if (p.isBinaryExpression({ operator: '+' })) {
        const a = literal(p.get('left'), next, depth + 1)
        const b = literal(p.get('right'), next, depth + 1)
        if (a !== undefined && b !== undefined && !(/^[-\d.]+$/.test(a) && /^[-\d.]+$/.test(b)))
          return a + b
      }
      if (p.isMemberExpression() && !p.node.computed && p.get('object').isIdentifier()) {
        const b = p.scope.getBinding((p.node.object as t.Identifier).name)
        if (b?.constant && b.path.isVariableDeclarator()) {
          const init = b.path.get('init')
          if (init.isObjectExpression()) {
            if (
              init.node.properties.some((x) => !t.isObjectProperty(x) || x.computed) ||
              b.referencePaths.some((ref) => {
                const parent = ref.parentPath
                return (
                  !parent?.isMemberExpression() ||
                  parent.node.object !== ref.node ||
                  parent.parentPath.isAssignmentExpression() ||
                  parent.parentPath.isUpdateExpression() ||
                  parent.parentPath.isUnaryExpression({ operator: 'delete' }) ||
                  (parent.parentPath.isCallExpression() &&
                    parent.parentPath.node.callee === parent.node)
                )
              })
            )
              return undefined
            const prop = init
              .get('properties')
              .find(
                (x) =>
                  x.isObjectProperty() &&
                  !x.node.computed &&
                  name(x.get('key')) === name(p.get('property') as NodePath)
              )
            if (prop?.isObjectProperty()) return literal(prop.get('value'), next, depth + 1)
          }
        }
      }
      return undefined
    }
    const classes = (p: NodePath, active = new Set<t.Node>(), depth = 0, context = ''): void => {
      if (!p.node) return
      if (depth > 12 || active.has(p.node)) {
        note(p, 'Local class resolution limit or cycle')
        return
      }
      if (options?.conformance && p.isIdentifier()) {
        const ref = imported(p, p.node.name)
        const resolved = ref ? options.resolve(ref) : undefined
        if (ref && resolved?.value !== undefined) {
          current?.references.push(ref)
          for (const token of resolved.value.split(/\s+/).filter(Boolean))
            emit(p, 'class', 'class', token, context, ref)
          return
        }
        if (ref) {
          emit(p, 'class', 'class', '<unresolved>', context)
          const atom = current?.atoms.at(-1)
          if (atom) atom.pendingRef = ref
          return
        }
      }
      if (options?.conformance && p.isCallExpression() && p.get('callee').isIdentifier()) {
        const ref = imported(p, (p.node.callee as t.Identifier).name)
        if (ref && options.resolve(ref)?.recipe) {
          current?.references.push(ref)
          for (const arg of p.get('arguments'))
            if (arg.isObjectExpression())
              for (const prop of arg.get('properties'))
                if (
                  prop.isObjectProperty() &&
                  ['class', 'className'].includes(name(prop.get('key')))
                )
                  classes(prop.get('value'), active, depth + 1, context)
          return
        }
      }
      const value = literal(p)
      if (value !== undefined) {
        for (const x of value.split(/\s+/).filter(Boolean)) emit(p, 'class', 'class', x, context)
        return
      }
      const next = new Set(active).add(p.node)
      const rec = (q: NodePath, branch = '') => classes(q, next, depth + 1, context + branch)
      if (p.isNullLiteral() || p.isBooleanLiteral()) return
      if (p.isTSAsExpression() || p.isTSNonNullExpression() || p.isTSSatisfiesExpression()) {
        rec(p.get('expression') as NodePath)
        return
      }
      if (p.isConditionalExpression()) {
        rec(p.get('consequent'), '/then')
        rec(p.get('alternate'), '/else')
        return
      }
      if (p.isLogicalExpression()) {
        rec(p.get('right'), `/${p.node.operator}:right`)
        if (p.node.operator !== '&&') rec(p.get('left'), `/${p.node.operator}:left`)
        return
      }
      if (p.isArrayExpression()) {
        for (const x of p.get('elements')) rec(x as NodePath)
        return
      }
      if (p.isObjectExpression()) {
        for (const x of p.get('properties')) {
          if (x.isObjectProperty() && !x.node.computed) {
            const k = x.get('key')
            const v = name(k)
            if (v && !x.get('value').isBooleanLiteral({ value: false }))
              for (const c of v.split(/\s+/)) emit(k, 'class', 'class', c, `${context}/enabled`)
          } else note(x, 'Computed/spread class map is unchecked')
        }
        return
      }
      if (p.isCallExpression() && classHelpers.has(helper(p.get('callee')))) {
        for (const x of p.get('arguments')) rec(x as NodePath)
        return
      }
      if (p.isIdentifier()) {
        const ref = imported(p, p.node.name)
        if (ref) current?.references.push(ref)
        const b = p.scope.getBinding(p.node.name)
        if (b?.constant && b.path.isVariableDeclarator()) {
          rec(b.path.get('init') as NodePath)
          return
        }
      }
      if (p.isTemplateLiteral() && options?.conformance) {
        for (const [i, q] of p.node.quasis.entries()) {
          const raw = q.value.cooked ?? q.value.raw
          const safe = raw.slice(
            i > 0 && !/^\s/.test(raw) ? (raw.search(/\s/) < 0 ? raw.length : raw.search(/\s/)) : 0,
            i < p.node.expressions.length && !/\s$/.test(raw)
              ? Math.max(0, raw.lastIndexOf(' '))
              : raw.length
          )
          for (const token of safe.split(/\s+/).filter(Boolean))
            emit(p, 'class', 'class', token, context)
          const expression = p.get('expressions')[i]
          if (expression) {
            const following = p.node.quasis[i + 1].value.cooked ?? p.node.quasis[i + 1].value.raw
            if ((!raw || /\s$/.test(raw)) && (!following || /^\s/.test(following)))
              rec(expression as NodePath)
            else note(expression as NodePath, 'Dynamic class fragment is unchecked')
          }
        }
        return
      }
      if (p.isTemplateLiteral()) {
        for (const e of p.get('expressions'))
          note(e, 'Dynamic template: only whitespace-delimited static classes checked')
        for (const [i, q] of p.node.quasis.entries()) {
          const raw = q.value.cooked ?? q.value.raw
          const safe = raw.slice(
            i > 0 && !/^\s/.test(raw) ? (raw.search(/\s/) < 0 ? raw.length : raw.search(/\s/)) : 0,
            i < p.node.expressions.length && !/\s$/.test(raw)
              ? Math.max(0, raw.lastIndexOf(' '))
              : raw.length
          )
          for (const c of safe.split(/\s+/).filter(Boolean)) emit(p, 'class', 'class', c, context)
        }
        return
      }
      note(p, 'Imported helper or computed class expression is unchecked')
    }
    const centralValue = (
      p: NodePath,
      seen = new Set<t.Node>()
    ): { ref: string; value: string } | undefined => {
      if (!p.node || seen.size > 12 || seen.has(p.node)) return undefined
      const next = new Set(seen).add(p.node)
      if (p.isIdentifier()) {
        const ref = imported(p, p.node.name)
        const resolved = ref ? options?.resolve(ref) : undefined
        if (ref && resolved?.value !== undefined) return { ref, value: resolved.value }
        const binding = p.scope.getBinding(p.node.name)
        if (binding?.constant && binding.path.isVariableDeclarator())
          return centralValue(binding.path.get('init') as NodePath, next)
      }
      return undefined
    }
    const styles = (p: NodePath, active = new Set<t.Node>(), context = ''): void => {
      if (!p.node || active.has(p.node) || active.size > 12) {
        if (p.node) note(p, 'Local style resolution limit', 'style')
        return
      }
      const next = new Set(active).add(p.node)
      if (p.isIdentifier()) {
        const b = p.scope.getBinding(p.node.name)
        if (b?.constant && b.path.isVariableDeclarator()) {
          styles(b.path.get('init') as NodePath, next, context)
          return
        }
      }
      if (p.isTSAsExpression() || p.isTSSatisfiesExpression()) {
        styles(p.get('expression') as NodePath, next, context)
        return
      }
      if (p.isConditionalExpression()) {
        if (options?.conformance && p.get('test').isBooleanLiteral()) {
          styles(
            p.node.test.type === 'BooleanLiteral' && p.node.test.value
              ? p.get('consequent')
              : p.get('alternate'),
            next,
            context
          )
          return
        }
        styles(p.get('consequent'), next, `${context}/then`)
        styles(p.get('alternate'), next, `${context}/else`)
        return
      }
      if (options?.conformance && p.isLogicalExpression()) {
        if (p.get('left').isBooleanLiteral()) {
          const truth = t.isBooleanLiteral(p.node.left) && p.node.left.value
          if ((p.node.operator === '&&' && truth) || (p.node.operator === '||' && !truth))
            styles(p.get('right'), next, context)
        } else {
          styles(p.get('right'), next, `${context}/${p.node.operator}:right`)
          if (p.node.operator !== '&&')
            styles(p.get('left'), next, `${context}/${p.node.operator}:left`)
        }
        return
      }
      if (options?.conformance && (p.isBooleanLiteral() || p.isNullLiteral())) return
      if (!p.isObjectExpression()) {
        note(p, 'Computed style object is unchecked', 'style')
        return
      }
      for (const prop of p.get('properties')) {
        if (options?.conformance && prop.isSpreadElement()) {
          styles(prop.get('argument'), next, context)
          continue
        }
        if (!prop.isObjectProperty() || prop.node.computed) {
          note(prop, 'Style spread/computed property is unchecked', 'style')
          continue
        }
        const key = kebab(name(prop.get('key')))
        const v = prop.get('value')
        const central = options?.conformance ? centralValue(v) : undefined
        const value = central?.value ?? literal(v)
        if (value === undefined) {
          const ref =
            options?.conformance && v.isIdentifier() ? imported(v, v.node.name) : undefined
          if (ref) {
            emit(v, 'style', key, '<unresolved>', context)
            const atom = current?.atoms.at(-1)
            if (atom) atom.pendingRef = ref
            continue
          }
          if (options?.conformance && /^(?:box|text)-shadow$/.test(key)) {
            const parts = partial(v)
            if (
              parts &&
              /^(?:inset\s+)?(?:-?(?:\d*\.)?\d+(?:px|rem|em)?\s+){2,4}var\(--lint-dynamic-0\)$/.test(
                parts.expression
              )
            ) {
              emit(v, 'style', key, parts.expression, context)
              const atom = current?.atoms.at(-1)
              if (atom) atom.partial = parts
              continue
            }
          }
          note(v, `Computed ${key} is unchecked`, 'style', key)
          continue
        }
        const unitless =
          /^(?:opacity|z-index|font-weight|line-height|flex(?:-grow|-shrink)?|order|scale|aspect-ratio)$/
        emit(
          v,
          'style',
          key,
          /^-?(?:\d*\.)?\d+$/.test(value) &&
            !unitless.test(key) &&
            !key.startsWith('--') &&
            value !== '0'
            ? `${value}px`
            : value,
          context,
          central?.ref
        )
      }
    }
    const partial = (
      p: NodePath,
      seen = new Set<t.Node>()
    ): { expression: string; inputs: string[] } | undefined => {
      if (seen.has(p.node) || seen.size >= 12) return undefined
      const next = new Set(seen).add(p.node)
      const known = literal(p)
      if (known !== undefined) return { expression: known, inputs: [] }
      const parts: (string | NodePath)[] = []
      if (p.isTemplateLiteral())
        for (let i = 0; i < p.node.quasis.length; i++) {
          parts.push(p.node.quasis[i].value.cooked ?? p.node.quasis[i].value.raw)
          if (i < p.node.expressions.length) parts.push(p.get('expressions')[i] as NodePath)
        }
      else if (p.isBinaryExpression({ operator: '+' })) parts.push(p.get('left'), p.get('right'))
      else if (p.isIdentifier()) {
        const b = p.scope.getBinding(p.node.name)
        if (b?.constant && b.path.isVariableDeclarator())
          return partial(b.path.get('init') as NodePath, next)
        return {
          expression: 'var(--lint-dynamic-0)',
          inputs: [imported(p, p.node.name) ?? p.node.name],
        }
      } else return undefined
      const inputs: string[] = []
      const out: string[] = []
      for (const part of parts) {
        const v = typeof part === 'string' ? { expression: part, inputs: [] } : partial(part, next)
        if (!v) return undefined
        const offset = inputs.length
        out.push(
          v.expression.replace(
            /--lint-dynamic-(\d+)/g,
            (_, n) => `--lint-dynamic-${offset + Number(n)}`
          )
        )
        inputs.push(...v.inputs)
      }
      return { expression: out.join(''), inputs }
    }
    const variantValues = (p: NodePath, context = ''): void => {
      if (p.isObjectExpression())
        for (const prop of p.get('properties')) {
          if (!prop.isObjectProperty()) {
            note(prop, 'Variant spread is unchecked')
            continue
          }
          const value = prop.get('value')
          const branch = `${context}/${name(prop.get('key'))}`
          if (value.isObjectExpression()) variantValues(value, branch)
          else classes(value, new Set(), 0, branch)
        }
    }
    const elements = new WeakMap<t.Node, Surface>()
    const svgText = new WeakMap<t.Node, boolean>()
    const containsSvgText = (node: t.Node): boolean => {
      const hit = svgText.get(node)
      if (hit !== undefined) return hit
      let found = false
      t.traverseFast(node, (n) => {
        if (t.isJSXElement(n) && ['text', 'tspan'].includes(jsxName(n.openingElement.name)))
          found = true
      })
      svgText.set(node, found)
      return found
    }
    const htmlInputs = new Set<t.Node>()
    const html = (p: NodePath) => {
      if (!appearance) return
      if (p.isObjectProperty() && !/^apps\/sim\/(?:blocks|triggers|app)\//.test(file)) return
      const input = htmlSink(p)
      if (!input || htmlInputs.has(input.node)) return
      htmlInputs.add(input.node)
      const result = renderedHtml(input, text, owner(p), options?.conformance)
      facts.surfaces?.push(...result.surfaces)
      for (const s of result.surfaces) facts.atoms.push(...s.atoms)
      facts.unchecked.push(...result.unchecked)
    }
    traverse(ast, {
      JSXElement(p) {
        if (
          options?.conformance &&
          t.isJSXIdentifier(p.node.openingElement.name, { name: 'svg' }) &&
          !containsSvgText(p.node) &&
          !p.findParent(
            (q) =>
              q.isJSXElement() && t.isJSXIdentifier(q.node.openingElement.name, { name: 'svg' })
          ) &&
          p.node.children.some(
            (c) => t.isJSXElement(c) && !['title', 'desc'].includes(jsxName(c.openingElement.name))
          )
        ) {
          facts.artwork ??= []
          facts.artwork.push({
            value: hash(artworkSyntax(p.node)),
            input: 'locally authored SVG artwork',
            line: p.node.loc?.start.line ?? 1,
            column: (p.node.loc?.start.column ?? 0) + 1,
            context: owner(p),
          })
        }
        if (
          (!options?.conformance && appearance && isIcon(p)) ||
          (!options?.conformance &&
            mediaNames.has(
              t.isJSXIdentifier(p.node.openingElement.name) ? p.node.openingElement.name.name : ''
            )) ||
          (options?.conformance &&
            Boolean(
              p.findParent(
                (q) =>
                  q.isJSXElement() &&
                  t.isJSXIdentifier(q.node.openingElement.name) &&
                  media.has(q.node.openingElement.name.name) &&
                  q.node.openingElement.name.name !== 'svg'
              )
            )) ||
          (options?.conformance &&
            p.findParent(
              (q) =>
                q.isJSXElement() && t.isJSXIdentifier(q.node.openingElement.name, { name: 'svg' })
            ) &&
            (!['text', 'tspan', 'g', 'svg', 'foreignObject'].includes(
              jsxName(p.node.openingElement.name)
            ) ||
              (['g', 'svg'].includes(jsxName(p.node.openingElement.name)) &&
                !containsSvgText(p.node))))
        ) {
          p.skip()
          return
        }
        const tag = t.isJSXIdentifier(p.node.openingElement.name)
          ? p.node.openingElement.name.name
          : text.slice(p.node.openingElement.name.start ?? 0, p.node.openingElement.name.end ?? 0)
        const target = targetFor(p, p.node.openingElement.name)
        elements.set(
          p.node,
          surface(
            'element',
            owner(p),
            target,
            p.node.loc?.start.line,
            (p.node.loc?.start.column ?? 0) + 1,
            /^@sim\/emcn#/.test(target)
          )
        )
        if (options?.conformance) {
          const group = elements.get(p.node) as Surface
          group.componentRef = /^[A-Z]/.test(tag)
            ? referenceFor(p, p.node.openingElement.name)
            : undefined
          group.routes = routesFor(p)
          if (group.componentRef) {
            group.providedProps = p.node.openingElement.attributes.flatMap((a) =>
              t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) ? [a.name.name] : []
            )
            if (p.node.children.some((c) => !t.isJSXText(c) || c.value.trim()))
              group.providedProps.push('children')
            group.unknownProps = p.node.openingElement.attributes.some((a) =>
              t.isJSXSpreadAttribute(a)
            )
          }
          const required = new Set<string>()
          const testProps = (test: NodePath, truth: boolean): void => {
            if (test.isUnaryExpression({ operator: '!' })) {
              testProps(test.get('argument'), !truth)
              return
            }
            if (
              test.isLogicalExpression() &&
              ((truth && test.node.operator === '&&') || (!truth && test.node.operator === '||'))
            ) {
              testProps(test.get('left'), truth)
              testProps(test.get('right'), truth)
              return
            }
            if (!truth || !test.isIdentifier()) return
            const binding = test.scope.getBinding(test.node.name)
            if (binding?.kind !== 'param' || !binding.path.isObjectPattern()) return
            for (const prop of binding.path.node.properties)
              if (
                t.isObjectProperty(prop) &&
                t.isIdentifier(prop.value, { name: test.node.name }) &&
                !prop.computed
              )
                required.add(
                  t.isIdentifier(prop.key)
                    ? prop.key.name
                    : t.isStringLiteral(prop.key)
                      ? prop.key.value
                      : ''
                )
          }
          let branch: NodePath = p
          while (branch.parentPath && !branch.parentPath.isFunction()) {
            const up = branch.parentPath
            if (up.isConditionalExpression() && branch.key !== 'test')
              testProps(up.get('test'), branch.key === 'consequent')
            if (up.isLogicalExpression({ operator: '&&' }) && branch.key === 'right')
              testProps(up.get('left'), true)
            branch = up
          }
          if (required.size) group.requiredProps = [...required].filter(Boolean).sort()
          group.ancestors = []
          let parent: NodePath | null = p.parentPath
          while (parent) {
            if (parent.isJSXElement())
              group.ancestors.push(targetFor(parent, parent.node.openingElement.name))
            parent = parent.parentPath
          }
          const attr = p.findParent((q) => q.isJSXAttribute())
          if (
            attr?.isJSXAttribute() &&
            attr.parentPath.isJSXOpeningElement() &&
            t.isJSXIdentifier(attr.parentPath.node.name)
          ) {
            const container =
              imported(attr, attr.parentPath.node.name.name) ?? attr.parentPath.node.name.name
            if (
              componentContract(container)?.iconSlots?.includes(
                t.isJSXIdentifier(attr.node.name) ? attr.node.name.name : ''
              )
            )
              group.iconSlot = container
          }
          if (
            group.ancestors.includes('@sim/emcn#ChipModalBody') &&
            !group.ancestors.includes('@sim/emcn#ChipModalField') &&
            /(?:^|#)(?:ChipInput|ChipTextarea|ChipSelect|ChipCombobox|ChipDropdown|input|textarea|select)$/.test(
              target
            )
          ) {
            const parent = p.findParent((q) => q.isJSXElement())
            if (
              parent?.isJSXElement() &&
              parent.node.children.some(
                (c) =>
                  t.isJSXElement(c) &&
                  t.isJSXIdentifier(c.openingElement.name) &&
                  ['label', 'Label'].includes(c.openingElement.name.name)
              )
            )
              group.structuralViolation = 'Use ChipModalField for this directly labeled modal field'
          }
        }
      },
      JSXAttribute(p) {
        html(p)
        const key =
          name(p.get('name') as NodePath) ||
          (t.isJSXIdentifier(p.node.name) ? p.node.name.name : '')
        const value = p.get('value')
        const parent = p.parentPath.parentPath
        const group = parent ? elements.get(parent.node) : undefined
        if (!group) return
        within(group, () => {
          if (/^(?:class|className|.*ClassName)$/.test(key))
            classes(
              value.isJSXExpressionContainer() ? value.get('expression') : (value as NodePath),
              new Set(),
              0,
              key
            )
          if (key === 'style' && value.isJSXExpressionContainer())
            styles(value.get('expression'), new Set(), 'style')
          if (
            options?.conformance &&
            /^[a-z]/.test(group.target) &&
            [
              'fontSize',
              'font-size',
              'fontFamily',
              'font-family',
              'fontWeight',
              'font-weight',
              'color',
              'fill',
              'stroke',
            ].includes(key) &&
            (!['svg', 'g'].includes(group.target) || (parent && containsSvgText(parent.node)))
          ) {
            const prop = kebab(key)
            const v = value.isJSXExpressionContainer()
              ? value.get('expression')
              : (value as NodePath)
            const ref = v.isIdentifier() ? imported(v, v.node.name) : undefined
            const central = centralValue(v)
            const resolved = central?.value ?? literal(v)
            if (resolved !== undefined)
              emit(
                v,
                'style',
                prop,
                /^(?:font-size)$/.test(prop) && /^\d+(?:\.\d+)?$/.test(resolved)
                  ? `${resolved}px`
                  : resolved,
                'attribute',
                central?.ref
              )
            else if (ref) {
              emit(v, 'style', prop, '<unresolved>', 'attribute')
              const atom = group.atoms.at(-1)
              if (atom) atom.pendingRef = ref
            } else note(v, `Computed presentation attribute ${key} is unchecked`, 'prop', prop)
          }
          if (
            group.shared &&
            ['variant', 'size', 'shape', 'minWidth', 'maxWidth', 'width', 'height'].includes(key)
          ) {
            const v = value.isJSXExpressionContainer()
              ? value.get('expression')
              : (value as NodePath)
            const resolved = literal(v)
            if (resolved !== undefined) emit(v, 'style', `prop:${key}`, resolved)
            else note(p, `Computed appearance prop ${key} is unchecked`, 'prop', `prop:${key}`)
          }
        })
      },
      JSXSpreadAttribute(p) {
        const parent = p.parentPath.parentPath
        const group = parent ? elements.get(parent.node) : undefined
        if (group)
          within(group, () =>
            note(p, 'JSX spread precedence and forwarded appearance props are unchecked', 'spread')
          )
      },
      ObjectProperty(p) {
        html(p)
      },
      CallExpression(p) {
        if (helper(p.get('callee')) !== 'cva') return
        within(surface('recipe', owner(p), 'cva', p.node.loc?.start.line), () => {
          const args = p.get('arguments')
          if (args[0]) classes(args[0] as NodePath)
          if (args[1]?.isObjectExpression())
            for (const prop of args[1].get('properties')) {
              if (!prop.isObjectProperty()) continue
              const key = name(prop.get('key'))
              const value = prop.get('value')
              if (key === 'variants') variantValues(value, 'variants')
              if (key === 'defaultVariants' && value.isObjectExpression())
                for (const item of value.get('properties')) {
                  if (!item.isObjectProperty()) {
                    note(item, 'Computed default variant is unchecked')
                    continue
                  }
                  const v = literal(item.get('value'))
                  if (v !== undefined) emit(item, 'style', `default:${name(item.get('key'))}`, v)
                  else note(item, 'Computed default variant is unchecked')
                }
              if (key === 'compoundVariants' && value.isArrayExpression())
                for (const item of value.get('elements')) {
                  if (item.isObjectExpression()) {
                    const conditions = item.node.properties
                      .filter(
                        (x) =>
                          t.isObjectProperty(x) &&
                          !['class', 'className'].includes(
                            t.isIdentifier(x.key)
                              ? x.key.name
                              : t.isStringLiteral(x.key)
                                ? x.key.value
                                : ''
                          )
                      )
                      .map((x) => {
                        if (!t.isObjectProperty(x)) return ''
                        const value = x.value
                        return [
                          t.isIdentifier(x.key) ? x.key.name : '',
                          t.isStringLiteral(value) ||
                          t.isBooleanLiteral(value) ||
                          t.isNumericLiteral(value)
                            ? value.value
                            : '<unchecked>',
                        ]
                      })
                      .sort()
                    for (const cp of item.get('properties'))
                      if (
                        cp.isObjectProperty() &&
                        ['class', 'className'].includes(name(cp.get('key')))
                      )
                        classes(
                          cp.get('value'),
                          new Set(),
                          0,
                          `compound:${JSON.stringify(conditions)}`
                        )
                  }
                }
            }
        })
      },
      ExportNamedDeclaration(p) {
        const d = p.get('declaration')
        if (d.isVariableDeclaration())
          for (const decl of d.get('declarations'))
            if (
              decl.get('id').isIdentifier() &&
              /(?:Class|Classes|Tokens|Styles|_CLASS|_CLASSES|_TOKENS|_STYLES)$/.test(
                name(decl.get('id'))
              )
            )
              within(
                surface(
                  'definition',
                  name(decl.get('id')),
                  'exported-styling',
                  decl.node.loc?.start.line
                ),
                () => {
                  let init = decl.get('init') as NodePath
                  if (init.isTSAsExpression() || init.isTSSatisfiesExpression())
                    init = init.get('expression') as NodePath
                  if (init.isObjectExpression()) variantValues(init)
                  else classes(init)
                }
              )
      },
    })
    if (options?.conformance) {
      const fields = new Map<t.Node, { label: boolean; control: boolean; field: boolean }>()
      const shape = (
        node: t.Node,
        depth = 0
      ): { label: boolean; control: boolean; field: boolean } => {
        const hit = fields.get(node)
        if (hit) return hit
        const result = { label: false, control: false, field: false }
        if (depth > 48) return result
        fields.set(node, result)
        if (t.isJSXElement(node)) {
          const target = elements.get(node)?.target ?? ''
          if (target === '@sim/emcn#ChipModalField') {
            result.field = true
            return result
          }
          result.label = ['label', '@sim/emcn#Label'].includes(target)
          result.control =
            /^(?:@sim\/emcn#(?:ChipInput|ChipTextarea|ChipSelect|ChipCombobox|ChipDropdown|ChipSwitch|ChipDatePicker)|input|textarea|select)$/.test(
              target
            )
          result.field = result.control
          if (!result.control && !result.label && !/^[a-z][a-z0-9-]*$/.test(target)) return result
        }
        const childKeys = t.isJSXElement(node) ? ['children'] : (t.VISITOR_KEYS[node.type] ?? [])
        for (const childKey of childKeys) {
          const child = (node as unknown as Record<string, unknown>)[childKey]
          for (const c of Array.isArray(child) ? child : [child])
            if (c && typeof c === 'object' && 'type' in c) {
              const f = shape(c as t.Node, depth + 1)
              result.field ||= f.field
              result.label ||= f.label
              result.control ||= f.control
            }
        }
        return result
      }
      traverse(ast, {
        JSXElement(p) {
          const group = elements.get(p.node)
          if (!group || group.target !== 'div') return
          const f = shape(p.node)
          group.fieldGroup = f.field
          if (
            f.label &&
            f.control &&
            !p.node.children.some((c) => t.isJSXElement(c) && shape(c).label && shape(c).control)
          )
            group.fieldContainer = true
        },
      })
    }
  } catch (error) {
    facts.atoms = []
    facts.surfaces = []
    facts.unchecked.push({
      line: 1,
      context: '',
      reason: `${parsed ? 'Extraction failure' : 'Parser failure'}: ${String(error).slice(0, 240)}; file styling is unchecked`,
    })
  } finally {
    // All binding resolution is file-local. Drop Babel's path/scope caches at that boundary
    // instead of leaving their AST cycles for a later runtime garbage-collection pass.
    traverse.cache.clear()
  }
  return facts
}
