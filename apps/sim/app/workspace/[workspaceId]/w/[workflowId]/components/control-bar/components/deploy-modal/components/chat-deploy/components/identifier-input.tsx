import { useEffect } from 'react'
import { Input, Label } from '@/components/ui'
import { getEmailDomain } from '@/lib/urls/utils'
import { cn } from '@/lib/utils'
import { useIdentifierValidation } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components/deploy-modal/components/chat-deploy/hooks/use-identifier-validation'

interface IdentifierInputProps {
  value: string
  onChange: (value: string) => void
  originalIdentifier?: string
  disabled?: boolean
  onValidationChange?: (isValid: boolean) => void
  isEditingExisting?: boolean
}

const getDomainPrefix = (() => {
  const prefix = `${getEmailDomain()}/chat/`
  return () => prefix
})()

export function IdentifierInput({
  value,
  onChange,
  originalIdentifier,
  disabled = false,
  onValidationChange,
  isEditingExisting = false,
}: IdentifierInputProps) {
  const { isChecking, error, isValid } = useIdentifierValidation(
    value,
    originalIdentifier,
    isEditingExisting
  )

  // Notify parent of validation changes
  useEffect(() => {
    onValidationChange?.(isValid)
  }, [isValid, onValidationChange])

  const handleChange = (newValue: string) => {
    const lowercaseValue = newValue.toLowerCase()
    onChange(lowercaseValue)
  }

  return (
    <div className='space-y-2'>
      <Label htmlFor='identifier' className='font-medium text-sm'>
        Identifier
      </Label>
      <div className='relative flex items-center rounded-md ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2'>
        <div className='flex h-10 items-center whitespace-nowrap rounded-l-md border border-r-0 bg-muted px-3 font-medium text-muted-foreground text-sm'>
          {getDomainPrefix()}
        </div>
        <div className='relative flex-1'>
          <Input
            id='identifier'
            placeholder='company-name'
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            required
            disabled={disabled}
            className={cn(
              'rounded-l-none border-l-0 focus-visible:ring-0 focus-visible:ring-offset-0',
              isChecking && 'pr-8',
              error && 'border-destructive focus-visible:border-destructive'
            )}
          />
          {isChecking && (
            <div className='-translate-y-1/2 absolute top-1/2 right-2'>
              <div className='h-[18px] w-[18px] animate-spin rounded-full border-2 border-gray-300 border-t-[var(--brand-primary-hex)]' />
            </div>
          )}
        </div>
      </div>
      {error && <p className='mt-1 text-destructive text-sm'>{error}</p>}
    </div>
  )
}
