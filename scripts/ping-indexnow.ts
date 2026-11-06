#!/usr/bin/env bun
/**
 * Tells IndexNow (Bing, Yandex, Seznam, Naver; ChatGPT and Copilot search ground on Bing) which
 * library articles and comparison pages a production release changed, so they are recrawled
 * without waiting for the sitemap. CI runs it after the production cutover, with the commits on
 * either side of the push: `bun scripts/ping-indexnow.ts <base-sha> <head-sha>`.
 *
 * Best effort by design: the CI job continues on error, and a run with nothing to submit, or
 * without a base commit to diff against, exits without a request.
 *
 * The key is public (IndexNow verifies ownership by fetching it from the site), so it is committed
 * as `apps/sim/public/<key>.txt`.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { SIM_SITE_URL } from '../packages/utils/src/site'

const SITE = SIM_SITE_URL
const INDEXNOW_KEY = 'e300fec30f4d245dc5ad832693bbc144'
const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'
/** IndexNow accepts at most 10,000 URLs per request. */
const MAX_URLS = 10_000
const REQUEST_TIMEOUT_MS = 15_000

const LIBRARY_DIR = 'apps/sim/content/library'
const COMPETITORS_DIR = 'apps/sim/lib/compare/data/competitors'
const SIM_PROFILE = 'apps/sim/lib/compare/data/sim.ts'

function git(repo: string, args: string[]): string | null {
  const result = spawnSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return result.status === 0 ? result.stdout : null
}

function isDraft(source: string): boolean {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] ?? ''
  return /^draft:\s*true\s*(#.*)?\r?$/m.test(frontmatter)
}

function profileId(source: string): string | undefined {
  return /^\s*id:\s*['"]([^'"]+)['"]/m.exec(source)?.[1]
}

/**
 * The public URLs whose source changed between two commits: each library article published on
 * either side (renamed, deleted, and newly drafted ones too, so engines learn of the 404), each
 * comparison whose profile changed under its old and new id (every comparison when Sim's own
 * profile did), and the index page of each section that changed. A post that was never published
 * is never submitted.
 */
export function collectIndexNowUrls(repo: string, base: string, head: string): string[] {
  const diff = git(repo, ['diff', '--name-status', '-M', base, head, '--']) ?? ''
  const show = (sha: string, file: string) => git(repo, ['show', `${sha}:${file}`])
  const paths = diff
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => line.split('\t').slice(1))
  const urls = new Set<string>()

  const slugs = new Set(
    paths
      .map((file) => path.relative(LIBRARY_DIR, file).split('/'))
      .filter((parts) => parts.length > 1 && parts[0] !== '..')
      .map(([slug]) => slug)
  )
  for (const slug of slugs) {
    const index = `${LIBRARY_DIR}/${slug}/index.mdx`
    const wasOrIsPublished = [show(base, index), show(head, index)].some(
      (source) => source !== null && !isDraft(source)
    )
    if (wasOrIsPublished) urls.add(`${SITE}/library/${slug}`)
  }
  if (urls.size > 0) urls.add(`${SITE}/library`)

  const changedProfiles = paths.filter(
    (file) => path.dirname(file) === COMPETITORS_DIR && file.endsWith('.ts')
  )
  const currentProfiles = paths.includes(SIM_PROFILE)
    ? (git(repo, ['ls-tree', '--name-only', head, `${COMPETITORS_DIR}/`]) ?? '').split('\n')
    : []
  const ids = new Set(
    [...new Set([...changedProfiles, ...currentProfiles])]
      .filter(Boolean)
      .flatMap((file) => [show(base, file), show(head, file)])
      .map((source) => profileId(source ?? ''))
      .filter((id): id is string => Boolean(id))
  )
  for (const id of ids) urls.add(`${SITE}/comparisons/${id}`)
  if (ids.size > 0) urls.add(`${SITE}/comparisons`)

  return [...urls].sort()
}

async function main() {
  const [base, head = 'HEAD'] = process.argv.slice(2)
  const repo = path.resolve(import.meta.dir, '..')
  if (!base || git(repo, ['cat-file', '-e', `${base}^{commit}`]) === null) {
    console.info(`No base commit to diff against (${base || 'none'}); nothing submitted.`)
    return
  }

  const urls = collectIndexNowUrls(repo, base, head).slice(0, MAX_URLS)
  if (urls.length === 0) {
    console.info('No library or comparison page changed; nothing submitted.')
    return
  }

  const response = await fetch(INDEXNOW_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: new URL(SITE).host,
      key: INDEXNOW_KEY,
      keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`,
      urlList: urls,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  console.info(`IndexNow answered ${response.status} for ${urls.length} URLs:\n${urls.join('\n')}`)
  if (!response.ok) process.exitCode = 1
}

if (import.meta.main) await main()
