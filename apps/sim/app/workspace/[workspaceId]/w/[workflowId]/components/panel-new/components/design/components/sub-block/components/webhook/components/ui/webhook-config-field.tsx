import { useState } from 'react'
import { Check, Copy, Eye, EyeOff, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface WebhookConfigFieldProps {
  id: string
  label: string
  value: string
  onChange?: (value: string) => void
  placeholder?: string
  description?: string
  isLoading?: boolean
  copied: string | null
  copyType: string
  copyToClipboard: (text: string, type: string) => void
  readOnly?: boolean
  isSecret?: boolean
  className?: string
}

export function WebhookConfigField({
  id,
  label,
  value,
  onChange,
  placeholder,
  description,
  isLoading = false,
  copied,
  copyType,
  copyToClipboard,
  readOnly = false,
  isSecret = false,
  className,
}: WebhookConfigFieldProps) {
  const [showSecret, setShowSecret] = useState(!isSecret)

  const toggleShowSecret = () => {
    if (isSecret) {
      setShowSecret(!showSecret)
    }
  }

  return (
    <div className={cn('mb-4 space-y-1', className)}>
      <div className='flex items-center gap-2'>
        <Label htmlFor={id} className='font-medium text-sm'>
          {label}
        </Label>
        {description && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='ghost'
                size='sm'
                className='h-6 w-6 p-1 text-gray-500'
                aria-label={`Learn more about ${label}`}
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
      <div className='flex'>
        <div className={cn('relative flex-1')}>
          <Input
            id={id}
            type={isSecret && !showSecret ? 'password' : 'text'}
            value={value}
            onChange={onChange ? (e) => onChange(e.target.value) : undefined}
            placeholder={placeholder}
            className={cn(
              'h-10 flex-1',
              readOnly ? 'cursor-text font-mono text-xs' : '',
              isSecret ? 'pr-10' : '',
              'focus-visible:ring-2 focus-visible:ring-primary/20'
            )}
            onClick={readOnly ? (e) => (e.target as HTMLInputElement).select() : undefined}
            readOnly={readOnly}
            disabled={isLoading}
          />
          {isSecret && (
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className={cn(
                '-translate-y-1/2 absolute top-1/2 right-1 h-6 w-6 text-muted-foreground',
                'transition-colors hover:bg-transparent hover:text-foreground'
              )}
              onClick={toggleShowSecret}
              aria-label={showSecret ? 'Hide secret' : 'Show secret'}
            >
              {showSecret ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
              <span className='sr-only'>{showSecret ? 'Hide secret' : 'Show secret'}</span>
            </Button>
          )}
        </div>
        <Button
          type='button'
          size='icon'
          variant='outline'
          className={cn('ml-2 h-10 w-10', 'hover:bg-primary/5', 'transition-colors')}
          onClick={() => copyToClipboard(value, copyType)}
          disabled={isLoading || !value}
        >
          {copied === copyType ? (
            <Check className='h-4 w-4 text-green-500' />
          ) : (
            <Copy className='h-4 w-4' />
          )}
        </Button>
      </div>
    </div>
  )
}
