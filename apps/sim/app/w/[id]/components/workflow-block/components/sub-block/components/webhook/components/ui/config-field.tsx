import type React from 'react'
import { Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface ConfigFieldProps {
  id: string
  label: React.ReactNode // Allow complex labels (e.g., with icons)
  description?: string
  children: React.ReactNode
  className?: string
}

export function ConfigField({ id, label, description, children, className }: ConfigFieldProps) {
  return (
    <div className={`space-y-2 ${className || ''}`}>
      <div className='flex items-center gap-2'>
        <Label htmlFor={id}>{label}</Label>
        {description && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='ghost'
                size='sm'
                className='h-6 w-6 p-1 text-gray-500'
                aria-label={`Learn more about ${label?.toString() || id}`}
              >
                <Info className='h-4 w-4' />
              </Button>
            </TooltipTrigger>
            <TooltipContent
              side='right'
              align='center'
              className='z-[100] max-w-[300px] p-3'
              role='tooltip'
            >
              <p className='text-sm'>{description}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      {children} {/* The actual input/select/checkbox goes here */}
    </div>
  )
}
