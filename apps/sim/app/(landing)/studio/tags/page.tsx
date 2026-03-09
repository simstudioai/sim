import Link from 'next/link'
import { getAllTags } from '@/lib/blog/registry'

export default async function TagsIndex() {
  const tags = await getAllTags()
  return (
    <main className='mx-auto max-w-[900px] px-6 py-10 sm:px-8 md:px-12'>
      <h1 className='mb-6 font-medium text-[32px] leading-tight'>Browse by tag</h1>
      <div className='flex flex-wrap gap-3'>
        <Link href='/studio' className='rounded-full border border-gray-300 px-3 py-1 text-sm'>
          All
        </Link>
        {tags.map((t) => (
          <Link
            key={t.tag}
            href={`/studio?tag=${encodeURIComponent(t.tag)}`}
            className='rounded-full border border-gray-300 px-3 py-1 text-sm'
          >
            {t.tag} ({t.count})
          </Link>
        ))}
      </div>
    </main>
  )
}
