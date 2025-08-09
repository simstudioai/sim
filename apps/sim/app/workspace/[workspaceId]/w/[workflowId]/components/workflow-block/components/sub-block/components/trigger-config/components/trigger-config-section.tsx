import { useState } from 'react'
import { Check, ChevronDown, Copy, Eye, EyeOff, Info } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { TriggerConfig } from '@/triggers/types'

interface TriggerConfigSectionProps {
  triggerDef: TriggerConfig
  config: Record<string, any>
  onChange: (fieldId: string, value: any) => void
  webhookUrl: string
  dynamicOptions?: Record<string, Array<{ id: string; name: string }> | string[]>
}

export function TriggerConfigSection({
  triggerDef,
  config,
  onChange,
  webhookUrl,
  dynamicOptions = {},
}: TriggerConfigSectionProps) {
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState<string | null>(null)

  const copyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text)
    setCopied(type)
    setTimeout(() => setCopied(null), 2000)
  }

  const toggleSecretVisibility = (fieldId: string) => {
    setShowSecrets((prev) => ({
      ...prev,
      [fieldId]: !prev[fieldId],
    }))
  }

  const renderField = (fieldId: string, fieldDef: any) => {
    const value = config[fieldId] ?? fieldDef.defaultValue ?? ''
    const isSecret = fieldDef.isSecret
    const showSecret = showSecrets[fieldId]

    switch (fieldDef.type) {
      case 'boolean':
        return (
          <div className='flex items-center space-x-2'>
            <Switch
              id={fieldId}
              checked={value}
              onCheckedChange={(checked) => onChange(fieldId, checked)}
            />
            <Label htmlFor={fieldId}>{fieldDef.label}</Label>
          </div>
        )

      case 'select':
        return (
          <div className='space-y-2'>
            <Label htmlFor={fieldId}>
              {fieldDef.label}
              {fieldDef.required && <span className='ml-1 text-red-500'>*</span>}
            </Label>
            <Select value={value} onValueChange={(value) => onChange(fieldId, value)}>
              <SelectTrigger>
                <SelectValue placeholder={fieldDef.placeholder} />
              </SelectTrigger>
              <SelectContent>
                {fieldDef.options?.map((option: string) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldDef.description && (
              <p className='text-muted-foreground text-sm'>{fieldDef.description}</p>
            )}
          </div>
        )

      case 'multiselect': {
        const selectedValues = Array.isArray(value) ? value : []
        const rawOptions = dynamicOptions[fieldId] || fieldDef.options || []

        // Handle both string[] and {id, name}[] formats
        const availableOptions = rawOptions.map((option: any) => {
          if (typeof option === 'string') {
            return { id: option, name: option }
          }
          return option
        })

        // Create a map for quick lookup of display names
        const optionMap = new Map(availableOptions.map((opt: any) => [opt.id, opt.name]))

        return (
          <div className='space-y-2'>
            <Label htmlFor={fieldId}>
              {fieldDef.label}
              {fieldDef.required && <span className='ml-1 text-red-500'>*</span>}
            </Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant='outline'
                  role='combobox'
                  className='h-10 w-full justify-between text-left font-normal'
                >
                  <div className='flex w-full items-center justify-between'>
                    {selectedValues.length > 0 ? (
                      <div className='flex flex-wrap gap-1'>
                        {selectedValues.slice(0, 2).map((selectedValue: string) => (
                          <Badge key={selectedValue} variant='secondary' className='text-xs'>
                            {optionMap.get(selectedValue) || selectedValue}
                          </Badge>
                        ))}
                        {selectedValues.length > 2 && (
                          <Badge variant='secondary' className='text-xs'>
                            +{selectedValues.length - 2} more
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className='text-muted-foreground'>{fieldDef.placeholder}</span>
                    )}
                    <ChevronDown className='h-4 w-4 opacity-50' />
                  </div>
                </Button>
              </PopoverTrigger>
              <PopoverContent className='w-[400px] p-0' align='start'>
                <Command>
                  <CommandInput placeholder={`Search ${fieldDef.label.toLowerCase()}...`} />
                  <CommandList className='max-h-[200px] overflow-y-auto'>
                    <CommandEmpty>
                      {availableOptions.length === 0
                        ? 'No options available. Please select credentials first.'
                        : 'No options found.'}
                    </CommandEmpty>
                    <CommandGroup>
                      {availableOptions.map((option: any) => (
                        <CommandItem
                          key={option.id}
                          value={option.id}
                          onSelect={() => {
                            const newValues = selectedValues.includes(option.id)
                              ? selectedValues.filter((v: string) => v !== option.id)
                              : [...selectedValues, option.id]
                            onChange(fieldId, newValues)
                          }}
                        >
                          <Check
                            className={cn(
                              'mr-2 h-4 w-4',
                              selectedValues.includes(option.id) ? 'opacity-100' : 'opacity-0'
                            )}
                          />
                          {option.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {fieldDef.description && (
              <p className='text-muted-foreground text-sm'>{fieldDef.description}</p>
            )}
          </div>
        )
      }

      case 'number':
        return (
          <div className='space-y-2'>
            <Label htmlFor={fieldId}>
              {fieldDef.label}
              {fieldDef.required && <span className='ml-1 text-red-500'>*</span>}
            </Label>
            <Input
              id={fieldId}
              type='number'
              placeholder={fieldDef.placeholder}
              value={value}
              onChange={(e) => onChange(fieldId, Number(e.target.value))}
            />
            {fieldDef.description && (
              <p className='text-muted-foreground text-sm'>{fieldDef.description}</p>
            )}
          </div>
        )

      default: // string
        return (
          <div className='mb-4 space-y-1'>
            <div className='flex items-center gap-2'>
              <Label htmlFor={fieldId} className='font-medium text-sm'>
                {fieldDef.label}
                {fieldDef.required && <span className='ml-1 text-red-500'>*</span>}
              </Label>
              {fieldDef.description && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant='ghost'
                      size='sm'
                      className='h-6 w-6 p-1 text-gray-500'
                      aria-label={`Learn more about ${fieldDef.label}`}
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
                    <p className='text-sm'>{fieldDef.description}</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <div className='flex'>
              <div className='relative flex-1'>
                <Input
                  id={fieldId}
                  type={isSecret && !showSecret ? 'password' : 'text'}
                  placeholder={fieldDef.placeholder}
                  value={value}
                  onChange={(e) => onChange(fieldId, e.target.value)}
                  className={cn(
                    'h-10 flex-1',
                    isSecret ? 'pr-10' : '',
                    'focus-visible:ring-2 focus-visible:ring-primary/20'
                  )}
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
                    onClick={() => toggleSecretVisibility(fieldId)}
                    aria-label={showSecret ? 'Hide secret' : 'Show secret'}
                  >
                    {showSecret ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
                    <span className='sr-only'>{showSecret ? 'Hide secret' : 'Show secret'}</span>
                  </Button>
                )}
              </div>
              {isSecret && (
                <Button
                  type='button'
                  size='icon'
                  variant='outline'
                  className={cn('ml-2 h-10 w-10', 'hover:bg-primary/5', 'transition-colors')}
                  onClick={() => copyToClipboard(value, fieldId)}
                  disabled={!value}
                >
                  {copied === fieldId ? (
                    <Check className='h-4 w-4 text-green-500' />
                  ) : (
                    <Copy className='h-4 w-4' />
                  )}
                </Button>
              )}
            </div>
          </div>
        )
    }
  }

  return (
    <div className='space-y-4 rounded-md border border-border bg-card p-4 shadow-sm'>
      {webhookUrl && (
        <div className='mb-4 space-y-1'>
          <div className='flex items-center gap-2'>
            <Label className='font-medium text-sm'>Webhook URL</Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-6 w-6 p-1 text-gray-500'
                    aria-label='Learn more about Webhook URL'
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
                  <p className='text-sm'>This is the URL that will receive webhook requests</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className='flex'>
            <div className='relative flex-1'>
              <Input
                value={webhookUrl}
                readOnly
                className={cn(
                  'h-10 flex-1 cursor-text font-mono text-xs',
                  'focus-visible:ring-2 focus-visible:ring-primary/20'
                )}
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
            </div>
            <Button
              type='button'
              size='icon'
              variant='outline'
              className={cn('ml-2 h-10 w-10', 'hover:bg-primary/5', 'transition-colors')}
              onClick={() => copyToClipboard(webhookUrl, 'url')}
            >
              {copied === 'url' ? (
                <Check className='h-4 w-4 text-green-500' />
              ) : (
                <Copy className='h-4 w-4' />
              )}
            </Button>
          </div>
        </div>
      )}

      {Object.entries(triggerDef.configFields).map(([fieldId, fieldDef]) => (
        <div key={fieldId}>{renderField(fieldId, fieldDef)}</div>
      ))}
    </div>
  )
}
