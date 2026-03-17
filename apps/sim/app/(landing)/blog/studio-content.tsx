'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Search } from 'lucide-react'
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
  author: { name: string; avatarUrl?: string }
  authors?: { name: string; avatarUrl?: string }[]
  featured?: boolean
}

interface StudioContentProps {
  posts: SerializedPost[]
  initialTag?: string | null
  initialQuery?: string
}

const PER_PAGE = 20

export function StudioContent({ posts, initialTag, initialQuery }: StudioContentProps) {
  const [activeTag, setActiveTag] = useState<string | null>(initialTag ?? null)
  const [query, setQuery] = useState(initialQuery ?? '')
  const [page, setPage] = useState(1)

  /** Sync URL via replaceState — no server round-trip. */
  const syncUrl = useCallback((tag: string | null, q: string) => {
    const params = new URLSearchParams()
    if (tag) params.set('tag', tag)
    if (q) params.set('q', q)
    const search = params.toString()
    window.history.replaceState(null, '', search ? `/blog?${search}` : '/blog')
  }, [])

  /** Handle browser back / forward. */
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search)
      setActiveTag(params.get('tag'))
      setQuery(params.get('q') ?? '')
      setPage(1)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // ── Category counts (static — computed once from full post set) ─────────
  const categoryItems = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const cat of CATEGORIES) counts[cat.id] = 0
    for (const post of posts) {
      const catId = getPrimaryCategory(post.tags).id
      counts[catId] = (counts[catId] ?? 0) + 1
    }
    return [
      { id: null as string | null, label: 'All Posts', count: posts.length, color: '#00F701' },
      ...CATEGORIES.map((cat) => ({
        id: cat.id as string | null,
        label: cat.label,
        count: counts[cat.id] ?? 0,
        color: cat.color,
      })),
    ]
  }, [posts])

  // ── Filter + sort (runs instantly on state change) ──────────────────────
  const lowerQ = query.trim().toLowerCase()

  const { sorted, activeCategory } = useMemo(() => {
    let filtered = posts

    if (activeTag) {
      filtered = posts.filter((p) => getPrimaryCategory(p.tags).id === activeTag)
    }

    if (lowerQ) {
      filtered = filtered.filter((p) => {
        const haystack = [
          p.title,
          p.description,
          ...p.tags,
          p.author.name,
          ...(p.authors?.map((a) => a.name) ?? []),
        ]
          .join(' ')
          .toLowerCase()
        return haystack.includes(lowerQ)
      })
    }

    const cat = activeTag ? getCategoryById(activeTag) : null
    const s = [...filtered].sort((a, b) => {
      if (a.featured && !b.featured) return -1
      if (!a.featured && b.featured) return 1
      return new Date(b.date).getTime() - new Date(a.date).getTime()
    })
    return { sorted: s, activeCategory: cat }
  }, [posts, activeTag, lowerQ])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PER_PAGE))
  const pagePosts = sorted.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  const isDefaultView = page === 1 && !activeTag && !lowerQ
  const featured: SerializedPost[] = []
  const feed: SerializedPost[] = []
  for (const p of pagePosts) {
    if (isDefaultView && p.featured) {
      featured.push(p)
    } else {
      feed.push(p)
    }
  }
  const showHero = isDefaultView

  const handleCategorySelect = useCallback(
    (id: string | null) => {
      setActiveTag(id)
      setQuery('')
      setPage(1)
      syncUrl(id, '')
    },
    [syncUrl]
  )

  const handleSearch = useCallback(
    (value: string) => {
      setQuery(value)
      setActiveTag(null)
      setPage(1)
      syncUrl(null, value.trim())
    },
    [syncUrl]
  )

  const handleClearAll = useCallback(() => {
    setActiveTag(null)
    setQuery('')
    setPage(1)
    syncUrl(null, '')
  }, [syncUrl])

  return (
    <div className='flex min-h-0 flex-1 flex-col lg:flex-row'>
      <aside className='flex w-full shrink-0 flex-col border-r border-[#2A2A2A] bg-[#1C1C1C] p-8 lg:sticky lg:top-[52px] lg:h-[calc(100vh-52px)] lg:w-72 lg:overflow-y-auto'>
        <div className='flex h-full flex-col'>
          <div className='mb-6'>
            <h2 className='mb-4 font-season text-[10px] uppercase tracking-widest text-[#666]'>
              Find Insights
            </h2>
            <SidebarSearch value={query} onChange={handleSearch} />
          </div>
          <div className='flex flex-col pt-6'>
            <h2 className='mb-3 font-season text-[10px] uppercase tracking-widest text-[#ECECEC]'>
              Categories
            </h2>
            <SidebarCategories
              items={categoryItems}
              activeId={activeTag}
              onSelect={handleCategorySelect}
            />
          </div>
        </div>
      </aside>

      <main className='relative min-w-0 flex-1'>
        <div className='flex flex-col'>
          {showHero && <StudioHero />}
          <div className='mx-auto w-full max-w-5xl py-12'>
            {lowerQ && (
              <div className='mb-8 flex items-center gap-3'>
                <span className='font-season text-[10px] uppercase tracking-widest text-[#666]'>
                  Results for:
                </span>
                <span
                  className='px-2 py-0.5 font-season text-[10px] uppercase tracking-wider text-[#ECECEC]'
                  style={{ border: '1px solid #3d3d3d' }}
                >
                  {query.trim()}
                </span>
                <button
                  type='button'
                  onClick={handleClearAll}
                  className='font-season text-[10px] uppercase tracking-wider text-[#999] transition-colors hover:text-[#ECECEC]'
                >
                  Clear
                </button>
              </div>
            )}

            {activeCategory && !lowerQ && (
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
                  onClick={handleClearAll}
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
                  {lowerQ ? 'Search Results' : activeCategory ? activeCategory.label : 'All Posts'}
                </h2>
                <PostGrid posts={feed} />
              </section>
            )}

            {pagePosts.length === 0 && (
              <div className='py-20 text-center'>
                <p className='text-[14px] text-[#666]'>
                  {lowerQ ? `No posts matching "${query.trim()}".` : 'No posts found.'}
                </p>
                <button
                  type='button'
                  onClick={handleClearAll}
                  className='mt-4 inline-block font-season text-[12px] uppercase tracking-wider text-[#999] transition-colors hover:text-[#ECECEC]'
                >
                  View all posts
                </button>
              </div>
            )}

            {totalPages > 1 && (
              <div className='mt-20 flex items-center justify-center gap-4 border-t border-[#2A2A2A] pt-12'>
                {page > 1 && (
                  <button
                    type='button'
                    onClick={() => setPage((p) => p - 1)}
                    className='border border-[#3d3d3d] bg-[#232323] px-6 py-2.5 font-season text-[11px] uppercase tracking-wider text-[#999] transition-colors hover:border-[#666] hover:text-[#ECECEC]'
                    style={{ borderRadius: '5px' }}
                  >
                    Previous
                  </button>
                )}
                <span className='font-season text-[10px] uppercase tracking-wider text-[#666]'>
                  Page {page} of {totalPages}
                </span>
                {page < totalPages && (
                  <button
                    type='button'
                    onClick={() => setPage((p) => p + 1)}
                    className='border border-[#3d3d3d] bg-[#232323] px-6 py-2.5 font-season text-[11px] uppercase tracking-wider text-[#999] transition-colors hover:border-[#666] hover:text-[#ECECEC]'
                    style={{ borderRadius: '5px' }}
                  >
                    Load more articles
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

interface SidebarSearchProps {
  value: string
  onChange: (value: string) => void
}

function SidebarSearch({ value, onChange }: SidebarSearchProps) {
  return (
    <form onSubmit={(e) => e.preventDefault()} className='relative'>
      <input
        type='text'
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder='SEARCH POSTS...'
        className='w-full border border-[#2A2A2A] bg-[#232323] px-4 py-2 pr-9 font-season text-[11px] text-[#ECECEC] placeholder:text-[#666] transition-colors focus:border-[#00F701] focus:outline-none'
        style={{ borderRadius: '5px' }}
        aria-label='Search blog posts'
      />
      <span className='absolute right-0 top-0 flex h-full items-center px-3 text-[#666]'>
        <Search className='h-3.5 w-3.5' aria-hidden='true' />
      </span>
    </form>
  )
}

interface SidebarCategoryItem {
  id: string | null
  label: string
  count: number
  color: string
}

interface SidebarCategoriesProps {
  items: SidebarCategoryItem[]
  activeId: string | null
  onSelect: (id: string | null) => void
}

function SidebarCategories({ items, activeId, onSelect }: SidebarCategoriesProps) {
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
    setHighlight({ top: elRect.top - listRect.top, height: elRect.height })
  }, [activeId])

  return (
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
            shouldReduceMotion ? { duration: 0 } : { type: 'spring', duration: 0.3, bounce: 0 }
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
  )
}
