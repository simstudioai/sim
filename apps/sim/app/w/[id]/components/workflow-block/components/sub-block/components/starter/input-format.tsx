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
  value?: InputField[]
}

// Default values
const DEFAULT_FIELD: InputField = {
  id: crypto.randomUUID(),
  name: '',
  type: 'string',
  collapsed: true,
}

export function InputFormat({ blockId, subBlockId, isPreview = false, value: propValue }: InputFormatProps) {
  // State hooks
  const [value, setValue] = useSubBlockValue<InputField[]>(blockId, subBlockId, false, isPreview, propValue)
  const fields = value || [DEFAULT_FIELD]

  // Field operations
  const addField = () => {
    const newField: InputField = {
      ...DEFAULT_FIELD,
      id: crypto.randomUUID(),
    }
    setValue([...fields, newField])
  }

  const removeField = (id: string) => {
    if (fields.length === 1) return
    setValue(fields.filter((field) => field.id !== id))
  }

  // Update handlers
  const updateField = (id: string, field: keyof InputField, value: any) => {
    setValue(fields.map((f) => (f.id === id ? { ...f, [field]: value } : f)))
  }

  const toggleCollapse = (id: string) => {
    setValue(fields.map((f) => (f.id === id ? { ...f, collapsed: !f.collapsed } : f)))
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
          <Button variant='ghost' size='icon' onClick={addField} className='h-6 w-6 rounded-full'>
            <Plus className='h-3.5 w-3.5' />
            <span className='sr-only'>Add Field</span>
          </Button>

          <Button
            variant='ghost'
            size='icon'
            onClick={() => removeField(field.id)}
            disabled={fields.length === 1}
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
      {fields.map((field, index) => {
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
                    className='h-9 placeholder:text-muted-foreground/50'
                  />
                </div>

                <div className='space-y-1.5'>
                  <Label className='text-xs'>Type</Label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant='outline' className='h-9 w-full justify-between font-normal'>
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
      })}

      {!hasConfiguredFields && (
        <div className='mt-1 px-1 text-muted-foreground/70 text-xs italic'>
          Define fields above to enable structured API input
        </div>
      )}
    </div>
  )
}
