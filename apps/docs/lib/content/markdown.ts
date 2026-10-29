import { isRecordLike, toArray, toRecord } from '@sim/utils/object'
import type { Nodes, Root, RootContent } from 'mdast'
import { gfmToMarkdown } from 'mdast-util-gfm'
import { toMarkdown } from 'mdast-util-to-markdown'
import { toString as mdastToString } from 'mdast-util-to-string'
import { BLOCK_DISPLAY_WORKFLOWS } from '@/components/workflow-preview/block-display-workflows'
import * as workflowExamples from '@/components/workflow-preview/examples'

const examples: Record<string, unknown> = workflowExamples

/** Evaluates only literal content data; documentation expressions never execute during serialization. */
function literal(expression: unknown): unknown {
  const node = toRecord(expression)
  if (node.type === 'Literal') return node.value
  if (node.type === 'Identifier') {
    if (typeof node.name === 'string' && node.name in examples) return examples[node.name]
    throw new Error(`Unknown documentation data reference: ${String(node.name)}`)
  }
  if (node.type === 'ArrayExpression') return toArray(node.elements).map(literal)
  if (node.type === 'ObjectExpression')
    return Object.fromEntries(
      toArray(node.properties).map((raw) => {
        const property = toRecord(raw)
        if (
          property.type !== 'Property' ||
          property.computed ||
          property.method ||
          property.kind !== 'init'
        )
          throw new Error('Only literal object properties are supported in documentation')
        const key = toRecord(property.key)
        return [key.name ?? key.value, literal(property.value)]
      })
    )
  if (node.type === 'UnaryExpression' && node.operator === '-')
    return -Number(literal(node.argument))
  throw new Error(`Unsupported documentation expression: ${String(node.type)}`)
}

function expressionValue(value: unknown): unknown {
  const expression = toRecord(value)
  const program = toRecord(toRecord(expression.data).estree)
  const statement = toRecord(toArray(program.body)[0])
  if (
    !statement.type &&
    typeof expression.value === 'string' &&
    expression.value.trim().startsWith('/*')
  )
    return undefined
  return literal(statement.expression)
}

function attributes(node: Nodes): Record<string, unknown> {
  const record = toRecord(node)
  return Object.fromEntries(
    toArray(record.attributes)
      .map(toRecord)
      .filter((attribute) => attribute.type === 'mdxJsxAttribute')
      .map((attribute) => [
        String(attribute.name),
        isRecordLike(attribute.value)
          ? expressionValue(attribute.value)
          : (attribute.value ?? true),
      ])
  )
}

const paragraph = (text: string): Nodes => ({
  type: 'paragraph',
  children: [{ type: 'text', value: text }],
})
const json = (value: unknown): Nodes => ({
  type: 'code',
  lang: 'json',
  value: JSON.stringify(value, null, 2),
})

