import { BookOpen, ExternalLink, Github, Rss } from 'lucide-react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { inter } from '@/app/fonts/inter'
import { soehne } from '@/app/fonts/soehne/soehne'

interface ChangelogEntry {
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

function enhanceContent(body: string): string {
  const lines = body.split('\n')
  const newLines = lines.map((line) => {
    if (line.trim().startsWith('- ')) {
      const mentionMatches = line.match(/@([A-Za-z0-9-]+)/g) ?? []
      if (mentionMatches.length === 0) return line.replace(/&nbsp/g, '')
      const mentions = mentionMatches.map((match) => {
        const username = match.slice(1)
        const avatarUrl = `https://github.com/${username}.png`
        return `[![${match}](${avatarUrl})](https://github.com/${username})`
      })
      return `${line.replace(/&nbsp/g, '')} – ${mentions.join(' ')}`
    }
    return line
  })
  return newLines.join('\n')
}

export default async function ChangelogContent() {
  let entries: ChangelogEntry[] = []

  try {
    const res = await fetch('https://api.github.com/repos/simstudioai/sim/releases', {
      headers: { Accept: 'application/vnd.github+json' },
      // Cache for 1 hour
      next: { revalidate: 3600 },
    })
    const releases: any[] = await res.json()
    entries = (releases || [])
      .filter((r) => !r.prerelease)
      .map((r) => ({
        tag: r.tag_name,
        title: r.name || r.tag_name,
        content: enhanceContent(String(r.body || '')),
        date: r.published_at,
        url: r.html_url,
        contributors: extractMentions(String(r.body || '')),
      }))
  } catch (err) {
    // Fail silently; show empty state
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
                href='/docs'
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
          <div className='-translate-x-full absolute top-0 left-0 hidden h-full w-px bg-gradient-to-b from-foreground/10 via-transparent to-transparent md:block' />
          <div className='max-w-2xl'>
            <div className='space-y-12'>
              {entries.map((entry) => (
                <Card key={entry.tag} className='border border-border bg-card shadow-sm'>
                  <CardHeader className='pb-6'>
                    <div className='mb-4 flex items-center justify-between'>
                      <Badge
                        variant='secondary'
                        className='border-brand-primary/20 bg-brand-primary/10 px-2.5 py-1 font-mono text-brand-primary text-xs'
                      >
                        {entry.tag}
                      </Badge>
                      <div
                        className={`${inter.className} flex items-center gap-2 text-muted-foreground text-sm`}
                      >
                        {new Date(entry.date).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                        <a
                          href={entry.url}
                          target='_blank'
                          rel='noopener noreferrer'
                          className='inline-flex items-center gap-1 text-muted-foreground hover:text-brand-primary'
                        >
                          <ExternalLink className='h-4 w-4' />
                        </a>
                      </div>
                    </div>
                    <h2 className={`${soehne.className} font-semibold text-2xl tracking-tight`}>
                      {entry.title}
                    </h2>

                    {entry.contributors && entry.contributors.length > 0 && (
                      <div className='mt-4 flex items-center gap-3'>
                        <span className={`${inter.className} text-muted-foreground text-sm`}>
                          Contributors:
                        </span>
                        <div className='-space-x-2 flex items-center'>
                          {entry.contributors.slice(0, 5).map((contributor) => (
                            <Avatar
                              key={contributor}
                              className='h-6 w-6 border-2 border-background'
                            >
                              <AvatarImage
                                src={`https://github.com/${contributor}.png`}
                                alt={`@${contributor}`}
                              />
                              <AvatarFallback className='bg-muted text-xs'>
                                {contributor.charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                          ))}
                          {entry.contributors.length > 5 && (
                            <div className='flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-muted'>
                              <span className='font-medium text-muted-foreground text-xs'>
                                +{entry.contributors.length - 5}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </CardHeader>
                  <CardContent className='pt-0'>
                    <div
                      className={`${inter.className} prose prose-sm dark:prose-invert max-w-none prose-code:rounded prose-pre:border prose-pre:border-border prose-code:bg-muted prose-pre:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-headings:font-semibold prose-a:text-brand-primary prose-code:text-foreground prose-headings:text-foreground prose-p:text-muted-foreground prose-a:no-underline hover:prose-a:underline`}
                    >
                      <ReactMarkdown
                        components={{
                          h2: ({ children, ...props }) => (
                            <h3
                              className='mt-6 mb-3 font-semibold text-lg tracking-tight first:mt-0'
                              {...props}
                            >
                              {children}
                            </h3>
                          ),
                          h3: ({ children, ...props }) => (
                            <h4
                              className='mt-5 mb-2 font-medium text-base tracking-tight'
                              {...props}
                            >
                              {children}
                            </h4>
                          ),
                          ul: ({ children, ...props }) => (
                            <ul className='mt-2 mb-4 space-y-1' {...props}>
                              {children}
                            </ul>
                          ),
                          li: ({ children, ...props }) => (
                            <li className='text-muted-foreground leading-relaxed' {...props}>
                              {children}
                            </li>
                          ),
                          p: ({ children, ...props }) => (
                            <p className='mb-4 text-muted-foreground leading-relaxed' {...props}>
                              {children}
                            </p>
                          ),
                          strong: ({ children, ...props }) => (
                            <strong className='font-medium text-foreground' {...props}>
                              {children}
                            </strong>
                          ),
                          code: ({ children, ...props }) => (
                            <code
                              className='rounded bg-muted px-1.5 py-0.5 font-mono text-foreground text-sm'
                              {...props}
                            >
                              {children}
                            </code>
                          ),
                          img: ({ ...props }) => (
                            <img
                              className='inline-block h-6 w-6 rounded-full border opacity-70'
                              {...(props as any)}
                            />
                          ),
                          a: ({ className, ...props }: any) => (
                            <a
                              {...props}
                              className={`underline ${className ?? ''}`}
                              target='_blank'
                              rel='noreferrer'
                            />
                          ),
                        }}
                      >
                        {entry.content}
                      </ReactMarkdown>
                    </div>
                  </CardContent>
                </Card>
              ))}

              {entries.length === 0 && (
                <div className='text-muted-foreground text-sm'>
                  No releases found yet. Check back soon.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
