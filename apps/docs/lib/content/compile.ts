import { createHash } from 'node:crypto'
import { compile } from '@mdx-js/mdx'
import rehypeShiki from '@shikijs/rehype'
import Slugger from 'github-slugger'
import type { Element, Root as HtmlRoot } from 'hast'
import type { Root } from 'mdast'
import type { MdxjsEsm } from 'mdast-util-mdxjs-esm'
import { toString as mdastToString } from 'mdast-util-to-string'
import remarkGfm from 'remark-gfm'
import { visit } from 'unist-util-visit'
import type { VFile } from 'vfile'
import { serializeMarkdown } from '@/lib/content/markdown'
import type { DocsHeading } from '@/lib/content/types'
import { simShikiOptions } from '@/lib/shiki-theme'

const COMPONENT_IMPORTS: Record<string, readonly string[]> = {
  '@/components/ui/callout': ['Callout'],
  '@/components/ui/cards': ['Cards', 'Card'],
  '@/components/ui/steps': ['Steps', 'Step'],
  '@/components/ui/tabs': ['Tabs', 'Tab', 'TabsList', 'TabsTrigger'],
  '@/components/ui/image': ['Image'],
  '@/components/ui/command-table': ['CommandTable'],
  '@/components/ui/reference-details': ['ReferenceDetails'],
  '@/components/introduction': ['IntroductionHero', 'IntroductionLink'],
  '@/components/workflow-preview': ['WorkflowPreview', 'BlockPreview', 'OutputBundle'],
}
const HTML_ELEMENTS = new Set([
  'a',
  'div',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'code',
  'br',
  'span',
  'img',
  'video',
  'source',
  'iframe',
  'strong',
  'em',
  'details',
  'summary',
])

interface CompileContext {
  source: string
  description: string
  headings: DocsHeading[]
  markdown: string
  links: string[]
  media: string[]
  ids: string[]
  codeFences: Array<{ lang?: string | null; meta?: string | null; sha256: string }>
}

function checkImports(node: MdxjsEsm, allowed: Set<string>, source: string) {
  for (const statement of node.data?.estree?.body ?? []) {
    if (statement.type !== 'ImportDeclaration' || typeof statement.source.value !== 'string')
      throw new Error(`${source}: only component imports are supported in MDX ESM`)
    const path = statement.source.value
    const exports = COMPONENT_IMPORTS[path]
    if (!exports) throw new Error(`${source}: unknown component module ${path}`)
    for (const specifier of statement.specifiers) {
      if (specifier.type !== 'ImportSpecifier')
        throw new Error(`${source}: use named component imports`)
      const imported =
        specifier.imported.type === 'Identifier'
          ? specifier.imported.name
          : specifier.imported.value
      if (typeof imported !== 'string')
        throw new Error(`${source}: component names must be strings`)
      if (
        !exports.includes(imported) &&
        !(path === '@/components/workflow-preview' && imported.endsWith('_WORKFLOW'))
      )
        throw new Error(`${source}: unknown export ${imported} from ${path}`)
      allowed.add(specifier.local.name)
    }
  }
}

function catalogPlugin(context: CompileContext) {
  return (tree: Root) => {
    const slugger = new Slugger()
    const ids = new Set<string>()
    const allowed = new Set<string>()
    visit(tree, 'mdxjsEsm', (node) => checkImports(node, allowed, context.source))
    const addId = (id: string) => {
      if (ids.has(id)) throw new Error(`${context.source}: duplicate anchor #${id}`)
      ids.add(id)
    }
    visit(tree, (node) => {
      if (node.type === 'code')
        context.codeFences.push({
          lang: node.lang,
          meta: node.meta,
          sha256: createHash('sha256').update(node.value).digest('hex'),
        })
      if (node.type === 'heading') {
        const last = node.children.at(-1)
        const match = last?.type === 'text' ? /\s*\[#([\s\S]+?)]\s*$/.exec(last.value) : null
        if (last?.type === 'text' && match) last.value = last.value.slice(0, match.index)
        const title = mdastToString(node)
        const id = match?.[1] ?? slugger.slug(title)
        addId(id)
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id } }
        context.headings.push({ id, title, depth: node.depth })
      }
      if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
        if (node.name && !allowed.has(node.name) && !HTML_ELEMENTS.has(node.name))
          throw new Error(`${context.source}: unknown component ${node.name}`)
        for (const attribute of node.attributes) {
          if (attribute.type !== 'mdxJsxAttribute' || typeof attribute.value !== 'string') continue
          if (attribute.name === 'id') addId(attribute.value)
          if (attribute.name === 'href') context.links.push(attribute.value)
          if (attribute.name === 'src') context.media.push(attribute.value)
        }
      }
      if (node.type === 'link' || node.type === 'definition') context.links.push(node.url)
      if (node.type === 'image') context.media.push(node.url)
    })
    context.ids = [...ids]
    context.markdown = serializeMarkdown(tree)
    const firstParagraph = tree.children.findIndex((node) => node.type === 'paragraph')
    if (
      firstParagraph >= 0 &&
      mdastToString(tree.children[firstParagraph]).trim() === context.description.trim()
    )
      tree.children.splice(firstParagraph, 1)
  }
}

function codeMetadata() {
  return (tree: HtmlRoot, file: VFile) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'pre') return
      const code = node.children.find(
        (child): child is Element => child.type === 'element' && child.tagName === 'code'
      )
      if (!code) return
      const classes = Array.isArray(code.properties.className) ? code.properties.className : []
      const language = classes.find(
        (value) => typeof value === 'string' && value.startsWith('language-')
      )
      const meta = typeof code.data?.meta === 'string' ? code.data.meta : ''
      node.properties['data-language'] = typeof language === 'string' ? language.slice(9) : 'text'
      node.properties['data-code'] = code.children
        .filter((child) => child.type === 'text')
        .map((child) => child.value)
        .join('')
        .replace(/\n$/, '')
      const title = /(?:title|filename)=["']([^"']+)["']/.exec(meta)?.[1]
      if (title) node.properties['data-title'] = title
    })
    if (!file.path) throw new Error('Compiled documentation requires source provenance')
  }
}

/** Compiles trusted repository MDX once at build time; no evaluators or compilers ship to the browser. */
export async function compileDocument(source: string, body: string, description: string) {
  const context: CompileContext = {
    source,
    description,
    headings: [],
    markdown: '',
    links: [],
    media: [],
    ids: [],
    codeFences: [],
  }
  const result = await compile(
    { value: body, path: source },
    {
      format: 'mdx',
      outputFormat: 'program',
      development: false,
      remarkPlugins: [remarkGfm, [catalogPlugin, context]],
      rehypePlugins: [
        codeMetadata,
        [rehypeShiki, { ...simShikiOptions, fallbackLanguage: 'text' }],
      ],
    }
  )
  return { ...context, javascript: String(result) }
}
