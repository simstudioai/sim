import { env } from '@/lib/core/config/env'
import { ChangelogHero } from '@/app/changelog/components/changelog-hero'
import ChangelogList from '@/app/changelog/components/timeline-list'

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
    const token = env.GITHUB_TOKEN
    const res = await fetch(
      'https://api.github.com/repos/simstudioai/sim/releases?per_page=10&page=1',
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'Sim/1.0',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        next: { revalidate: 3600 },
      }
    )

    if (!res.ok) {
      entries = []
    } else {
      const releases = await res.json()
      if (Array.isArray(releases)) {
        entries = releases
          .filter((r) => !r.prerelease)
          .map((r) => ({
            tag: r.tag_name,
            title: r.name || r.tag_name,
            content: String(r.body || ''),
            date: r.published_at,
            url: r.html_url,
            contributors: extractMentions(String(r.body || '')),
          }))
      }
    }
  } catch (err) {
    entries = []
  }

  return (
    <div className='flex flex-col'>
      <ChangelogHero />
      <main className='mx-auto w-full max-w-5xl px-6 py-12'>
        <h2 className='mb-8 flex items-center gap-2 font-season text-[11px] uppercase tracking-widest text-[#666]'>
          <span className='inline-block h-2 w-2 bg-[#FFCC02]' aria-hidden='true' />
          All Releases
        </h2>
        <ChangelogList initialEntries={entries} />
      </main>
    </div>
  )
}
