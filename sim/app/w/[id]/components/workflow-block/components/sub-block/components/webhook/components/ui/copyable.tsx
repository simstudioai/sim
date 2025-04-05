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
    <div className="flex items-center space-x-2">
      {isLoading ? (
        <div className="flex-1 h-10 px-3 py-2 rounded-md border border-input bg-background flex items-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="flex-1 relative">
          <Input
            id={id}
            type={isSecret && !showSecret ? 'password' : 'text'}
            value={value}
            onChange={onChange ? (e) => onChange(e.target.value) : undefined}
            placeholder={placeholder}
            className={cn('flex-1', isSecret ? 'pr-10' : '')}
            readOnly={readOnly}
          />
          {isSecret && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 text-muted-foreground"
              onClick={toggleShowSecret}
              aria-label={showSecret ? 'Hide secret' : 'Show secret'}
            >
              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              <span className="sr-only">{showSecret ? 'Hide secret' : 'Show secret'}</span>
            </Button>
          )}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => copyToClipboard(value, copyType)}
        disabled={isLoading || !value}
        className="shrink-0"
        aria-label="Copy value"
      >
        {copied === copyType ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  )
}
