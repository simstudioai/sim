import { GithubIcon } from '@/components/icons'
import { env } from '@/lib/env'

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

async function getGitHubStars() {
  const token = env.GITHUB_TOKEN

  try {
    const response = await fetch('https://api.github.com/repos/simstudioai/sim', {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      next: { revalidate: 3600 }, // Revalidate every hour
    })

    if (!response.ok) {
      // Return current stars if API fails, we don't want to break the UI
      return 1200
    }

    const data = await response.json()
    return data.stargazers_count
  } catch (error) {
    console.error('Error fetching GitHub stars:', error)
    return 1200
  }
}

export default async function GitHubStars() {
  const stars = await getGitHubStars()
  const formattedStars = formatNumber(stars)

  return (
    <a
      href="https://github.com/simstudioai/sim"
      className="flex items-center gap-2 text-white/80 hover:text-white/100 p-1.5 rounded-md transition-colors duration-200"
      aria-label="GitHub"
      target="_blank"
      rel="noopener noreferrer"
    >
      <GithubIcon className="w-[20px] h-[20px]" />
      <span className="text-base font-medium">{formattedStars}</span>
    </a>
  )
}
