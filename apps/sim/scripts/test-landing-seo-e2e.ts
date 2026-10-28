import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  LANDING_INTEGRATION_SLUGS,
  LANDING_SLUG_BY_DOCS_SLUG,
} from '@sim/deployment-config/integration-docs'
import integrationsJson from '@sim/deployment-config/integrations.json'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import matter from 'gray-matter'
import {
  dustProfile,
  gumloopProfile,
  langflowProfile,
  n8nProfile,
  openClawProfile,
  pipedreamProfile,
  vellumProfile,
} from '@/lib/compare/data'
import { ContentFrontmatterSchema } from '@/lib/content/schema'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { INTEGRATION_SEO } from '@/app/(landing)/integrations/data/seo-content'

/**
 * Crawls a running landing site the way a search or AI crawler does: plain GETs, no JavaScript,
 * reading status codes, robots directives, the sitemap, and JSON-LD. CI points it at the production
 * build (`next start` on the image's placeholder `NEXT_PUBLIC_APP_URL`, so every route renders
 * dynamically, as it does in production). It only issues GETs, so it can also be pointed at a
 * deployed origin to compare.
 *
 * Requires LANDING_SEO_E2E_BASE_URL and LANDING_SEO_E2E_REPORT_PATH.
 */
const logger = createLogger('LandingSeoE2E')

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}

const baseUrl = new URL(requiredEnvironment('LANDING_SEO_E2E_BASE_URL'))
const reportPath = resolve(requiredEnvironment('LANDING_SEO_E2E_REPORT_PATH'))
assert.equal(baseUrl.pathname, '/', 'The base URL must be an origin without a path')

interface Integration {
  slug: string
  updatedAt?: string
}
const integrations = integrationsJson.integrations as Integration[]
const LIBRARY_ARTICLE_PATH = /^\/library\/(?!authors\/|tags)[^/]+$/
/** `?home` serves the landing page without the self-hosted `/` → `/login` redirect. */
const HOME_PATH = '/?home'

const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const responses: { path: string; accept?: string; status: number; location?: string }[] = []
const startedAt = new Date().toISOString()

async function check(name: string, run: () => Promise<void>) {
  const started = performance.now()
  try {
    await run()
    checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started) })
    logger.info(`PASS ${name}`)
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: Math.round(performance.now() - started),
      error: getErrorMessage(error),
    })
    logger.error(`FAIL ${name}`, { error: getErrorMessage(error) })
  }
}

async function get(
  path: string,
  accept?: string
): Promise<{ status: number; location: string | null; body: string; headers: Headers }> {
  const response = await fetch(new URL(path, baseUrl), {
    redirect: 'manual',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; SimLandingSeoE2E/1.0)',
      ...(accept ? { Accept: accept } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  })
  const body = await response.text()
  const location = response.headers.get('location')
  responses.push({
    path,
    ...(accept ? { accept } : {}),
    status: response.status,
    ...(location ? { location } : {}),
  })
  return { status: response.status, location, body, headers: response.headers }
}

function pageTitle(html: string): string {
  return decodeHtml(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '')
}

function canonicalPath(html: string): string | null {
  const href = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1]
  return href ? new URL(href).pathname : null
}

function robotsDirectives(html: string): string[] {
  return [...html.matchAll(/<meta name="robots" content="([^"]*)"/g)].map((match) => match[1])
}

function jsonLdNodes(html: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = []
  for (const match of html.matchAll(
    /<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs
  )) {
    const parsed: unknown = JSON.parse(match[1])
    const roots = Array.isArray(parsed) ? parsed : [parsed]
    for (const root of roots as Record<string, unknown>[]) {
      nodes.push(root)
      if (Array.isArray(root['@graph']))
        nodes.push(...(root['@graph'] as Record<string, unknown>[]))
    }
  }
  return nodes
}

