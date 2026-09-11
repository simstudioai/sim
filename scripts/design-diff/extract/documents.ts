import { type DefaultTreeAdapterMap, parse as parseHtml } from 'parse5'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { canonical, semanticSource } from '#design-diff/ast'
import { cssValue } from '#design-diff/extract/css'
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
        if (node.tagName === 'script') {
          emit(
            'review',
            {
              attributes: node.attrs.map((attr) => [attr.name, attr.value]),
              body: canonical(
                node.childNodes.map((n) => {
                  if (!('value' in n)) return null
                  try {
                    return semanticSource(n.value, `${file}.js`)
                  } catch {
                    return n.value
                  }
                })
              ),
            },
            loc?.startLine,
            loc?.startCol
          )
          return
        }
        if (node.tagName === 'style') {
          emit(
            'css',
            cssValue(node.childNodes.map((n) => ('value' in n ? n.value : '')).join('')),
            loc?.startLine,
            loc?.startCol
          )
          return
        }
        emit(
          'markup',
          {
            tag: node.tagName,
            attrs: node.attrs
              .filter((attr) => !/^on/.test(attr.name) && attr.name !== 'class')
              .map((attr) => [
                attr.name,
                attr.name === 'style' ? cssValue(`a{${attr.value}}`) : attr.value,
              ]),
          },
          loc?.startLine,
          loc?.startCol
        )
        for (const attr of node.attrs)
          if (attr.name === 'class')
            emit('class', attr.value, loc?.startLine, loc?.startCol, 'class')
        if ('content' in node) walk(node.content as DefaultTreeAdapterMap['documentFragment'])
      }
      if (node.nodeName === '#text' && 'value' in node && node.value)
        emit('content', node.value, loc?.startLine, loc?.startCol)
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
    for (const node of root.children) {
      const data = canonical(node) as Record<string, Data>
      const stripPositions = (value: Data): Data => {
        if (Array.isArray(value)) return value.map(stripPositions)
        if (value && typeof value === 'object') {
          const result: Record<string, Data> = {}
          for (const [key, child] of Object.entries(value))
            if (!['position', 'data'].includes(key)) result[key] = stripPositions(child)
          return result
        }
        return value
      }
      const value = stripPositions(data)
      const evidence: { dependencies: string[]; unresolved: string[] } = {
        dependencies: [],
        unresolved: [],
      }
      const resolveExpressions = (item: Data): Data => {
        if (Array.isArray(item)) return item.map(resolveExpressions)
        if (!item || typeof item !== 'object') return item
        if (
          resolver &&
          typeof item.type === 'string' &&
          /Expression$/.test(item.type) &&
          typeof item.value === 'string' &&
          !/^\s*\/\*/.test(item.value)
        ) {
          try {
            const resolved = resolver.documentExpression(imports, item.value, file)
            evidence.dependencies.push(...resolved.dependencies)
            evidence.unresolved.push(...resolved.unresolved)
            return { ...item, resolved: resolved.value }
          } catch {
            evidence.unresolved.push('MDX expression could not be parsed')
          }
        }
        return Object.fromEntries(
          Object.entries(item).map(([key, child]) => [key, resolveExpressions(child)])
        )
      }
      const resolved = resolveExpressions(value)
      if (
        /^mdx.*Expression$/.test(node.type) &&
        'value' in node &&
        /^\s*\/\*[\s\S]*\*\/\s*$/.test(String(node.value))
      )
        continue
      emit(
        node.type === 'mdxjsEsm' || JSON.stringify(value).includes('Expression')
          ? 'review'
          : 'content',
        resolved,
        node.position?.start.line,
        node.position?.start.column
      )
      result[result.length - 1].dependencies = [...new Set([file, ...evidence.dependencies])].sort()
      result[result.length - 1].unresolved.push(...new Set(evidence.unresolved))
    }
  }
  return result
}
