import { useState } from 'react'
import { CheckCheck, Copy, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
    <div className={cn('space-y-1 mb-4', className)}>
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      <div className="flex">
        <div className={cn('flex-1 relative')}>
          <Input
            id={id}
            type={isSecret && !showSecret ? 'password' : 'text'}
            value={value}
            onChange={onChange ? (e) => onChange(e.target.value) : undefined}
            placeholder={placeholder}
            className={cn(
              'flex-1 h-10',
              readOnly ? 'font-mono text-xs cursor-text' : '',
              isSecret ? 'pr-10' : '',
              'focus-visible:ring-2 focus-visible:ring-primary/20'
            )}
            onClick={readOnly ? (e) => (e.target as HTMLInputElement).select() : undefined}
            readOnly={readOnly}
            disabled={isLoading}
          />
          {isSecret && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                'absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 text-muted-foreground',
                'hover:text-foreground hover:bg-transparent transition-colors'
              )}
              onClick={toggleShowSecret}
              aria-label={showSecret ? 'Hide secret' : 'Show secret'}
            >
              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              <span className="sr-only">{showSecret ? 'Hide secret' : 'Show secret'}</span>
            </Button>
          )}
        </div>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className={cn('ml-2 h-10 w-10', 'hover:bg-primary/5', 'transition-colors')}
          onClick={() => copyToClipboard(value, copyType)}
          disabled={isLoading || !value}
        >
          {copied === copyType ? (
            <CheckCheck className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>
      {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
    </div>
  )
}
