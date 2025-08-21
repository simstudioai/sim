import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Plus, Trash } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'

interface Field {
  id: string
  name: string
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array'
  value?: string
  collapsed?: boolean
}

interface FieldFormatProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: Field[] | null
  disabled?: boolean
  title?: string
  placeholder?: string
  emptyMessage?: string
  showType?: boolean
  showValue?: boolean
  valuePlaceholder?: string
  isConnecting?: boolean
  config?: any
}

// Default values
const DEFAULT_FIELD: Field = {
  id: crypto.randomUUID(),
  name: '',
  type: 'string',
  value: '',
  collapsed: false,
}

export function FieldFormat({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
  title = 'Field',
  placeholder = 'fieldName',
  emptyMessage = 'No fields defined',
  showType = true,
  showValue = false,
  valuePlaceholder = 'Enter test value',
  isConnecting = false,
  config,
}: FieldFormatProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<Field[]>(blockId, subBlockId)
  const [dragHighlight, setDragHighlight] = useState<Record<string, boolean>>({})
  const valueInputRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement>>({})
  const [localValues, setLocalValues] = useState<Record<string, string>>({})

  // Use preview value when in preview mode, otherwise use store value
  const value = isPreview ? previewValue : storeValue
  const fields: Field[] = value || []

  useEffect(() => {
    const initial: Record<string, string> = {}
    ;(fields || []).forEach((f) => {
      if (localValues[f.id] === undefined) {
        initial[f.id] = (f.value as string) || ''
      }
    })
    if (Object.keys(initial).length > 0) {
      setLocalValues((prev) => ({ ...prev, ...initial }))
    }
  }, [fields])

  // Field operations
  const addField = () => {
    if (isPreview || disabled) return

    const newField: Field = {
      ...DEFAULT_FIELD,
      id: crypto.randomUUID(),
    }
    setStoreValue([...(fields || []), newField])
  }

  const removeField = (id: string) => {
    if (isPreview || disabled) return
    setStoreValue((fields || []).filter((field: Field) => field.id !== id))
  }

  // Validate field name for API safety
  const validateFieldName = (name: string): string => {
    // Remove only truly problematic characters for JSON/API usage
    // Allow most characters but remove control characters, quotes, and backslashes
    return name.replace(/[\x00-\x1F"\\]/g, '').trim()
  }

  const handleValueInputChange = (fieldId: string, newValue: string) => {
    setLocalValues((prev) => ({ ...prev, [fieldId]: newValue }))
  }

  // Value normalization: keep it simple for string types

  const handleValueInputBlur = (field: Field) => {
    if (isPreview || disabled) return

    const inputEl = valueInputRefs.current[field.id]
    if (!inputEl) return

    const current = localValues[field.id] ?? inputEl.value ?? ''
    const trimmed = current.trim()
    if (!trimmed) return
    updateField(field.id, 'value', current)
  }

  // Drag and drop handlers for connection blocks
  const handleDragOver = (e: React.DragEvent, fieldId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragHighlight((prev) => ({ ...prev, [fieldId]: true }))
  }

  const handleDragLeave = (e: React.DragEvent, fieldId: string) => {
    e.preventDefault()
    setDragHighlight((prev) => ({ ...prev, [fieldId]: false }))
  }

  const handleDrop = (e: React.DragEvent, fieldId: string) => {
    e.preventDefault()
    setDragHighlight((prev) => ({ ...prev, [fieldId]: false }))
    const input = valueInputRefs.current[fieldId]
    input?.focus()
  }

  // Update handlers
  const updateField = (id: string, field: keyof Field, value: any) => {
    if (isPreview || disabled) return

    // Validate field name if it's being updated
    if (field === 'name' && typeof value === 'string') {
      value = validateFieldName(value)
    }

    setStoreValue((fields || []).map((f: Field) => (f.id === id ? { ...f, [field]: value } : f)))
  }

  const toggleCollapse = (id: string) => {
    if (isPreview || disabled) return
    setStoreValue(
      (fields || []).map((f: Field) => (f.id === id ? { ...f, collapsed: !f.collapsed } : f))
    )
  }

  // Field header
  const renderFieldHeader = (field: Field, index: number) => {
    const isUnconfigured = !field.name || field.name.trim() === ''

    return (
      <div
        className='flex h-9 cursor-pointer items-center justify-between px-3 py-1'
        onClick={() => toggleCollapse(field.id)}
      >
        <div className='flex items-center'>
          <span
            className={cn(
              'text-sm',
              isUnconfigured ? 'text-muted-foreground/50' : 'text-foreground'
            )}
          >
            {field.name ? field.name : `${title} ${index + 1}`}
          </span>
          {field.name && showType && (
            <Badge variant='outline' className='ml-2 h-5 bg-muted py-0 font-normal text-xs'>
              {field.type}
            </Badge>
          )}
        </div>
        <div className='flex items-center gap-1' onClick={(e) => e.stopPropagation()}>
          <Button
            variant='ghost'
            size='icon'
            onClick={addField}
            disabled={isPreview || disabled}
            className='h-6 w-6 rounded-full'
          >
            <Plus className='h-3.5 w-3.5' />
            <span className='sr-only'>Add {title}</span>
          </Button>

          <Button
            variant='ghost'
            size='icon'
            onClick={() => removeField(field.id)}
            disabled={isPreview || disabled}
            className='h-6 w-6 rounded-full text-destructive hover:text-destructive'
          >
            <Trash className='h-3.5 w-3.5' />
            <span className='sr-only'>Delete Field</span>
          </Button>
        </div>
      </div>
    )
  }

  // Main render
  return (
    <div className='space-y-2'>
      {fields.length === 0 ? (
        <div className='flex flex-col items-center justify-center rounded-md border border-input/50 border-dashed py-8'>
          <p className='mb-3 text-muted-foreground text-sm'>{emptyMessage}</p>
          <Button
            variant='outline'
            size='sm'
            onClick={addField}
            disabled={isPreview || disabled}
            className='h-8'
          >
            <Plus className='mr-1.5 h-3.5 w-3.5' />
            Add {title}
          </Button>
        </div>
      ) : (
        fields.map((field, index) => {
          const isUnconfigured = !field.name || field.name.trim() === ''

          return (
            <div
              key={field.id}
              data-field-id={field.id}
              className={cn(
                'rounded-md border shadow-sm',
                isUnconfigured ? 'border-input/50' : 'border-input',
                field.collapsed ? 'overflow-hidden' : 'overflow-visible'
              )}
            >
              {renderFieldHeader(field, index)}

              {!field.collapsed && (
                <div className='space-y-2 border-t px-3 pt-1.5 pb-2'>
                  <div className='space-y-1.5'>
                    <Label className='text-xs'>Name</Label>
                    <Input
                      name='name'
                      value={field.name}
                      onChange={(e) => updateField(field.id, 'name', e.target.value)}
                      placeholder={placeholder}
                      disabled={isPreview || disabled}
                      className='h-9 placeholder:text-muted-foreground/50'
                    />
                  </div>

                  {showType && (
                    <div className='space-y-1.5'>
                      <Label className='text-xs'>Type</Label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant='outline'
                            disabled={isPreview || disabled}
                            className='h-9 w-full justify-between font-normal'
                          >
                            <div className='flex items-center'>
                              <span>{field.type}</span>
                            </div>
                            <ChevronDown className='h-4 w-4 opacity-50' />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align='end' className='w-[200px]'>
                          <DropdownMenuItem
                            onClick={() => updateField(field.id, 'type', 'string')}
                            className='cursor-pointer'
                          >
                            <span className='mr-2 font-mono'>Aa</span>
                            <span>String</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => updateField(field.id, 'type', 'number')}
                            className='cursor-pointer'
                          >
                            <span className='mr-2 font-mono'>123</span>
                            <span>Number</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => updateField(field.id, 'type', 'boolean')}
                            className='cursor-pointer'
                          >
                            <span className='mr-2 font-mono'>0/1</span>
                            <span>Boolean</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => updateField(field.id, 'type', 'object')}
                            className='cursor-pointer'
                          >
                            <span className='mr-2 font-mono'>{'{}'}</span>
                            <span>Object</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => updateField(field.id, 'type', 'array')}
                            className='cursor-pointer'
                          >
                            <span className='mr-2 font-mono'>[]</span>
                            <span>Array</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}

                  {showValue && (
                    <div className='space-y-1.5'>
                      <Label className='text-xs'>Value</Label>
                      <div className='relative'>
                        {field.type === 'boolean' ? (
                          <Select
                            value={localValues[field.id] ?? (field.value as string) ?? ''}
                            onValueChange={(v) => {
                              setLocalValues((prev) => ({ ...prev, [field.id]: v }))
                              if (!isPreview && !disabled) updateField(field.id, 'value', v)
                            }}
                          >
                            <SelectTrigger className='h-9 w-full justify-between font-normal'>
                              <SelectValue placeholder='Select value' className='truncate' />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value='true'>true</SelectItem>
                              <SelectItem value='false'>false</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : field.type === 'object' || field.type === 'array' ? (
                          <Textarea
                            ref={(el) => {
                              if (el) valueInputRefs.current[field.id] = el
                            }}
                            name='value'
                            value={localValues[field.id] ?? (field.value as string) ?? ''}
                            onChange={(e) => handleValueInputChange(field.id, e.target.value)}
                            onBlur={() => handleValueInputBlur(field)}
                            placeholder={
                              field.type === 'object' ? '{\n  "key": "value"\n}' : '[\n  1, 2, 3\n]'
                            }
                            disabled={isPreview || disabled}
                            className={cn(
                              'min-h-[120px] font-mono text-sm placeholder:text-muted-foreground/50',
                              dragHighlight[field.id] && 'ring-2 ring-blue-500 ring-offset-2',
                              isConnecting &&
                                config?.connectionDroppable !== false &&
                                'ring-2 ring-blue-500 ring-offset-2 focus-visible:ring-blue-500'
                            )}
                          />
                        ) : (
                          <Input
                            ref={(el) => {
                              if (el) valueInputRefs.current[field.id] = el
                            }}
                            name='value'
                            value={localValues[field.id] ?? field.value ?? ''}
                            onChange={(e) => handleValueInputChange(field.id, e.target.value)}
                            onBlur={() => handleValueInputBlur(field)}
                            onDragOver={(e) => handleDragOver(e, field.id)}
                            onDragLeave={(e) => handleDragLeave(e, field.id)}
                            onDrop={(e) => handleDrop(e, field.id)}
                            placeholder={valuePlaceholder}
                            disabled={isPreview || disabled}
                            className={cn(
                              'h-9 placeholder:text-muted-foreground/50',
                              dragHighlight[field.id] && 'ring-2 ring-blue-500 ring-offset-2',
                              isConnecting &&
                                config?.connectionDroppable !== false &&
                                'ring-2 ring-blue-500 ring-offset-2 focus-visible:ring-blue-500'
                            )}
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

// Export specific components for backward compatibility
export function InputFormat(
  props: Omit<FieldFormatProps, 'title' | 'placeholder' | 'emptyMessage'>
) {
  return (
    <FieldFormat
      {...props}
      title='Field'
      placeholder='firstName'
      emptyMessage='No input fields defined'
    />
  )
}

export function ResponseFormat(
  props: Omit<
    FieldFormatProps,
    'title' | 'placeholder' | 'emptyMessage' | 'showType' | 'showValue' | 'valuePlaceholder'
  >
) {
  return (
    <FieldFormat
      {...props}
      title='Field'
      placeholder='output'
      emptyMessage='No response fields defined'
      showType={false}
      showValue={true}
      valuePlaceholder='Enter test value'
    />
  )
}

export type { Field as InputField, Field as ResponseField }
