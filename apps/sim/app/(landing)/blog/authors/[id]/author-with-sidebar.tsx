'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BlogStudioSidebar } from '@/app/(landing)/blog/studio-sidebar-client'

interface AuthorWithSidebarProps {
  allPosts: { tags: string[] }[]
  activeTag: string | null
  children: React.ReactNode
}

export function AuthorWithSidebar({ allPosts, activeTag, children }: AuthorWithSidebarProps) {
  const router = useRouter()
  const [query, setQuery] = useState('')

  const handleChangeQuery = useCallback(
    (value: string) => {
      setQuery(value)
      const trimmed = value.trim()
      router.push(trimmed ? `/blog?q=${encodeURIComponent(trimmed)}` : '/blog')
    },
    [router]
  )

  const handleSelectTag = useCallback(
    (id: string | null) => {
      setQuery('')
      router.push(id ? `/blog?tag=${encodeURIComponent(id)}` : '/blog')
    },
    [router]
  )

  const sidebarPosts = useMemo(() => allPosts.map((p) => ({ tags: p.tags })), [allPosts])

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-x-clip px-4 sm:px-6 lg:flex-row lg:px-12'>
      <BlogStudioSidebar
        posts={sidebarPosts}
        activeTag={activeTag}
        query={query}
        onChangeQuery={handleChangeQuery}
        onSelectTag={handleSelectTag}
      />
      <main className='relative min-w-0 flex-1'>{children}</main>
    </div>
  )
}
