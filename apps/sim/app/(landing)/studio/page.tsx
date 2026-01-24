import Link from 'next/link'
import { getAllPostMeta } from '@/lib/blog/registry'
import { soehne } from '@/app/_styles/fonts/soehne/soehne'
import { PostGrid } from '@/app/(landing)/studio/post-grid'

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

  const sorted =
    pageNum === 1
      ? filtered.sort((a, b) => {
          if (a.featured && !b.featured) return -1
          if (!a.featured && b.featured) return 1
          return new Date(b.date).getTime() - new Date(a.date).getTime()
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
      <PostGrid posts={posts} />

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
