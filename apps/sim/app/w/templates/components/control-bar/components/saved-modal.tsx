'use client'

import { useState, useEffect } from 'react'
import { Heart, MoreHorizontal, Eye, ArrowUpDown, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('SavedModal')

interface SavedTemplate {
  id: string
  name: string
  authorName: string
  authorId: string
  views: number
  category: string
  savedAt: string
  timesUsed: number
  lastUsedAt?: string
}

interface SavedModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type SortOption = 'recent' | 'oldest' | 'name' | 'author'

export function SavedModal({ open, onOpenChange }: SavedModalProps) {
  const router = useRouter()
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<SortOption>('recent')
  const [error, setError] = useState<string | null>(null)

  // Fetch saved templates
  useEffect(() => {
    if (!open) return

    const fetchSavedTemplates = async () => {
      try {
        setLoading(true)
        setError(null)

        const response = await fetch('/api/templates/saved')
        if (!response.ok) {
          throw new Error('Failed to fetch saved templates')
        }

        const data = await response.json()
        setSavedTemplates(data.saved || [])
        
        logger.info(`Loaded ${data.saved?.length || 0} saved templates`)
      } catch (err: any) {
        logger.error('Error fetching saved templates:', err)
        setError(err.message || 'Failed to load saved templates')
      } finally {
        setLoading(false)
      }
    }

    fetchSavedTemplates()
  }, [open])

  // Sort templates based on selected option
  const sortedTemplates = [...savedTemplates].sort((a, b) => {
    switch (sortBy) {
      case 'recent':
        return new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
      case 'oldest':
        return new Date(a.savedAt).getTime() - new Date(b.savedAt).getTime()
      case 'name':
        return a.name.localeCompare(b.name)
      case 'author':
        return a.authorName.localeCompare(b.authorName)
      default:
        return 0
    }
  })

  const handleViewTemplate = (templateId: string) => {
    onOpenChange(false)
    router.push(`/w/templates/${templateId}`)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const getAuthorInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const getSortLabel = (option: SortOption) => {
    switch (option) {
      case 'recent': return 'Recently Saved'
      case 'oldest': return 'Oldest First'
      case 'name': return 'Template Name'
      case 'author': return 'Author Name'
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader className="pb-4">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Heart className="h-5 w-5 fill-current text-red-500" />
            Saved Templates
          </DialogTitle>
        </DialogHeader>

        {/* Sort Controls */}
        <div className="flex items-center justify-between border-b pb-4">
          <div className="text-sm text-muted-foreground">
            {savedTemplates.length} saved template{savedTemplates.length !== 1 ? 's' : ''}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <ArrowUpDown className="h-4 w-4" />
                Sort by: {getSortLabel(sortBy)}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setSortBy('recent')}>
                Recently Saved
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy('oldest')}>
                Oldest First
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy('name')}>
                Template Name
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy('author')}>
                Author Name
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="ml-2 text-sm text-muted-foreground">Loading saved templates...</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <p className="text-destructive text-sm">{error}</p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="mt-2"
                  onClick={() => window.location.reload()}
                >
                  Try Again
                </Button>
              </div>
            </div>
          ) : savedTemplates.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <Heart className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground text-sm">No saved templates yet</p>
                <p className="text-muted-foreground text-xs mt-1">
                  Save templates from the marketplace to see them here
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedTemplates.map((template) => (
                <div
                  key={template.id}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  {/* Template Info */}
                  <div className="flex items-center gap-3 flex-1">
                    {/* Author Avatar */}
                    <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                      <span className="text-xs font-medium text-muted-foreground">
                        {getAuthorInitials(template.authorName)}
                      </span>
                    </div>

                    {/* Template Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-sm truncate">
                          {template.name}
                        </h3>
                        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          FREE
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                        <span>by {template.authorName}</span>
                        <div className="flex items-center gap-1">
                          <Eye className="h-3 w-3" />
                          {template.views}
                        </div>
                      </div>
                    </div>

                    {/* Saved Date */}
                    <div className="text-xs text-muted-foreground">
                      Saved {formatDate(template.savedAt)}
                    </div>

                    {/* Actions */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleViewTemplate(template.id)}>
                          View in Template Gallery
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
