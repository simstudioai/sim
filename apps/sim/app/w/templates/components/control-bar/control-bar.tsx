'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Heart, ShoppingBag, ChevronDown, Shapes } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useDebounce } from '@/hooks/use-debounce'
import { 
  CATEGORIES, 
  CATEGORY_GROUPS, 
  getCategoriesByGroup, 
  getCategoryIcon,
  getCategoryLabel,
  getCategoryColor,
  getCategoryHoverColor,
  type CategoryGroup 
} from '../../constants/categories'

interface TemplatesHeaderProps {
  setSearchQuery: (query: string) => void
  activeSection: string | null
  scrollToSection: (sectionId: string) => void
  onCategoryFilter: (categories: string[] | null) => void
}

type NavigationItem = 'discover' | CategoryGroup

export function TemplatesHeader({ 
  setSearchQuery, 
  activeSection, 
  scrollToSection,
  onCategoryFilter 
}: TemplatesHeaderProps) {
  const router = useRouter()
  const [localSearchQuery, setLocalSearchQuery] = useState('')
  const [activeNavigation, setActiveNavigation] = useState<NavigationItem>('discover')
  const [visibleCategories, setVisibleCategories] = useState<string[]>([])
  const debouncedSearchQuery = useDebounce(localSearchQuery, 300)

  // Update parent component when debounced search query changes
  useEffect(() => {
    setSearchQuery(debouncedSearchQuery)
  }, [debouncedSearchQuery, setSearchQuery])

  // Update visible categories when navigation changes
  useEffect(() => {
    if (activeNavigation === 'discover') {
      setVisibleCategories(['popular', 'recent', ...CATEGORIES.map(cat => cat.value)])
      onCategoryFilter(null) // Show all categories
    } else {
      const groupCategories = [...CATEGORY_GROUPS[activeNavigation]]
      setVisibleCategories(groupCategories)
      onCategoryFilter(groupCategories)
    }
  }, [activeNavigation, onCategoryFilter])

  const handleNavigationClick = (nav: NavigationItem) => {
    setActiveNavigation(nav)
  }

  const handleDropdownCategoryClick = (category: string) => {
    scrollToSection(category)
  }

  const renderNavigationButton = (
    label: string, 
    value: NavigationItem,
    hasDropdown: boolean = false,
    dropdownCategories?: string[]
  ) => {
    const isActive = activeNavigation === value

    if (hasDropdown && dropdownCategories) {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className={`font-bold text-lg hover:text-foreground transition-colors ${
                isActive ? 'text-foreground' : 'text-muted-foreground'
              }`}
              onClick={() => handleNavigationClick(value)}
            >
              {label}
              <ChevronDown className="ml-1 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {dropdownCategories.map((categoryValue) => {
              const category = getCategoriesByGroup(value as CategoryGroup).find(
                cat => cat.value === categoryValue
              )
              if (!category) return null
              
              return (
                <DropdownMenuItem
                  key={categoryValue}
                  onClick={() => handleDropdownCategoryClick(categoryValue)}
                  className="cursor-pointer"
                >
                  <div className="flex items-center">
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
      <Button
        variant="ghost"
        className={`font-bold text-lg hover:text-foreground transition-colors ${
          isActive ? 'text-foreground' : 'text-muted-foreground'
        }`}
        onClick={() => handleNavigationClick(value)}
      >
        {label}
      </Button>
    )
  }

  return (
    <div className="border-b bg-background">
      {/* Top Row - Action Icons */}
      <div className="flex justify-between px-6 py-3">
        <div className="flex items-center gap-2">
          <Button 
            variant="ghost" 
            size="sm" 
            className="text-muted-foreground hover:text-foreground"
            onClick={() => router.push('/w/templates')}
          >
            <Shapes className="h-4 w-4 mr-2" />
            Marketplace
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
            <Heart className="h-4 w-4 mr-2" />
            Saved
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
            <ShoppingBag className="h-4 w-4 mr-2" />
            Purchased
          </Button>
        </div>
      </div>

      {/* Main Navigation Row */}
      <div className="flex items-center justify-between px-6 py-4">
        {/* Left - Navigation */}
        <div className="flex items-center gap-6">
          {renderNavigationButton('Discover', 'discover')}
          {renderNavigationButton('Work', 'work', true, [...CATEGORY_GROUPS.work])}
          {renderNavigationButton('Life', 'life', true, [...CATEGORY_GROUPS.life])}
          {renderNavigationButton('School', 'school', true, [...CATEGORY_GROUPS.school])}
        </div>

        {/* Right - Search */}
        <div className="relative w-[400px]">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Search className="h-4 w-4 text-muted-foreground" />
          </div>
          <Input
            type="search"
            placeholder="Search templates..."
            className="h-10 pl-10"
            value={localSearchQuery}
            onChange={(e) => setLocalSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Category Pills Row */}
      <div className="px-6 pb-4">
        <div className="flex flex-wrap gap-2">
          {visibleCategories.map((categoryValue) => {
            const isSpecial = categoryValue === 'popular' || categoryValue === 'recent'
            const category = CATEGORIES.find(cat => cat.value === categoryValue)
            const isActive = activeSection === categoryValue
            const categoryColor = getCategoryColor(categoryValue)
            const hoverColor = getCategoryHoverColor(categoryValue)
            
            return (
              <Button
                key={categoryValue}
                variant={isActive ? "default" : "outline"}
                size="sm"
                className={`rounded-full px-4 py-2 text-sm transition-colors ${
                  isActive 
                    ? 'text-white border-0'
                    : `border-muted-foreground/20 ${hoverColor} hover:text-foreground`
                }`}
                onClick={() => scrollToSection(categoryValue)}
                style={
                  isActive 
                    ? { 
                        backgroundColor: categoryColor, 
                        borderColor: categoryColor,
                        color: 'white'
                      }
                    : {}
                }
              >
                <div className="flex items-center">
                  {getCategoryIcon(categoryValue)}
                  {getCategoryLabel(categoryValue)}
                </div>
              </Button>
            )
          })}
        </div>
      </div>
    </div>
  )
} 