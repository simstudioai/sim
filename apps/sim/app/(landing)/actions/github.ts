'use server'

/**
 * Format a number to a human-readable format (e.g., 1000 -> 1k, 1100 -> 1.1k)
 */
function formatNumber(num: number): string {
  if (num < 1000) {
    return num.toString()
  }

  // Convert to one decimal place and remove trailing 0
  const formatted = (Math.round(num / 100) / 10).toFixed(1)

  // Remove .0 if the decimal is 0
  return formatted.endsWith('.0') ? `${formatted.slice(0, -2)}k` : `${formatted}k`
}

/**
 * Server action to fetch GitHub stars
 */
export async function getFormattedGitHubStars(): Promise<string> {
  try {
    const token = process.env.GITHUB_TOKEN

    const response = await fetch('https://api.github.com/repos/simstudioai/sim', {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'SimStudio/1.0',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      next: { revalidate: 3600 }, // Revalidate every hour
    })

    if (!response.ok) {
      console.error(`GitHub API error: ${response.status} ${response.statusText}`)
      return formatNumber(1200)
    }

    const data = await response.json()
    return formatNumber(data.stargazers_count || 1200)
  } catch (error) {
    console.error('Error fetching GitHub stars:', error)
    return formatNumber(1200)
  }
}
