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
      return formatStarCount(13000)
    }

    const data = await response.json()
    return formatStarCount(Number(data?.stargazers_count ?? 13000))
  } catch {
    return formatStarCount(13000)
  }
}

export default async function Nav() {
  const formattedStars = await fetchGitHubStars()
  return (
    <nav
      aria-label='Primary'
      className={`${soehne.className} flex w-full items-center justify-between px-[70px] pt-[24px] pb-[34px]`}
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
            <a
              href='https://github.com/simstudioai/sim'
              target='_blank'
              rel='noopener noreferrer'
              className='flex items-center gap-2 font-normal text-[18px] text-muted-foreground'
              aria-label='GitHub repository'
            >
              <GithubIcon className='h-[18px] w-[18px]' />
              <span>{formattedStars}</span>
            </a>
          </li>
          <li>
            <Link href='/' className='font-normal text-[18px] text-muted-foreground'>
              Docs
            </Link>
          </li>
          <li>
            <Link href='/' className='font-normal text-[18px] text-muted-foreground'>
              Pricing
            </Link>
          </li>
          <li>
            <Link href='/' className='font-normal text-[18px] text-muted-foreground'>
              Enterprise
            </Link>
          </li>
        </ul>
      </div>
    </nav>
  )
}
