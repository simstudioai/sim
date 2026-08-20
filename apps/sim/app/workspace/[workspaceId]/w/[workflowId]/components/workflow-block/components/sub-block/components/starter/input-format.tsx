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
import { cn } from '@/lib/utils'
import { useSubBlockValue } from '../../hooks/use-sub-block-value'

interface InputField {
  id: string
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  collapsed?: boolean
}

interface InputFormatProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: InputField[] | null
  disabled?: boolean
}

// Default values
const DEFAULT_FIELD: InputField = {
  id: crypto.randomUUID(),
  name: '',
  type: 'string',
  collapsed: true,
}

export function InputFormat({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
}: InputFormatProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<InputField[]>(blockId, subBlockId)

  // Use preview value when in preview mode, otherwise use store value
  const value = isPreview ? previewValue : storeValue
  const fields: InputField[] = value || []

  // Field operations
  const addField = () => {
    if (isPreview || disabled) return

    const newField: InputField = {
      ...DEFAULT_FIELD,
      id: crypto.randomUUID(),
    }
    setStoreValue([...fields, newField])
  }

  const removeField = (id: string) => {
    if (isPreview || disabled) return
    setStoreValue(fields.filter((field: InputField) => field.id !== id))
  }

  // Update handlers
  const updateField = (id: string, field: keyof InputField, value: any) => {
    if (isPreview || disabled) return
    setStoreValue(fields.map((f: InputField) => (f.id === id ? { ...f, [field]: value } : f)))
  }

  const toggleCollapse = (id: string) => {
    if (isPreview || disabled) return
    setStoreValue(
      fields.map((f: InputField) => (f.id === id ? { ...f, collapsed: !f.collapsed } : f))
    )
  }

  // Field header
  const renderFieldHeader = (field: InputField, index: number) => {
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
            {field.name ? field.name : `Field ${index + 1}`}
          </span>
          {field.name && (
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
            <span className='sr-only'>Add Field</span>
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

  // Check if any fields have been configured
  const hasConfiguredFields = fields.some((field) => field.name && field.name.trim() !== '')

  // Main render
  return (
    <div className='space-y-2'>
      {fields.length === 0 ? (
        <div className='flex flex-col items-center justify-center rounded-md border border-input/50 border-dashed py-8'>
          <p className='mb-3 text-muted-foreground text-sm'>No input fields defined</p>
          <Button
            variant='outline'
            size='sm'
            onClick={addField}
            disabled={isPreview || disabled}
            className='h-8'
          >
            <Plus className='mr-1.5 h-3.5 w-3.5' />
            Add Field
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
                      placeholder='firstName'
                      disabled={isPreview || disabled}
                      className='h-9 placeholder:text-muted-foreground/50'
                    />
                  </div>

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
                </div>
              )}
            </div>
          )
        })
      )}

      {fields.length > 0 && !hasConfiguredFields && (
        <div className='mt-1 px-1 text-muted-foreground/70 text-xs italic'>
          Define fields above to enable structured API input
        </div>
      )}
    </div>
  )
}
