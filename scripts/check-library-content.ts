#!/usr/bin/env bun
/**
 * Validates every content post under `apps/sim/content/{blog,library,customers,changelog}/<slug>/index.mdx`.
 *
 * Content is mostly written by agents and merged without a build, so a bad post only fails at
 * `next build` (an invalid frontmatter key, an MDX syntax error) or never fails at all (a link to a
 * retired or misspelled slug 301s or 404s in production). Each rule here is exact, so nothing
 * needs an override:
 *
 * - `frontmatter`: gray-matter parses it and it passes the strict `ContentFrontmatterSchema`, so
 *   an unknown key such as `canonical` fails; every author id has a JSON file in `content/authors`.
 * - `slug`: the `slug` field equals the post's folder name.
 * - `og-image`: `ogImage` is a local path to a file under `apps/sim/public`.
 * - `mdx`: the body compiles with the MDX compiler and `remark-gfm`, as the registry compiles it.
 * - `media`: changelog screenshots have literal dimensions and existing assets; recordings and
 *   captions use existing local assets or the approved CDN, matching the site's CSP.
 *   Published changelog bodies must contain feature media; a cover or fenced example is not enough.
 * - Changelog publication dates cannot be in the future, correction dates cannot precede
 *   publication, and published updates cannot reuse the same RSS identity.
 * - `faq`: the body has no FAQ heading (the FAQ lives in frontmatter, which renders it and emits
 *   its JSON-LD), and no FAQ question or answer contains Markdown link syntax (it renders as text).
 * - `internal-link`: every `https://www.sim.ai/<section>/<slug>` link, and every relative
 *   `/<section>/<slug>` link target, names a page that serves: a published blog or library post,
 *   or a customer story registered in `CUSTOMER_STORIES` — never a retired or moved slug. Every
 *   retired or moved slug redirects to a published library post. Apex `https://sim.ai` links
 *   belong to `check:site-urls`.
 *   Changelog integration, model, and docs links also resolve against the generated catalogs,
 *   docs source files, and generated OpenAPI operation pages, including reference-style links.
 *
 * Run one post with `--slug <section>/<slug>` or `--slug <slug>`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { compile } from '@mdx-js/mdx'
import integrationsJson from '@sim/deployment-config/integrations.json'
import { SIM_DOCS_URL, SIM_SITE_URL } from '@sim/utils/site'
import matter from 'gray-matter'
import type { Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import { visit } from 'unist-util-visit'
import { OPENAPI_SPEC_FILES } from '../apps/docs/lib/openapi-specs'
import { MODEL_PROVIDERS_WITH_MODELS } from '../apps/sim/app/(landing)/models/utils'
import { isChangelogMediaSource } from '../apps/sim/lib/changelog/media'
import { AuthorSchema, ContentFrontmatterSchema } from '../apps/sim/lib/content/schema'
import { CUSTOMER_STORIES } from '../apps/sim/lib/customers/data'
import {
  LIBRARY_MERGED_SLUGS,
  LIBRARY_MOVED_BLOG_SLUGS,
} from '../apps/sim/lib/library/retired-slugs'
import { foldDocsIndexPath } from '../apps/sim/lib/mothership/docs/docs-path'

export const SECTIONS = ['blog', 'library', 'customers', 'changelog'] as const
export type Section = (typeof SECTIONS)[number]

export type Rule = 'frontmatter' | 'slug' | 'og-image' | 'mdx' | 'media' | 'faq' | 'internal-link'

export interface Finding {
  file: string
  line: number
  rule: Rule
  message: string
  hint: string
}

export interface ContentCheckConfig {
  /** Holds one folder per section (`<contentDir>/<section>/<slug>/index.mdx`) plus `authors/`. */
  contentDir: string
  /** The app's `public/` directory, which local `ogImage` paths resolve against. */
  publicDir: string
  /** Static route segments beside `[slug]` (e.g. `tags`, `rss.xml`) that are not posts. */
  reservedSegments: Readonly<Record<Section, ReadonlySet<string>>>
  /** Retired library slug to the slug that replaced it. */
  mergedSlugs: Readonly<Record<string, string>>
  /** Blog slugs that now live under `/library`. */
  movedBlogSlugs: readonly string[]
  /** Customer slugs the `/customers/[slug]` route serves (`CUSTOMER_STORIES`). */
  customerSlugs: readonly string[]
  /** Canonical integration, model, and documentation pages served by the current source tree. */
  linkedPages: ReadonlySet<string>
}

