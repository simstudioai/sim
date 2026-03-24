import type { Metadata } from 'next'
import Link from 'next/link'
import { getAllTags } from '@/lib/blog/registry'

export const metadata: Metadata = {
  title: 'Tags',
}

export default async function TagsIndex() {
  const tags = await getAllTags()
  return (
    <main className='mx-auto max-w-[900px] px-6 py-10 sm:px-8 md:px-12'>
      <h1 className='mb-6 font-[500] text-[#ECECEC] text-[32px] leading-tight'>Browse by tag</h1>
      <div className='flex flex-wrap gap-3'>
        <Link
          href='/blog'
          className='rounded-full border border-[#3d3d3d] px-3 py-1 text-[#ECECEC] text-sm transition-colors hover:bg-[#2A2A2A]'
        >
          All
        </Link>
        {tags.map((t) => (
          <Link
            key={t.tag}
            href={`/blog?tag=${encodeURIComponent(t.tag)}`}
            className='rounded-full border border-[#3d3d3d] px-3 py-1 text-[#ECECEC] text-sm transition-colors hover:bg-[#2A2A2A]'
          >
            {t.tag} ({t.count})
          </Link>
        ))}
      </div>
    </main>
  )
}
