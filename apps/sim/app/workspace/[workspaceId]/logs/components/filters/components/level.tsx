import { Check, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useFilterStore } from '@/stores/logs/filters/store'
import type { LogLevel } from '@/stores/logs/filters/types'

export default function Level() {
  const { level, setLevel } = useFilterStore()
  const specificLevels: { value: LogLevel; label: string; color: string }[] = [
    { value: 'error', label: 'Error', color: 'bg-destructive/100' },
    { value: 'info', label: 'Info', color: 'bg-muted-foreground/100' },
  ]

  const getDisplayLabel = () => {
    if (level === 'all') return 'Any status'
    const selected = specificLevels.find((l) => l.value === level)
    return selected ? selected.label : 'Any status'
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          className='w-full justify-between rounded-[10px] border-[#E5E5E5] bg-[#FFFFFF] font-normal text-sm dark:border-[#414141] dark:bg-[var(--surface-elevated)]'
        >
          {getDisplayLabel()}
          <ChevronDown className='ml-2 h-4 w-4 text-muted-foreground' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        className='w-[180px] rounded-lg border-[#E5E5E5] bg-[#FFFFFF] shadow-xs dark:border-[#414141] dark:bg-[var(--surface-elevated)]'
      >
        <DropdownMenuItem
          key='all'
          onSelect={(e) => {
            e.preventDefault()
            setLevel('all')
          }}
          className='flex cursor-pointer items-center justify-between rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
        >
          <span>Any status</span>
          {level === 'all' && <Check className='h-4 w-4 text-muted-foreground' />}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {specificLevels.map((levelItem) => (
          <DropdownMenuItem
            key={levelItem.value}
            onSelect={(e) => {
              e.preventDefault()
              setLevel(levelItem.value)
            }}
            className='flex cursor-pointer items-center justify-between rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
          >
            <div className='flex items-center'>
              <div className={`mr-2 h-2 w-2 rounded-full ${levelItem.color}`} />
              {levelItem.label}
            </div>
            {level === levelItem.value && <Check className='h-4 w-4 text-muted-foreground' />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
