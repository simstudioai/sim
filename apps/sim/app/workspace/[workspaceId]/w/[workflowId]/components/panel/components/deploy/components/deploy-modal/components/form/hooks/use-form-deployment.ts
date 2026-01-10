import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'

const logger = createLogger('useFormDeployment')

interface CreateFormParams {
  workflowId: string
  identifier: string
  title: string
  description?: string
  customizations?: {
    primaryColor?: string
    welcomeMessage?: string
    thankYouTitle?: string
    thankYouMessage?: string
    logoUrl?: string
  }
  authType?: 'public' | 'password' | 'email'
  password?: string
  allowedEmails?: string[]
  showBranding?: boolean
}

interface UpdateFormParams {
  identifier?: string
  title?: string
  description?: string
  customizations?: {
    primaryColor?: string
    welcomeMessage?: string
    thankYouTitle?: string
    thankYouMessage?: string
    logoUrl?: string
  }
  authType?: 'public' | 'password' | 'email'
  password?: string
  allowedEmails?: string[]
  showBranding?: boolean
  isActive?: boolean
}

interface CreateFormResult {
  id: string
  formUrl: string
}

export function useFormDeployment() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createForm = useCallback(
    async (params: CreateFormParams): Promise<CreateFormResult | null> => {
      setIsSubmitting(true)
      setError(null)

      try {
        const response = await fetch('/api/form', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(params),
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to create form')
        }

        logger.info('Form created successfully:', { id: data.id })
        return {
          id: data.id,
          formUrl: data.formUrl,
        }
      } catch (err: any) {
        const errorMessage = err.message || 'Failed to create form'
        setError(errorMessage)
        logger.error('Error creating form:', err)
        throw err
      } finally {
        setIsSubmitting(false)
      }
    },
    []
  )

  const updateForm = useCallback(async (formId: string, params: UpdateFormParams) => {
    setIsSubmitting(true)
    setError(null)

    try {
      const response = await fetch(`/api/form/manage/${formId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update form')
      }

      logger.info('Form updated successfully:', { id: formId })
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to update form'
      setError(errorMessage)
      logger.error('Error updating form:', err)
      throw err
    } finally {
      setIsSubmitting(false)
    }
  }, [])

  const deleteForm = useCallback(async (formId: string) => {
    setIsSubmitting(true)
    setError(null)

    try {
      const response = await fetch(`/api/form/manage/${formId}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete form')
      }

      logger.info('Form deleted successfully:', { id: formId })
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to delete form'
      setError(errorMessage)
      logger.error('Error deleting form:', err)
      throw err
    } finally {
      setIsSubmitting(false)
    }
  }, [])

  return {
    createForm,
    updateForm,
    deleteForm,
    isSubmitting,
    error,
  }
}
