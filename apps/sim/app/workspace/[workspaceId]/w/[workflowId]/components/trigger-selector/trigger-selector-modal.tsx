'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { getAllTriggerBlocks, getTriggerDisplayName } from '@/lib/workflows/trigger-utils'

interface TriggerSelectorModalProps {
  open: boolean
  onClose: () => void
  onSelect: (triggerId: string, enableTriggerMode?: boolean) => void
}

export function TriggerSelectorModal({ open, onClose, onSelect }: TriggerSelectorModalProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Get all trigger options from the centralized source
  const triggerOptions = useMemo(() => getAllTriggerBlocks(), [])

  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return triggerOptions

    const query = searchQuery.toLowerCase()
    return triggerOptions.filter(
      (option) =>
        option.name.toLowerCase().includes(query) ||
        option.description.toLowerCase().includes(query)
    )
  }, [searchQuery, triggerOptions])

  const coreOptions = useMemo(
    () => filteredOptions.filter((opt) => opt.category === 'core'),
    [filteredOptions]
  )

  const integrationOptions = useMemo(
    () => filteredOptions.filter((opt) => opt.category === 'integration'),
    [filteredOptions]
  )

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-w-5xl p-0 overflow-hidden max-h-[85vh]'>
        <DialogHeader className='px-6 pt-6 pb-4'>
          <DialogTitle className='text-2xl font-semibold'>
            How do you want to trigger this workflow?
          </DialogTitle>
          <p className='text-sm text-muted-foreground mt-1'>
            Choose how your workflow will be started. You can add more triggers later from the
            sidebar.
          </p>
        </DialogHeader>

        <div className='px-6'>
          {/* Search Input */}
          <div className='flex h-9 items-center gap-2 rounded-[8px] border bg-background pr-2 pl-3 mb-4'>
            <Search className='h-4 w-4 text-muted-foreground' strokeWidth={2} />
            <Input
              placeholder='Search triggers...'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className='h-6 flex-1 border-0 bg-transparent px-0 text-muted-foreground text-sm leading-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
              autoComplete='off'
              autoCorrect='off'
              autoCapitalize='off'
              spellCheck='false'
            />
          </div>
        </div>

        <div className='px-6 pb-6 overflow-y-auto max-h-[60vh]'>
          {/* Core Triggers Section */}
          {coreOptions.length > 0 && (
            <>
              <h3 className='text-sm font-medium text-muted-foreground mb-3'>Core Triggers</h3>
              <div className='grid grid-cols-2 md:grid-cols-3 gap-3 mb-6'>
                {coreOptions.map((option) => {
                  const Icon = option.icon
                  const isHovered = hoveredId === option.id

                  return (
                    <button
                      key={option.id}
                      onClick={() => onSelect(option.id, option.enableTriggerMode)}
                      onMouseEnter={() => setHoveredId(option.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      className={cn(
                        'relative group rounded-xl border-2 p-4 text-left transition-all duration-200',
                        'hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]',
                        'cursor-pointer',
                        isHovered && 'border-primary shadow-md',
                        !isHovered && 'border-border'
                      )}
                    >
                      <div
                        className={cn(
                          'w-10 h-10 rounded-lg flex items-center justify-center mb-3',
                          'transition-transform duration-200',
                          isHovered && 'scale-110'
                        )}
                        style={{ backgroundColor: option.color }}
                      >
                        {Icon ? (
                          <Icon className='w-5 h-5 text-white' />
                        ) : (
                          <div className='w-5 h-5 bg-white/20 rounded' />
                        )}
                      </div>

                      <h3 className='font-semibold text-sm mb-1'>
                        {getTriggerDisplayName(option.id)}
                      </h3>
                      <p className='text-xs text-muted-foreground line-clamp-2'>
                        {option.description}
                      </p>

                      {isHovered && (
                        <div className='absolute inset-0 rounded-xl ring-2 ring-primary ring-opacity-20 pointer-events-none' />
                      )}
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {/* Integration Triggers Section */}
          {integrationOptions.length > 0 && (
            <>
              <h3 className='text-sm font-medium text-muted-foreground mb-3'>
                Integration Triggers
              </h3>
              <div className='grid grid-cols-2 md:grid-cols-3 gap-3'>
                {integrationOptions.map((option) => {
                  const Icon = option.icon
                  const isHovered = hoveredId === option.id

                  return (
                    <button
                      key={option.id}
                      onClick={() => onSelect(option.id, option.enableTriggerMode)}
                      onMouseEnter={() => setHoveredId(option.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      className={cn(
                        'relative group rounded-xl border-2 p-4 text-left transition-all duration-200',
                        'hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]',
                        'cursor-pointer',
                        isHovered && 'border-primary shadow-md',
                        !isHovered && 'border-border'
                      )}
                    >
                      <div
                        className={cn(
                          'w-10 h-10 rounded-lg flex items-center justify-center mb-3',
                          'transition-transform duration-200',
                          isHovered && 'scale-110'
                        )}
                        style={{ backgroundColor: option.color }}
                      >
                        {Icon ? (
                          <Icon className='w-5 h-5 text-white' />
                        ) : (
                          <div className='w-5 h-5 bg-white/20 rounded' />
                        )}
                      </div>

                      <h3 className='font-semibold text-sm mb-1'>
                        {getTriggerDisplayName(option.id)}
                      </h3>
                      <p className='text-xs text-muted-foreground line-clamp-2'>
                        {option.description}
                      </p>

                      {isHovered && (
                        <div className='absolute inset-0 rounded-xl ring-2 ring-primary ring-opacity-20 pointer-events-none' />
                      )}
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {filteredOptions.length === 0 && (
            <div className='text-center py-12 text-sm text-muted-foreground'>
              No triggers found matching "{searchQuery}"
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
