import type { Metadata } from 'next'
import Link from 'next/link'
import { getAllPostMeta } from '@/lib/blog/registry'
import { CATEGORIES, getPrimaryCategory } from '@/app/(landing)/blog/tag-colors'

export const metadata: Metadata = {
  title: 'Tags',
}

export const revalidate = 3600

export default async function TagsIndex() {
  const allPosts = await getAllPostMeta()

  const categoryCounts: Record<string, number> = {}
  for (const cat of CATEGORIES) {
    categoryCounts[cat.id] = 0
  }
  for (const post of allPosts) {
    const cat = getPrimaryCategory(post.tags)
    categoryCounts[cat.id] = (categoryCounts[cat.id] ?? 0) + 1
  }

  return (
    <div className='mx-auto max-w-5xl px-8 py-16 lg:px-12'>
      <div className='mb-8 flex items-center gap-2 font-season text-[11px] uppercase tracking-widest text-[#666]'>
        <span className='inline-block h-2 w-2 bg-[#FA4EDF]' aria-hidden='true' />
        Browse by Category
      </div>

      <h1 className='mb-4 font-[500] text-[40px] leading-tight tracking-[-0.02em] text-[#ECECEC]'>
        Topics
      </h1>
      <p className='mb-10 text-[18px] tracking-[0.02em] text-[#999]'>
        Filter posts by category to find what interests you.
      </p>
      <div className='flex flex-wrap gap-3'>
        <Link
          href='/studio'
          className='border border-[#3d3d3d] bg-[#232323] px-4 py-2 font-season text-[11px] uppercase tracking-wider text-[#ECECEC] transition-colors hover:border-[#ECECEC]'
          style={{ borderRadius: '5px' }}
          prefetch
        >
          All Posts ({allPosts.length})
        </Link>
        {CATEGORIES.map((cat) => {
          const count = categoryCounts[cat.id] ?? 0
          return (
            <Link
              key={cat.id}
              href={`/studio?tag=${encodeURIComponent(cat.id)}`}
              className='flex items-center gap-2 px-4 py-2 font-season text-[11px] uppercase tracking-wider transition-colors hover:opacity-80'
              style={{
                borderRadius: '5px',
                border: `1px solid ${cat.color}`,
                color: cat.color,
                backgroundColor: `${cat.color}08`,
              }}
              prefetch
            >
              <span
                className='inline-block h-2 w-2'
                style={{ backgroundColor: cat.color }}
                aria-hidden='true'
              />
              {cat.label}
              <span className='opacity-60'>({count})</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
