import { compareStrings, escapeRegExp, stripTrailingSlashes } from '@sim/utils/string'
import type { ContentMeta } from '@/lib/content/schema'
import { byDateDesc } from '@/lib/content/utils'
import { SITE_URL } from '@/lib/core/utils/urls'

/** A post with the site-internal paths its body links to. */
export interface LinkedPost {
  meta: ContentMeta
  linkedPaths: string[]
}

/** Related-post rankings and the reverse link graph for one content section, built once per scan. */
export interface PostLinkIndex {
  /** Every other post for each slug, most related first. */
  related: Map<string, ContentMeta[]>
  /** Posts whose body links to each site-internal path, newest first. */
  inbound: Map<string, ContentMeta[]>
  /** Site-internal paths each post's body links to. */
  outbound: Map<string, ReadonlySet<string>>
}

/**
 * Markdown (`](...)`) and JSX (`href="..."`) link targets on this site, relative or absolute.
 * Query strings and fragments are dropped so `/library/a#faq` counts as a link to `/library/a`.
 */
const INTERNAL_LINK_PATTERN = new RegExp(
  `(?:\\]\\(|href=\\{?["'])(?:${escapeRegExp(SITE_URL)})?(/[^\\s)"'#?]*)`,
  'g'
)

const TITLE_STOP_WORDS = new Set([
  'an',
  'and',
  'are',
  'as',
  'at',
  'best',
  'by',
  'can',
  'compared',
  'do',
  'does',
  'for',
  'from',
  'guide',
  'how',
  'in',
  'into',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'vs',
  'what',
  'when',
  'why',
  'with',
  'you',
  'your',
])

/** Unique site-internal paths a post body links to, without trailing slashes. */
export function extractInternalLinkPaths(body: string): string[] {
  const paths = new Set<string>()
  for (const match of body.matchAll(INTERNAL_LINK_PATTERN)) {
    paths.add(stripTrailingSlashes(match[1]) || '/')
  }
  return [...paths]
}

function titleTerms(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length > 1 && !/^\d+$/.test(term) && !TITLE_STOP_WORDS.has(term))
  )
}

/**
 * Inverse document frequency per term. A term on more than half the posts (the `Sim` and
 * `AI Agents` tags on every library post) says nothing about which posts are related, so it
 * weighs zero.
 */
function rarityWeights(termSets: Iterable<Set<string>>, postCount: number): Map<string, number> {
  const documentFrequency = new Map<string, number>()
  for (const terms of termSets) {
    for (const term of terms) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
  }
  const weights = new Map<string, number>()
  for (const [term, count] of documentFrequency) {
    weights.set(term, count > postCount / 2 ? 0 : Math.log(postCount / count))
  }
  return weights
}

function sharedWeight(a: Set<string>, b: Set<string>, weights: Map<string, number>): number {
  let total = 0
  for (const term of a) if (b.has(term)) total += weights.get(term) ?? 0
  return total
}

/** FNV-1a, so posts with equal scores spread across pages instead of all favoring one. */
function pairHash(from: string, to: string): number {
  let hash = 2166136261
  const key = `${from}\0${to}`
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * Ranks related posts and inverts body links for a section's published posts.
 *
 * Relatedness sums three signals: shared tags and shared title terms, each weighted by rarity,
 * and a direct body link in either direction, discounted when either post is already widely
 * linked so a hub page does not crowd every list. Equal scores order by a per-pair hash, then
 * slug, so the result is deterministic without favoring the newest posts.
 */
export function buildPostLinkIndex(posts: LinkedPost[], basePath: string): PostLinkIndex {
  const postCount = posts.length
  const entries = posts.map(({ meta, linkedPaths }) => ({
    meta,
    linkedPaths,
    tags: new Set(meta.tags),
    terms: titleTerms(meta.title),
  }))
  const tagWeights = rarityWeights(
    entries.map(({ tags }) => tags),
    postCount
  )
  const termWeights = rarityWeights(
    entries.map(({ terms }) => terms),
    postCount
  )

  const postPrefix = `${basePath}/`
  const inbound = new Map<string, ContentMeta[]>()
  const outbound = new Map<string, ReadonlySet<string>>()
  for (const { meta, linkedPaths } of entries) {
    const selfPath = `${postPrefix}${meta.slug}`
    const paths = new Set(linkedPaths.filter((linkPath) => linkPath !== selfPath))
    outbound.set(meta.slug, paths)
    for (const linkPath of paths) {
      const linkers = inbound.get(linkPath)
      if (linkers) linkers.push(meta)
      else inbound.set(linkPath, [meta])
    }
  }
  for (const linkers of inbound.values()) linkers.sort(byDateDesc)

  const inboundCount = (slug: string) => inbound.get(`${postPrefix}${slug}`)?.length ?? 0
  const linkWeight = (a: string, b: string) => {
    const linked =
      outbound.get(a)?.has(`${postPrefix}${b}`) || outbound.get(b)?.has(`${postPrefix}${a}`)
    if (!linked) return 0
    return Math.max(0, Math.log(postCount / (1 + inboundCount(a) + inboundCount(b))))
  }

  const related = new Map<string, ContentMeta[]>()
  for (const current of entries) {
    const ranked = entries
      .filter(({ meta }) => meta.slug !== current.meta.slug)
      .map((candidate) => ({
        meta: candidate.meta,
        score:
          sharedWeight(current.tags, candidate.tags, tagWeights) +
          sharedWeight(current.terms, candidate.terms, termWeights) +
          linkWeight(current.meta.slug, candidate.meta.slug),
        tiebreak: pairHash(current.meta.slug, candidate.meta.slug),
      }))
      .sort(
        (a, b) =>
          b.score - a.score || a.tiebreak - b.tiebreak || compareStrings(a.meta.slug, b.meta.slug)
      )
    related.set(
      current.meta.slug,
      ranked.map(({ meta }) => meta)
    )
  }

  return { related, inbound, outbound }
}