/** Converts every authored component to useful Markdown while retaining all inactive content. */
export function serializeMarkdown(tree: Root): string {
  const convert = (node: Nodes, tabLabel?: string): Nodes[] => {
    if (node.type === 'mdxjsEsm') return []
    if (node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression') {
      const value = expressionValue(node)
      return value === undefined ? [] : [{ type: 'text', value: String(value) }]
    }
    if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
      const props = attributes(node)
      const children = node.children.flatMap((child) => convert(child))
      switch (node.name) {
        case 'WorkflowPreview':
          return [paragraph('Workflow configuration'), json(props.workflow)]
        case 'BlockPreview':
          return [
            paragraph(`${String(props.type)} block configuration`),
            json(BLOCK_DISPLAY_WORKFLOWS[String(props.type)]),
          ]
        case 'OutputBundle':
          return [paragraph(`Output from ${String(props.blockName)}`), json(props.values)]
        case 'Image':
        case 'img':
          return [
            {
              type: 'image',
              url: String(props.src),
              alt: String(props.alt ?? ''),
              ...(typeof props.caption === 'string' ? { title: props.caption } : {}),
            },
          ]
        case 'IntroductionHero':
          return [
            {
              type: 'image',
              url: '/static/introduction/platform.webp',
              alt: String(props.alt ?? 'Sim workspace'),
            },
          ]
        case 'IntroductionLink':
          return [
            {
              type: 'paragraph',
              children: [
                {
                  type: 'link',
                  url: String(props.href),
                  children: [{ type: 'text', value: String(props.title) }],
                },
              ],
            },
            ...children,
          ]
        case 'Callout':
          return [
            paragraph(
              `${typeof props.title === 'string' ? props.title : props.type === 'warn' || props.type === 'warning' ? 'Warning' : 'Note'}:`
            ),
            ...children,
          ]
        case 'Tabs': {
          let index = 0
          return node.children.flatMap((child) =>
            convert(
              child,
              (child.type === 'mdxJsxFlowElement' || child.type === 'mdxJsxTextElement') &&
                child.name === 'Tab'
                ? String(toArray(props.items)[index++] ?? 'Configuration')
                : undefined
            )
          )
        }
        case 'Tab':
          return [
            paragraph(`Tab: ${String(props.title ?? props.value ?? tabLabel ?? 'Configuration')}`),
            ...children,
          ]
        case 'TabsList':
        case 'TabsTrigger':
          return []
        case 'ReferenceDetails':
          return typeof props.label === 'string' ? [paragraph(props.label), ...children] : children
        case 'a': {
          if (typeof props.href === 'string')
            return [
              {
                type: 'link',
                url: props.href,
                children: [
                  {
                    type: 'text',
                    value: mdastToString({ type: 'root', children: children as RootContent[] }),
                  },
                ],
              },
            ]
          return typeof props.id === 'string'
            ? [
                { type: 'html', value: `<a id="${props.id.replace(/"/g, '&quot;')}"></a>` },
                ...children,
              ]
            : children
        }
        case 'code':
          return [
            { type: 'inlineCode', value: children.map((child) => mdastToString(child)).join('') },
          ]
        case 'br':
          return [{ type: 'break' }]
        case 'table': {
          const rows = node.children
            .flatMap((child) =>
              child.type === 'mdxJsxFlowElement' && ['thead', 'tbody'].includes(child.name ?? '')
                ? child.children
                : [child]
            )
            .filter(
              (child) =>
                (child.type === 'mdxJsxFlowElement' || child.type === 'mdxJsxTextElement') &&
                child.name === 'tr'
            )
          return [
            {
              type: 'table',
              children: rows.map((row) => ({
                type: 'tableRow',
                children:
                  'children' in row
                    ? row.children
                        .filter(
                          (cell) =>
                            (cell.type === 'mdxJsxFlowElement' ||
                              cell.type === 'mdxJsxTextElement') &&
                            ['th', 'td'].includes(cell.name ?? '')
                        )
                        .map((cell) => ({
                          type: 'tableCell',
                          children: [
                            {
                              type: 'text',
                              value: mdastToString({
                                type: 'root',
                                children: convert(cell) as RootContent[],
                              }),
                            },
                          ],
                        }))
                    : [],
              })),
            },
          ]
        }
        default:
          return children
      }
    }
    if (node.type === 'heading' && typeof node.data?.hProperties?.id === 'string')
      return [
        {
          ...node,
          children: [...node.children, { type: 'text', value: ` [#${node.data.hProperties.id}]` }],
        },
      ]
    if ('children' in node)
      return [{ ...node, children: node.children.flatMap((child) => convert(child)) } as Nodes]
    return [node]
  }
  const markdownTree: Root = {
    type: 'root',
    children: tree.children.flatMap((child) => convert(child)) as RootContent[],
  }
  return toMarkdown(markdownTree, {
    extensions: [gfmToMarkdown({ tablePipeAlign: false })],
    fences: true,
    bullet: '-',
    listItemIndent: 'one',
  })
}
