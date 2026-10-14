import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import integrationsJson from '@sim/deployment-config/integrations.json'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'

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
/** `?home` serves the landing page without the self-hosted `/` → `/login` redirect. */
const HOME_PATH = '/?home'

const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const responses: { path: string; status: number; location?: string }[] = []
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
  path: string
): Promise<{ status: number; location: string | null; body: string }> {
  const response = await fetch(new URL(path, baseUrl), {
    redirect: 'manual',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SimLandingSeoE2E/1.0)' },
    signal: AbortSignal.timeout(30_000),
  })
  const body = await response.text()
  const location = response.headers.get('location')
  responses.push({ path, status: response.status, ...(location ? { location } : {}) })
  return { status: response.status, location, body }
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
  const sitemap = await readSitemap()
  const sitemapPaths = [...sitemap.keys()]
  const firstPath = (pattern: RegExp) => {
    const path = sitemapPaths.find((candidate) => pattern.test(candidate))
    assert(path, `The sitemap lists no page matching ${pattern}`)
    return path
  }

  await check('unknown slugs return 404 with a single noindex directive', async () => {
    const unknown = [
      '/integrations/not-a-real-integration',
      '/library/not-a-real-post',
      '/blog/not-a-real-post',
      '/blog/authors/not-a-real-author',
      '/library/authors/not-a-real-author',
      '/models/not-a-real-provider',
      '/models/anthropic/not-a-real-model',
    ]
    const failures: string[] = []
    for (const path of unknown) {
      const { status, body } = await get(path)
      const robots = robotsDirectives(body)
      const indexable = robots.some((directive) => !directive.includes('noindex'))
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
      firstPath(/^\/library\/(?!authors\/|tags)[^/]+$/),
      firstPath(/^\/integrations\/[^/]+$/),
      firstPath(/^\/models\/anthropic\/[^/]+$/),
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

  await check('underscore integration slugs redirect to the hyphenated page', async () => {
    const { status, location } = await get('/integrations/google_drive')
    assert.equal(status, 308)
    assert.equal(location && new URL(location, baseUrl).pathname, '/integrations/google-drive')
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
      body.includes(`dateTime="${integration.updatedAt}"`),
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

await run()
const failures = checks.filter((result) => result.status === 'failed')
logger.info('Landing SEO checks complete', {
  passed: checks.length - failures.length,
  failed: failures.length,
  reportPath,
})
if (failures.length) process.exitCode = 1
