import { escapeRegExp } from '@sim/utils/string'
import type { CompetitorProfile } from '@/lib/compare/data'
import type { ContentMeta } from '@/lib/content/schema'
import { getAllPostMeta } from '@/lib/library/registry'
import { ALL_COMPETITORS } from '@/app/(landing)/comparisons/utils'

/** Most links either side renders, so the section stays a short "read next" list. */
const MAX_LINKS = 3

/** A competitor named in an article's title or tags is its subject; one named only in the description is a mention. */
const SUBJECT_SCORE = 2
const MENTION_SCORE = 1

interface MentionPatterns {
  /** Matches Title Case titles and tags, where a bare common-word name ("Make") is ambiguous. */
  subject: RegExp
  /** Matches sentence-case descriptions, where the bare name is unambiguous. */
  mention: RegExp
}

/** Whole-word, case-sensitive match on any of `phrases`. */
function wordPattern(phrases: string[]): RegExp {
  return new RegExp(`\\b(?:${phrases.map(escapeRegExp).join('|')})\\b`)
}

function buildMentionPatterns(competitor: CompetitorProfile): MentionPatterns {
  const aliases = competitor.mentions ?? [competitor.name]
  return {
    subject: wordPattern(aliases),
    mention: wordPattern([competitor.name, ...aliases]),
  }
}

const COMPETITOR_PATTERNS = ALL_COMPETITORS.map((competitor) => ({
  competitor,
  patterns: buildMentionPatterns(competitor),
}))

function scoreRelevance(post: ContentMeta, { subject, mention }: MentionPatterns): number {
  if (subject.test(post.title) || post.tags.some((tag) => subject.test(tag))) return SUBJECT_SCORE
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
 * Library articles about or naming `competitor`, articles where it is the
 * subject first, then newest first.
 */
export async function getLibraryPostsForCompetitor(
  competitor: CompetitorProfile
): Promise<ContentMeta[]> {
  const patterns = buildMentionPatterns(competitor)
  return topByScore(await getAllPostMeta(), (post) => scoreRelevance(post, patterns))
}

/**
 * Comparison pages for the competitors a library article is about or names,
 * subjects first, then in {@link ALL_COMPETITORS} order.
 */
export function getComparisonsForPost(post: ContentMeta): CompetitorProfile[] {
  return topByScore(COMPETITOR_PATTERNS, ({ patterns }) => scoreRelevance(post, patterns)).map(
    ({ competitor }) => competitor
  )
}
