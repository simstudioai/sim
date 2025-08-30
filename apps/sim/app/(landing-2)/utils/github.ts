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

interface CommitData {
  sha: string
  commit: {
    author: {
      name: string
      email: string
      date: string
    }
    message: string
  }
  html_url: string
  stats?: {
    additions: number
    deletions: number
  }
}

/**
 * Generate commit timeline data for the last 30 days using real commit data
 */
export function generateCommitTimelineData(commitsData: CommitData[]): CommitTimelineData[] {
  return Array.from({ length: 30 }, (_, i) => {
    const date = new Date()
    date.setDate(date.getDate() - (29 - i))
    const dateStr = date.toISOString().split('T')[0]

    const dayCommits = commitsData.filter((commit) => commit.commit.author.date.startsWith(dateStr))

    const stats = dayCommits.reduce(
      (acc, commit) => {
        if (commit.stats) {
          acc.additions += commit.stats.additions || 0
          acc.deletions += commit.stats.deletions || 0
        }
        return acc
      },
      { additions: 0, deletions: 0 }
    )

    return {
      date: date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      }),
      commits: dayCommits.length,
      additions: stats.additions,
      deletions: stats.deletions,
    }
  })
}

/**
 * Generate activity data for the last 7 days using actual commit data
 */
export function generateActivityData(
  commitsData: CommitData[],
  repoStats?: RepoStats
): ActivityData[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date()
    const today = date.getDay()
    const daysToSubtract = today + (6 - i)
    date.setDate(date.getDate() - daysToSubtract)

    const dateStr = date.toISOString().split('T')[0]

    const dayCommits = commitsData.filter((commit) =>
      commit.commit.author.date.startsWith(dateStr)
    ).length

    return {
      date: date.toLocaleDateString('en-US', { weekday: 'short' }),
      commits: dayCommits,
      issues: repoStats ? Math.floor(repoStats.openIssues / 7) : 0,
      pullRequests: repoStats ? Math.floor(repoStats.openPRs / 7) : 0,
    }
  })
}
