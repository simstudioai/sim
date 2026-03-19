'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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

  const syncUrl = useCallback((tag: string | null, q: string) => {
    const params = new URLSearchParams()
    if (tag) params.set('tag', tag)
    if (q) params.set('q', q)
    const search = params.toString()
    window.history.replaceState(null, '', search ? `/blog?${search}` : '/blog')
  }, [])

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

  const lowerQ = query.trim().toLowerCase()

  const { sorted, activeCategory } = useMemo(() => {
    const validTag = activeTag && CATEGORIES.some((c) => c.id === activeTag) ? activeTag : null

    let filtered = posts

    if (validTag) {
      filtered = posts.filter((p) => getPrimaryCategory(p.tags).id === validTag)
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

    const cat = validTag ? getCategoryById(validTag) : null
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
    <div className='flex min-h-0 flex-1 flex-col overflow-x-clip px-4 sm:px-6 lg:px-12'>

      <main className='relative min-w-0 flex-1'>
        <div className='flex flex-col'>
          {showHero && (
            <div className='-mx-4 sm:-mx-6 lg:-mx-12'>
              <StudioHero />
            </div>
          )}
          <div className='mx-auto w-full max-w-5xl py-12'>
            {lowerQ && (
              <div className='mb-8 flex items-center gap-3'>
                <span className='font-season text-[#666] text-[10px] uppercase tracking-widest'>
                  Results for:
                </span>
                <span
                  className='px-2 py-0.5 font-season text-[#ECECEC] text-[10px] uppercase tracking-wider'
                  style={{ border: '1px solid #3d3d3d' }}
                >
                  {query.trim()}
                </span>
                <button
                  type='button'
                  onClick={handleClearAll}
                  className='font-season text-[#999] text-[10px] uppercase tracking-wider transition-colors hover:text-[#ECECEC]'
                >
                  Clear
                </button>
              </div>
            )}

            {activeCategory && !lowerQ && (
              <div className='mb-8 flex items-center gap-3'>
                <span className='font-season text-[#666] text-[10px] uppercase tracking-widest'>
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
                  className='font-season text-[#999] text-[10px] uppercase tracking-wider transition-colors hover:text-[#ECECEC]'
                >
                  Clear
                </button>
              </div>
            )}

            {featured.length > 0 && (
              <section className='mb-10'>
                <h2 className='mb-8 flex items-center gap-2 font-season text-[#666] text-[11px] uppercase tracking-widest'>
                  <span className='inline-block h-2 w-2 bg-[#FA4EDF]' aria-hidden='true' />
                  Featured Content
                </h2>
                <FeaturedGrid posts={featured} />
              </section>
            )}

            {feed.length > 0 && (
              <section>
                <h2 className='mb-8 flex items-center gap-2 font-season text-[#666] text-[11px] uppercase tracking-widest'>
                  <span className='inline-block h-2 w-2 bg-[#00F701]' aria-hidden='true' />
                  {lowerQ ? 'Search Results' : activeCategory ? activeCategory.label : 'All Posts'}
                </h2>
                <PostGrid posts={feed} />
              </section>
            )}

            {pagePosts.length === 0 && (
              <div className='py-20 text-center'>
                <p className='text-[#666] text-[14px]'>
                  {lowerQ ? `No posts matching "${query.trim()}".` : 'No posts found.'}
                </p>
                <button
                  type='button'
                  onClick={handleClearAll}
                  className='mt-4 inline-block font-season text-[#999] text-[12px] uppercase tracking-wider transition-colors hover:text-[#ECECEC]'
                >
                  View all posts
                </button>
              </div>
            )}

            {totalPages > 1 && (
              <div className='mt-20 flex items-center justify-center gap-4 border-[#2A2A2A] border-t pt-12'>
                {page > 1 && (
                  <button
                    type='button'
                    onClick={() => setPage((p) => p - 1)}
                    className='border border-[#3d3d3d] bg-[#232323] px-6 py-2.5 font-season text-[#999] text-[11px] uppercase tracking-wider transition-colors hover:border-[#666] hover:text-[#ECECEC]'
                    style={{ borderRadius: '5px' }}
                  >
                    Previous
                  </button>
                )}
                <span className='font-season text-[#666] text-[10px] uppercase tracking-wider'>
                  Page {page} of {totalPages}
                </span>
                {page < totalPages && (
                  <button
                    type='button'
                    onClick={() => setPage((p) => p + 1)}
                    className='border border-[#3d3d3d] bg-[#232323] px-6 py-2.5 font-season text-[#999] text-[11px] uppercase tracking-wider transition-colors hover:border-[#666] hover:text-[#ECECEC]'
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
