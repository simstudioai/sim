'use client'

import React from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowUpRight } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/emcn'
import { formatDate } from '@/lib/core/utils/formatting'
import type { ChangelogEntry } from '@/app/changelog/components/changelog-content'

type Props = { initialEntries: ChangelogEntry[] }

const EASE_OUT_QUINT = [0.23, 1, 0.32, 1] as const
const CARD_DURATION = 0.35
const CARD_Y = 16

function sanitizeContent(body: string): string {
  return body.replace(/&nbsp/g, '')
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

function stripViewOnGitHub(body: string): string {
  return body.replace(/\n*\[View changes on GitHub\]\([^)]*\)\s*$/gi, '')
}

function stripCommitPrefix(text: string): string {
  const cleaned = text.replace(
    /^(feat|fix|improvement|chore|refactor|docs|test|ci|perf|style|build|revert)\([^)]*\)\s*:\s*/i,
    ''
  )
  if (cleaned.length === 0) return text
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

function isContributorsLabel(nodeChildren: React.ReactNode): boolean {
  return /^\s*contributors\s*:?\s*$/i.test(String(nodeChildren))
}

function cleanMarkdown(body: string): string {
  const sanitized = sanitizeContent(body)
  const withoutContribs = stripContributors(sanitized)
  const withoutPrs = stripPrReferences(withoutContribs)
  const withoutGhLink = stripViewOnGitHub(withoutPrs)
  return withoutGhLink
}

function extractMentions(body: string): string[] {
  const matches = body.match(/@([A-Za-z0-9-]+)/g) ?? []
  return Array.from(new Set(matches.map((m) => m.slice(1))))
}

