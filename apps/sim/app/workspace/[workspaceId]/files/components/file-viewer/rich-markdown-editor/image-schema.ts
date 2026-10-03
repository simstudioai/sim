import { InputRule, type JSONContent, mergeAttributes } from '@tiptap/core'
import { Image, inputRegex } from '@tiptap/extension-image'
import { type DOMOutputSpec, Fragment, Slice } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'
import { Lexer, Tokenizer } from 'marked'
import { imageTypeAt } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-node'
import { normalizeLinkHref } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-fidelity'
import { createTextInputRulePlugins } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/text-input-rule'

/**
 * React-free schema half of the image node. Lives apart from {@link ./image} (its React resize node
 * view) so the shared editor schema — `createMarkdownContentExtensions` in `./extensions` — can be
 * imported by server code (the collab-doc seed converter) without pulling a client component
 * (`useEffect`) into a Server Component module. The client editor injects the node-view variant
 * ({@link ResizableImage}) via `nodeViews`.
 */

/**
 * Linked images store their destination in attributes because the Yjs binding does not preserve
 * marks on image atoms. Tokenizing the complete Markdown link preserves README badges in both
 * image representations.
 */
/** Escape a value for safe interpolation into a double-quoted HTML attribute. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function decodeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function imageAttrsFromHtml(raw: string): Record<string, string> | null {
  if (!/^<img\s/i.test(raw)) return null
  const attrs: Record<string, string> = {}
  const attributePattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g
  for (const match of raw.matchAll(attributePattern)) {
    attrs[match[1].toLowerCase()] = decodeAttr(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return typeof attrs.src === 'string' ? attrs : null
}

/**
 * Markdown has no image dimensions, so sized images use HTML. Links wrap either representation:
 * `[![alt](src)](href)` or `[<img …>](href)`.
 */
function imageMarkdown(node: JSONContent): string {
  const attrs = node.attrs ?? {}
  const src = typeof attrs.src === 'string' ? attrs.src : ''
  const alt = typeof attrs.alt === 'string' ? attrs.alt : ''
  const title = typeof attrs.title === 'string' ? attrs.title : ''
  const link = node.marks?.find((mark) => mark.type === 'link')
  const linkAttrs = link ? link.attrs : { href: attrs.href, title: attrs.hrefTitle }
  const href = typeof linkAttrs?.href === 'string' ? linkAttrs.href : ''
  const hrefTitle = typeof linkAttrs?.title === 'string' ? linkAttrs.title : ''
  const width = attrs.width
  const height = attrs.height
  let image: string
  if (width || height) {
    const parts = [`src="${escapeAttr(src)}"`, `alt="${escapeAttr(alt)}"`]
    if (title) parts.push(`title="${escapeAttr(title)}"`)
    if (width) parts.push(`width="${escapeAttr(String(width))}"`)
    if (height) parts.push(`height="${escapeAttr(String(height))}"`)
    image = `<img ${parts.join(' ')}>`
  } else {
    // Escape so an alt with `]`/`[` or a title with `"` can't break out of the `![…](… "…")` syntax
    // and corrupt the round-trip; a src with spaces/parens goes in angle brackets (CommonMark).
    const titlePart = title ? ` "${title.replace(/["\\]/g, '\\$&')}"` : ''
    const safeSrc = /[\s()]/.test(src) ? `<${src}>` : src
    image = `![${alt.replace(/[\\[\]]/g, '\\$&')}](${safeSrc}${titlePart})`
  }
  if (!href) return image
  // Escape `"`/`\` so an href title can't break out of the `[…](href "title")` syntax (mirrors the
  // image title escaping above).
  const hrefTitlePart = hrefTitle ? ` "${hrefTitle.replace(/["\\]/g, '\\$&')}"` : ''
  const safeHref = /[\s()]/.test(href) ? `<${href}>` : href
  return `[${image}](${safeHref}${hrefTitlePart})`
}

