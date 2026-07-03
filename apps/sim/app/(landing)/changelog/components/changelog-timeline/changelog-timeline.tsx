'use client'

import { type ReactNode, useRef, useState } from 'react'
import { Streamdown } from 'streamdown'
import 'streamdown/styles.css'
import { Avatar, AvatarFallback, AvatarImage, Chip, cn } from '@sim/emcn'
import type { ChangelogEntry, GitHubRelease } from '@/app/(landing)/changelog/types'
import { mapReleases, releasesEndpoint } from '@/app/(landing)/changelog/utils'

/**
 * The changelog timeline - the single client leaf of the changelog page. Renders
 * each GitHub release as a `<section>` (an `<h2>` version tag + contributor
 * avatars + cleaned markdown via {@link Streamdown}) and paginates further pages
 * from the GitHub Releases API on demand. Re-authored from the prior dark
 * timeline onto the platform light tokens; the fetch, markdown cleaning, and
 * load-more behavior are preserved.
 */

interface ChangelogTimelineProps {
  initialEntries: ChangelogEntry[]
}

function stripContributors(body: string): string {
  let output = body
  output = output.replace(
    /(^|\n)#{1,6}\s*Contributors\s*\n[\s\S]*?(?=\n\s*\n|\n#{1,6}\s|$)/gi,
    '\n'
  )
  output = output.replace(
    /(^|\n)\s*(?:\*\*|__)?\s*Contributors\s*(?:\*\*|__)?\s*:?\s*\n[\s\S]*?(?=\n\s*\n|\n#{1,6}\s|$)/gi,
    '\n'
  )
  output = output.replace(
    /(^|\n)[-*+]\s*(?:@[A-Za-z0-9-]+(?:\s*,\s*|\s+))+@[A-Za-z0-9-]+\s*(?=\n)/g,
    '\n'
  )
  output = output.replace(
    /(^|\n)\s*(?:@[A-Za-z0-9-]+(?:\s*,\s*|\s+))+@[A-Za-z0-9-]+\s*(?=\n)/g,
    '\n'
  )
  return output
}

function stripPrReferences(body: string): string {
  return body.replace(/\s*\(\s*\[#\d+\]\([^)]*\)\s*\)/g, '').replace(/\s*\(\s*#\d+\s*\)/g, '')
}

function cleanMarkdown(body: string): string {
  return stripPrReferences(stripContributors(body))
}

function isContributorsLabel(children: ReactNode): boolean {
  return /^\s*contributors\s*:?\s*$/i.test(String(children))
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function ChangelogTimeline({ initialEntries }: ChangelogTimelineProps) {
  const [entries, setEntries] = useState<ChangelogEntry[]>(initialEntries)
  const [loading, setLoading] = useState<boolean>(false)
  const [done, setDone] = useState<boolean>(false)
  const pageRef = useRef(1)

  const loadMore = async () => {
    if (loading || done) return
    setLoading(true)
    try {
      const nextPage = pageRef.current + 1
      // boundary-raw-fetch: external GitHub Releases API (cross-origin), not a same-origin contract
      const res = await fetch(releasesEndpoint(nextPage), {
        headers: { Accept: 'application/vnd.github+json' },
      })
      const releases = (await res.json()) as GitHubRelease[]
      const mapped = mapReleases(releases ?? [])

      if (mapped.length === 0) {
        setDone(true)
      } else {
        setEntries((prev) => [...prev, ...mapped])
        pageRef.current = nextPage
      }
    } catch {
      setDone(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className='flex flex-col gap-7'>
      {entries.map((entry) => {
        const headingId = `release-${entry.tag}-heading`
        return (
          <section key={entry.tag} aria-labelledby={headingId} className='flex flex-col'>
            <div className='flex items-center justify-between gap-4'>
              <div className='flex items-center gap-2'>
                <h2 id={headingId} className='text-[18px] text-[var(--text-primary)] leading-[1.3]'>
                  {entry.tag}
                </h2>
                {entry.contributors.length > 0 ? (
                  <div className='flex'>
                    {entry.contributors.slice(0, 5).map((contributor, index) => (
                      <a
                        key={contributor}
                        href={`https://github.com/${contributor}`}
                        target='_blank'
                        rel='noopener noreferrer'
                        aria-label={`View @${contributor} on GitHub`}
                        title={`@${contributor}`}
                        className={index === 0 ? 'block' : '-ms-2 block'}
                      >
                        <Avatar className='size-6 ring-2 ring-[var(--bg)]'>
                          <AvatarImage
                            src={`https://avatars.githubusercontent.com/${contributor}`}
                            alt={`@${contributor}`}
                            className='hover:z-10'
                          />
                          <AvatarFallback>{contributor.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                      </a>
                    ))}
                    {entry.contributors.length > 5 ? (
                      <div className='-ms-2 relative flex size-6 items-center justify-center rounded-full bg-[var(--surface-2)] text-[10px] text-[var(--text-body)] ring-2 ring-[var(--bg)] hover:z-10'>
                        +{entry.contributors.length - 5}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <span className='text-[12px] text-[var(--text-muted)]'>{formatDate(entry.date)}</span>
            </div>

            <div aria-hidden='true' className='mt-[9px] mb-3 h-px bg-[var(--border)]' />

            <div className='max-w-none'>
              <Streamdown
                mode='static'
                components={{
                  h2: ({ children, ...props }) =>
                    isContributorsLabel(children) ? null : (
                      <h3
                        className='mt-5 mb-2 text-[14px] text-[var(--text-primary)] leading-[1.4]'
                        {...props}
                      >
                        {children}
                      </h3>
                    ),
                  h3: ({ children, ...props }) =>
                    isContributorsLabel(children) ? null : (
                      <h4
                        className='mt-4 mb-1 text-[14px] text-[var(--text-primary)] leading-[1.4]'
                        {...props}
                      >
                        {children}
                      </h4>
                    ),
                  ul: ({ children, ...props }) => (
                    <ul className='mt-2 mb-3 space-y-1.5' {...props}>
                      {children}
                    </ul>
                  ),
                  li: ({ children, ...props }) =>
                    isContributorsLabel(children) ? null : (
                      <li
                        className='text-[13px] text-[var(--text-body)] leading-relaxed'
                        {...props}
                      >
                        {children}
                      </li>
                    ),
                  p: ({ children, ...props }) =>
                    isContributorsLabel(children) ? null : (
                      <p
                        className='mb-3 text-[13px] text-[var(--text-body)] leading-relaxed'
                        {...props}
                      >
                        {children}
                      </p>
                    ),
                  strong: ({ children, ...props }) => (
                    <strong className='text-[var(--text-primary)]' {...props}>
                      {children}
                    </strong>
                  ),
                  inlineCode: ({ children }) => (
                    <code className='whitespace-normal rounded bg-[var(--surface-2)] px-1 py-0.5 font-mono text-[var(--text-primary)] not-italic'>
                      {children}
                    </code>
                  ),
                  img: () => null,
                  a: ({ children, className, ...props }) => (
                    <a
                      {...props}
                      className={cn('text-[var(--text-primary)] underline', className)}
                      target='_blank'
                      rel='noopener noreferrer'
                    >
                      {children}
                    </a>
                  ),
                }}
              >
                {cleanMarkdown(entry.content)}
              </Streamdown>
            </div>
          </section>
        )
      })}

      {!done ? (
        <div>
          <Chip type='button' flush onClick={loadMore} disabled={loading}>
            {loading ? 'Loading…' : 'Show more'}
          </Chip>
        </div>
      ) : null}
    </div>
  )
}
