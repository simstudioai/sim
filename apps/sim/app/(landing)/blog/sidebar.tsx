import { getAllPostMeta } from '@/lib/blog/registry'
import { CategoryList } from '@/app/(landing)/blog/category-list'
import { SearchInput } from '@/app/(landing)/blog/search-input'
import { CATEGORIES, getPrimaryCategory } from '@/app/(landing)/blog/tag-colors'

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

  const items = [
    {
      id: null,
      label: 'All Posts',
      count: totalCount,
      href: '/studio',
      color: '#00F701',
    },
    ...CATEGORIES.map((cat) => ({
      id: cat.id,
      label: cat.label,
      count: categoryCounts[cat.id] ?? 0,
      href: `/studio?tag=${encodeURIComponent(cat.id)}`,
      color: cat.color,
    })),
  ]

  return (
    <aside className='flex w-full shrink-0 flex-col border-r border-[#2A2A2A] bg-[#1C1C1C] p-8 lg:sticky lg:top-[52px] lg:h-[calc(100vh-52px)] lg:w-72 lg:overflow-y-auto'>
      <div className='flex h-full flex-col'>
        <div className='mb-6'>
          <h2 className='mb-4 font-season text-[10px] uppercase tracking-widest text-[#666]'>
            Find Insights
          </h2>
          <SearchInput />
        </div>
        <div className='flex flex-col pt-6'>
          <h2 className='mb-3 font-season text-[10px] uppercase tracking-widest text-[#ECECEC]'>
            Categories
          </h2>
          <CategoryList items={items} activeId={activeTag ?? null} />
        </div>
      </div>
    </aside>
  )
}
