import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { getAllPostMeta } from '@/lib/blog/registry'
import { PostGrid } from '@/app/(landing)/blog/post-grid'
import { WithSidebar } from '@/app/(landing)/blog/with-sidebar'

export const revalidate = 3600

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const posts = (await getAllPostMeta()).filter(
    (p) => p.author.id === id || p.authors?.some((a) => a.id === id)
  )
  const author = posts[0]?.author
  return { title: author?.name ?? 'Author' }
}

export default async function AuthorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const allPosts = await getAllPostMeta()
  const posts = allPosts.filter((p) => p.author.id === id || p.authors?.some((a) => a.id === id))
  const author = posts[0]?.author

  if (!author) {
    return (
      <div className='mx-auto max-w-5xl px-8 py-16 lg:px-12'>
        <h1 className='font-[500] text-[32px] text-[#ECECEC]'>Author not found</h1>
        <Link
          href='/studio'
          className='mt-4 inline-block font-mono text-[12px] uppercase tracking-wider text-[#999] transition-colors hover:text-[#ECECEC]'
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
    <WithSidebar>
      <div className='mx-auto max-w-5xl px-8 py-16 lg:px-12'>
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
            <div className='mb-1 font-mono text-[10px] uppercase tracking-widest text-[#FA4EDF]'>
              Author
            </div>
            <h1 className='font-[500] text-[32px] leading-tight tracking-[-0.02em] text-[#ECECEC]'>
              {author.name}
            </h1>
            {author.url && (
              <Link
                href={author.url}
                target='_blank'
                rel='noopener noreferrer'
                className='font-mono text-[11px] text-[#999] transition-colors hover:text-[#ECECEC]'
              >
                {author.xHandle ? `@${author.xHandle}` : 'Profile'}
              </Link>
            )}
          </div>
        </div>
        <h2 className='mb-8 flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-[#666]'>
          <span className='inline-block h-2 w-2 bg-[#00F701]' aria-hidden='true' />
          Posts by {author.name}
        </h2>

        <PostGrid posts={posts} />
      </div>
    </WithSidebar>
  )
}
