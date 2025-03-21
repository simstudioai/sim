import { Star } from 'lucide-react'
import { GithubIcon } from '@/components/icons'

async function getGitHubStars() {
  const response = await fetch('https://api.github.com/repos/simstudioai/sim', {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    next: { revalidate: 3600 }, // Revalidate every hour
  })

  if (!response.ok) {
    // Return 0 stars if API fails, we don't want to break the UI
    return 0
  }

  const data = await response.json()
  return data.stargazers_count
}

export default async function GitHubStars() {
  const stars = await getGitHubStars()

  return (
    <a
      href="https://github.com/simstudioai/sim"
      className="flex items-center gap-2 text-white/80 hover:text-white/100 p-2 rounded-md group hover:scale-[1.04] transition-colors transition-transform duration-200"
      aria-label="GitHub"
      target="_blank"
      rel="noopener noreferrer"
    >
      <GithubIcon className="w-[20px] h-[20px]" />
      <div className="flex items-center justify-center gap-1">
        <span className="text-sm font-medium py-[2px]">{stars}</span>
        <Star className="w-3.5 h-3.5 fill-white/80 stroke-none group-hover:fill-white" />
      </div>
    </a>
  )
}