interface MarkdownImageToken {
  /** Custom image tokens hold the source here; the built-in image token uses `href`. */
  src?: string
  alt?: string
  title?: string | null
  /** Built-in image token holds the source URL here; our linked token holds the link target. */
  href?: string
  hrefTitle?: string | null
  width?: string | null
  height?: string | null
  /** Built-in image token holds the alt text here. */
  text?: string
}

/** Map both the built-in image token and our linked-image token onto the image node's attributes. */
function parseImageToken(token: MarkdownImageToken): JSONContent {
  const isLinked = typeof token.src === 'string'
  return {
    type: 'image',
    attrs: isLinked
      ? {
          src: token.src,
          alt: token.alt ?? '',
          title: token.title ?? null,
          href: token.href ?? null,
          hrefTitle: token.hrefTitle ?? null,
          width: token.width ?? null,
          height: token.height ?? null,
        }
      : {
          src: token.href ?? '',
          alt: token.text ?? '',
          title: token.title ?? null,
          href: null,
          hrefTitle: null,
          width: null,
          height: null,
        },
  }
}

const widthAttr = {
  default: null,
  parseHTML: (element: HTMLElement) => element.getAttribute('width'),
  renderHTML: (attributes: Record<string, unknown>) =>
    attributes.width ? { width: String(attributes.width) } : {},
}

const heightAttr = {
  default: null,
  parseHTML: (element: HTMLElement) => element.getAttribute('height'),
  renderHTML: (attributes: Record<string, unknown>) =>
    attributes.height ? { height: String(attributes.height) } : {},
}

/** Wrapping links belong to the image's metadata, not an HTML `<img>` attribute. */
const hrefAttr = {
  default: null,
  rendered: false,
  parseHTML: (element: HTMLElement) => element.closest('a[href]')?.getAttribute('href') ?? null,
}
const hrefTitleAttr = {
  default: null,
  rendered: false,
  parseHTML: (element: HTMLElement) => element.closest('a[href]')?.getAttribute('title') ?? null,
}

/**
 * Image node that carries optional `width`/`height` (serialized as an HTML `<img>` tag) and an
 * optional `href`/`hrefTitle` (a wrapping markdown link, for badges). Shared by the headless
 * round-trip path (no node view) and the live {@link ResizableImage}.
 */
const ImageSchema = Image.extend({
  addInputRules: () => [],
  addAttributes() {
    return {
      ...this.parent?.(),
      width: widthAttr,
      height: heightAttr,
      href: hrefAttr,
      hrefTitle: hrefTitleAttr,
    }
  },
  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    const image: DOMOutputSpec = [
      'img',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
    ]
    const href = typeof node.attrs.href === 'string' ? normalizeLinkHref(node.attrs.href) : ''
    if (!href || node.marks.some((mark) => mark.type.name === 'link')) return image
    return [
      'a',
      {
        href,
        ...(typeof node.attrs.hrefTitle === 'string' ? { title: node.attrs.hrefTitle } : {}),
      },
      image,
    ]
  },
  renderMarkdown: imageMarkdown,
})

