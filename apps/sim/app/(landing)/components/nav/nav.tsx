import Image from 'next/image'
import Link from 'next/link'
import { GithubIcon } from '@/components/icons'
import { env } from '@/lib/env'
import { soehne } from '@/app/fonts/soehne/soehne'

function formatStarCount(num: number): string {
  if (num < 1000) return String(num)
  const formatted = (Math.round(num / 100) / 10).toFixed(1)
  return formatted.endsWith('.0') ? `${formatted.slice(0, -2)}k` : `${formatted}k`
}

async function fetchGitHubStars(): Promise<string> {
  // Only fetch on server-side to avoid CSP issues
  if (typeof window !== 'undefined') {
    return formatStarCount(13000)
  }

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
      cache: 'force-cache',
    })

    if (!response.ok) {
      console.warn('GitHub API request failed:', response.status)
      return formatStarCount(13000)
    }

    const data = await response.json()
    return formatStarCount(Number(data?.stargazers_count ?? 13000))
  } catch (error) {
    console.warn('Error fetching GitHub stars:', error)
    return formatStarCount(13000)
  }
}

export default async function Nav() {
  const formattedStars = await fetchGitHubStars()
  return (
    <nav
      aria-label='Primary'
      className={`${soehne.className} flex w-full items-center justify-between px-[70px] pt-[20px] pb-[34px]`}
    >
      <div className='flex items-center gap-[50px]'>
        <Link href='/' aria-label='Sim home'>
          <Image
            src='/logo/b&w/text/b&w.svg'
            alt='Sim logo'
            width={58.5684}
            height={28.56}
            priority
          />
        </Link>
        <ul className='flex items-center justify-center gap-[24px] pt-[4px]'>
          <li>
            <Link
              href='https://docs.sim.ai'
              target='_blank'
              rel='noopener noreferrer'
              className='text-[18px] text-muted-foreground'
            >
              Docs
            </Link>
          </li>
          <li>
            <Link href='/' className='text-[18px] text-muted-foreground'>
              Pricing
            </Link>
          </li>
          <li>
            <Link href='/' className='text-[18px] text-muted-foreground'>
              Enterprise
            </Link>
          </li>
          <li>
            <a
              href='https://github.com/simstudioai/sim'
              target='_blank'
              rel='noopener noreferrer'
              className='flex items-center gap-2 text-[18px] text-muted-foreground'
              aria-label='GitHub repository'
            >
              <GithubIcon className='h-[18px] w-[18px]' />
              <span>{formattedStars}</span>
            </a>
          </li>
        </ul>
      </div>
      <div className='flex items-center justify-center gap-[24px]'>
        <Link href='/login' className='text-[#2E2E2E] text-[18px]'>
          Log in
        </Link>
        <Link
          href='/signup'
          className='inline-flex items-center justify-center gap-2 rounded-[10px] border border-[#6F3DFA] bg-gradient-to-b from-[#8357FF] to-[#6F3DFA] px-3 py-[6px] text-[18px] text-white shadow-[inset_0_2px_4px_0_#9B77FF]'
          aria-label='Get started'
        >
          Get started
        </Link>
      </div>
    </nav>
  )
}
