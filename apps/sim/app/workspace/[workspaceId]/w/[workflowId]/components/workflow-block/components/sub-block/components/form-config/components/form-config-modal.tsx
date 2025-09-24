'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, GripVertical, Plus, Trash, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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

interface FormField {
  id: string
  name: string
  label: string
  type: 'text' | 'email' | 'textarea' | 'number' | 'select' | 'checkbox'
  placeholder?: string
  required: boolean
  options?: string[] // For select fields
}

interface FormSettings {
  successMessage: string
  redirectUrl?: string
  submitButtonText: string
}

interface FormConfig {
  title: string
  description?: string
  fields: FormField[]
  settings: FormSettings
}

interface FormConfigModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (config: FormConfig) => Promise<void>
  initialConfig?: FormConfig
  isSaving: boolean
  formPath?: string
}

const defaultFormConfig: FormConfig = {
  title: '',
  description: '',
  fields: [
    {
      id: '1',
      name: '',
      label: '',
      type: 'text',
      placeholder: '',
      required: false,
    },
  ],
  settings: {
    successMessage: '',
    submitButtonText: '',
  },
}

// Helper components that match webhook modal styling
function ConfigField({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`space-y-2 ${className || ''}`}>
      <Label className='font-medium text-sm'>{label}</Label>
      {children}
    </div>
  )
}

function ConfigSection({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className='space-y-4 rounded-md border border-border bg-card p-4 shadow-sm'>
      {title && <h3 className='font-medium text-sm'>{title}</h3>}
      {children}
    </div>
  )
}

