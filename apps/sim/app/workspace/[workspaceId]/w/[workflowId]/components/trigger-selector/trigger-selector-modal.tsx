'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { TriggerInfo } from '@/lib/workflows/trigger-utils'
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

  const TriggerOptionCard = ({ option }: { option: TriggerInfo }) => {
    const Icon = option.icon
    const isHovered = hoveredId === option.id
    return (
      <button
        onClick={() => onSelect(option.id, option.enableTriggerMode)}
        onMouseEnter={() => setHoveredId(option.id)}
        onMouseLeave={() => setHoveredId(null)}
        className={cn(
          'group relative rounded-xl border-2 p-4 text-left transition-all duration-200',
          'hover:scale-[1.02] hover:shadow-lg active:scale-[0.98]',
          'cursor-pointer',
          isHovered ? 'border-primary shadow-md' : 'border-border'
        )}
      >
        <div
          className={cn(
            'mb-3 flex h-10 w-10 items-center justify-center rounded-lg',
            'transition-transform duration-200',
            isHovered && 'scale-110'
          )}
          style={{ backgroundColor: option.color }}
        >
          {Icon ? (
            <Icon className='h-5 w-5 text-white' />
          ) : (
            <div className='h-5 w-5 rounded bg-white/20' />
          )}
        </div>

        <h3 className='mb-1 font-semibold text-sm'>{getTriggerDisplayName(option.id)}</h3>
        <p className='line-clamp-2 text-muted-foreground text-xs'>{option.description}</p>

        {isHovered && (
          <div className='pointer-events-none absolute inset-0 rounded-xl ring-2 ring-primary ring-opacity-20' />
        )}
      </button>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[85vh] max-w-5xl overflow-hidden p-0'>
        <DialogHeader className='px-6 pt-6 pb-4'>
          <DialogTitle className='font-semibold text-2xl'>
            How do you want to trigger this workflow?
          </DialogTitle>
          <p className='mt-1 text-muted-foreground text-sm'>
            Choose how your workflow will be started. You can add more triggers later from the
            sidebar.
          </p>
        </DialogHeader>

        <div className='px-6'>
          {/* Search Input */}
          <div className='mb-4 flex h-9 items-center gap-2 rounded-[8px] border bg-background pr-2 pl-3'>
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

        <div className='max-h-[60vh] overflow-y-auto px-6 pb-6'>
          {/* Core Triggers Section */}
          {coreOptions.length > 0 && (
            <>
              <h3 className='mb-3 font-medium text-muted-foreground text-sm'>Core Triggers</h3>
              <div className='mb-6 grid grid-cols-2 gap-3 md:grid-cols-3'>
                {coreOptions.map((option) => (
                  <TriggerOptionCard key={option.id} option={option} />
                ))}
              </div>
            </>
          )}

          {/* Integration Triggers Section */}
          {integrationOptions.length > 0 && (
            <>
              <h3 className='mb-3 font-medium text-muted-foreground text-sm'>
                Integration Triggers
              </h3>
              <div className='grid grid-cols-2 gap-3 md:grid-cols-3'>
                {integrationOptions.map((option) => (
                  <TriggerOptionCard key={option.id} option={option} />
                ))}
              </div>
            </>
          )}

          {filteredOptions.length === 0 && (
            <div className='py-12 text-center text-muted-foreground text-sm'>
              No triggers found matching "{searchQuery}"
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
