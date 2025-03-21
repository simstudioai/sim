import { Check, Copy, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface CopyableFieldProps {
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
}

export function CopyableField({
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
}: CopyableFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center space-x-2">
        {isLoading ? (
          <div className="flex-1 h-10 px-3 py-2 rounded-md border border-input bg-background flex items-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Input
            id={id}
            value={value}
            onChange={onChange ? (e) => onChange(e.target.value) : undefined}
            placeholder={placeholder}
            className="flex-1"
            readOnly={readOnly}
          />
        )}
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => copyToClipboard(value, copyType)}
          disabled={isLoading || !value}
        >
          {copied === copyType ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  )
}
