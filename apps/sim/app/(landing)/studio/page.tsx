import Image from 'next/image'
import Link from 'next/link'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { getAllPostMeta } from '@/lib/blog/registry'
import { soehne } from '@/app/fonts/soehne/soehne'

export const revalidate = 3600

export default async function StudioIndex({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; tag?: string }>
}) {
  const { page, tag } = await searchParams
  const pageNum = Math.max(1, Number(page || 1))
  const perPage = 20

  const all = await getAllPostMeta()
  const filtered = tag ? all.filter((p) => p.tags.includes(tag)) : all

  // Sort to ensure featured post is first on page 1
  const sorted =
    pageNum === 1
      ? filtered.sort((a, b) => {
          if (a.featured && !b.featured) return -1
          if (!a.featured && b.featured) return 1
          return 0
        })
      : filtered

  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage))
  const start = (pageNum - 1) * perPage
  const posts = sorted.slice(start, start + perPage)
  // Tag filter chips are intentionally disabled for now.
  // const tags = await getAllTags()
  const studioJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'Sim Studio',
    url: 'https://sim.ai/studio',
    description: 'Announcements, insights, and guides for building AI agent workflows.',
  }

  return (
    <main className={`${soehne.className} mx-auto max-w-[1200px] px-6 py-12 sm:px-8 md:px-12`}>
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(studioJsonLd) }}
      />
      <h1 className='mb-3 font-medium text-[40px] leading-tight sm:text-[56px]'>Sim Studio</h1>
      <p className='mb-10 text-[18px] text-gray-700'>
        Announcements, insights, and guides for building AI agent workflows.
      </p>

      {/* Tag filter chips hidden until we have more posts */}
      {/* <div className='mb-10 flex flex-wrap gap-3'>
        <Link href='/studio' className={`rounded-full border px-3 py-1 text-sm ${!tag ? 'border-black bg-black text-white' : 'border-gray-300'}`}>All</Link>
        {tags.map((t) => (
          <Link key={t.tag} href={`/studio?tag=${encodeURIComponent(t.tag)}`} className={`rounded-full border px-3 py-1 text-sm ${tag === t.tag ? 'border-black bg-black text-white' : 'border-gray-300'}`}>
            {t.tag} ({t.count})
          </Link>
        ))}
      </div> */}

      {/* Grid layout for consistent rows */}
      <div className='grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3'>
        {posts.map((p, i) => {
          return (
            <Link key={p.slug} href={`/studio/${p.slug}`} className='group flex flex-col'>
              <div className='flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 transition-colors duration-300 hover:border-gray-300'>
                <Image
                  src={p.ogImage}
                  alt={p.title}
                  width={800}
                  height={450}
                  className='h-48 w-full object-cover'
                />
                <div className='flex flex-1 flex-col p-4'>
                  <div className='mb-2 text-gray-600 text-xs'>
                    {new Date(p.date).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </div>
                  <h3 className='shine-text mb-1 font-medium text-lg leading-tight'>{p.title}</h3>
                  <p className='mb-3 line-clamp-3 flex-1 text-gray-700 text-sm'>{p.description}</p>
                  <div className='flex items-center gap-2'>
                    <div className='-space-x-1.5 flex'>
                      {(p.authors && p.authors.length > 0 ? p.authors : [p.author])
                        .slice(0, 3)
                        .map((author, idx) => (
                          <Avatar key={idx} className='size-4 border border-white'>
                            <AvatarImage src={author?.avatarUrl} alt={author?.name} />
                            <AvatarFallback className='border border-white bg-gray-100 text-[10px] text-gray-600'>
                              {author?.name.slice(0, 2)}
                            </AvatarFallback>
                          </Avatar>
                        ))}
                    </div>
                    <span className='text-gray-600 text-xs'>
                      {(p.authors && p.authors.length > 0 ? p.authors : [p.author])
                        .slice(0, 2)
                        .map((a) => a?.name)
                        .join(', ')}
                      {(p.authors && p.authors.length > 0 ? p.authors : [p.author]).length > 2 && (
                        <>
                          {' '}
                          and{' '}
                          {(p.authors && p.authors.length > 0 ? p.authors : [p.author]).length - 2}{' '}
                          other
                          {(p.authors && p.authors.length > 0 ? p.authors : [p.author]).length - 2 >
                          1
                            ? 's'
                            : ''}
                        </>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      {totalPages > 1 && (
        <div className='mt-10 flex items-center justify-center gap-3'>
          {pageNum > 1 && (
            <Link
              href={`/studio?page=${pageNum - 1}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`}
              className='rounded border px-3 py-1 text-sm'
            >
              Previous
            </Link>
          )}
          <span className='text-gray-600 text-sm'>
            Page {pageNum} of {totalPages}
          </span>
          {pageNum < totalPages && (
            <Link
              href={`/studio?page=${pageNum + 1}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`}
              className='rounded border px-3 py-1 text-sm'
            >
              Next
            </Link>
          )}
        </div>
      )}
    </main>
  )
}
