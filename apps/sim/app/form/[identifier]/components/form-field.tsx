'use client'

import { useCallback, useRef, useState } from 'react'
import { Upload, X } from 'lucide-react'
import { Input, Label, Switch, Textarea } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
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
  required?: boolean
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FormField({
  field,
  value,
  onChange,
  primaryColor,
  label,
  description,
  required,
}: FormFieldProps) {
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const formatLabel = (name: string) => {
    return name
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/^./, (str) => str.toUpperCase())
      .trim()
  }

  const displayLabel = label || formatLabel(field.name)
  const placeholder = description || field.description || ''
  const isRequired = required ?? field.required

  const handleFileDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) {
        onChange(files)
      }
    },
    [onChange]
  )

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || [])
      if (files.length > 0) {
        onChange(files)
      }
    },
    [onChange]
  )

  const removeFile = useCallback(
    (index: number) => {
      if (Array.isArray(value)) {
        const newFiles = value.filter((_, i) => i !== index)
        onChange(newFiles.length > 0 ? newFiles : undefined)
      }
    },
    [value, onChange]
  )

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
            placeholder={placeholder || 'Enter a number'}
            className='rounded-[10px] shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100'
          />
        )

      case 'object':
      case 'array':
        return (
          <Textarea
            value={(value as string) ?? ''}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
            placeholder={
              placeholder || (field.type === 'array' ? '["item1", "item2"]' : '{"key": "value"}')
            }
            className='min-h-[100px] rounded-[10px] font-mono text-[13px] shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100'
          />
        )

      case 'files': {
        const files = Array.isArray(value) ? (value as File[]) : []
        return (
          <div className='space-y-3'>
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center rounded-[10px] border-2 border-dashed px-6 py-8 transition-colors',
                isDragging
                  ? 'border-[var(--brand-primary-hex)] bg-[var(--brand-primary-hex)]/5'
                  : 'border-border hover:border-muted-foreground/50'
              )}
            >
              <input
                ref={fileInputRef}
                type='file'
                multiple
                onChange={handleFileChange}
                className='hidden'
              />
              <Upload
                className='mb-2 h-6 w-6 text-muted-foreground'
                style={isDragging ? { color: primaryColor } : undefined}
              />
              <p className={`${inter.className} text-center text-[14px] text-muted-foreground`}>
                <span style={{ color: primaryColor }} className='font-medium'>
                  Click to upload
                </span>{' '}
                or drag and drop
              </p>
            </div>

            {files.length > 0 && (
              <div className='space-y-2'>
                {files.map((file, idx) => (
                  <div
                    key={idx}
                    className='flex items-center justify-between rounded-[8px] border border-border bg-muted/30 px-3 py-2'
                  >
                    <div className='min-w-0 flex-1'>
                      <p
                        className={`${inter.className} truncate font-medium text-[13px] text-foreground`}
                      >
                        {file.name}
                      </p>
                      <p className={`${inter.className} text-[12px] text-muted-foreground`}>
                        {formatFileSize(file.size)}
                      </p>
                    </div>
                    <button
                      type='button'
                      onClick={(e) => {
                        e.stopPropagation()
                        removeFile(idx)
                      }}
                      className='ml-2 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                    >
                      <X className='h-4 w-4' />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      }

      default:
        return (
          <Input
            type='text'
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder || 'Enter text'}
            className='rounded-[10px] shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100'
          />
        )
    }
  }

  return (
    <div className='space-y-2'>
      <Label className={`${inter.className} font-medium text-[14px] text-foreground`}>
        {displayLabel}
        {isRequired && <span className='ml-0.5 text-[var(--text-error)]'>*</span>}
      </Label>
      {renderInput()}
    </div>
  )
}
