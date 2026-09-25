import { Chip } from '@sim/emcn'
import type { OptionItem } from '@/app/workspace/[workspaceId]/home/types'

interface OptionsProps {
  items: OptionItem[]
  onSelect?: (id: string) => void
}

export function Options({ items, onSelect }: OptionsProps) {
  if (items.length === 0) return null

  return (
    <div className='flex flex-wrap gap-2'>
      {items.map((item) => (
        <Chip
          key={item.id}
          variant='border'
          shape='round'
          onClick={() => onSelect?.(item.id)}
          className='max-w-full'
        >
          {item.label}
        </Chip>
      ))}
    </div>
  )
}
