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
  const allActive = !activeTag

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
        <div className='flex flex-col border-t border-[#2A2A2A] pt-8'>
          <h2 className='mb-3 font-mono text-[10px] uppercase tracking-widest text-[#ECECEC]'>
            Categories
          </h2>
          <ul className='flex flex-col'>
            <li>
              <Link
                href='/studio'
                className='mx-1 mb-0.5 flex items-center justify-between rounded-sm px-3 py-2 text-[13px] transition-all'
                style={
                  allActive
                    ? {
                        backgroundColor: 'rgba(0, 247, 1, 0.05)',
                        color: '#00F701',
                        border: '1px solid #00F701',
                      }
                    : {
                        color: '#999',
                        border: '1px solid transparent',
                      }
                }
              >
                <span>All Posts</span>
                <span
                  className='font-mono text-[10px]'
                  style={{
                    padding: '2px 6px',
                    borderRadius: '2px',
                    border: allActive ? '1px solid #00F701' : '1px solid #2A2A2A',
                    color: allActive ? '#00F701' : '#666',
                  }}
                >
                  {String(totalCount).padStart(2, '0')}
                </span>
              </Link>
            </li>
            {CATEGORIES.map((cat) => {
              const isActive = activeTag === cat.id
              const count = categoryCounts[cat.id] ?? 0

              return (
                <li key={cat.id}>
                  <Link
                    href={`/studio?tag=${encodeURIComponent(cat.id)}`}
                    className='group mx-1 mb-0.5 flex items-center justify-between rounded-sm px-3 py-2 text-[13px] transition-all hover:bg-[#181818] hover:text-[#ECECEC]'
                    style={
                      isActive
                        ? {
                            backgroundColor: `${cat.color}0D`,
                            color: cat.color,
                            border: `1px solid ${cat.color}`,
                          }
                        : {
                            color: '#999',
                            border: '1px solid transparent',
                          }
                    }
                  >
                    <span>{cat.label}</span>
                    <span
                      className='font-mono text-[10px]'
                      style={{
                        padding: '2px 6px',
                        borderRadius: '2px',
                        border: isActive ? `1px solid ${cat.color}` : '1px solid #2A2A2A',
                        color: isActive ? cat.color : '#666',
                      }}
                    >
                      {String(count).padStart(2, '0')}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </aside>
  )
}
