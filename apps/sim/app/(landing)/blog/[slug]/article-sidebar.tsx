import Image from 'next/image'
import Link from 'next/link'
import type { Author, BlogMeta } from '@/lib/blog/schema'
import { TableOfContents } from '@/app/(landing)/studio/[slug]/table-of-contents'
import { getTagColor } from '@/app/(landing)/studio/tag-colors'

interface ArticleSidebarProps {
  author: Author
  authors: Author[]
  headings: { text: string; id: string }[]
  related: BlogMeta[]
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function ArticleSidebar({ author, authors, headings, related }: ArticleSidebarProps) {
  const displayAuthors = authors.length > 0 ? authors : [author]

  return (
    <aside className='w-full shrink-0 space-y-6 xl:sticky xl:top-[76px] xl:w-72'>
      {displayAuthors.map((a) => (
        <div
          key={a.id}
          className='flex items-start gap-4 border border-[#2A2A2A] bg-[#232323] p-5'
          style={{ borderRadius: '5px' }}
        >
          <div
            className='flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden border border-[#2A2A2A] bg-[#1C1C1C] font-mono text-lg text-[#2ABBF8]'
            style={{ borderRadius: '5px' }}
          >
            {a.avatarUrl ? (
              <Image
                src={a.avatarUrl}
                alt={a.name}
                width={48}
                height={48}
                className='h-full w-full object-cover'
                unoptimized
              />
            ) : (
              a.name.slice(0, 2).toUpperCase()
            )}
          </div>
          <div>
            <div className='mb-1 font-mono text-[10px] uppercase tracking-widest text-[#FA4EDF]'>
              Author
            </div>
            <h3 className='font-[500] text-[#ECECEC]'>{a.name}</h3>
            {a.url && (
              <Link
                href={a.url}
                target='_blank'
                rel='noopener noreferrer'
                className='font-mono text-[11px] text-[#999] transition-colors hover:text-[#ECECEC]'
              >
                {a.xHandle ? `@${a.xHandle}` : 'Profile'}
              </Link>
            )}
          </div>
        </div>
      ))}
      {headings.length > 0 && (
        <div className='border border-[#2A2A2A] bg-[#232323] p-5' style={{ borderRadius: '5px' }}>
          <TableOfContents headings={headings} />
        </div>
      )}

      {related.length > 0 && (
        <div className='border border-[#2A2A2A] bg-[#232323] p-5' style={{ borderRadius: '5px' }}>
          <div className='mb-4 flex items-center gap-2 border-b border-[#2A2A2A] pb-3 font-mono text-[11px] uppercase tracking-widest text-[#ECECEC]'>
            <span className='inline-block h-1.5 w-1.5 bg-[#FFCC02]' aria-hidden='true' />
            Recent Logs
          </div>
          <div className='space-y-4'>
            {related.map((p) => {
              const color = getTagColor(p.tags[0]) || '#999'
              return (
                <Link key={p.slug} href={`/studio/${p.slug}`} className='group block'>
                  <div
                    className='mb-1 font-mono text-[9px] uppercase tracking-widest'
                    style={{ color }}
                  >
                    {p.tags[0] || 'Post'}
                  </div>
                  <h4 className='mb-1 text-[13px] font-[500] leading-tight text-[#ECECEC] transition-colors group-hover:text-[#FFCC02]'>
                    {p.title}
                  </h4>
                  <div className='font-mono text-[10px] text-[#666]'>{formatDate(p.date)}</div>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </aside>
  )
}
