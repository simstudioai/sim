'use client'

import { useCallback, useState } from 'react'
import { Input, Label, Switch, Textarea } from '@/components/emcn'
import { inter } from '@/app/_styles/fonts/inter/inter'

interface InputField {
  name: string
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'files'
  description?: string
  value?: unknown
  required?: boolean
}

interface FormFieldProps {
  field: InputField
  value: unknown
  onChange: (value: unknown) => void
  primaryColor?: string
  label?: string
  description?: string
}

export function FormField({
  field,
  value,
  onChange,
  primaryColor,
  label,
  description,
}: FormFieldProps) {
  const [jsonError, setJsonError] = useState<string | null>(null)

  const handleJsonChange = useCallback(
    (text: string) => {
      try {
        if (text.trim() === '') {
          onChange(field.type === 'array' ? [] : {})
          setJsonError(null)
          return
        }
        const parsed = JSON.parse(text)
        onChange(parsed)
        setJsonError(null)
      } catch {
        setJsonError('Invalid JSON')
        onChange(text)
      }
    },
    [field.type, onChange]
  )

  const formatLabel = (name: string) => {
    return name
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/^./, (str) => str.toUpperCase())
      .trim()
  }

  // Use custom label/description if provided, otherwise fall back to field values
  const displayLabel = label || formatLabel(field.name)
  // Use description as placeholder
  const placeholder = description || field.description || ''

  const renderInput = () => {
    switch (field.type) {
      case 'boolean':
        return (
          <div className='flex items-center gap-3'>
            <Switch
              checked={Boolean(value)}
              onCheckedChange={onChange}
              style={value ? { backgroundColor: primaryColor } : undefined}
            />
            <span className={`${inter.className} text-[14px] text-muted-foreground`}>
              {value ? 'Yes' : 'No'}
            </span>
          </div>
        )

      case 'number':
        return (
          <Input
            type='number'
            value={(value as string) ?? ''}
            onChange={(e) => {
              const val = e.target.value
              onChange(val === '' ? '' : Number(val))
            }}
            placeholder={placeholder}
          />
        )

      case 'object':
      case 'array': {
        const displayValue = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
        return (
          <div>
            <Textarea
              value={displayValue}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                handleJsonChange(e.target.value)
              }
              placeholder={
                placeholder || (field.type === 'array' ? '["item1", "item2"]' : '{"key": "value"}')
              }
              className={`min-h-[100px] font-mono ${jsonError ? 'border-red-300' : ''}`}
            />
            {jsonError && (
              <p className={`${inter.className} mt-1 text-[14px] text-red-500`}>{jsonError}</p>
            )}
          </div>
        )
      }

      case 'files':
        return (
          <div className='rounded-[10px] border-2 border-border border-dashed p-6 text-center'>
            <input
              type='file'
              multiple
              onChange={(e) => onChange(Array.from(e.target.files || []))}
              className='hidden'
              id={`file-${field.name}`}
            />
            <label
              htmlFor={`file-${field.name}`}
              className={`${inter.className} cursor-pointer text-[14px] text-muted-foreground`}
            >
              <span style={{ color: primaryColor }}>Click to upload</span> or drag and drop
            </label>
            {Array.isArray(value) && value.length > 0 && (
              <div className='mt-3 space-y-1'>
                {(value as File[]).map((file, idx) => (
                  <div key={idx} className={`${inter.className} text-[13px] text-muted-foreground`}>
                    {file.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        )

      default:
        return (
          <Input
            type='text'
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
          />
        )
    }
  }

  return (
    <div className='space-y-2'>
      <Label className={`${inter.className} font-medium text-[14px] text-foreground`}>
        {displayLabel}
        {field.required && <span className='ml-0.5 text-red-500'>*</span>}
      </Label>
      {renderInput()}
    </div>
  )
}
