import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { createLogger } from '@/lib/logs/console-logger'
import { useSubBlockValue } from '../hooks/use-sub-block-value'

const logger = createLogger('CheckboxList')

interface CheckboxListProps {
  blockId: string
  subBlockId: string
  title: string
  options: { label: string; id: string }[]
  layout?: 'full' | 'half'
  isPreview?: boolean
  value?: Record<string, boolean>
}

export function CheckboxList({ 
  blockId, 
  subBlockId, 
  title, 
  options, 
  layout,
  isPreview = false,
  value: propValues
}: CheckboxListProps) {
  return (
    <div className={cn('grid gap-4', layout === 'half' ? 'grid-cols-2' : 'grid-cols-1', 'pt-1')}>
      {options.map((option) => {
        const [value, setValue] = useSubBlockValue(
          blockId, 
          option.id, 
          false, 
          isPreview, 
          propValues?.[option.id]
        )
        
        // Log when in preview mode to verify it's working
        if (isPreview) {
          logger.info(`[PREVIEW] CheckboxList option ${option.id} for ${blockId}`, {
            isPreview,
            propValue: propValues?.[option.id],
            value
          });
        }
        
        return (
          <div key={option.id} className='flex items-center space-x-2'>
            <Checkbox
              id={`${blockId}-${option.id}`}
              checked={Boolean(value)}
              onCheckedChange={(checked) => setValue(checked as boolean)}
            />
            <Label
              htmlFor={`${blockId}-${option.id}`}
              className='cursor-pointer font-normal text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
            >
              {option.label}
            </Label>
          </div>
        )
      })}
    </div>
  )
}
