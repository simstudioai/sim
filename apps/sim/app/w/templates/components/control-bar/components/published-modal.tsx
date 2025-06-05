'use client'

import { useEffect, useState } from 'react'
import { ArrowUpDown, Eye, Loader2, MoreHorizontal, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('PublishedModal')

interface PublishedTemplate {
  id: string
  name: string
  views: number
  category: string
  short_description: string | null
  price: string
  createdAt: string
  updatedAt: string
}

interface PublishedModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type SortOption = 'recent' | 'oldest' | 'name' | 'views'

export function PublishedModal({ open, onOpenChange }: PublishedModalProps) {
  const router = useRouter()
  const [publishedTemplates, setPublishedTemplates] = useState<PublishedTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<SortOption>('recent')
  const [error, setError] = useState<string | null>(null)

  // Fetch published templates
  useEffect(() => {
    if (!open) return

    const fetchPublishedTemplates = async () => {
      try {
        setLoading(true)
        setError(null)

        const response = await fetch('/api/templates/published')
        if (!response.ok) {
          throw new Error('Failed to fetch published templates')
        }

        const data = await response.json()
        setPublishedTemplates(data.published || [])

        logger.info(`Loaded ${data.published?.length || 0} published templates`)
      } catch (err: any) {
        logger.error('Error fetching published templates:', err)
        setError(err.message || 'Failed to load published templates')
      } finally {
        setLoading(false)
      }
    }

    fetchPublishedTemplates()
  }, [open])

  // Sort templates based on selected option
  const sortedTemplates = [...publishedTemplates].sort((a, b) => {
    switch (sortBy) {
      case 'recent':
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      case 'oldest':
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      case 'name':
        return a.name.localeCompare(b.name)
      case 'views':
        return b.views - a.views
      default:
        return 0
    }
  })

  const handleViewTemplate = (templateId: string) => {
    router.push(`/w/templates/${templateId}`)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const getSortLabel = (option: SortOption) => {
    switch (option) {
      case 'recent':
        return 'Recently Published'
      case 'oldest':
        return 'Oldest First'
      case 'name':
        return 'Template Name'
      case 'views':
        return 'Most Views'
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex max-h-[80vh] flex-col sm:max-w-4xl'>
        <DialogHeader className='pb-4'>
          <DialogTitle className='flex items-center gap-2 text-xl'>
            <Upload className='h-5 w-5 text-blue-500' />
            Published Templates
          </DialogTitle>
        </DialogHeader>

        {/* Sort Controls */}
        <div className='flex items-center justify-between border-b pb-4'>
          <div className='text-muted-foreground text-sm'>
            {publishedTemplates.length} published template
            {publishedTemplates.length !== 1 ? 's' : ''}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='outline' size='sm' className='gap-2'>
                <ArrowUpDown className='h-4 w-4' />
                Sort by: {getSortLabel(sortBy)}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onClick={() => setSortBy('recent')}>
                Recently Published
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy('oldest')}>Oldest First</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy('name')}>Template Name</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy('views')}>Most Views</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Content */}
        <div className='flex-1 overflow-y-auto'>
          {loading ? (
            <div className='flex items-center justify-center py-12'>
              <Loader2 className='h-6 w-6 animate-spin' />
              <span className='ml-2 text-muted-foreground text-sm'>
                Loading published templates...
              </span>
            </div>
          ) : error ? (
            <div className='flex items-center justify-center py-12'>
              <div className='text-center'>
                <p className='text-destructive text-sm'>{error}</p>
                <Button
                  variant='outline'
                  size='sm'
                  className='mt-2'
                  onClick={() => window.location.reload()}
                >
                  Try Again
                </Button>
              </div>
            </div>
          ) : publishedTemplates.length === 0 ? (
            <div className='flex items-center justify-center py-12'>
              <div className='text-center'>
                <Upload className='mx-auto mb-4 h-12 w-12 text-muted-foreground/50' />
                <p className='text-muted-foreground text-sm'>No published templates yet</p>
                <p className='mt-1 text-muted-foreground text-xs'>
                  Publish workflows to the templates to see them here
                </p>
              </div>
            </div>
          ) : (
            <div className='space-y-2'>
              {sortedTemplates.map((template) => (
                <div
                  key={template.id}
                  className='flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50'
                >
                  {/* Template Info */}
                  <div className='flex flex-1 items-center gap-3'>
                    {/* Template Icon */}
                    <div className='flex h-8 w-8 items-center justify-center rounded-full bg-blue-100'>
                      <Upload className='h-4 w-4 text-blue-600' />
                    </div>

                    {/* Template Details */}
                    <div className='min-w-0 flex-1'>
                      <div className='flex items-center gap-2'>
                        <h3 className='truncate font-medium text-sm'>{template.name}</h3>
                        <span className='rounded bg-muted px-1.5 py-0.5 text-muted-foreground text-xs uppercase'>
                          {template.price}
                        </span>
                      </div>
                      <div className='mt-1 flex items-center gap-4 text-muted-foreground text-xs'>
                        {template.short_description && (
                          <span className='truncate'>{template.short_description}</span>
                        )}
                        <div className='flex items-center gap-1'>
                          <Eye className='h-3 w-3' />
                          {template.views}
                        </div>
                      </div>
                    </div>

                    {/* Published Date */}
                    <div className='text-muted-foreground text-xs'>
                      Published {formatDate(template.createdAt)}
                    </div>

                    {/* Actions */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant='ghost' size='sm' className='h-8 w-8 p-0'>
                          <MoreHorizontal className='h-4 w-4' />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end'>
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
