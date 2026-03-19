import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { getAllPostMeta } from '@/lib/blog/registry'
import { AuthorWithSidebar } from '@/app/(landing)/blog/authors/[id]/author-with-sidebar'

export const revalidate = 3600

function findAuthorById(posts: Awaited<ReturnType<typeof getAllPostMeta>>, id: string) {
  for (const p of posts) {
    if (p.author.id === id) return p.author
    const coAuthor = p.authors?.find((a) => a.id === id)
    if (coAuthor) return coAuthor
  }
  return null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const allPosts = await getAllPostMeta()
  const author = findAuthorById(allPosts, id)
  return { title: author?.name ?? 'Author' }
}

export default async function AuthorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tag?: string; q?: string }>
}) {
  const { id } = await params
  const { tag, q } = await searchParams
  const allPosts = await getAllPostMeta()
  const posts = allPosts.filter((p) => p.author.id === id || p.authors?.some((a) => a.id === id))
  const author = findAuthorById(allPosts, id)

  if (!author) {
    return (
      <div className='mx-auto max-w-5xl px-8 py-16 lg:px-12'>
        <h1 className='font-[500] text-[#ECECEC] text-[32px]'>Author not found</h1>
        <Link
          href='/blog'
          className='mt-4 inline-block font-season text-[#999] text-[12px] uppercase tracking-wider transition-colors hover:text-[#ECECEC]'
        >
          Back to all posts
        </Link>
      </div>
    )
  }

  const personJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: author.name,
    url: `https://sim.ai/blog/authors/${author.id}`,
    sameAs: author.url ? [author.url] : [],
    image: author.avatarUrl,
  }

  return (
    <AuthorWithSidebar
      allPosts={allPosts}
      authorPosts={posts}
      activeTag={tag ?? null}
      initialQuery={q ?? ''}
    >
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd) }}
      />
      <div className='mb-12 flex items-center gap-4'>
        {author.avatarUrl && (
          <div
            className='h-16 w-16 shrink-0 overflow-hidden border border-[#2A2A2A] bg-[#232323]'
            style={{ borderRadius: '5px' }}
          >
            <Image
              src={author.avatarUrl}
              alt={author.name}
              width={64}
              height={64}
              className='h-full w-full object-cover'
              unoptimized
            />
          </div>
        )}
        <div>
          <div className='mb-1 font-season text-[#FA4EDF] text-[10px] uppercase tracking-widest'>
            Author
          </div>
          <h1 className='font-[500] text-[#ECECEC] text-[32px] leading-tight tracking-[-0.02em]'>
            {author.name}
          </h1>
          {author.url && (
            <Link
              href={author.url}
              target='_blank'
              rel='noopener noreferrer'
              className='font-season text-[#999] text-[11px] transition-colors hover:text-[#ECECEC]'
            >
              {author.xHandle ? `@${author.xHandle}` : 'Profile'}
            </Link>
          )}
        </div>
      </div>
      <h2 className='mb-8 flex items-center gap-2 font-season text-[#666] text-[11px] uppercase tracking-widest'>
        <span className='inline-block h-2 w-2 bg-[#00F701]' aria-hidden='true' />
        Posts by {author.name}
      </h2>
    </AuthorWithSidebar>
  )
}
