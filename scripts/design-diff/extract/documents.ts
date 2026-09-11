import { type DefaultTreeAdapterMap, parse as parseHtml } from 'parse5'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { appearanceAttributes, mediaElement } from '#design-diff/appearance'
import { parseSource, propertyName } from '#design-diff/ast'
import { extractCss } from '#design-diff/extract/css'
import type { Resolver } from '#design-diff/resolve'
import type { Data, Definition } from '#design-diff/types'

const markdown = unified().use(remarkParse).use(remarkGfm).use(remarkMdx).use(remarkFrontmatter)

export function extractDocument(source: string, file: string, resolver?: Resolver): Definition[] {
  const result: Definition[] = []
  const emit = (
    kind: Definition['kind'],
    value: Data,
    line = 1,
    column = 1,
    property: string = kind
  ) => {
    result.push({
      key: `${kind}:${result.length}`,
      kind,
      property,
      value,
      location: { file, line, column },
      symbol: 'document',
      conditions: [],
      dependencies: [file],
      unresolved: kind === 'review' ? ['Embedded rendering expression requires review'] : [],
    })
  }
  if (/\.html?$/.test(file)) {
    const errors: string[] = []
    const root = parseHtml(source, {
      sourceCodeLocationInfo: true,
      onParseError: (error) => {
        if (error.code !== 'missing-doctype') errors.push(error.code)
      },
    })
    const walk = (node: DefaultTreeAdapterMap['node']) => {
      const loc = node.sourceCodeLocation
      if ('tagName' in node) {
        if (mediaElement.test(node.tagName)) return
        if (node.tagName === 'script') return
        if (node.tagName === 'style') {
          for (const definition of extractCss(
            node.childNodes.map((n) => ('value' in n ? n.value : '')).join(''),
            file
          )) {
            definition.location.line += (loc?.startLine ?? 1) - 1
            definition.key = `embedded:${result.length}:${definition.key}`
            result.push(definition)
          }
          return
        }
        for (const attr of node.attrs)
          if (attr.name === 'class')
            emit('class', attr.value, loc?.startLine, loc?.startCol, 'class')
          else if (attr.name === 'style') {
            for (const definition of extractCss(`a{${attr.value}}`, file)) {
              definition.location = { file, line: loc?.startLine ?? 1, column: loc?.startCol ?? 1 }
              definition.key = `inline:${result.length}`
              result.push(definition)
            }
          } else if (appearanceAttributes.test(attr.name))
            emit('attribute', attr.value, loc?.startLine, loc?.startCol, attr.name)
        if ('content' in node) walk(node.content as DefaultTreeAdapterMap['documentFragment'])
      }
      if ('childNodes' in node) for (const child of node.childNodes) walk(child)
    }
    walk(root)
    if (errors.length) emit('review', errors)
  } else {
    const root = markdown.parse(source)
    const imports = root.children
      .filter((node) => node.type === 'mdxjsEsm' && 'value' in node)
      .map((node) => ('value' in node ? String(node.value) : ''))
      .join('\n')
    const bindings = new Map<string, { module: string; name: string }>()
    for (const statement of parseSource(imports, `${file}.tsx`).program.body) {
      if (statement.type !== 'ImportDeclaration') continue
      for (const specifier of statement.specifiers)
        bindings.set(specifier.local.name, {
          module: statement.source.value,
          name:
            specifier.type === 'ImportSpecifier'
              ? propertyName(specifier.imported)
              : specifier.type === 'ImportNamespaceSpecifier'
                ? '*'
                : 'default',
        })
    }
    const walk = (node: Record<string, Data>) => {
      if (typeof node.name === 'string' && mediaElement.test(node.name)) return
      const imported =
        typeof node.name === 'string' ? bindings.get(node.name.split('.')[0]) : undefined
      if (
        imported &&
        resolver?.tree.config.mediaModules?.some(
          (module) => imported.module === module || imported.module.startsWith(`${module}/`)
        )
      )
        return
      const content =
        imported &&
        resolver?.tree.config.documentationContent?.components.find(
          (component) =>
            component.module === imported.module &&
            component.names.includes(
              imported.name === '*' && typeof node.name === 'string'
                ? node.name.split('.')[1]
                : imported.name
            )
        )
      if (typeof node.name === 'string') {
        emit('markup', null, 1, 1, node.name)
        result[result.length - 1].appearance = { element: node.name }
      }
      if (Array.isArray(node.attributes)) {
        const position = node.position as { start?: { line?: number; column?: number } } | undefined
        for (const item of node.attributes) {
          if (
            !item ||
            typeof item !== 'object' ||
            Array.isArray(item) ||
            typeof item.name !== 'string' ||
            content?.contentProps.includes(item.name) ||
            !appearanceAttributes.test(item.name)
          )
            continue
          let value = item.value
          let evidence = { dependencies: [file], unresolved: [] as string[] }
          if (
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            typeof value.value === 'string'
          ) {
            try {
              const resolved = resolver?.documentExpression(imports, value.value, file)
              value = resolved?.value ?? null
              if (resolved) evidence = resolved
            } catch {
              continue
            }
          }
          const first = result.length
          if (
            item.name === 'style' &&
            value &&
            typeof value === 'object' &&
            !Array.isArray(value)
          ) {
            for (const [property, data] of Object.entries(value))
              emit('style', data, position?.start?.line, position?.start?.column, property)
          } else
            emit(
              /ClassName$|^(?:className|class)$/.test(item.name) ? 'class' : 'attribute',
              value,
              position?.start?.line,
              position?.start?.column,
              item.name
            )
          for (const definition of result.slice(first)) {
            definition.dependencies = [...new Set([file, ...evidence.dependencies])].sort()
            definition.unresolved.push(...evidence.unresolved)
            if (typeof node.name === 'string' && /^[A-Z]/.test(node.name))
              definition.appearance = { shared: true, element: node.name }
          }
        }
      }
      if (Array.isArray(node.children))
        for (const child of node.children)
          if (child && typeof child === 'object' && !Array.isArray(child)) walk(child)
    }
    walk(root as unknown as Record<string, Data>)
  }
  return result
}