/** Post folders per section, keyed by slug, with each post's `draft` flag. */
export type PostIndex = Record<Section, Map<string, { draft: boolean }>>

export interface PostRef {
  section: Section
  slug: string
}

/**
 * An absolute `www.sim.ai` URL anywhere, or a relative path in a Markdown link target or an
 * `href` attribute. Group 1 is the section, group 2 the first segment, group 3 anything after it.
 */
const INTERNAL_LINK =
  /(?:https?:\/\/www\.sim\.ai|(?<=\]\(\s*|href=\{?["'`]))\/(library|blog|customers|changelog)\/([^\s)"'`#?/<>\]]+)(\/[^\s)"'`#?<>\]]*)?/g
/** Sentence punctuation that ends a bare URL in prose (`…see https://www.sim.ai/library/x.`). */
const TRAILING_PUNCTUATION = /[.,;:!]+$/
/** Text just before a Markdown link target or `href` value, whose URL ends at its delimiter. */
const LINK_TARGET_OPENER = /(?:\]\(\s*|href=\{?["'`])$/
const MARKDOWN_LINK = /\[[^\]\n]*\]\([^)\n]*\)/
const FAQ_HEADING = /^#{1,6}\s+FAQs?\s*:?\s*$/i
const CODE_FENCE = /^\s*(```|~~~)/
const ROUTE_FILES = ['page.tsx', 'page.ts', 'route.tsx', 'route.ts']

function isSection(value: string): value is Section {
  return (SECTIONS as readonly string[]).includes(value)
}

/** A post whose frontmatter does not parse counts as published; its own check reports it. */
function readDraft(file: string): boolean {
  try {
    return matter(readFileSync(file, 'utf-8'), {}).data.draft === true
  } catch {
    return false
  }
}

/** Post folders per section: every directory that holds an `index.mdx`. */
export function indexPosts(contentDir: string): PostIndex {
  const index = {} as PostIndex
  for (const section of SECTIONS) {
    const sectionDir = path.join(contentDir, section)
    index[section] = new Map()
    if (!existsSync(sectionDir)) continue
    for (const entry of readdirSync(sectionDir, { withFileTypes: true })) {
      const file = path.join(sectionDir, entry.name, 'index.mdx')
      if (entry.isDirectory() && existsSync(file)) {
        index[section].set(entry.name, { draft: readDraft(file) })
      }
    }
  }
  return index
}

/** Why `/<section>/<slug>` would not serve a page, or null when it does. */
export function unservedReason(
  posts: PostIndex,
  customerSlugs: readonly string[],
  section: Section,
  slug: string
): string | null {
  const post = posts[section].get(slug)
  if (!post) return `does not exist (no apps/sim/content/${section}/${slug}/index.mdx)`
  if (section === 'customers') {
    return customerSlugs.includes(slug)
      ? null
      : 'is not in CUSTOMER_STORIES (apps/sim/lib/customers/data.ts), so it 404s'
  }
  return post.draft ? 'is a draft, so it 404s' : null
}

/** Static routes beside each section's `[slug]` route: folders that define a page or route handler. */
export function readReservedSegments(sectionAppDir: (section: Section) => string) {
  const reserved = {} as Record<Section, Set<string>>
  for (const section of SECTIONS) {
    const dir = sectionAppDir(section)
    reserved[section] = new Set(
      existsSync(dir)
        ? readdirSync(dir, { withFileTypes: true })
            .filter(
              (entry) =>
                entry.isDirectory() &&
                !/^[[(_]/.test(entry.name) &&
                ROUTE_FILES.some((name) => existsSync(path.join(dir, entry.name, name)))
            )
            .map((entry) => entry.name)
        : []
    )
  }
  return reserved
}

/** Parses `<section>/<slug>` or a bare `<slug>`, resolving the latter against the post index. */
export function resolvePostArg(arg: string, posts: PostIndex): PostRef[] | string {
  const [first, second] = arg.replace(/\/+$/, '').split('/')
  if (second !== undefined) {
    if (!isSection(first)) return `Unknown section "${first}"; use one of ${SECTIONS.join(', ')}.`
    return posts[first].has(second) ? [{ section: first, slug: second }] : `No post at ${arg}.`
  }
  const matches = SECTIONS.filter((section) => posts[section].has(first)).map((section) => ({
    section,
    slug: first,
  }))
  if (matches.length === 0) return `No post named "${first}" in ${SECTIONS.join(', ')}.`
  return matches
}

function lineOfKey(frontmatterLines: string[], key: string): number {
  const index = frontmatterLines.findIndex((line) => line.startsWith(`${key}:`))
  return index === -1 ? 1 : index + 2
}

type ReportFinding = (line: number, rule: Rule, message: string, hint: string) => void

function checkChangelogBody(
  tree: Root,
  config: ContentCheckConfig,
  bodyOffset: number,
  published: boolean,
  report: ReportFinding
): void {
  let mediaCount = 0
  const definitions = new Map<string, string>()
  visit(tree, 'definition', (node) => {
    definitions.set(node.identifier, node.url)
  })
  const checkLink = (href: string, line: number) => {
    let url: URL
    try {
      url = new URL(href, SIM_SITE_URL)
    } catch {
      return
    }
    const isDocs = url.hostname === new URL(SIM_DOCS_URL).hostname
    const isCatalog =
      url.hostname === new URL(SIM_SITE_URL).hostname &&
      /^\/(?:integrations|models)(?:\/|$)/.test(url.pathname)
    if (!isDocs && !isCatalog) return
    const canonical = `${url.origin}${url.pathname.replace(/\/$/, '')}`
    if (!config.linkedPages.has(canonical)) {
      report(
        line,
        'internal-link',
        `${href} does not exist in the published integration/model catalogs or documentation source.`,
        'Use the canonical catalog or docs URL; keep feature and setup links relevant to the update.'
      )
    }
  }
  visit(tree, (node) => {
    const line = bodyOffset + (node.position?.start.line ?? 1)
    if (node.type === 'link') checkLink(node.url, line)
    if (node.type === 'linkReference') {
      const href = definitions.get(node.identifier)
      if (href) checkLink(href, line)
    }
    if (node.type === 'heading' && node.depth < 3) {
      report(
        bodyOffset + (node.position?.start.line ?? 1),
        'mdx',
        'Changelog body heading must start at level 3.',
        'Use ### for entry sections; the article title and details section own H1 and H2.'
      )
    }
    if (node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxJsxTextElement') return
    if (node.name === 'a' || node.name === 'Link') {
      const href = node.attributes.find(
        (attribute) => attribute.type === 'mdxJsxAttribute' && attribute.name === 'href'
      )
      if (href?.type === 'mdxJsxAttribute' && typeof href.value === 'string') {
        checkLink(href.value, line)
      }
    }
    if (node.name !== 'ChangelogImage' && node.name !== 'ChangelogVideo') return
    mediaCount += 1
    const name = node.name
    const attributes = new Map(
      node.attributes
        .filter((attribute) => attribute.type === 'mdxJsxAttribute')
        .map((attribute) => [attribute.name, attribute.value])
    )
    const literal = (field: string) => {
      const value = attributes.get(field)
      return typeof value === 'string' && value.trim() ? value : undefined
    }
    const fail = (field: string, reason: string) =>
      report(
        line,
        'media',
        `${name} ${field} ${reason}.`,
        'Use literal attributes, existing local images, and same-origin or approved CDN media. Verify hosted media in the deployment preview.'
      )
    const asset = (field: string, localOnly: boolean) => {
      const value = literal(field)
      if (!value || !isChangelogMediaSource(value) || (localOnly && !value.startsWith('/'))) {
        fail(field, 'must be a literal same-origin path or approved media CDN URL')
        return
      }
      if (!value.startsWith('/')) return
      const target = path.resolve(config.publicDir, `.${value}`)
      const relative = path.relative(config.publicDir, target)
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        fail(field, 'resolves outside public/')
      } else if (!existsSync(target) || !statSync(target).isFile()) {
        fail(field, 'does not exist under public/')
      }
    }
    asset('src', name === 'ChangelogImage')
    if (name === 'ChangelogImage') {
      if (!literal('alt')) fail('alt', 'must describe the screenshot')
      for (const field of ['width', 'height']) {
        const value = Number(literal(field))
        if (!Number.isInteger(value) || value <= 0) {
          fail(field, 'must be a positive literal dimension; MDX strips JavaScript expressions')
        }
      }
    } else {
      asset('poster', true)
      if (!literal('caption')) fail('caption', 'must describe the action and result')
      const src = literal('src')
      if (src && isChangelogMediaSource(src) && !src.endsWith('.mp4')) {
        fail('src', 'must point to an MP4')
      }
      if (attributes.has('captionsSrc')) {
        asset('captionsSrc', false)
        if (!literal('captionsSrc')?.endsWith('.vtt')) {
          fail('captionsSrc', 'must point to a WebVTT file')
        }
      }
    }
  })
  if (published && mediaCount === 0) {
    report(
      bodyOffset + 1,
      'media',
      'A published changelog needs at least one feature image or video in its body.',
      'Add a reviewed ChangelogImage or ChangelogVideo that demonstrates the update; a cover image or fenced example is not enough. Keep unfinished entries as drafts.'
    )
  }
}

/** Validates one post, returning every finding (empty when the post is clean). */
export async function checkPost(
  config: ContentCheckConfig,
  posts: PostIndex,
  authorIds: ReadonlySet<string>,
  { section, slug }: PostRef
): Promise<Finding[]> {
  const file = path.join(config.contentDir, section, slug, 'index.mdx')
  const raw = readFileSync(file, 'utf-8')
  const findings: Finding[] = []
  const report = (line: number, rule: Rule, message: string, hint: string) =>
    findings.push({ file, line, rule, message, hint })

  let parsed: matter.GrayMatterFile<string>
  try {
    // A fresh options object bypasses gray-matter's content-keyed cache.
    parsed = matter(raw, {})
  } catch (error) {
    const mark = (error as { mark?: { line?: number } }).mark
    report(
      typeof mark?.line === 'number' ? mark.line + 2 : 1,
      'frontmatter',
      `Frontmatter is not valid YAML: ${(error as Error).message.split('\n')[0]}`,
      'Fix the YAML between the --- fences (quote values that contain a colon).'
    )
    return findings
  }

  const body = parsed.content
  const bodyOffset = raw.endsWith(body)
    ? raw.slice(0, raw.length - body.length).split('\n').length - 1
    : 0
  const frontmatterLines = raw.split('\n').slice(1, Math.max(bodyOffset - 1, 1))

  const result = ContentFrontmatterSchema.safeParse(parsed.data)
  if (!result.success) {
    for (const issue of result.error.issues) {
      if (issue.code === 'unrecognized_keys') {
        for (const key of issue.keys) {
          report(
            lineOfKey(frontmatterLines, key),
            'frontmatter',
            `Unknown frontmatter key "${key}".`,
            key === 'canonical'
              ? 'Remove it: the canonical URL is derived from the section and slug.'
              : `Remove it, or add it to ContentFrontmatterSchema in apps/sim/lib/content/schema.ts.`
          )
        }
        continue
      }
      const key = String(issue.path[0] ?? '')
      report(
        key ? lineOfKey(frontmatterLines, key) : 1,
        'frontmatter',
        `Frontmatter ${issue.path.join('.') || '(root)'}: ${issue.message}`,
        'Match ContentFrontmatterSchema in apps/sim/lib/content/schema.ts.'
      )
    }
  }

  const data = parsed.data as Record<string, unknown>

  if (section === 'changelog' && result.success) {
    const { date, updated, draft, ogAlt } = result.data
    if (!draft && (date.getTime() > Date.now() || (updated && updated.getTime() > Date.now()))) {
      report(
        lineOfKey(frontmatterLines, 'date'),
        'frontmatter',
        'A published changelog date cannot be in the future.',
        'Keep the entry as a draft until its actual publication date; deployment, not the date field, publishes content.'
      )
    }
    if (updated && updated < date) {
      report(
        lineOfKey(frontmatterLines, 'updated'),
        'frontmatter',
        'The updated date cannot precede the publication date.',
        'Preserve the original publication date and use the actual date of a substantive correction.'
      )
    }
    if (!draft && !ogAlt?.trim()) {
      report(
        lineOfKey(frontmatterLines, 'ogAlt'),
        'frontmatter',
        'A published changelog cover needs descriptive ogAlt text.',
        'Describe what the cover actually shows, rather than repeating the headline.'
      )
    }
  }

  if (Array.isArray(data.authors)) {
    for (const author of data.authors) {
      if (typeof author === 'string' && !authorIds.has(author)) {
        report(
          lineOfKey(frontmatterLines, 'authors'),
          'frontmatter',
          `Author "${author}" has no profile in apps/sim/content/authors.`,
          `Use one of: ${[...authorIds].sort().join(', ')}.`
        )
      }
    }
  }

  if (typeof data.slug === 'string' && data.slug !== slug) {
    report(
      lineOfKey(frontmatterLines, 'slug'),
      'slug',
      `slug "${data.slug}" does not match the folder name "${slug}".`,
      `Set slug: ${slug}, or rename the folder (and its public/ assets) to match.`
    )
  }

  if (config.reservedSegments[section].has(slug)) {
    report(2, 'slug', `slug "${slug}" is reserved for a static route.`, 'Choose a different slug.')
  }

  if (typeof data.ogImage === 'string') {
    const line = lineOfKey(frontmatterLines, 'ogImage')
    if (!data.ogImage.startsWith('/')) {
      report(
        line,
        'og-image',
        `ogImage "${data.ogImage}" is not a local path.`,
        `Point it at a file under apps/sim/public, e.g. /${section}/${slug}/cover.jpg.`
      )
    } else {
      const target = path.resolve(config.publicDir, `.${data.ogImage}`)
      const relative = path.relative(config.publicDir, target)
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        report(
          line,
          'og-image',
          `ogImage "${data.ogImage}" resolves outside apps/sim/public.`,
          `Point it at a file under apps/sim/public, e.g. /${section}/${slug}/cover.jpg.`
        )
      } else if (!existsSync(target) || !statSync(target).isFile()) {
        report(
          line,
          'og-image',
          `ogImage "${data.ogImage}" does not exist under apps/sim/public.`,
          `Add apps/sim/public${data.ogImage}, or fix the path.`
        )
      }
    }
  }

  if (Array.isArray(data.faq)) {
    const questionLines: number[] = []
    const answerLines: number[] = []
    frontmatterLines.forEach((line, index) => {
      if (/^\s*-?\s*q:/.test(line)) questionLines.push(index + 2)
      if (/^\s*-?\s*a:/.test(line)) answerLines.push(index + 2)
    })
    data.faq.forEach((entry: unknown, index: number) => {
      if (!entry || typeof entry !== 'object') return
      const { q, a } = entry as { q?: unknown; a?: unknown }
      for (const [field, value, lines] of [
        ['q', q, questionLines],
        ['a', a, answerLines],
      ] as const) {
        if (typeof value === 'string' && MARKDOWN_LINK.test(value)) {
          report(
            lines[index] ?? lineOfKey(frontmatterLines, 'faq'),
            'faq',
            `faq[${index}].${field} contains Markdown link syntax, which renders as literal text.`,
            'Write the FAQ in plain text; put the link in the article body instead.'
          )
        }
      }
    })
  }

  const bodyLines = body.split('\n')
  let fence: string | null = null
  bodyLines.forEach((text, index) => {
    const fenceMatch = CODE_FENCE.exec(text)
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1]
      else if (fenceMatch[1] === fence) fence = null
      return
    }
    if (fence !== null) return
    const line = bodyOffset + index + 1
    if (FAQ_HEADING.test(text.trim())) {
      report(
        line,
        'faq',
        `Body has a "${text.trim()}" heading.`,
        'Move the questions into the frontmatter `faq:` list (q/a pairs) and delete the section; the page renders it and emits FAQPage JSON-LD.'
      )
    }
    for (const match of text.matchAll(INTERNAL_LINK)) {
      const linkSection = match[1] as Section
      const isBareUrl = !LINK_TARGET_OPENER.test(text.slice(0, match.index))
      const target = isBareUrl ? match[2].replace(TRAILING_PUNCTUATION, '') : match[2]
      const rest = match[3] ?? ''
      // A deeper path is a public asset (`/library/<slug>/cover.jpg`) or a static sub-route.
      if (rest !== '' && rest !== '/') continue
      if (config.reservedSegments[linkSection].has(target)) continue
      const link = `/${linkSection}/${target}`
      if (linkSection === 'library' && target in config.mergedSlugs) {
        const kept = config.mergedSlugs[target]
        report(
          line,
          'internal-link',
          `${link} is retired; it was merged into /library/${kept}.`,
          `Link /library/${kept} instead.`
        )
      } else if (linkSection === 'blog' && config.movedBlogSlugs.includes(target)) {
        report(
          line,
          'internal-link',
          `${link} moved to /library/${target}.`,
          `Link /library/${target} instead.`
        )
      } else {
        const reason = unservedReason(posts, config.customerSlugs, linkSection, target)
        if (!reason) continue
        const elsewhere = SECTIONS.filter(
          (other) =>
            other !== linkSection && !unservedReason(posts, config.customerSlugs, other, target)
        )
        report(
          line,
          'internal-link',
          `${link} ${reason}.`,
          elsewhere.length > 0
            ? `Did you mean ${elsewhere.map((other) => `/${other}/${target}`).join(' or ')}?`
            : 'Fix the slug, publish the target, or remove the link.'
        )
      }
    }
  })

  try {
    await compile(body, {
      remarkPlugins: [
        remarkGfm,
        ...(section === 'changelog'
          ? [
              () => (tree: Root) =>
                checkChangelogBody(tree, config, bodyOffset, data.draft !== true, report),
            ]
          : []),
      ],
      outputFormat: 'function-body',
    })
  } catch (error) {
    const { line, reason, message } = error as { line?: number; reason?: string; message?: string }
    report(
      typeof line === 'number' ? bodyOffset + line : bodyOffset + 1,
      'mdx',
      `MDX does not compile: ${reason ?? message}`,
      'Escape a literal `<` or `{` as `&lt;` / `\\{`, and close every JSX tag.'
    )
  }

  return findings
}

/** Every retired or moved slug must redirect to a library post that serves a page. */
export function checkRedirectTargets(
  config: ContentCheckConfig,
  posts: PostIndex,
  file: string
): Finding[] {
  const redirects = [
    ...Object.entries(config.mergedSlugs).map(([from, to]) => [`/library/${from}`, to]),
    ...config.movedBlogSlugs.map((slug) => [`/blog/${slug}`, slug]),
  ]
  return redirects.flatMap(([from, to]) => {
    const reason = unservedReason(posts, config.customerSlugs, 'library', to)
    if (!reason) return []
    return {
      file,
      line: 1,
      rule: 'internal-link' as const,
      message: `${from} redirects to /library/${to}, which ${reason}.`,
      hint: 'Point the redirect in retired-slugs.ts at a published library post.',
    }
  })
}

/** Author ids from every author JSON that passes `AuthorSchema`; invalid profiles are findings. */
export function readAuthors(contentDir: string): { ids: Set<string>; findings: Finding[] } {
  const dir = path.join(contentDir, 'authors')
  const ids = new Set<string>()
  const findings: Finding[] = []
  if (!existsSync(dir)) return { ids, findings }
  for (const name of readdirSync(dir)
    .filter((entry) => entry.endsWith('.json'))
    .sort()) {
    const file = path.join(dir, name)
    let json: unknown
    try {
      json = JSON.parse(readFileSync(file, 'utf-8'))
    } catch (error) {
      json = error
    }
    const result = AuthorSchema.safeParse(json)
    if (result.success) {
      ids.add(result.data.id)
      continue
    }
    findings.push({
      file,
      line: 1,
      rule: 'frontmatter',
      message: `Author profile is invalid: ${result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`).join('; ')}`,
      hint: 'Match AuthorSchema in apps/sim/lib/content/schema.ts (valid JSON with id and name).',
    })
  }
  return { ids, findings }
}

export async function checkContent(
  config: ContentCheckConfig,
  only?: PostRef[]
): Promise<{ checked: number; findings: Finding[] }> {
  const posts = indexPosts(config.contentDir)
  const authors = readAuthors(config.contentDir)
  const targets =
    only ??
    SECTIONS.flatMap((section) => [...posts[section].keys()].map((slug) => ({ section, slug })))
  const results = await Promise.all(
    targets.map((target) => checkPost(config, posts, authors.ids, target))
  )
  const findings = [...authors.findings, ...results.flat()]
  const rssIdentities = new Map<string, string>()
  for (const [slug, post] of posts.changelog) {
    if (post.draft) continue
    const file = path.join(config.contentDir, 'changelog', slug, 'index.mdx')
    let frontmatter: unknown
    try {
      frontmatter = matter(readFileSync(file, 'utf-8'), {}).data
    } catch {
      continue
    }
    const parsed = ContentFrontmatterSchema.safeParse(frontmatter)
    if (!parsed.success || !parsed.data.release?.url) continue
    const identity = parsed.data.release.url
    const previous = rssIdentities.get(identity)
    if (previous) {
      findings.push({
        file,
        line: 1,
        rule: 'frontmatter',
        message: `Changelog entries ${previous} and ${slug} share an RSS identity.`,
        hint: 'Keep the release URL as the identity only for its migrated historical entry. For additional stories, omit release.url and link the release in the body.',
      })
    } else {
      rssIdentities.set(identity, slug)
    }
  }
  return { checked: targets.length, findings }
}

interface DocsOperation {
  operationId?: string
  tags?: string[]
}

interface DocsSpec {
  paths?: Record<string, Partial<Record<string, DocsOperation>>>
}

function readLinkedPages(docsAppDir: string): Set<string> {
  const pages = new Set([
    `${SIM_SITE_URL}/integrations`,
    `${SIM_SITE_URL}/models`,
    SIM_DOCS_URL,
    ...integrationsJson.integrations.map(
      (integration) => `${SIM_SITE_URL}/integrations/${integration.slug}`
    ),
    ...MODEL_PROVIDERS_WITH_MODELS.flatMap((provider) => [
      `${SIM_SITE_URL}${provider.href}`,
      ...provider.models.map((model) => `${SIM_SITE_URL}${model.href}`),
    ]),
  ])
  const docsDir = path.join(docsAppDir, 'content/docs')
  for (const file of readdirSync(docsDir, { recursive: true })) {
    if (!file.endsWith('.mdx') || file === 'index.mdx') continue
    const route = foldDocsIndexPath(file.split(path.sep).join('/')).replace(/\.mdx$/, '')
    pages.add(`${SIM_DOCS_URL}/${route}`)
  }
  for (const file of OPENAPI_SPEC_FILES) {
    const spec = JSON.parse(readFileSync(path.join(docsAppDir, file), 'utf8')) as DocsSpec
    for (const item of Object.values(spec.paths ?? {})) {
      for (const method of ['get', 'post', 'patch', 'delete', 'head', 'put']) {
        const operation = item[method]
        if (!operation?.operationId) continue
        for (const tag of operation.tags?.length ? operation.tags : ['unknown']) {
          const group = tag.replace(/\s+/g, '-').toLowerCase()
          pages.add(`${SIM_DOCS_URL}/api-reference/${group}/${operation.operationId}`)
        }
      }
    }
  }
  return pages
}

async function main() {
  const root = path.resolve(import.meta.dir, '..')
  const appDir = path.join(root, 'apps/sim')
  const config: ContentCheckConfig = {
    contentDir: path.join(appDir, 'content'),
    publicDir: path.join(appDir, 'public'),
    reservedSegments: readReservedSegments((section) =>
      path.join(appDir, 'app/(landing)', section)
    ),
    mergedSlugs: LIBRARY_MERGED_SLUGS,
    movedBlogSlugs: LIBRARY_MOVED_BLOG_SLUGS,
    customerSlugs: CUSTOMER_STORIES.map((story) => story.slug),
    linkedPages: readLinkedPages(path.join(root, 'apps/docs')),
  }

  const args = process.argv.slice(2)
  const flagIndex = args.indexOf('--slug')
  const slugArg = flagIndex === -1 ? args.find((arg) => !arg.startsWith('-')) : args[flagIndex + 1]
  if (flagIndex !== -1 && !slugArg) {
    console.error('Usage: bun run check:library-content [--slug <section>/<slug> | <slug>]')
    process.exit(1)
  }

  let only: PostRef[] | undefined
  const findings: Finding[] = []
  if (slugArg) {
    const resolved = resolvePostArg(slugArg, indexPosts(config.contentDir))
    if (typeof resolved === 'string') {
      console.error(resolved)
      process.exit(1)
    }
    only = resolved
  } else {
    findings.push(
      ...checkRedirectTargets(
        config,
        indexPosts(config.contentDir),
        path.join(appDir, 'lib/library/retired-slugs.ts')
      )
    )
  }

  const result = await checkContent(config, only)
  findings.push(...result.findings)

  if (findings.length > 0) {
    findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
    console.error(
      `Library content audit failed: ${findings.length} problem(s) in ${result.checked} post(s).\n\n` +
        findings
          .map(
            (finding) =>
              `  ${path.relative(root, finding.file)}:${finding.line} [${finding.rule}] ${finding.message}\n    fix: ${finding.hint}`
          )
          .join('\n')
    )
    process.exit(1)
  }

  console.log(`Library content audit passed (${result.checked} posts).`)
}

if (import.meta.main) await main()