/** Undoes the entity escaping React applies to text, so rendered copy compares to its source. */
function decodeHtml(html: string): string {
  return html
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** Question text of every FAQPage entry on the page, in order. */
function faqQuestions(html: string): string[] {
  const faqPage = jsonLdNodes(html).find((node) => node['@type'] === 'FAQPage')
  const entries = (faqPage?.mainEntity ?? []) as { name?: string }[]
  return entries.map((entry) => entry.name ?? '')
}

/** Paths and lastmod values from the sitemap, keyed by path. */
async function readSitemap(): Promise<Map<string, string | undefined>> {
  const { status, body } = await get('/sitemap.xml')
  assert.equal(status, 200, 'sitemap.xml must be served')
  const entries = new Map<string, string | undefined>()
  for (const match of body.matchAll(/<url>(.*?)<\/url>/gs)) {
    const loc = /<loc>([^<]+)<\/loc>/.exec(match[1])?.[1]
    if (!loc) continue
    entries.set(new URL(loc).pathname, /<lastmod>([^<]+)<\/lastmod>/.exec(match[1])?.[1])
  }
  return entries
}

async function run() {
  let sitemap = new Map<string, string | undefined>()
  await check('sitemap.xml is served', async () => {
    sitemap = await readSitemap()
  })
  const sitemapPaths = [...sitemap.keys()]
  const firstPath = (pattern: RegExp) => {
    const path = sitemapPaths.find((candidate) => pattern.test(candidate))
    assert(path, `The sitemap lists no page matching ${pattern}`)
    return path
  }

  await check('unknown slugs return 404 and every robots directive is noindex', async () => {
    const unknown = [
      '/integrations/not-a-real-integration',
      '/library/not-a-real-post',
      '/blog/not-a-real-post',
      '/blog/authors/not-a-real-author',
      '/library/authors/not-a-real-author',
      '/models/not-a-real-provider',
      '/models/anthropic/not-a-real-model',
      '/models/compare/not-a-real-pair',
    ]
    const failures: string[] = []
    for (const path of unknown) {
      const { status, body } = await get(path)
      const robots = robotsDirectives(body)
      const indexable =
        robots.length === 0 || robots.some((directive) => !/\bnoindex\b/.test(directive))
      if (status !== 404 || indexable) {
        failures.push(`${path} → ${status}, robots ${JSON.stringify(robots)}`)
      }
    }
    assert.deepEqual(failures, [])
  })

  await check('known pages in each slug family render and are indexable', async () => {
    const known = [
      '/blog',
      '/library',
      firstPath(/^\/blog\/(?!authors\/|tags)[^/]+$/),
      firstPath(LIBRARY_ARTICLE_PATH),
      firstPath(/^\/integrations\/[^/]+$/),
      firstPath(/^\/models\/anthropic\/[^/]+$/),
      '/models/context-windows',
      '/models/pricing-calculator',
      '/models/token-counter',
      firstPath(/^\/models\/compare\/[^/]+$/),
    ]
    const failures: string[] = []
    for (const path of known) {
      const { status, body } = await get(path)
      const robots = robotsDirectives(body)
      if (status !== 200 || robots.some((directive) => directive.includes('noindex'))) {
        failures.push(`${path} → ${status}, robots ${JSON.stringify(robots)}`)
      }
    }
    assert.deepEqual(failures, [])
  })

  await check(
    'a library seoTitle and seoDescription are the search and social copy; title stays the H1',
    async () => {
      const slug = 'openai-vs-n8n-vs-sim'
      const source = await readFile(
        new URL(`../content/library/${slug}/index.mdx`, import.meta.url)
      )
      const { title, seoTitle, description, seoDescription } = ContentFrontmatterSchema.parse(
        matter(source.toString()).data
      )
      assert(seoTitle && seoTitle !== title, `${slug} has no distinct seoTitle`)
      assert(
        seoDescription && seoDescription !== description,
        `${slug} has no distinct seoDescription`
      )
      const { status, body } = await get(`/library/${slug}`)
      assert.equal(status, 200)
      const capture = (pattern: RegExp) => {
        const value = pattern.exec(body)?.[1]
        return value === undefined ? undefined : decodeHtml(value)
      }
      assert.equal(capture(/<title>([^<]*)<\/title>/), `${seoTitle} | Sim`)
      assert.equal(capture(/<meta property="og:title" content="([^"]*)"/), seoTitle)
      assert.equal(capture(/<meta name="description" content="([^"]*)"/), seoDescription)
      assert.equal(capture(/<h1[^>]*>([^<]*)<\/h1>/), title)
    }
  )

  await check(
    'every model page carries a distinct search title within 60 characters and self-canonicalizes',
    async () => {
      const paths = sitemapPaths.filter((path) => path === '/models' || path.startsWith('/models/'))
      const comparePaths = paths.filter((path) => path.startsWith('/models/compare/'))
      assert(
        comparePaths.length >= 5,
        `The sitemap lists only ${comparePaths.length} compare pages`
      )
      for (const required of [
        '/models',
        '/models/anthropic',
        '/models/context-windows',
        '/models/pricing-calculator',
        '/models/token-counter',
      ]) {
        assert(paths.includes(required), `The sitemap omits ${required}`)
      }
      const pages = await mapWithConcurrency(paths, 8, async (path) => ({
        path,
        ...(await get(path)),
      }))
      const pathByTitle = new Map<string, string>()
      let anthropicTitle = ''
      const failures: string[] = []
      for (const { path, status, body } of pages) {
        const title = pageTitle(body)
        const canonical = canonicalPath(body)
        const duplicateOf = pathByTitle.get(title)
        pathByTitle.set(title, duplicateOf ?? path)
        if (path === '/models/anthropic') anthropicTitle = title
        if (
          status !== 200 ||
          !title.endsWith(' | Sim') ||
          title.endsWith(' | Sim | Sim') ||
          title.length > 60 ||
          duplicateOf ||
          canonical !== path ||
          !sitemap.has(path)
        ) {
          failures.push(
            `${path} → ${status}, title "${title}" (${title.length})${duplicateOf ? ` duplicates ${duplicateOf}` : ''}, canonical ${canonical}, in sitemap ${sitemap.has(path)}`
          )
        }
      }
      assert.deepEqual(failures, [])
      assert.match(anthropicTitle, /Claude/, '/models/anthropic does not name Claude in its title')
    }
  )

  await check('token counter ships no js-tiktoken code in its initial load', async () => {
    const { status, body } = await get('/models/token-counter')
    assert.equal(status, 200)
    // Every js-tiktoken rank table is keyed `bpe_ranks` and its encoder reads that property, so the
    // name appears in any chunk that bundles the tokenizer, which must load only on interaction.
    const marker = /bpe_ranks/
    assert(!marker.test(body), 'The initial HTML embeds js-tiktoken code')
    const scripts = [...body.matchAll(/<script[^>]+src="([^"]+)"/g)]
      .map((match) => new URL(decodeHtml(match[1]), baseUrl))
      .filter((url) => url.origin === baseUrl.origin)
    assert(scripts.length > 0, 'The initial HTML references no scripts')
    const offenders: string[] = []
    for (const url of scripts) {
      const script = await get(`${url.pathname}${url.search}`)
      if (marker.test(script.body)) offenders.push(url.pathname)
    }
    assert.deepEqual(offenders, [], 'An initial script chunk bundles js-tiktoken')
  })

  await check('docs integration slugs redirect to their landing page', async () => {
    const failures: string[] = []
    for (const [docsSlug, landingSlug] of LANDING_SLUG_BY_DOCS_SLUG) {
      if (docsSlug === landingSlug || LANDING_INTEGRATION_SLUGS.has(docsSlug)) continue
      const { status, location } = await get(`/integrations/${docsSlug}`)
      const target = location ? new URL(location, baseUrl).pathname : null
      if (status !== 308 || target !== `/integrations/${landingSlug}`) {
        failures.push(`${docsSlug} → ${status} ${target}`)
      }
    }
    assert.deepEqual(failures, [])
  })

  await check('integration sitemap dates are per integration, not one catalog date', async () => {
    const mismatches: string[] = []
    for (const integration of integrations) {
      const lastmod = sitemap.get(`/integrations/${integration.slug}`)
      assert(integration.updatedAt, `${integration.slug} has no updatedAt in the catalog`)
      if (lastmod?.slice(0, 10) !== integration.updatedAt) {
        mismatches.push(
          `${integration.slug}: sitemap ${lastmod} vs catalog ${integration.updatedAt}`
        )
      }
    }
    assert.deepEqual(mismatches.slice(0, 10), [], `${mismatches.length} integration dates differ`)
    const distinctDates = new Set(integrations.map((integration) => integration.updatedAt))
    assert(distinctDates.size > 1, 'Every integration carries the same date')
  })

  await check('integration page JSON-LD and visible date use the integration date', async () => {
    const integration = integrations.find((entry) => entry.slug === 'slack')
    assert(integration?.updatedAt)
    const { body } = await get('/integrations/slack')
    const webPage = jsonLdNodes(body).find((node) => node['@type'] === 'WebPage')
    assert.equal(webPage?.dateModified, integration.updatedAt)
    assert(
      // HTML attribute names are case-insensitive; React emits `dateTime`, parsers fold it.
      body
        .toLowerCase()
        .includes(`datetime="${integration.updatedAt}"`),
      'Visible last-updated date differs'
    )
  })

  await check('reseller model pages are in the sitemap and name their provider', async () => {
    const resellerPath = firstPath(/^\/models\/(?:bedrock|vertex|azure-openai)\/[^/]+$/)
    const { status, body } = await get(resellerPath)
    assert.equal(status, 200)
    const title = /<title>([^<]*)<\/title>/.exec(body)?.[1] ?? ''
    assert.match(title, / on /, `${resellerPath} title "${title}" does not name the reseller`)
  })

  await check('footer integration links stay on the landing site', async () => {
    const { body } = await get(HOME_PATH)
    assert(body.includes('href="/integrations/slack"'), 'Footer does not link /integrations/slack')
    assert(!body.includes('docs.sim.ai/integrations/'), 'Footer still links docs integration pages')
    assert(!body.includes('docs.sim.ai/mothership'), 'Footer links a redirecting docs path')
  })

  await check(
    'home JSON-LD names no retired plan and ties the product to the organization',
    async () => {
      const { body } = await get(HOME_PATH)
      assert(!/Community Plan/.test(body), 'Home still names the retired Community plan')
      const software = jsonLdNodes(body).find((node) => String(node['@id']).endsWith('#software'))
      assert(software, 'Home has no #software node')
      const publisher = software.publisher as Record<string, unknown> | undefined
      assert(String(publisher?.['@id']).endsWith('#organization'), '#software has no publisher')
    }
  )

  await check('pricing declares its offers on the canonical product node', async () => {
    const { body } = await get('/pricing')
    const product = jsonLdNodes(body).find((node) => Array.isArray(node.offers))
    assert(product, 'Pricing has no offers')
    assert(String(product['@id']).endsWith('#software'), `Offers sit on ${product['@id']}`)
  })

  await check('comparison pages lead with their answer and their tracked-prompt FAQs', async () => {
    const failures: string[] = []
    for (const profile of [
      n8nProfile,
      dustProfile,
      gumloopProfile,
      vellumProfile,
      langflowProfile,
      pipedreamProfile,
      openClawProfile,
    ]) {
      const { status, body } = await get(`/comparisons/${profile.id}`)
      if (status !== 200) {
        failures.push(`${profile.id}: status ${status}`)
        continue
      }
      const text = decodeHtml(body)
      const lead = profile.leadAnswer?.map((part) => (typeof part === 'string' ? part : part.text))
      const firstSection = text.indexOf('<h2')
      const leadAt = lead ? text.indexOf(lead.join('')) : -1
      if (leadAt < 0 || leadAt > firstSection) {
        failures.push(`${profile.id}: lead answer missing or below the first section`)
      }
      const expected = (profile.faqs ?? []).map((faq) => faq.question)
      const questions = faqQuestions(body).slice(0, expected.length)
      if (expected.length === 0 || questions.join('|') !== expected.join('|')) {
        failures.push(`${profile.id}: FAQPage does not open with the profile FAQs`)
      }
    }
    assert.deepEqual(failures, [])
  })

  await check('rebuilt integration pages render their comparison and FAQs', async () => {
    const failures: string[] = []
    for (const slug of ['github', 'shopify', 'snowflake']) {
      const seo = INTEGRATION_SEO[slug]
      const { status, body } = await get(`/integrations/${slug}`)
      if (status !== 200) {
        failures.push(`${slug}: status ${status}`)
        continue
      }
      const text = decodeHtml(body)
      if (!seo?.comparison || !text.includes(seo.comparison.heading)) {
        failures.push(`${slug}: comparison section missing`)
      }
      const expected = (seo?.faqs ?? []).map((faq) => faq.question)
      if (expected.length === 0 || faqQuestions(body).join('|') !== expected.join('|')) {
        failures.push(`${slug}: FAQPage does not match the hand-written FAQs`)
      }
    }
    assert.deepEqual(failures, [])
  })

  await check('blog, library, and changelog advertise their RSS feeds', async () => {
    const missing: string[] = []
    for (const [path, feed] of [
      ['/blog', '/blog/rss.xml'],
      ['/library', '/library/rss.xml'],
      ['/changelog', '/changelog.xml'],
    ]) {
      const { body } = await get(path)
      const link = /<link rel="alternate" type="application\/rss\+xml" href="([^"]+)"/.exec(body)
      if (!link || new URL(link[1]).pathname !== feed) missing.push(path)
    }
    assert.deepEqual(missing, [])
  })

  await check('the homepage answers a Markdown request in Markdown', async () => {
    const markdown = await get(HOME_PATH, 'text/markdown')
    assert.equal(markdown.status, 200)
    assert.match(markdown.headers.get('content-type') ?? '', /^text\/markdown/)
    assert.match(markdown.headers.get('vary') ?? '', /\bAccept\b/)
    assert.equal(markdown.headers.get('cache-control'), 'no-store')
    assert.match(markdown.body, /^# Sim: /)
    assert.match(markdown.body, /\]\([^)]*\/signup\)/)

    const refused = await get(HOME_PATH, 'text/html, text/markdown;q=0')
    assert.match(refused.headers.get('content-type') ?? '', /^text\/html/)

    const html = await get(HOME_PATH, 'text/html,application/xhtml+xml,*/*;q=0.8')
    assert.match(html.headers.get('content-type') ?? '', /^text\/html/)
    assert.match(html.headers.get('vary') ?? '', /\bAccept\b/)
    const alternate = /<link rel="alternate" type="text\/markdown" href="([^"]+)"/.exec(html.body)
    assert.ok(alternate, 'homepage HTML does not advertise its Markdown alternate')
    const alternatePath = new URL(alternate[1]).pathname
    assert.equal(alternatePath, '/index.md')

    const direct = await get(alternatePath)
    assert.equal(direct.body, markdown.body)
    assert.match(direct.headers.get('link') ?? '', /rel="canonical"/)
  })

  await check('a library article is served as Markdown at .md and by Accept', async () => {
    const path = firstPath(LIBRARY_ARTICLE_PATH)
    const html = await get(path, 'text/html,application/xhtml+xml,*/*;q=0.8')
    assert.match(html.headers.get('content-type') ?? '', /^text\/html/)
    assert.match(html.headers.get('vary') ?? '', /\bAccept\b/)
    const alternate = /<link rel="alternate" type="text\/markdown" href="([^"]+)"/.exec(html.body)
    assert.ok(alternate, `${path} does not advertise its Markdown alternate`)
    assert.equal(new URL(alternate[1]).pathname, `${path}.md`)
    const feed = /<link rel="alternate" type="application\/rss\+xml" href="([^"]+)"/.exec(html.body)
    assert.equal(feed && new URL(feed[1]).pathname, '/library/rss.xml')

    const direct = await get(`${path}.md`)
    assert.equal(direct.status, 200)
    assert.match(direct.headers.get('content-type') ?? '', /^text\/markdown/)
    assert.equal(direct.headers.get('cache-control'), 'no-store')
    assert.match(direct.headers.get('link') ?? '', /rel="canonical"/)
    const heading = decodeHtml(/<h1[^>]*>([^<]*)<\/h1>/.exec(html.body)?.[1] ?? '')
    assert.equal(direct.body.split('\n')[0], `# ${heading}`)

    const negotiated = await get(path, 'text/markdown')
    assert.match(negotiated.headers.get('content-type') ?? '', /^text\/markdown/)
    assert.equal(negotiated.body, direct.body)

    const tags = await get('/library/tags', 'text/markdown, text/html;q=0.5')
    assert.equal(tags.status, 200, 'the Markdown rewrite shadows /library/tags')
    assert.match(tags.headers.get('content-type') ?? '', /^text\/html/)

    const unknown = await get('/library/not-a-real-post.md')
    assert.equal(unknown.status, 404)
    assert.match(unknown.headers.get('content-type') ?? '', /^text\/markdown/)
  })

  await check(
    'a library article has one structured-data source, linked to the site graph',
    async () => {
      const path = firstPath(LIBRARY_ARTICLE_PATH)
      const { body } = await get(path)
      assert.doesNotMatch(body, /itemType="https:\/\/schema\.org\/(BlogPosting|FAQPage)"/i)
      const nodes = jsonLdNodes(body)
      const website = nodes.find((node) => node['@type'] === 'WebSite')
      const article = nodes.find((node) => [node['@type']].flat().includes('BlogPosting'))
      assert(website && article, `${path} lacks a WebSite or BlogPosting node`)
      assert.equal(article['@id'], `${article.url}#article`)
      for (const selector of (article.speakable as { cssSelector: string[] }).cssSelector) {
        const [, name, value] = /^\[([\w-]+)="([^"]+)"\]$/.exec(selector) ?? []
        assert(
          body.includes(`${name}="${value}"`),
          `speakable selector ${selector} matches nothing`
        )
      }
      assert.equal(
        (article.isPartOf as Record<string, unknown> | undefined)?.['@id'],
        website['@id']
      )
      for (const author of article.author as Record<string, unknown>[]) {
        const page = new URL(String(author.url)).pathname
        assert.match(page, /^\/library\/authors\/[^/]+$/)
        assert.equal(author['@id'], `${author.url}#person`)
        const profile = jsonLdNodes((await get(page)).body).find(
          (node) => node['@type'] === 'Person'
        )
        assert.equal(profile?.['@id'], author['@id'], `${page} names a different Person @id`)
      }
    }
  )
}

try {
  await run()
} finally {
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        startedAt,
        completedAt: new Date().toISOString(),
        baseUrl: baseUrl.origin,
        checks,
        responses,
      },
      null,
      2
    )
  )
}
const failures = checks.filter((result) => result.status === 'failed')
logger.info('Landing SEO checks complete', {
  passed: checks.length - failures.length,
  failed: failures.length,
  reportPath,
})
if (failures.length) process.exitCode = 1
