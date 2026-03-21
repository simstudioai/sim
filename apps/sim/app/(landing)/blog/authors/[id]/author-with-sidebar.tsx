'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BlogMeta } from '@/lib/blog/schema'
import { PostGrid } from '@/app/(landing)/blog/post-grid'
import { BlogStudioSidebar } from '@/app/(landing)/blog/studio-sidebar-client'
import { CATEGORIES, getPrimaryCategory } from '@/app/(landing)/blog/tag-colors'

interface AuthorWithSidebarProps {
  allPosts: BlogMeta[]
  authorPosts: BlogMeta[]
  activeTag: string | null
  initialQuery: string
  children: React.ReactNode
}

export function AuthorWithSidebar({
  allPosts,
  authorPosts,
  activeTag,
  initialQuery,
  children,
}: AuthorWithSidebarProps) {
  const [selectedTag, setSelectedTag] = useState<string | null>(activeTag)
  const [query, setQuery] = useState(initialQuery)

  const syncUrl = useCallback((tag: string | null, q: string) => {
    const params = new URLSearchParams()
    if (tag) params.set('tag', tag)
    if (q) params.set('q', q)
    const search = params.toString()
    const basePath = window.location.pathname
    window.history.replaceState(null, '', search ? `${basePath}?${search}` : basePath)
  }, [])

  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search)
      setSelectedTag(params.get('tag'))
      setQuery(params.get('q') ?? '')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const lowerQ = query.trim().toLowerCase()

  const filteredAuthorPosts = useMemo(() => {
    const validTag =
      selectedTag && CATEGORIES.some((c) => c.id === selectedTag) ? selectedTag : null

    let filtered = authorPosts

    if (validTag) filtered = authorPosts.filter((p) => getPrimaryCategory(p.tags).id === validTag)

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

    return filtered
  }, [authorPosts, lowerQ, selectedTag])

  const sidebarPosts = useMemo(() => allPosts.map((p) => ({ tags: p.tags })), [allPosts])

  const handleChangeQuery = useCallback(
    (value: string) => {
      setQuery(value)
      setSelectedTag(null)
      syncUrl(null, value.trim())
    },
    [syncUrl]
  )

  const handleSelectTag = useCallback(
    (id: string | null) => {
      setQuery('')
      setSelectedTag(id)
      syncUrl(id, '')
    },
    [syncUrl]
  )

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-x-clip px-4 sm:px-6 lg:flex-row lg:px-12'>
      <BlogStudioSidebar
        posts={sidebarPosts}
        activeTag={selectedTag}
        query={query}
        onChangeQuery={handleChangeQuery}
        onSelectTag={handleSelectTag}
      />
      <main className='relative min-w-0 flex-1'>
        <div className='mx-auto w-full max-w-5xl px-4 py-16 sm:px-0 lg:mr-8 lg:px-0 lg:py-16'>
          {children}
          {filteredAuthorPosts.length === 0 ? (
            <div className='py-20 text-center'>
              <p className='text-[#666] text-[14px]'>
                {lowerQ ? `No posts matching "${query.trim()}".` : 'No posts found.'}
              </p>
            </div>
          ) : (
            <PostGrid posts={filteredAuthorPosts} />
          )}
        </div>
      </main>
    </div>
  )
}
