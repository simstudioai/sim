import { createLoader, createSerializer, parseAsString, parseAsStringLiteral } from 'nuqs/server'

/**
 * The view state of each workspace list, shared by the list, which reads and writes it, and its
 * records' detail pages, whose Back link returns to the same filtered, sorted list.
 */

const ISSUE_STATUSES = ['all', 'review', 'progress', 'merged', 'closed'] as const
const ISSUE_SORTS = ['newest', 'oldest', 'title-asc', 'title-desc'] as const

export const issueListParams = {
  q: parseAsString.withDefault(''),
  status: parseAsStringLiteral(ISSUE_STATUSES).withDefault('all'),
  sort: parseAsStringLiteral(ISSUE_SORTS).withDefault('newest'),
}

export const CHANGELOG_PERIODS = ['all', '7d', '30d', '90d'] as const

export const changelogParams = {
  period: parseAsStringLiteral(CHANGELOG_PERIODS).withDefault('all'),
  contributor: parseAsString.withDefault('all'),
}

export const RUN_STATUSES = [
  'all',
  'completed',
  'failed',
  'waiting',
  'running',
  'cancelled',
] as const
export const RUN_SORTS = ['newest', 'oldest', 'duration', 'cu'] as const

export const runListParams = {
  q: parseAsString.withDefault(''),
  status: parseAsStringLiteral(RUN_STATUSES).withDefault('all'),
  trigger: parseAsString.withDefault('all'),
  workflow: parseAsString.withDefault('all'),
  sort: parseAsStringLiteral(RUN_SORTS).withDefault('newest'),
}

export const serializeIssueList = createSerializer(issueListParams)
export const serializeChangelog = createSerializer(changelogParams)
export const serializeRunList = createSerializer(runListParams)

const loadIssueList = createLoader(issueListParams)
const loadChangelog = createLoader(changelogParams)
const loadRunList = createLoader(runListParams)

type SearchRecord = Record<string, string | string[] | undefined>

/** `href` with the issue list's search, status and sort from `search`, dropping defaults. */
export function withIssueListView(href: string, search: SearchRecord) {
  return serializeIssueList(href, loadIssueList(search))
}

/** `href` with the changelog's period and contributor from `search`. */
export function withChangelogView(href: string, search: SearchRecord) {
  return serializeChangelog(href, loadChangelog(search))
}

/** `href` with the run list's search, filters and sort from `search`. */
export function withRunListView(href: string, search: SearchRecord) {
  return serializeRunList(href, loadRunList(search))
}
