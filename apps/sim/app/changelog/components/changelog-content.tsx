import { BookOpen, Github, Rss } from 'lucide-react'
import Link from 'next/link'
import { inter } from '@/app/fonts/inter/inter'
import { soehne } from '@/app/fonts/soehne/soehne'
import ChangelogList from './timeline-list'

export interface ChangelogEntry {
  tag: string
  title: string
  content: string
  date: string
  url: string
  contributors?: string[]
}

function extractMentions(body: string): string[] {
  const matches = body.match(/@([A-Za-z0-9-]+)/g) ?? []
  const uniq = Array.from(new Set(matches.map((m) => m.slice(1))))
  return uniq
}

export default async function ChangelogContent() {
  let entries: ChangelogEntry[] = []

  try {
    const res = await fetch(
      'https://api.github.com/repos/simstudioai/sim/releases?per_page=10&page=1',
      {
        headers: { Accept: 'application/vnd.github+json' },
        next: { revalidate: 3600 },
      }
    )
    const releases: any[] = await res.json()
    entries = (releases || [])
      .filter((r) => !r.prerelease)
      .map((r) => ({
        tag: r.tag_name,
        title: r.name || r.tag_name,
        content: String(r.body || ''),
        date: r.published_at,
        url: r.html_url,
        contributors: extractMentions(String(r.body || '')),
      }))
  } catch (err) {
    entries = []
  }

  return (
    <div className='min-h-screen bg-background'>
      <div className='relative grid md:grid-cols-2'>
        {/* Left intro panel */}
        <div className='relative top-0 overflow-hidden border-border border-b px-6 py-16 sm:px-10 md:sticky md:h-dvh md:border-r md:border-b-0 md:px-12 md:py-24'>
          <div className='absolute inset-0 bg-grid-pattern opacity-[0.03] dark:opacity-[0.06]' />
          <div className='absolute inset-0 bg-gradient-to-tr from-background via-transparent to-background/60' />

          <div className='relative mx-auto h-full max-w-xl md:flex md:flex-col md:justify-center'>
            <h1
              className={`${soehne.className} mt-6 font-semibold text-4xl tracking-tight sm:text-5xl`}
            >
              Changelog
            </h1>
            <p className={`${inter.className} mt-4 text-muted-foreground text-sm`}>
              Stay up-to-date with the latest features, improvements, and bug fixes in Sim. All
              changes are documented here with detailed release notes.
            </p>
            <hr className='mt-6 border-border' />

            <div className='mt-6 flex flex-wrap items-center gap-3 text-sm'>
              <Link
                href='https://github.com/simstudioai/sim/releases'
                target='_blank'
                rel='noopener noreferrer'
                className='group inline-flex items-center justify-center gap-2 rounded-[10px] border border-[#6F3DFA] bg-gradient-to-b from-[#8357FF] to-[#6F3DFA] py-[6px] pr-[10px] pl-[12px] text-[14px] text-white shadow-[inset_0_2px_4px_0_#9B77FF] transition-all sm:text-[16px]'
              >
                <Github className='h-4 w-4' />
                View on GitHub
              </Link>
              <Link
                href='https://docs.sim.ai'
                className='inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 hover:bg-muted'
              >
                <BookOpen className='h-4 w-4' />
                Documentation
              </Link>
              <Link
                href='/changelog.xml'
                className='inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 hover:bg-muted'
              >
                <Rss className='h-4 w-4' />
                RSS Feed
              </Link>
            </div>
          </div>
        </div>

        {/* Right timeline */}
        <div className='relative px-4 py-10 sm:px-6 md:px-8 md:py-12'>
          <div className='relative max-w-2xl pl-8'>
            <ChangelogList initialEntries={entries} />
          </div>
        </div>
      </div>
    </div>
  )
}
