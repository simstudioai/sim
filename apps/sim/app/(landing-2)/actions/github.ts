'use server'

import { env } from '@/lib/env'

/**
 * Format a number to a human-readable format (e.g., 1000 -> 1k, 1100 -> 1.1k)
 */
function formatNumber(num: number): string {
  if (num < 1000) {
    return num.toString()
  }

  const formatted = (Math.round(num / 100) / 10).toFixed(1)

  return formatted.endsWith('.0') ? `${formatted.slice(0, -2)}k` : `${formatted}k`
}

/**
 * Server action to fetch GitHub stars
 */
export async function getFormattedGitHubStars(): Promise<string> {
  try {
    const token = env.GITHUB_TOKEN

    const response = await fetch('https://api.github.com/repos/simstudioai/sim', {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'SimStudio/1.0',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      next: { revalidate: 3600 },
    })

    if (!response.ok) {
      console.error(`GitHub API error: ${response.status} ${response.statusText}`)
      return formatNumber(3867)
    }

    const data = await response.json()
    return formatNumber(data.stargazers_count || 3867)
  } catch (error) {
    console.error('Error fetching GitHub stars:', error)
    return formatNumber(3867)
  }
}

interface Contributor {
  login: string
  avatar_url: string
  contributions: number
  html_url: string
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
}

interface RepoStats {
  stars: number
  forks: number
  watchers: number
  openIssues: number
  openPRs: number
}

/**
 * Server action to fetch repository statistics
 */
export async function getRepositoryStats(): Promise<RepoStats> {
  try {
    const token = env.GITHUB_TOKEN

    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'SimStudio/1.0',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }

    const repoResponse = await fetch('https://api.github.com/repos/simstudioai/sim', {
      headers,
      next: { revalidate: 3600 },
    })

    const prsResponse = await fetch(
      'https://api.github.com/repos/simstudioai/sim/pulls?state=open',
      {
        headers,
        next: { revalidate: 3600 },
      }
    )

    if (!repoResponse.ok || !prsResponse.ok) {
      console.error('GitHub API error fetching repo stats')
      return {
        stars: 3867,
        forks: 581,
        watchers: 26,
        openIssues: 23,
        openPRs: 3,
      }
    }

    const repoData = await repoResponse.json()
    const prsData = await prsResponse.json()

    return {
      stars: repoData.stargazers_count || 3867,
      forks: repoData.forks_count || 581,
      watchers: repoData.subscribers_count || 26,
      openIssues: (repoData.open_issues_count || 26) - prsData.length,
      openPRs: prsData.length || 3,
    }
  } catch (error) {
    console.error('Error fetching repository stats:', error)
    return {
      stars: 3867,
      forks: 581,
      watchers: 26,
      openIssues: 23,
      openPRs: 3,
    }
  }
}

/**
 * Server action to fetch contributors
 */
export async function getContributors(): Promise<Contributor[]> {
  try {
    const token = env.GITHUB_TOKEN

    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'SimStudio/1.0',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }

    const response = await fetch(
      'https://api.github.com/repos/simstudioai/sim/contributors?per_page=100',
      {
        headers,
        next: { revalidate: 3600 },
      }
    )

    if (!response.ok) {
      console.error('GitHub API error fetching contributors')
      return []
    }

    const contributors = await response.json()
    return contributors || []
  } catch (error) {
    console.error('Error fetching contributors:', error)
    return []
  }
}

/**
 * Server action to fetch recent commits for timeline data
 */
export async function getCommitsData(): Promise<CommitData[]> {
  try {
    const token = env.GITHUB_TOKEN

    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'SimStudio/1.0',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }

    const response = await fetch(
      'https://api.github.com/repos/simstudioai/sim/commits?per_page=100',
      {
        headers,
        next: { revalidate: 3600 },
      }
    )

    if (!response.ok) {
      console.error('GitHub API error fetching commits')
      return []
    }

    const commits = await response.json()
    return commits || []
  } catch (error) {
    console.error('Error fetching commits:', error)
    return []
  }
}
