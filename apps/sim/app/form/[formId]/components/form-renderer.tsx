'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { quickValidateEmail } from '@/lib/email/validation'
import type { FormConfig, FormField, FormSettings } from '@/lib/types/form'

interface FormRendererProps {
  formId: string
  formConfig: FormConfig
  styling?: Record<string, any>
  settings: FormSettings
}

export function FormRenderer({ formId, formConfig, styling, settings }: FormRendererProps) {
  const [formData, setFormData] = useState<Record<string, any>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)

  const handleFieldChange = (fieldName: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [fieldName]: value,
    }))

    if (errors[fieldName]) {
      setErrors((prev) => ({
        ...prev,
        [fieldName]: '',
      }))
    }
  }

  const validateForm = () => {
    const newErrors: Record<string, string> = {}

    formConfig.fields.forEach((field) => {
      if (field.required) {
        const value = formData[field.name]
        if (!value || (typeof value === 'string' && value.trim() === '')) {
          newErrors[field.name] = `${field.label} is required`
        }
      }

      if (field.type === 'email' && formData[field.name]) {
        const validation = quickValidateEmail(formData[field.name])
        if (!validation.isValid) {
          newErrors[field.name] = validation.reason || 'Please enter a valid email address'
        }
      }
    })

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) {
      return
    }

    setIsSubmitting(true)
    setSubmitError(null)

    try {
      const response = await fetch(`/api/forms/${formId}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Form submission failed')
      }

      const result = await response.json()

      setIsSubmitted(true)

      if (result.redirectUrl) {
        setTimeout(() => {
          window.location.href = result.redirectUrl
        }, 2000)
      }
    } catch (error: any) {
      setSubmitError(error.message || 'Something went wrong. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const renderField = (field: FormField) => {
    const value = formData[field.name] || ''

    const commonProps = {
      id: field.name,
      name: field.name,
      placeholder: field.placeholder,
      required: field.required,
    }

    switch (field.type) {
      case 'text':
        return (
          <Input
            {...commonProps}
            type='text'
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
          />
        )

      case 'email':
        return (
          <Input
            {...commonProps}
            type='email'
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
          />
        )

      case 'number':
        return (
          <Input
            {...commonProps}
            type='number'
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
          />
        )

      case 'textarea':
        return (
          <Textarea
            {...commonProps}
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            rows={4}
          />
        )

      case 'select':
        return (
          <Select
            value={value}
            onValueChange={(selectedValue) => handleFieldChange(field.name, selectedValue)}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={field.placeholder || `Select ${field.label.toLowerCase()}`}
              />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )

      case 'checkbox':
        return (
          <div className='flex items-center space-x-2'>
            <Checkbox
              id={field.name}
              checked={!!value}
              onCheckedChange={(checked) => handleFieldChange(field.name, checked)}
            />
            <Label
              htmlFor={field.name}
              className='font-normal text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
            >
              {field.label}
            </Label>
          </div>
        )

      default:
        return null
    }
  }

  if (isSubmitted) {
    return (
      <div className='space-y-2 py-8 text-center'>
        <p className='text-foreground'>{settings.successMessage}</p>
        {settings.redirectUrl && <p className='text-muted-foreground text-sm'>Redirecting...</p>}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className='space-y-6'>
      {submitError && (
        <div className='rounded-md border border-destructive/20 bg-destructive/10 p-4'>
          <div className='text-destructive text-sm'>{submitError}</div>
        </div>
      )}

      <div className='space-y-4'>
        {formConfig.fields.map((field) => {
          const error = errors[field.name]
          const isCheckboxField = field.type === 'checkbox'

          if (isCheckboxField) {
            return (
              <div key={field.id} className='space-y-2'>
                {renderField(field)}
                {error && <div className='text-destructive text-sm'>{error}</div>}
              </div>
            )
          }

          return (
            <div key={field.id} className='space-y-2'>
              <Label htmlFor={field.name}>
                {field.label}
                {field.required && <span className='ml-1 text-destructive'>*</span>}
              </Label>
              {renderField(field)}
              {error && <div className='text-destructive text-sm'>{error}</div>}
            </div>
          )
        })}
      </div>

      <Button type='submit' disabled={isSubmitting} className='h-10 w-full rounded-[8px]'>
        {isSubmitting ? (
          <>
            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            Submitting...
          </>
        ) : (
          settings.submitButtonText || 'Submit'
        )}
      </Button>
    </form>
  )
}
