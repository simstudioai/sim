import { useState } from 'react'
import { Check, Copy, Eye, EyeOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface CopyableFieldProps {
  id: string
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
}

export function CopyableField({
  id,
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
}: CopyableFieldProps) {
  const [showSecret, setShowSecret] = useState(!isSecret)

  const toggleShowSecret = () => {
    if (isSecret) {
      setShowSecret(!showSecret)
    }
  }

  return (
    <div className='flex items-center space-x-2'>
      {isLoading ? (
        <div className='flex h-10 flex-1 items-center rounded-md border border-input bg-background px-3 py-2'>
          <Loader2 className='h-4 w-4 animate-spin text-muted-foreground' />
        </div>
      ) : (
        <div className='relative flex-1'>
          <Input
            id={id}
            type={isSecret && !showSecret ? 'password' : 'text'}
            value={value}
            onChange={onChange ? (e) => onChange(e.target.value) : undefined}
            placeholder={placeholder}
            className={cn(
              'flex-1',
              isSecret ? 'pr-10' : '',
              'focus-visible:ring-2 focus-visible:ring-primary/20'
            )}
            readOnly={readOnly}
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
      )}
      <Button
        type='button'
        variant='outline'
        size='icon'
        onClick={() => copyToClipboard(value, copyType)}
        disabled={isLoading || !value}
        className={cn('shrink-0', 'transition-colors hover:bg-primary/5')}
        aria-label='Copy value'
      >
        {copied === copyType ? <Check className='h-4 w-4' /> : <Copy className='h-4 w-4' />}
      </Button>
    </div>
  )
}
