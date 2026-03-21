import { Search } from 'lucide-react'
import Link from 'next/link'
import { getAllPostMeta } from '@/lib/blog/registry'
import { CATEGORIES, getPrimaryCategory } from '@/app/(landing)/studio/tag-colors'

interface StudioSidebarProps {
  activeTag?: string | null
}

export async function StudioSidebar({ activeTag }: StudioSidebarProps) {
  const allPosts = await getAllPostMeta()

  const categoryCounts: Record<string, number> = {}
  for (const cat of CATEGORIES) {
    categoryCounts[cat.id] = 0
  }
  for (const post of allPosts) {
    const cat = getPrimaryCategory(post.tags)
    categoryCounts[cat.id] = (categoryCounts[cat.id] ?? 0) + 1
  }

  const totalCount = allPosts.length

  return (
    <aside className='flex w-full shrink-0 flex-col border-r border-[#2A2A2A] bg-[#1C1C1C] p-8 lg:sticky lg:top-[52px] lg:h-[calc(100vh-52px)] lg:w-72 lg:overflow-y-auto'>
      <div className='flex h-full flex-col'>
        <div className='mb-10'>
          <h2 className='mb-4 font-mono text-[10px] uppercase tracking-widest text-[#666]'>
            Find Insight
          </h2>
          <div className='relative'>
            <input
              type='text'
              placeholder='SEARCH POSTS...'
              className='w-full border border-[#2A2A2A] bg-[#232323] px-4 py-2 font-mono text-[11px] text-[#ECECEC] placeholder:text-[#666] transition-colors focus:border-[#00F701] focus:outline-none'
              style={{ borderRadius: '5px' }}
              aria-label='Search blog posts'
            />
            <Search
              className='absolute right-3 top-2.5 h-3.5 w-3.5 text-[#666]'
              aria-hidden='true'
            />
          </div>
        </div>
        <div className='flex flex-col gap-1'>
          <h2 className='mb-4 font-mono text-[10px] uppercase tracking-widest text-[#666]'>
            Categories
          </h2>
          <Link
            href='/studio'
            className={`group flex items-center justify-between py-2 font-mono text-[11px] uppercase tracking-wider transition-colors ${
              !activeTag ? 'text-[#00F701]' : 'text-[#999] hover:text-[#ECECEC]'
            }`}
          >
            <span>All Posts</span>
            <span
              className={`${!activeTag ? 'text-[#00F701]' : 'text-[#666] group-hover:text-[#999]'}`}
            >
              {totalCount}
            </span>
          </Link>
          {CATEGORIES.map((cat) => {
            const isActive = activeTag === cat.id
            const count = categoryCounts[cat.id] ?? 0

            return (
              <Link
                key={cat.id}
                href={`/studio?tag=${encodeURIComponent(cat.id)}`}
                className={`group flex items-center justify-between py-2 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                  isActive ? '' : 'text-[#999] hover:text-[#ECECEC]'
                }`}
                style={isActive ? { color: cat.color } : undefined}
              >
                <span className='flex items-center gap-2'>
                  <span
                    className='inline-block h-1.5 w-1.5 shrink-0'
                    style={{ backgroundColor: cat.color }}
                    aria-hidden='true'
                  />
                  {cat.label}
                </span>
                <span
                  className={`${isActive ? '' : 'text-[#666] group-hover:text-[#999]'}`}
                  style={isActive ? { color: cat.color } : undefined}
                >
                  {count}
                </span>
              </Link>
            )
          })}
        </div>
      </div>
    </aside>
  )
}