export const MarkdownImage = ImageSchema.extend({
  addProseMirrorPlugins() {
    return createTextInputRulePlugins(
      this.editor,
      this.name,
      new InputRule({
        find: new RegExp(`${inputRegex.source}(?![\\s\\S])`),
        handler: ({ state, range, match }) => {
          const [, syntax, alt, src, title] = match
          const from = range.from + match[0].indexOf(syntax)
          const type = state.schema.nodes[imageTypeAt(state.doc, from)]
          state.tr
            .replaceRangeWith(from, range.to, type.create({ alt, src, title: title ?? null }))
            .scrollIntoView()
        },
      })
    )
  },
  addCommands() {
    return {
      setImage:
        (attrs) =>
        ({ state, commands }) =>
          commands.insertContent({ type: imageTypeAt(state.doc, state.selection.from), attrs }),
    }
  },
  markdownTokenizer: {
    name: 'image',
    level: 'inline',
    start: (src: string) => {
      const markdown = src.indexOf('[![')
      const html = src.search(/\[?<img\s/i)
      if (markdown === -1) return html
      if (html === -1) return markdown
      return Math.min(markdown, html)
    },
    tokenize: (src: string): (MarkdownImageToken & { type: string; raw: string }) | undefined => {
      if (/^<img\s/i.test(src)) {
        const tokenizer = new Tokenizer()
        new Lexer({ gfm: true, tokenizer })
        const tag = tokenizer.tag(src)
        const attrs = tag && imageAttrsFromHtml(tag.raw)
        if (!tag || !attrs) return undefined
        return {
          type: 'image',
          raw: tag.raw,
          src: attrs.src,
          alt: attrs.alt,
          title: attrs.title,
          width: attrs.width,
          height: attrs.height,
        }
      }
      if (!src.startsWith('[![') && !/^\[<img\s/i.test(src)) return undefined
      /** Native first-token parsing avoids recursively lexing the entire remaining document. */
      const tokenizer = new Tokenizer()
      new Lexer({ gfm: true, tokenizer })
      const inner = src.startsWith('[![')
        ? tokenizer.link(src.slice(1))
        : tokenizer.tag(src.slice(1))
      const innerRaw = inner?.raw
      if (!inner || !innerRaw || (inner.type !== 'image' && inner.type !== 'html')) return undefined
      if (inner.type === 'image' && !innerRaw.trimEnd().endsWith(')')) return undefined
      const suffix = src.slice(1 + innerRaw.length)
      if (!suffix.startsWith(']')) return undefined
      const outer = tokenizer.link(`[x${suffix}`)
      if (outer?.type !== 'link' || typeof outer.raw !== 'string' || !outer.raw.startsWith('[x]')) {
        return undefined
      }
      if (!outer.raw.trimEnd().endsWith(')')) return undefined
      const raw = `[${innerRaw}${outer.raw.slice(2)}`
      const htmlAttrs = inner.type === 'html' ? imageAttrsFromHtml(innerRaw) : null
      if (inner.type === 'html' && !htmlAttrs) return undefined
      return {
        type: 'image',
        raw,
        alt: inner.type === 'image' ? inner.text : (htmlAttrs?.alt ?? ''),
        src: inner.type === 'image' ? inner.href : htmlAttrs?.src,
        title: inner.type === 'image' ? inner.title : (htmlAttrs?.title ?? null),
        width: htmlAttrs?.width ?? null,
        height: htmlAttrs?.height ?? null,
        href: outer.href,
        hrefTitle: outer.title ?? null,
      }
    },
  },
  parseMarkdown: parseImageToken,
})

/** Yjs persists inline image attributes, but not marks on image atoms. */
function preservePastedImageLinks(fragment: Fragment): Fragment {
  const children = []
  for (let index = 0; index < fragment.childCount; index++) {
    const child = fragment.child(index)
    const link =
      child.type.name === 'inlineImage' && child.marks.find((mark) => mark.type.name === 'link')
    children.push(
      link
        ? child.type.create(
            { ...child.attrs, href: link.attrs.href, hrefTitle: link.attrs.title ?? null },
            child.content,
            child.marks.filter((mark) => mark !== link)
          )
        : child.content.size
          ? child.copy(preservePastedImageLinks(child.content))
          : child
    )
  }
  return Fragment.fromArray(children)
}

export const MarkdownInlineImage = ImageSchema.extend({
  name: 'inlineImage',
  markdownTokenName: 'inlineImage',
  addCommands: () => ({}),
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          transformPasted: (slice) =>
            new Slice(preservePastedImageLinks(slice.content), slice.openStart, slice.openEnd),
        },
      }),
    ]
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      /** HTML links on inline images are represented by the surrounding link mark. */
      href: { default: null, rendered: false },
      hrefTitle: { default: null, rendered: false },
    }
  },
  parseHTML() {
    return [
      { tag: 'img[data-inline-image]', priority: 60 },
      { tag: 'img[src]', context: 'heading/', priority: 60 },
      {
        tag: 'img[src]',
        context: 'paragraph/',
        priority: 60,
        getAttrs: (element) => (element.closest('p')?.textContent?.trim() ? null : false),
      },
    ]
  },
}).configure({ inline: true, HTMLAttributes: { 'data-inline-image': '' } })
