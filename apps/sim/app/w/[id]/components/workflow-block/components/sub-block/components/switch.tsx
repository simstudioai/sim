import { useEffect } from 'react'
import { Label } from '@/components/ui/label'
import { Switch as UISwitch } from '@/components/ui/switch'
import { createLogger } from '@/lib/logs/console-logger'
import { useSubBlockValue } from '../hooks/use-sub-block-value'

const logger = createLogger('Switch')

interface SwitchProps {
  blockId: string
  subBlockId: string
  title: string
  isPreview?: boolean
  value?: boolean
}

export function Switch({ 
  blockId, 
  subBlockId, 
  title, 
  isPreview = false,
  value: propValue 
}: SwitchProps) {
  const [value, setValue] = useSubBlockValue(blockId, subBlockId, false, isPreview, propValue)

  // Log when in preview mode to verify it's working
  useEffect(() => {
    if (isPreview) {
      logger.info(`[PREVIEW] Switch for ${blockId}:${subBlockId}`, {
        isPreview,
        propValue,
        value
      });
    }
  }, [isPreview, propValue, value, blockId, subBlockId]);

  return (
    <div className='flex flex-col gap-2'>
      <Label className='font-medium text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'>
        {title}
      </Label>
      <UISwitch checked={Boolean(value)} onCheckedChange={(checked) => setValue(checked)} />
    </div>
  )
}
