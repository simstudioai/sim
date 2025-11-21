import { useCallback, useState } from 'react'

export type AuthType = 'public' | 'password' | 'email' | 'sso'

export interface ChatFormData {
  identifier: string
  title: string
  description: string
  authType: AuthType
  password: string
  emails: string[]
  welcomeMessage: string
  selectedOutputBlocks: string[]
}

export interface ChatFormErrors {
  identifier?: string
  title?: string
  password?: string
  emails?: string
  outputBlocks?: string
  general?: string
}

const initialFormData: ChatFormData = {
  identifier: '',
  title: '',
  description: '',
  authType: 'public',
  password: '',
  emails: [],
  welcomeMessage: 'Hi there! How can I help you today?',
  selectedOutputBlocks: [],
}

export function useChatForm(initialData?: Partial<ChatFormData>) {
  const [formData, setFormData] = useState<ChatFormData>({
    ...initialFormData,
    ...initialData,
  })

  const [errors, setErrors] = useState<ChatFormErrors>({})

  const updateField = useCallback(
    <K extends keyof ChatFormData>(field: K, value: ChatFormData[K]) => {
      setFormData((prev) => ({ ...prev, [field]: value }))
      // Clear error when user starts typing
      if (field in errors && errors[field as keyof ChatFormErrors]) {
        setErrors((prev) => ({ ...prev, [field]: undefined }))
      }
    },
    [errors]
  )

  const setError = useCallback((field: keyof ChatFormErrors, message: string) => {
    setErrors((prev) => ({ ...prev, [field]: message }))
  }, [])

  const clearError = useCallback((field: keyof ChatFormErrors) => {
    setErrors((prev) => ({ ...prev, [field]: undefined }))
  }, [])

  const clearAllErrors = useCallback(() => {
    setErrors({})
  }, [])

  const validateForm = useCallback((): boolean => {
    const newErrors: ChatFormErrors = {}

    if (!formData.identifier.trim()) {
      newErrors.identifier = 'Identifier is required'
    } else if (!/^[a-z0-9-]+$/.test(formData.identifier)) {
      newErrors.identifier = 'Identifier can only contain lowercase letters, numbers, and hyphens'
    }

    if (!formData.title.trim()) {
      newErrors.title = 'Title is required'
    }

    if (formData.authType === 'password' && !formData.password.trim()) {
      newErrors.password = 'Password is required when using password protection'
    }

    if (formData.authType === 'email' && formData.emails.length === 0) {
      newErrors.emails = 'At least one email or domain is required when using email access control'
    }

    if (formData.authType === 'sso' && formData.emails.length === 0) {
      newErrors.emails = 'At least one email or domain is required when using SSO access control'
    }

    if (formData.selectedOutputBlocks.length === 0) {
      newErrors.outputBlocks = 'Please select at least one output block'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }, [formData])

  const resetForm = useCallback(() => {
    setFormData(initialFormData)
    setErrors({})
  }, [])

  return {
    formData,
    errors,
    updateField,
    setError,
    clearError,
    clearAllErrors,
    validateForm,
    resetForm,
    setFormData,
  }
}