function ReleaseCard({ entry, index }: { entry: ChangelogEntry; index: number }) {
  const shouldReduceMotion = useReducedMotion()

  return (
    <motion.article
      initial={shouldReduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: CARD_Y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{
        duration: CARD_DURATION,
        ease: EASE_OUT_QUINT,
        delay: index < 10 ? index * 0.06 : 0,
      }}
      className='overflow-hidden border border-[#2A2A2A] bg-[#232323] transition-[border-color,background-color] duration-200 ease-out [@media(hover:hover)]:hover:border-[#3d3d3d] [@media(hover:hover)]:hover:bg-[#282828]'
    >
      <div className='p-6 sm:p-8'>
        <div className='mb-5 flex items-center justify-between'>
          <div className='flex items-center gap-3'>
            <a
              href={entry.url}
              target='_blank'
              rel='noopener noreferrer'
              className='inline-block border border-[#3d3d3d] bg-[#2A2A2A] px-2 py-0.5 font-bold font-season text-[#ECECEC] text-[10px] uppercase tracking-wider transition-colors hover:border-[#666]'
            >
              {entry.tag}
            </a>
            <span className='h-1 w-1 bg-[#3d3d3d]' aria-hidden='true' />
            <time className='font-season text-[#666] text-[10px] uppercase tracking-wider'>
              {formatDate(new Date(entry.date))}
            </time>
          </div>
          <a
            href={entry.url}
            target='_blank'
            rel='noopener noreferrer'
            className='flex items-center gap-1 font-season text-[#666] text-[10px] uppercase tracking-wider transition-colors hover:text-[#ECECEC]'
            aria-label={`View ${entry.tag} on GitHub`}
          >
            GitHub
            <ArrowUpRight className='h-3 w-3' />
          </a>
        </div>
        {entry.title !== entry.tag && (
          <h3 className='mb-4 font-[500] text-[#ECECEC] text-[20px] leading-tight tracking-[-0.01em]'>
            {entry.title}
          </h3>
        )}
        <div className='max-w-none'>
          <ReactMarkdown
            components={{
              h2: ({ children, ...props }) => {
                if (isContributorsLabel(children)) return null
                return (
                  <h4
                    className='mt-6 mb-3 flex items-center gap-2 font-season text-[#999] text-[11px] uppercase tracking-widest first:mt-0'
                    {...props}
                  >
                    <span
                      className='inline-block h-[6px] w-[6px] flex-shrink-0 bg-[#666]'
                      aria-hidden='true'
                    />
                    {children}
                  </h4>
                )
              },
              h3: ({ children, ...props }) => {
                if (isContributorsLabel(children)) return null
                return (
                  <h5
                    className='mt-5 mb-2 flex items-center gap-2 font-season text-[#999] text-[11px] uppercase tracking-widest first:mt-0'
                    {...props}
                  >
                    <span
                      className='inline-block h-[6px] w-[6px] flex-shrink-0 bg-[#666]'
                      aria-hidden='true'
                    />
                    {children}
                  </h5>
                )
              },
              ul: ({ children, ...props }) => (
                <ul className='mb-4 space-y-2' {...props}>
                  {children}
                </ul>
              ),
              li: ({ children, ...props }) => {
                const text = String(children)
                if (/^\s*contributors\s*:?\s*$/i.test(text)) return null
                return (
                  <li className='flex items-start gap-2.5 text-[14px] leading-relaxed' {...props}>
                    <span
                      className='mt-[8px] inline-block h-[5px] w-[5px] flex-shrink-0 rounded-full bg-[#666]'
                      aria-hidden='true'
                    />
                    <span className='text-[#CCCCCC]'>
                      <CleanedListContent>{children}</CleanedListContent>
                    </span>
                  </li>
                )
              },
              p: ({ children, ...props }) =>
                /^\s*contributors\s*:?\s*$/i.test(String(children)) ? null : (
                  <p className='mb-3 text-[#999] text-[14px] leading-relaxed' {...props}>
                    {children}
                  </p>
                ),
              strong: ({ children, ...props }) => (
                <strong className='font-[500] text-[#ECECEC]' {...props}>
                  {children}
                </strong>
              ),
              code: ({ children, ...props }) => (
                <code
                  className='rounded-[2px] border border-[#2A2A2A] bg-[#1C1C1C] px-1 py-0.5 font-mono text-[#CCCCCC] text-[12px]'
                  {...props}
                >
                  {children}
                </code>
              ),
              img: () => null,
              a: ({ className, ...props }: any) => (
                <a
                  {...props}
                  className={`text-[#ECECEC] underline decoration-[#3d3d3d] underline-offset-2 transition-colors hover:decoration-[#ECECEC] ${className ?? ''}`}
                  target='_blank'
                  rel='noreferrer'
                />
              ),
            }}
          >
            {cleanMarkdown(entry.content)}
          </ReactMarkdown>
        </div>
      </div>
      {entry.contributors && entry.contributors.length > 0 && (
        <div className='flex items-center gap-3 border-[#2A2A2A] border-t px-6 py-4 sm:px-8'>
          <div className='-space-x-1.5 flex'>
            {entry.contributors.slice(0, 8).map((contributor) => (
              <a
                key={contributor}
                href={`https://github.com/${contributor}`}
                target='_blank'
                rel='noreferrer noopener'
                aria-label={`View @${contributor} on GitHub`}
                title={`@${contributor}`}
                className='block transition-transform [@media(hover:hover)]:hover:z-10 [@media(hover:hover)]:hover:scale-110'
              >
                <Avatar className='size-5 border border-[#232323]'>
                  <AvatarImage
                    src={`https://avatars.githubusercontent.com/${contributor}`}
                    alt={`@${contributor}`}
                  />
                  <AvatarFallback className='bg-[#2A2A2A] font-season text-[#999] text-[8px]'>
                    {contributor.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </a>
            ))}
            {entry.contributors.length > 8 && (
              <div className='relative flex size-5 items-center justify-center rounded-full border border-[#232323] bg-[#2A2A2A] font-season text-[#999] text-[8px]'>
                +{entry.contributors.length - 8}
              </div>
            )}
          </div>
          <span className='font-season text-[#999] text-[10px] uppercase tracking-wider'>
            {entry.contributors
              .slice(0, 3)
              .map((c) => c)
              .join(', ')}
            {entry.contributors.length > 3 && ` +${entry.contributors.length - 3}`}
          </span>
        </div>
      )}
    </motion.article>
  )
}

function CleanedListContent({ children }: { children: React.ReactNode }) {
  let cleaned = false
  const result = React.Children.map(children, (child) => {
    if (!cleaned && typeof child === 'string') {
      cleaned = true
      return stripCommitPrefix(child)
    }
    return child
  })
  return <>{result}</>
}

export default function ChangelogList({ initialEntries }: Props) {
  const [entries, setEntries] = React.useState<ChangelogEntry[]>(initialEntries)
  const [page, setPage] = React.useState<number>(1)
  const [loading, setLoading] = React.useState<boolean>(false)
  const [done, setDone] = React.useState<boolean>(false)

  const loadMore = async () => {
    if (loading || done) return
    setLoading(true)
    try {
      const nextPage = page + 1
      const res = await fetch(`/api/changelog/releases?page=${nextPage}`)

      if (!res.ok) {
        setDone(true)
        return
      }

      const data = await res.json()
      const releases = data?.releases

      if (!Array.isArray(releases) || releases.length === 0) {
        setDone(true)
        return
      }

      const mapped: ChangelogEntry[] = releases.map((r: any) => ({
        tag: r.tag,
        title: r.title,
        content: r.content,
        date: r.date,
        url: r.url,
        contributors: extractMentions(String(r.content || '')),
      }))

      setEntries((prev) => [...prev, ...mapped])
      setPage(nextPage)
    } catch {
      setDone(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className='space-y-6'>
        {entries.map((entry, index) => (
          <ReleaseCard key={entry.tag} entry={entry} index={index} />
        ))}
      </div>

      {!done && (
        <div className='mt-12 flex items-center justify-center border-[#2A2A2A] border-t pt-12'>
          <button
            type='button'
            onClick={loadMore}
            disabled={loading}
            className='rounded-[5px] border border-[#3d3d3d] bg-[#232323] px-6 py-2.5 font-season text-[#999] text-[11px] uppercase tracking-wider transition-colors hover:border-[#666] hover:text-[#ECECEC] disabled:opacity-60'
          >
            {loading ? 'Loading...' : 'Load more releases'}
          </button>
        </div>
      )}
    </div>
  )
}
