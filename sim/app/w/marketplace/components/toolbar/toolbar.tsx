'use client'

import { useEffect, useState } from 'react'
import {
  BotMessageSquare,
  Code,
  LineChart,
  MailIcon,
  PanelLeftClose,
  PanelRight,
  Sparkles,
  Star,
  Store,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { mockWorkflows } from '../../marketplace'

export type MarketplaceCategory = 'popular' | 'programming' | 'marketing' | 'all'

interface ToolbarProps {
  scrollToSection: (sectionId: string) => void
  activeSection: string | null
}

// Map of category icons
const categoryIcons: Record<string, React.ReactNode> = {
  popular: <Star className="h-4 w-4 mr-2" />,
  programming: <Code className="h-4 w-4 mr-2" />,
  marketing: <MailIcon className="h-4 w-4 mr-2" />,
  sales: <Store className="h-4 w-4 mr-2" />,
}

export function Toolbar({ scrollToSection, activeSection }: ToolbarProps) {
  const [categories, setCategories] = useState<string[]>([])

  // Extract all available categories from mockWorkflows
  useEffect(() => {
    const availableCategories = Object.keys(mockWorkflows)
    setCategories(availableCategories)
  }, [])

  return (
    <div className="p-4 w-64 border-r h-full overflow-auto">
      <h2 className="text-sm font-medium mb-4 pl-2">Categories</h2>
      <nav className="space-y-1">
        {categories.map((category) => (
          <Button
            key={category}
            variant="ghost"
            className={`w-full justify-start px-2 py-2 text-sm font-medium capitalize text-muted-foreground transition-colors hover:text-foreground ${
              activeSection === category ? 'bg-accent text-foreground' : 'hover:bg-accent/50'
            }`}
            onClick={() => scrollToSection(category)}
          >
            {categoryIcons[category] || <Star className="h-4 w-4 mr-2" />}
            {category}
          </Button>
        ))}
      </nav>
    </div>
  )
}
