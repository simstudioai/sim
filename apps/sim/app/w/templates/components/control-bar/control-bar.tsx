'use client'

import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code,
  Glasses,
  Heart,
  Search,
  Shapes,
  Upload,
  User,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useDebounce } from '@/hooks/use-debounce'
import {
  CATEGORIES,
  CATEGORY_GROUPS,
  type CategoryGroup,
  getCategoriesByGroup,
  getCategoryColor,
  getCategoryHoverColor,
  getCategoryIcon,
  getCategoryLabel,
} from '../../constants/categories'
import { PublishedModal } from './components/published-modal'
import { SavedModal } from './components/saved-modal'

interface TemplatesHeaderProps {
  setSearchQuery: (query: string) => void
  activeSection: string | null
  scrollToSection: (sectionId: string) => void
  onCategoryFilter: (categories: string[] | null) => void
  currentCategory?: string
}

type NavigationItem = 'discover' | CategoryGroup

export function ControlBar({
  setSearchQuery,
  activeSection,
  scrollToSection,
  onCategoryFilter,
  currentCategory,
}: TemplatesHeaderProps) {
  const router = useRouter()
  const [localSearchQuery, setLocalSearchQuery] = useState('')
  const [activeNavigation, setActiveNavigation] = useState<NavigationItem>('discover')
  const [visibleCategories, setVisibleCategories] = useState<string[]>([])
  const debouncedSearchQuery = useDebounce(localSearchQuery, 300)
  const [showSavedModal, setShowSavedModal] = useState(false)
  const [showPublishedModal, setShowPublishedModal] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [showArrows, setShowArrows] = useState(false)

  useEffect(() => {
    if (currentCategory && currentCategory !== 'discover') {
      setActiveNavigation(currentCategory as NavigationItem)
    }
  }, [currentCategory])

  useEffect(() => {
    setSearchQuery(debouncedSearchQuery)
  }, [debouncedSearchQuery, setSearchQuery])

  useEffect(() => {
    if (activeNavigation === 'discover') {
      setVisibleCategories(['popular', ...CATEGORIES.map((cat) => cat.value)])
      onCategoryFilter(null)
    } else {
      const groupCategories = [...CATEGORY_GROUPS[activeNavigation]]
      setVisibleCategories(groupCategories)
      onCategoryFilter(groupCategories)
    }
  }, [activeNavigation, onCategoryFilter])

  // Auto-scroll to active section pill
  useEffect(() => {
    if (activeSection && scrollContainerRef.current) {
      const activeButton = scrollContainerRef.current.querySelector(
        `[data-category="${activeSection}"]`
      ) as HTMLElement
      if (activeButton) {
        activeButton.scrollIntoView({
          behavior: 'smooth',
          inline: 'center',
          block: 'nearest',
        })
      }
    }
  }, [activeSection])

  const handleNavigationClick = (nav: NavigationItem) => {
    setActiveNavigation(nav)

    if (nav === 'discover' && currentCategory && currentCategory !== 'discover') {
      router.push('/w/templates')
    }
  }

  const handleDropdownCategoryClick = (category: string, parentGroup: CategoryGroup) => {
    router.push(`/w/templates/${parentGroup}?subcategory=${category}`)
  }

  const handleCategoryPillClick = (categoryValue: string) => {
    if (currentCategory && currentCategory !== 'discover') {
      router.push(`/w/templates/${currentCategory}?subcategory=${categoryValue}`)
    } else {
      scrollToSection(categoryValue)
    }
  }

  const scrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -200, behavior: 'smooth' })
    }
  }

  const scrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 200, behavior: 'smooth' })
    }
  }

  const renderNavigationButton = (
    label: string,
    value: NavigationItem,
    hasDropdown = false,
    dropdownCategories?: string[]
  ) => {
    const isActive = activeNavigation === value

    if (hasDropdown && dropdownCategories) {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <span
              className={`cursor-pointer font-bold text-lg transition-colors ${
                isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => handleNavigationClick(value)}
            >
              {label}
              <ChevronDown className='ml-1 inline h-4 w-4' />
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start' className='w-48'>
            {dropdownCategories.map((categoryValue) => {
              const category = getCategoriesByGroup(value as CategoryGroup).find(
                (cat) => cat.value === categoryValue
              )
              if (!category) return null

              return (
                <DropdownMenuItem
                  key={categoryValue}
                  onClick={() => handleDropdownCategoryClick(categoryValue, value as CategoryGroup)}
                  className='cursor-pointer'
                >
                  <div className='flex items-center'>
                    {getCategoryIcon(categoryValue)}
                    {category.label}
                  </div>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }

    return (
      <span
        className={`cursor-pointer font-bold text-lg transition-colors ${
          isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
        }`}
        onClick={() => handleNavigationClick(value)}
      >
        {label}
      </span>
    )
  }

  // Get category display info
  const getCategoryDisplayInfo = (category: string) => {
    switch (category) {
      case 'operations':
        return {
          label: 'Operations',
          icon: <Glasses className='mr-2 inline h-4 w-4' />,
        }
      case 'personal':
        return {
          label: 'Personal',
          icon: <User className='mr-2 inline h-4 w-4' />,
        }
      case 'technical':
        return {
          label: 'Technical',
          icon: <Code className='mr-2 inline h-4 w-4' />,
        }
      default:
        return {
          label: 'Templates',
          icon: <Shapes className='mr-2 inline h-4 w-4' />,
        }
    }
  }

  return (
    <div className='w-full border-b bg-background'>
      {/* Top Row - Action Icons */}
      <div className='flex justify-between px-6 pt-4 pb-6'>
        <div className='flex items-center gap-2'>
          <Shapes className='h-[18px] w-[18px] text-muted-foreground' />
          <h1 className='font-medium text-sm'>Templates</h1>
          {currentCategory && currentCategory !== 'discover' && (
            <span
              className='cursor-pointer font-medium text-sm'
              onClick={() => router.push('/w/templates')}
            >
              <span className='mx-2'>/</span>
              {getCategoryDisplayInfo(currentCategory).icon}
              {getCategoryDisplayInfo(currentCategory).label}
            </span>
          )}
        </div>
        <div className='flex items-center gap-6'>
          <span
            className='cursor-pointer font-medium text-sm'
            onClick={() => setShowSavedModal(true)}
          >
            <Heart className='mr-2 inline h-4 w-4' />
            Saved
          </span>
          <span
            className='cursor-pointer font-medium text-sm'
            onClick={() => setShowPublishedModal(true)}
          >
            <Upload className='mr-2 inline h-4 w-4' />
            Published
          </span>
        </div>
      </div>

      {/* Main Navigation Row */}
      <div className='flex items-center justify-between px-6 py-4'>
        {/* Left - Navigation */}
        <div className='flex items-center gap-6'>
          {renderNavigationButton('Discover', 'discover')}
          {renderNavigationButton('Operations', 'operations', true, [
            ...CATEGORY_GROUPS.operations,
          ])}
          {renderNavigationButton('Personal', 'personal', true, [...CATEGORY_GROUPS.personal])}
          {renderNavigationButton('Technical', 'technical', true, [...CATEGORY_GROUPS.technical])}
        </div>

        {/* Right - Search */}
        <div className='relative w-[400px]'>
          <div className='pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3'>
            <Search className='h-4 w-4 text-muted-foreground' />
          </div>
          <Input
            type='search'
            placeholder='Search templates...'
            className='h-10 pl-10'
            value={localSearchQuery}
            onChange={(e) => setLocalSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Category Pills Row with Custom Scroll */}
      <div className='relative px-6 pb-4'>
        <div
          className='relative'
          onMouseEnter={() => setShowArrows(true)}
          onMouseLeave={() => setShowArrows(false)}
        >
          {/* Left Arrow - overlays Popular tag */}
          {showArrows && (
            <button
              onClick={scrollLeft}
              className='-translate-y-1/2 absolute top-1/2 left-0 z-10 flex h-8 w-8 items-center justify-center rounded-full border bg-background/60 opacity-70 shadow-sm backdrop-blur-sm transition-all hover:bg-background/80 hover:opacity-100'
            >
              <ChevronLeft className='h-4 w-4' />
            </button>
          )}

          {/* Right Arrow */}
          {showArrows && (
            <button
              onClick={scrollRight}
              className='-translate-y-1/2 absolute top-1/2 right-0 z-10 flex h-8 w-8 items-center justify-center rounded-full border bg-background/60 opacity-70 shadow-sm backdrop-blur-sm transition-all hover:bg-background/80 hover:opacity-100'
            >
              <ChevronRight className='h-4 w-4' />
            </button>
          )}

          {/* Scrollable Content */}
          <div
            ref={scrollContainerRef}
            className='flex space-x-2 overflow-x-auto px-0 pb-2 [&::-webkit-scrollbar]:hidden'
            style={
              {
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
              } as React.CSSProperties
            }
          >
            {visibleCategories.map((categoryValue) => {
              const isSpecial = categoryValue === 'popular'
              const category = CATEGORIES.find((cat) => cat.value === categoryValue)
              const isActive = activeSection === categoryValue
              const categoryColor = getCategoryColor(categoryValue)
              const hoverColor = getCategoryHoverColor(categoryValue)

              return (
                <Button
                  key={categoryValue}
                  variant={isActive ? 'default' : 'outline'}
                  size='sm'
                  data-category={categoryValue}
                  className={`flex-shrink-0 rounded-full px-4 py-2 text-sm transition-colors ${
                    isActive
                      ? 'border-0 text-white'
                      : `border-muted-foreground/20 ${hoverColor} hover:text-foreground`
                  }`}
                  onClick={() => handleCategoryPillClick(categoryValue)}
                  style={
                    isActive
                      ? {
                          backgroundColor: categoryColor,
                          borderColor: categoryColor,
                          color: 'white',
                        }
                      : {}
                  }
                >
                  <div className='flex items-center'>
                    {getCategoryIcon(categoryValue)}
                    {getCategoryLabel(categoryValue)}
                  </div>
                </Button>
              )
            })}
          </div>
        </div>
      </div>

      <SavedModal open={showSavedModal} onOpenChange={setShowSavedModal} />
      <PublishedModal open={showPublishedModal} onOpenChange={setShowPublishedModal} />
    </div>
  )
}
