import * as t from '@babel/types'
import { parseDocument } from 'yaml'
import { canonicalJson, parseSyntax } from '#design-diff/ast'
import type { Config, Data } from '#design-diff/types'

type Node = Record<string, Data>

const prose = new Set([
  'text',
  'inlineCode',
  'code',
  'break',
  'thematicBreak',
  'definition',
  'footnoteReference',
])
const containers = new Set([
  'root',
  'paragraph',
  'heading',
  'blockquote',
  'list',
  'listItem',
  'emphasis',
  'strong',
  'delete',
  'link',
  'linkReference',
  'table',
  'tableRow',
  'tableCell',
  'footnoteDefinition',
])
const proseTags = new Set([
  'p',
  'span',
  'a',
  'strong',
  'em',
  'b',
  'i',
  'code',
  'pre',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
])

function object(value: Data | undefined): value is Node {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Only literal document data qualifies; calls, spreads and JSX never execute or disappear. */
function literal(node: t.Node | null | undefined): boolean {
  if (!node) return false
  if (
    t.isStringLiteral(node) ||
    t.isNumericLiteral(node) ||
    t.isBooleanLiteral(node) ||
    t.isNullLiteral(node)
  )
    return true
  if (t.isArrayExpression(node)) return node.elements.every(literal)
  if (t.isObjectExpression(node))
    return node.properties.every(
      (property) => t.isObjectProperty(property) && !property.computed && literal(property.value)
    )
  if (t.isTemplateLiteral(node)) return node.expressions.every(literal)
  if (t.isUnaryExpression(node) && ['-', '+', '!'].includes(node.operator))
    return literal(node.argument)
  if (t.isTSAsExpression(node) || t.isTSSatisfiesExpression(node)) return literal(node.expression)
  return false
}

function literalExpression(value: string): boolean {
  try {
    const parsed = parseSyntax(`const value = (${value})`, 'document.tsx').program.body[0]
    return t.isVariableDeclaration(parsed) && literal(parsed.declarations[0]?.init)
  } catch {
    return false
  }
}

/** Project authoring content away while retaining custom presentation and unknown mechanisms. */
export function documentPresentation(
  nodes: Node[],
  policy: NonNullable<Config['documentationContent']>
): Node[] {
  const bindings = new Map<string, { module: string; name: string; props: string[] }>()
  const approvedImports = new Set<Node>()
  for (const node of nodes) {
    if (node.type !== 'mdxjsEsm' || typeof node.value !== 'string') continue
    const statements = parseSyntax(node.value, 'document.tsx').program.body
    let approved = true
    for (const statement of statements) {
      if (!t.isImportDeclaration(statement) || !statement.specifiers.length) {
        approved = false
        continue
      }
      for (const specifier of statement.specifiers) {
        const name = t.isImportSpecifier(specifier)
          ? t.isIdentifier(specifier.imported)
            ? specifier.imported.name
            : specifier.imported.value
          : 'default'
        const rule = policy.components.find(
          (rule) => rule.module === statement.source.value && rule.names.includes(name)
        )
        if (!rule || !t.isImportSpecifier(specifier)) {
          approved = false
          continue
        }
        bindings.set(specifier.local.name, { module: rule.module, name, props: rule.contentProps })
      }
    }
    if (approved) approvedImports.add(node)
  }

  const project = (node: Node): Node[] => {
    const type = String(node.type)
    if (prose.has(type)) return []
    if (approvedImports.has(node)) return []
    if (type === 'yaml' && typeof node.value === 'string') {
      const document = parseDocument(node.value, {
        schema: 'core',
        customTags: [],
        uniqueKeys: true,
      })
      if (document.errors.length || document.warnings.length)
        throw new Error('Unsupported documentation frontmatter')
      const value = document.toJS({ maxAliasCount: 0 }) as Data
      if (!object(value)) throw new Error('Documentation frontmatter must be an object')
      const retained = Object.fromEntries(
        Object.entries(value).filter(([key]) => !policy.frontmatterFields.includes(key))
      )
      return Object.keys(retained).length ? [{ ...node, value: canonicalJson(retained) }] : []
    }
    if (/^mdx.*Expression$/.test(type) && typeof node.value === 'string') {
      if (/^\s*\/\*[\s\S]*\*\/\s*$/.test(node.value) || literalExpression(node.value)) return []
      return [node]
    }
    const children = Array.isArray(node.children)
      ? node.children.flatMap((child) => (object(child) ? project(child) : []))
      : []
    if (containers.has(type)) return children.length ? [{ ...node, children }] : []
    if (/^mdxJsx(?:Flow|Text)Element$/.test(type)) {
      const name = typeof node.name === 'string' ? node.name : ''
      const binding = bindings.get(name)
      const intrinsic = proseTags.has(name)
      if (!binding && !intrinsic && name) return [node]
      const allowed = binding?.props ?? ['title', 'href', 'id', 'aria-label']
      const attributes = Array.isArray(node.attributes)
        ? node.attributes.filter((attribute) => {
            if (
              !object(attribute) ||
              attribute.type !== 'mdxJsxAttribute' ||
              typeof attribute.name !== 'string'
            )
              return true
            if (!allowed.includes(attribute.name)) return true
            if (typeof attribute.value === 'string' || attribute.value === null) return false
            return (
              !object(attribute.value) ||
              typeof attribute.value.value !== 'string' ||
              !literalExpression(attribute.value.value)
            )
          })
        : []
      if (!attributes.length && !children.length) return []
      return [
        {
          ...node,
          name: binding ? `${binding.module}#${binding.name}` : node.name,
          attributes,
          children,
        },
      ]
    }
    return [node]
  }
  return nodes.flatMap(project)
}
