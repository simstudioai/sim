import { escapeRegExp } from '@sim/utils/string'
import type { CompetitorProfile } from '@/lib/compare/data'
import type { ContentMeta } from '@/lib/content/schema'
import { getAllPostMeta, getPostsLinkingTo } from '@/lib/library/registry'
import { ALL_COMPETITORS, comparisonPath } from '@/app/(landing)/comparisons/utils'

/** Most links either side renders, so the section stays a short "read next" list. */
const MAX_LINKS = 6

/**
 * An article titled "{Competitor} Alternatives" answers the same buyer question as the
 * comparison page, so it leads, then articles about the competitor, articles linking to its
 * comparison page, and articles naming it only in the description.
 */
const ALTERNATIVES_SCORE = 4
const SUBJECT_SCORE = 3
const LINKS_TO_COMPARISON_SCORE = 2
const MENTION_SCORE = 1

interface MentionPatterns {
  /**
   * Matches a title naming the competitor's alternatives ("n8n Alternatives", "LangChain and LangGraph
   * Alternatives"). A bare common-word name ("Make") counts only directly before "Alternatives".
   */
  alternatives: RegExp
  /** Matches Title Case titles and tags, where a bare common-word name ("Make") is ambiguous. */
  subject: RegExp
  /** Matches sentence-case descriptions, where the bare name is unambiguous. */
  mention: RegExp
}

function phraseAlternation(phrases: string[]): string {
  return `(?:${phrases.map(escapeRegExp).join('|')})`
}

/** Whole-word, case-sensitive match on any of `phrases`. */
function wordPattern(phrases: string[]): RegExp {
  return new RegExp(`\\b${phraseAlternation(phrases)}\\b`)
}

function buildMentionPatterns(competitor: CompetitorProfile): MentionPatterns {
  const aliases = competitor.mentions ?? [competitor.name]
  return {
    alternatives: new RegExp(
      `\\b(?:${phraseAlternation(aliases)}(?: and [^,:]+?)?|${escapeRegExp(competitor.name)}) Alternatives\\b`
    ),
    subject: wordPattern(aliases),
    mention: wordPattern([competitor.name, ...aliases]),
  }
}

const COMPETITOR_PATTERNS = ALL_COMPETITORS.map((competitor) => ({
  competitor,
  patterns: buildMentionPatterns(competitor),
}))

function scoreRelevance(
  post: ContentMeta,
  { alternatives, subject, mention }: MentionPatterns,
  linksToComparison: boolean
): number {
  if (alternatives.test(post.title)) return ALTERNATIVES_SCORE
  if (subject.test(post.title) || post.tags.some((tag) => subject.test(tag))) return SUBJECT_SCORE
  if (linksToComparison) return LINKS_TO_COMPARISON_SCORE
  return mention.test(post.description) ? MENTION_SCORE : 0
}

/** The highest-scoring items with a positive score, best first; ties keep input order. */
function topByScore<T>(items: T[], score: (item: T) => number): T[] {
  return items
    .map((item) => ({ item, score: score(item) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_LINKS)
    .map(({ item }) => item)
}

/**
 * Library articles about, linking to, or naming `competitor`, strongest match first, then
 * newest first.
 */
export async function getLibraryPostsForCompetitor(
  competitor: CompetitorProfile
): Promise<ContentMeta[]> {
  const patterns = buildMentionPatterns(competitor)
  const [posts, linkingPosts] = await Promise.all([
    getAllPostMeta(),
    getPostsLinkingTo(comparisonPath(competitor)),
  ])
  const linkingSlugs = new Set(linkingPosts.map((post) => post.slug))
  return topByScore(posts, (post) => scoreRelevance(post, patterns, linkingSlugs.has(post.slug)))
}

/**
 * Comparison pages for the competitors a library article is about, links to (`linkedPaths`,
 * from its body), or names, strongest match first, then in {@link ALL_COMPETITORS} order.
 */
export function getComparisonsForPost(
  post: ContentMeta,
  linkedPaths: ReadonlySet<string>
): CompetitorProfile[] {
  return topByScore(COMPETITOR_PATTERNS, ({ competitor, patterns }) =>
    scoreRelevance(post, patterns, linkedPaths.has(comparisonPath(competitor)))
  ).map(({ competitor }) => competitor)
}
