'use client'

import { useCallback, useMemo, useState } from 'react'
import { StudioHero } from '@/app/(landing)/blog/hero'
import { FeaturedGrid, PostGrid } from '@/app/(landing)/blog/post-grid'
import { CATEGORIES, getCategoryById, getPrimaryCategory } from '@/app/(landing)/blog/tag-colors'

interface SerializedPost {
  slug: string
  title: string
  description: string
  date: string
  ogImage: string
  readingTime?: number
  tags: string[]
  author: { id: string; name: string; avatarUrl?: string; url?: string }
  authors?: { id: string; name: string; avatarUrl?: string; url?: string }[]
  featured?: boolean
}

interface StudioFeedProps {
  posts: SerializedPost[]
  initialTag?: string | null
}

export function StudioFeed({ posts, initialTag }: StudioFeedProps) {
  const [activeTag, setActiveTag] = useState<string | null>(initialTag ?? null)

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const cat of CATEGORIES) counts[cat.id] = 0
    for (const post of posts) {
      const cat = getPrimaryCategory(post.tags)
      counts[cat.id] = (counts[cat.id] ?? 0) + 1
    }
    return counts
  }, [posts])

  const filtered = useMemo(() => {
    if (!activeTag) return posts
    return posts.filter((p) => getPrimaryCategory(p.tags).id === activeTag)
  }, [posts, activeTag])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (a.featured && !b.featured) return -1
      if (!a.featured && b.featured) return 1
      return new Date(b.date).getTime() - new Date(a.date).getTime()
    })
  }, [filtered])

  const featured = !activeTag ? sorted.filter((p) => p.featured) : []
  const feed = !activeTag ? sorted.filter((p) => !p.featured) : sorted
  const activeCategory = activeTag ? getCategoryById(activeTag) : null

  const handleCategoryClick = useCallback((catId: string | null) => {
    setActiveTag(catId)
    const url = catId ? `/studio?tag=${encodeURIComponent(catId)}` : '/studio'
    window.history.replaceState(null, '', url)
  }, [])

  const sidebarItems = useMemo(
    () => [
      { id: null, label: 'All Posts', count: posts.length, color: '#00F701' },
      ...CATEGORIES.map((cat) => ({
        id: cat.id as string | null,
        label: cat.label,
        count: categoryCounts[cat.id] ?? 0,
        color: cat.color,
      })),
    ],
    [posts.length, categoryCounts]
  )

  return (
    <div className='flex flex-1 flex-col lg:flex-row'>
      <Sidebar items={sidebarItems} activeId={activeTag} onSelect={handleCategoryClick} />
      <main className='relative flex-1'>
        <div className='flex flex-col'>
          {!activeTag && <StudioHero />}
          <div className='mx-auto w-full max-w-5xl py-12'>
            {activeCategory && (
              <div className='mb-8 flex items-center gap-3'>
                <span className='font-season text-[10px] uppercase tracking-widest text-[#666]'>
                  Filtered by:
                </span>
                <span
                  className='px-2 py-0.5 font-season text-[10px] uppercase tracking-wider'
                  style={{
                    border: `1px solid ${activeCategory.color}`,
                    color: activeCategory.color,
                  }}
                >
                  {activeCategory.label}
                </span>
                <button
                  type='button'
                  onClick={() => handleCategoryClick(null)}
                  className='font-season text-[10px] uppercase tracking-wider text-[#999] transition-colors hover:text-[#ECECEC]'
                >
                  Clear
                </button>
              </div>
            )}
            {featured.length > 0 && (
              <section className='mb-10'>
                <h2 className='mb-8 flex items-center gap-2 font-season text-[11px] uppercase tracking-widest text-[#666]'>
                  <span className='inline-block h-2 w-2 bg-[#FA4EDF]' aria-hidden='true' />
                  Featured Content
                </h2>
                <FeaturedGrid posts={featured} />
              </section>
            )}
            {feed.length > 0 && (
              <section>
                <h2 className='mb-8 flex items-center gap-2 font-season text-[11px] uppercase tracking-widest text-[#666]'>
                  <span className='inline-block h-2 w-2 bg-[#00F701]' aria-hidden='true' />
                  {activeCategory ? activeCategory.label : 'All Posts'}
                </h2>
                <PostGrid posts={feed} />
              </section>
            )}
            {sorted.length === 0 && (
              <div className='py-20 text-center'>
                <p className='text-[14px] text-[#666]'>No posts found.</p>
                <button
                  type='button'
                  onClick={() => handleCategoryClick(null)}
                  className='mt-4 inline-block font-season text-[12px] uppercase tracking-wider text-[#999] transition-colors hover:text-[#ECECEC]'
                >
                  View all posts
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

import { useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Search } from 'lucide-react'

interface SidebarItem {
  id: string | null
  label: string
  count: number
  color: string
}

interface SidebarProps {
  items: SidebarItem[]
  activeId: string | null
  onSelect: (id: string | null) => void
}

function Sidebar({ items, activeId, onSelect }: SidebarProps) {
  const shouldReduceMotion = useReducedMotion()
  const listRef = useRef<HTMLUListElement>(null)
  const itemRefs = useRef<Map<string, HTMLLIElement>>(new Map())
  const [highlight, setHighlight] = useState<{ top: number; height: number } | null>(null)

  const activeItem = items.find((item) => item.id === activeId) ?? items[0]

  useEffect(() => {
    const key = activeId ?? 'all'
    const el = itemRefs.current.get(key)
    const list = listRef.current
    if (!el || !list) {
      setHighlight(null)
      return
    }
    const listRect = list.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    setHighlight({
      top: elRect.top - listRect.top,
      height: elRect.height,
    })
  }, [activeId])

  return (
    <aside className='flex w-full shrink-0 flex-col border-r border-[#2A2A2A] bg-[#1C1C1C] p-8 lg:sticky lg:top-[52px] lg:h-[calc(100vh-52px)] lg:w-72 lg:overflow-y-auto'>
      <div className='flex h-full flex-col'>
        <div className='mb-10'>
          <h2 className='mb-4 font-season text-[10px] uppercase tracking-widest text-[#666]'>
            Find Insights
          </h2>
          <div className='relative'>
            <input
              type='text'
              placeholder='SEARCH COMING SOON...'
              disabled
              className='w-full cursor-not-allowed border border-[#2A2A2A] bg-[#232323] px-4 py-2 font-season text-[11px] text-[#ECECEC] opacity-50 placeholder:text-[#666]'
              style={{ borderRadius: '5px' }}
              aria-label='Search blog posts (coming soon)'
            />
            <Search
              className='absolute right-3 top-2.5 h-3.5 w-3.5 text-[#666]'
              aria-hidden='true'
            />
          </div>
        </div>
        <div className='flex flex-col'>
          <h2 className='mb-3 font-season text-[10px] uppercase tracking-widest text-[#ECECEC]'>
            Categories
          </h2>
          <ul ref={listRef} className='relative flex flex-col'>
            {activeItem && highlight && (
              <motion.div
                className='absolute left-0 right-0 rounded-sm'
                style={{
                  backgroundColor: `${activeItem.color}0D`,
                  border: `1px solid ${activeItem.color}`,
                  height: highlight.height,
                }}
                animate={{ y: highlight.top }}
                transition={
                  shouldReduceMotion
                    ? { duration: 0 }
                    : { type: 'spring', duration: 0.3, bounce: 0 }
                }
              />
            )}
            {items.map((item) => {
              const isActive = item.id === activeId
              const key = item.id ?? 'all'

              return (
                <li
                  key={key}
                  ref={(el) => {
                    if (el) itemRefs.current.set(key, el)
                  }}
                >
                  <button
                    type='button'
                    onClick={() => onSelect(item.id)}
                    className={`relative flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-[13px] transition-colors duration-150 ease ${
                      isActive
                        ? ''
                        : '[@media(hover:hover)]:hover:bg-[#232323] [@media(hover:hover)]:hover:text-[#ECECEC]'
                    }`}
                    style={{ color: isActive ? item.color : '#999' }}
                  >
                    <span className='relative z-10'>{item.label}</span>
                    <span
                      className='relative z-10 font-season text-[10px]'
                      style={{
                        padding: '2px 6px',
                        borderRadius: '2px',
                        border: isActive ? `1px solid ${item.color}` : '1px solid #2A2A2A',
                        color: isActive ? item.color : '#666',
                      }}
                    >
                      {String(item.count).padStart(2, '0')}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </aside>
  )
}
