import { headers } from 'next/headers'
import Image from 'next/image'
import Link from 'next/link'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { getAllPostMeta } from '@/lib/blog/registry'
import { soehne } from '@/app/fonts/soehne/soehne'

export const revalidate = 3600

export default async function BlogIndex({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; tag?: string }>
}) {
  await headers()

  const { page, tag } = await searchParams
  const pageNum = Math.max(1, Number(page || 1))
  const perPage = 20

  const all = await getAllPostMeta()
  const filtered = tag ? all.filter((p) => p.tags.includes(tag)) : all
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage))
  const start = (pageNum - 1) * perPage
  const posts = filtered.slice(start, start + perPage)
  // Tag filter chips are intentionally disabled for now.
  // const tags = await getAllTags()
  const blogJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'Sim Blog',
    url: 'https://sim.ai/blog',
    description: 'Announcements, insights, and guides for building AI agent workflows.',
  }

  const [featured, ...rest] = posts

  return (
    <main className={`${soehne.className} mx-auto max-w-[1200px] px-6 py-12 sm:px-8 md:px-12`}>
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(blogJsonLd) }}
      />
      <h1 className='mb-3 font-medium text-[40px] leading-tight sm:text-[56px]'>The Sim Times</h1>
      <p className='mb-10 text-[18px] text-gray-700'>
        Announcements, insights, and guides for building AI agent workflows.
      </p>

      {/* Tag filter chips hidden until we have more posts */}
      {/* <div className='mb-10 flex flex-wrap gap-3'>
        <Link href='/blog' className={`rounded-full border px-3 py-1 text-sm ${!tag ? 'border-black bg-black text-white' : 'border-gray-300'}`}>All</Link>
        {tags.map((t) => (
          <Link key={t.tag} href={`/blog?tag=${encodeURIComponent(t.tag)}`} className={`rounded-full border px-3 py-1 text-sm ${tag === t.tag ? 'border-black bg-black text-white' : 'border-gray-300'}`}>
            {t.tag} ({t.count})
          </Link>
        ))}
      </div> */}

      {featured && (
        <Link href={`/blog/${featured.slug}`} className='group mb-10 block'>
          <div className='overflow-hidden rounded-2xl border border-gray-200'>
            <Image
              src={featured.ogImage}
              alt={featured.title}
              width={1200}
              height={630}
              className='h-[320px] w-full object-cover sm:h-[420px]'
            />
            <div className='p-6 sm:p-8'>
              <div className='mb-2 text-gray-600 text-xs sm:text-sm'>
                {new Date(featured.date).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </div>
              <h2 className='shine-text mb-2 font-medium text-2xl leading-tight sm:text-3xl'>
                {featured.title}
              </h2>
              <p className='mb-4 text-gray-700 sm:text-base'>{featured.description}</p>
              <div className='flex items-center gap-2'>
                <div className='-space-x-2 flex'>
                  {(featured.authors && featured.authors.length > 0
                    ? featured.authors
                    : [featured.author]
                  )
                    .slice(0, 3)
                    .map((author, idx) => (
                      <Avatar key={idx} className='size-5 border-2 border-white'>
                        <AvatarImage src={author?.avatarUrl} alt={author?.name} />
                        <AvatarFallback className='border-2 border-white bg-gray-100 text-gray-600 text-xs'>
                          {author?.name.slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                    ))}
                </div>
                <span className='text-gray-600 text-xs sm:text-sm'>
                  {(featured.authors && featured.authors.length > 0
                    ? featured.authors
                    : [featured.author]
                  )
                    .slice(0, 2)
                    .map((a, i) => a?.name)
                    .join(', ')}
                  {(featured.authors && featured.authors.length > 0
                    ? featured.authors
                    : [featured.author]
                  ).length > 2 && (
                    <>
                      {' '}
                      and{' '}
                      {(featured.authors && featured.authors.length > 0
                        ? featured.authors
                        : [featured.author]
                      ).length - 2}{' '}
                      other
                      {(featured.authors && featured.authors.length > 0
                        ? featured.authors
                        : [featured.author]
                      ).length -
                        2 >
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
      )}

      {/* Masonry-like list using CSS columns for varied heights */}
      <div className='gap-6 [column-fill:_balance] md:columns-2 lg:columns-3'>
        {rest.map((p, i) => {
          const size = i % 3 === 0 ? 'h-64' : i % 3 === 1 ? 'h-56' : 'h-48'
          return (
            <Link
              key={p.slug}
              href={`/blog/${p.slug}`}
              className='group mb-6 inline-block w-full break-inside-avoid'
            >
              <div className='overflow-hidden rounded-xl border border-gray-200 transition-colors duration-300 hover:border-gray-300'>
                <Image
                  src={p.ogImage}
                  alt={p.title}
                  width={800}
                  height={450}
                  className={`${size} w-full object-cover`}
                />
                <div className='p-4'>
                  <div className='mb-2 text-gray-600 text-xs'>
                    {new Date(p.date).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </div>
                  <h3 className='shine-text mb-1 font-medium text-lg leading-tight'>{p.title}</h3>
                  <p className='mb-3 line-clamp-3 text-gray-700 text-sm'>{p.description}</p>
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
              href={`/blog?page=${pageNum - 1}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`}
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
              href={`/blog?page=${pageNum + 1}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`}
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
