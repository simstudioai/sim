'use client'

import { useMemo } from 'react'
import { useReducedMotion } from 'framer-motion'
import { Search } from 'lucide-react'
import { cn } from '@/lib/core/utils/cn'
import { hexToRgba } from '@/lib/core/utils/formatting'
import { CATEGORIES, getPrimaryCategory } from '@/app/(landing)/blog/tag-colors'

const LEFT_WALL_CLIP = 'polygon(0 8px, 100% 0, 100% 100%, 0 100%)'
const BOTTOM_WALL_CLIP = 'polygon(0 0, 100% 0, calc(100% - 8px) 100%, 0 100%)'

const DEPTH_SEGMENTS = [
  [0.3, 10],
  [0.5, 8],
  [0.8, 6],
  [1, 5],
  [0.4, 12],
  [0.7, 8],
  [1, 6],
  [0.5, 10],
  [0.9, 7],
  [0.6, 12],
  [1, 8],
  [0.35, 8],
] as const

function buildBottomWallGradient(color: string): string {
  let pos = 0
  const stops: string[] = []
  for (const [opacity, width] of DEPTH_SEGMENTS) {
    const c = hexToRgba(color, opacity)
    stops.push(`${c} ${pos}%`, `${c} ${pos + width}%`)
    pos += width
  }
  return `linear-gradient(135deg, ${stops.join(', ')})`
}

interface BlogSidebarPost {
  tags: string[]
}

interface BlogStudioSidebarProps {
  posts: BlogSidebarPost[]
  activeTag: string | null
  query: string
  onChangeQuery: (value: string) => void
  onSelectTag: (id: string | null) => void
  className?: string
}

export function BlogStudioSidebar({
  posts,
  activeTag,
  query,
  onChangeQuery,
  onSelectTag,
  className,
}: BlogStudioSidebarProps) {
  const shouldReduceMotion = useReducedMotion()

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

  return (
    <aside
      className={cn(
        'flex w-full shrink-0 flex-col border-[#2A2A2A] border-b bg-[#1C1C1C] px-4 py-6 sm:px-6 lg:sticky lg:top-[52px] lg:h-[calc(100vh-52px)] lg:w-64 lg:overflow-y-auto lg:border-r lg:border-b-0 lg:px-6 lg:pt-12',
        className
      )}
    >
      <div className='flex h-full flex-col'>
        <div className='mb-6'>
          <h2 className='mb-4 font-season text-[#666] text-[10px] uppercase tracking-widest'>
            Find Insights
          </h2>
          <SidebarSearch value={query} onChange={onChangeQuery} />
        </div>

        <div className='border-[#2A2A2A] border-t pt-6'>
          <h2 className='mb-3 font-season text-[#ECECEC] text-[10px] uppercase tracking-widest'>
            Categories
          </h2>
          <SidebarCategories
            items={categoryItems}
            activeId={activeTag}
            onSelect={onSelectTag}
            shouldReduceMotion={Boolean(shouldReduceMotion)}
          />
        </div>
      </div>
    </aside>
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
        className='w-full border border-[#2A2A2A] bg-[#232323] px-4 py-2 pr-9 font-season text-[#ECECEC] text-[11px] transition-colors placeholder:text-[#666] focus:border-[#3d3d3d] focus:outline-none'
        style={{ borderRadius: '4px' }}
        aria-label='Search blog posts'
      />
      <span className='absolute top-0 right-0 flex h-full items-center px-3 text-[#666]'>
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
  shouldReduceMotion: boolean
}

function SidebarCategories({
  items,
  activeId,
  onSelect,
  shouldReduceMotion,
}: SidebarCategoriesProps) {
  return (
    <ul className='relative flex flex-col'>
      {items.map((item) => {
        const isActive = item.id === activeId
        const key = item.id ?? 'all'
        return (
          <li key={key}>
            <button
              type='button'
              onClick={() => onSelect(item.id)}
              className={cn(
                'relative w-full text-left',
                isActive
                  ? 'z-10'
                  : 'shadow-[inset_0_-1px_0_0_#2A2A2A] last:shadow-none hover:bg-[#232323]/50'
              )}
            >
              <div
                className='pointer-events-none absolute top-[-4px] bottom-0 left-0 w-1'
                style={{
                  clipPath: LEFT_WALL_CLIP,
                  backgroundColor: hexToRgba(item.color, 0.63),
                  opacity: isActive ? 1 : 0,
                  transition: shouldReduceMotion
                    ? 'none'
                    : isActive
                      ? 'opacity 250ms cubic-bezier(0.2, 0, 0, 1) 50ms'
                      : 'opacity 200ms cubic-bezier(0.4, 0, 1, 1)',
                }}
                aria-hidden='true'
              />
              <div
                className='pointer-events-none absolute right-[-4px] bottom-0 left-1 h-1'
                style={{
                  clipPath: BOTTOM_WALL_CLIP,
                  background: buildBottomWallGradient(item.color),
                  opacity: isActive ? 1 : 0,
                  transition: shouldReduceMotion
                    ? 'none'
                    : isActive
                      ? 'opacity 250ms cubic-bezier(0.2, 0, 0, 1) 50ms'
                      : 'opacity 200ms cubic-bezier(0.4, 0, 1, 1)',
                }}
                aria-hidden='true'
              />
              <div
                className='relative flex items-center px-[12px] py-[10px]'
                style={{
                  transform: isActive ? 'translate(4px, -4px)' : 'translate(0px, 0px)',
                  backgroundColor: isActive ? '#242424' : 'transparent',
                  boxShadow: isActive
                    ? 'inset 0 0 0 1.5px #3E3E3E'
                    : 'inset 0 0 0 1.5px transparent',
                  transition: shouldReduceMotion
                    ? 'none'
                    : isActive
                      ? 'transform 350ms cubic-bezier(0.34, 1.4, 0.64, 1), background-color 250ms ease 30ms, box-shadow 250ms ease 30ms'
                      : 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1), background-color 200ms ease, box-shadow 200ms ease',
                }}
              >
                <span
                  className='flex-1 font-[430] font-season text-[14px]'
                  style={{
                    color: isActive ? '#FFFFFF' : 'rgba(246, 246, 240, 0.5)',
                    transition: shouldReduceMotion ? 'none' : 'color 250ms ease',
                  }}
                >
                  {item.label}
                </span>
                <span
                  className='font-season text-[10px]'
                  style={{
                    padding: '2px 6px',
                    borderRadius: '2px',
                    border: isActive ? '1px solid #3E3E3E' : '1px solid #2A2A2A',
                    color: isActive ? item.color : '#666',
                    backgroundColor: isActive ? '#232323' : 'transparent',
                    transition: shouldReduceMotion ? 'none' : 'all 200ms ease',
                  }}
                >
                  {String(item.count).padStart(2, '0')}
                </span>
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
