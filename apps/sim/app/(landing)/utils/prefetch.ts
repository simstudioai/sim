// Utility for prefetching and caching contributors page data
import { getCommitsData, getContributors, getRepositoryStats } from '../actions/github'
import { generateActivityData, generateCommitTimelineData } from './github'

interface Contributor {
  login: string
  avatar_url: string
  contributions: number
  html_url: string
}

interface RepoStats {
  stars: number
  forks: number
  watchers: number
  openIssues: number
  openPRs: number
}

interface CommitTimelineData {
  date: string
  commits: number
  additions: number
  deletions: number
}

interface ActivityData {
  date: string
  commits: number
  issues: number
  pullRequests: number
}

interface ContributorsPageData {
  contributors: Contributor[]
  repoStats: RepoStats
  timelineData: CommitTimelineData[]
  activityData: ActivityData[]
}

// Cache for the prefetched data
let cachedData: ContributorsPageData | null = null
let isPreFetching = false
let prefetchPromise: Promise<ContributorsPageData> | null = null

/**
 * Prefetch contributors page data
 */
export async function prefetchContributorsData(): Promise<ContributorsPageData> {
  // If data is already cached, return it
  if (cachedData) {
    return cachedData
  }

  // If already prefetching, return the existing promise
  if (isPreFetching && prefetchPromise) {
    return prefetchPromise
  }

  // Start prefetching
  isPreFetching = true
  prefetchPromise = fetchContributorsData()

  try {
    const data = await prefetchPromise
    cachedData = data
    return data
  } finally {
    isPreFetching = false
    prefetchPromise = null
  }
}

/**
 * Get cached contributors data if available
 */
export function getCachedContributorsData(): ContributorsPageData | null {
  return cachedData
}

/**
 * Clear the cached data (useful for refreshing)
 */
export function clearContributorsCache(): void {
  cachedData = null
}

/**
 * Internal function to fetch all contributors data
 */
async function fetchContributorsData(): Promise<ContributorsPageData> {
  const [contributors, stats, commits] = await Promise.all([
    getContributors(),
    getRepositoryStats(),
    getCommitsData(),
  ])

  return {
    contributors,
    repoStats: stats,
    timelineData: generateCommitTimelineData(commits),
    activityData: generateActivityData(commits),
  }
}