export function FormConfigModal({
  isOpen,
  onClose,
  onSave,
  initialConfig,
  isSaving,
  formPath,
}: FormConfigModalProps) {
  const [config, setConfig] = useState<FormConfig>(defaultFormConfig)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setConfig(initialConfig || defaultFormConfig)
    }
  }, [isOpen, initialConfig])

  const handleSave = async () => {
    await onSave(config)
  }

  const addField = () => {
    const newField: FormField = {
      id: Date.now().toString(),
      name: `field_${config.fields.length + 1}`,
      label: 'New Field',
      type: 'text',
      required: false,
    }
    setConfig({
      ...config,
      fields: [...config.fields, newField],
    })
  }

  const updateField = (id: string, updates: Partial<FormField>) => {
    setConfig({
      ...config,
      fields: config.fields.map((field) => (field.id === id ? { ...field, ...updates } : field)),
    })
  }

  const removeField = (id: string) => {
    setConfig({
      ...config,
      fields: config.fields.filter((field) => field.id !== id),
    })
  }

  const fieldTypes = [
    { value: 'text', label: 'Text' },
    { value: 'email', label: 'Email' },
    { value: 'textarea', label: 'Textarea' },
    { value: 'number', label: 'Number' },
    { value: 'select', label: 'Select' },
    { value: 'checkbox', label: 'Checkbox' },
  ]

  const formUrl =
    typeof window !== 'undefined' && formPath ? `${window.location.origin}/form/${formPath}` : ''

  const copyToClipboard = async () => {
    if (!formUrl) return
    try {
      await navigator.clipboard.writeText(formUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {}
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className='flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[720px]'
        hideCloseButton
      >
        <DialogHeader className='border-b px-6 py-4'>
          <div className='flex items-center justify-between'>
            <DialogTitle className='font-medium text-lg'>Configure Form</DialogTitle>
            <Button
              variant='ghost'
              size='icon'
              onClick={onClose}
              disabled={isSaving}
              className='h-8 w-8 p-0'
            >
              <X className='h-4 w-4' />
            </Button>
          </div>
        </DialogHeader>

        <div className='min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-6'>
          <div className='space-y-4'>
            {formUrl && (
              <div className='mb-2 space-y-1'>
                <Label htmlFor='form-url' className='font-medium text-sm'>
                  Form URL
                </Label>
                <div className='relative'>
                  <Input
                    id='form-url'
                    readOnly
                    value={formUrl}
                    className={cn(
                      'h-9 cursor-text rounded-[8px] pr-10 font-mono text-xs',
                      'focus-visible:ring-2 focus-visible:ring-primary/20'
                    )}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <div className='absolute top-0.5 right-0.5 flex h-8 items-center pr-1'>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className={cn(
                        'group h-7 w-7 rounded-md p-0',
                        'text-muted-foreground/60 transition-all duration-200',
                        'hover:scale-105 hover:bg-muted/50 hover:text-foreground',
                        'active:scale-95',
                        'focus-visible:ring-2 focus-visible:ring-muted-foreground/20 focus-visible:ring-offset-1'
                      )}
                      onClick={copyToClipboard}
                    >
                      {copied ? (
                        <Check className='h-3.5 w-3.5' />
                      ) : (
                        <Copy className='h-3.5 w-3.5' />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}
            {/* Form Settings */}
            <ConfigSection title='Form Settings'>
              <div className='space-y-4'>
                <ConfigField label='Form Title'>
                  <Input
                    value={config.title}
                    onChange={(e) => setConfig({ ...config, title: e.target.value })}
                    placeholder='Enter form title'
                  />
                </ConfigField>

                <ConfigField label='Description (optional)'>
                  <Textarea
                    value={config.description || ''}
                    onChange={(e) => setConfig({ ...config, description: e.target.value })}
                    placeholder='Enter form description'
                    rows={2}
                  />
                </ConfigField>
              </div>
            </ConfigSection>

            {/* Form Fields */}
            <ConfigSection title='Form Fields'>
              <div className='space-y-4'>
                <div className='flex items-center justify-between'>
                  <span className='text-muted-foreground text-sm'>
                    {config.fields.length} field{config.fields.length !== 1 ? 's' : ''} configured
                  </span>
                  <Button onClick={addField} size='sm' variant='outline'>
                    <Plus className='mr-2 h-4 w-4' />
                    Add Field
                  </Button>
                </div>

                <div className='space-y-3'>
                  {config.fields.map((field, index) => (
                    <div key={field.id} className='rounded-md border border-border bg-muted/50 p-3'>
                      <div className='space-y-3'>
                        <div className='flex items-center justify-between'>
                          <div className='flex items-center gap-2'>
                            <GripVertical className='h-4 w-4 text-muted-foreground' />
                            <span className='font-medium text-sm'>Field {index + 1}</span>
                          </div>
                          {config.fields.length > 1 && (
                            <Button
                              onClick={() => removeField(field.id)}
                              size='sm'
                              variant='ghost'
                              className='h-6 w-6 p-0 text-muted-foreground hover:text-destructive'
                            >
                              <Trash className='h-4 w-4' />
                            </Button>
                          )}
                        </div>

                        <div className='grid grid-cols-2 gap-3'>
                          <ConfigField label='Field Name'>
                            <Input
                              value={field.name}
                              onChange={(e) => updateField(field.id, { name: e.target.value })}
                              placeholder='field_name'
                            />
                          </ConfigField>

                          <ConfigField label='Label'>
                            <Input
                              value={field.label}
                              onChange={(e) => updateField(field.id, { label: e.target.value })}
                              placeholder='Field Label'
                            />
                          </ConfigField>
                        </div>

                        <div className='grid grid-cols-2 gap-3'>
                          <ConfigField label='Field Type'>
                            <Select
                              value={field.type}
                              onValueChange={(value: any) => updateField(field.id, { type: value })}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {fieldTypes.map((type) => (
                                  <SelectItem key={type.value} value={type.value}>
                                    {type.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </ConfigField>

                          <ConfigField label='Placeholder'>
                            <Input
                              value={field.placeholder || ''}
                              onChange={(e) =>
                                updateField(field.id, { placeholder: e.target.value })
                              }
                              placeholder='Enter placeholder text'
                            />
                          </ConfigField>
                        </div>

                        {field.type === 'select' && (
                          <ConfigField label='Options (one per line)'>
                            <Textarea
                              value={field.options?.join('\n') || ''}
                              onChange={(e) =>
                                updateField(field.id, {
                                  options: e.target.value.split('\n').filter(Boolean),
                                })
                              }
                              placeholder='Option 1&#10;Option 2&#10;Option 3'
                              rows={3}
                            />
                          </ConfigField>
                        )}

                        <div className='flex items-center space-x-2'>
                          <Checkbox
                            id={`required-${field.id}`}
                            checked={field.required}
                            onCheckedChange={(checked) =>
                              updateField(field.id, { required: checked as boolean })
                            }
                          />
                          <Label
                            htmlFor={`required-${field.id}`}
                            className='cursor-pointer font-medium text-sm'
                          >
                            Required field
                          </Label>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </ConfigSection>

            {/* Submit Settings */}
            <ConfigSection title='Submit Settings'>
              <div className='space-y-4'>
                <ConfigField label='Submit Button Text'>
                  <Input
                    value={config.settings.submitButtonText}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        settings: { ...config.settings, submitButtonText: e.target.value },
                      })
                    }
                    placeholder='Submit'
                  />
                </ConfigField>

                <ConfigField label='Success Message'>
                  <Textarea
                    value={config.settings.successMessage}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        settings: { ...config.settings, successMessage: e.target.value },
                      })
                    }
                    placeholder='Thank you for your submission!'
                    rows={2}
                  />
                </ConfigField>

                <ConfigField label='Redirect URL (optional)'>
                  <Input
                    value={config.settings.redirectUrl || ''}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        settings: { ...config.settings, redirectUrl: e.target.value },
                      })
                    }
                    placeholder='https://example.com/thank-you'
                  />
                </ConfigField>
              </div>
            </ConfigSection>
          </div>
        </div>

        <DialogFooter className='w-full border-t px-6 pt-4 pb-6'>
          <div className='flex items-center justify-end gap-2'>
            <Button
              onClick={onClose}
              variant='ghost'
              disabled={isSaving}
              className='h-9 rounded-[8px] px-3'
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving} className='h-9 rounded-[8px] px-3'>
              {isSaving ? 'Saving...' : 'Save Form'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
