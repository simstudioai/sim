'use client'

import { useCallback, useState } from 'react'
import { OAuthProvider } from '@/tools/types'

/**
 * Interface for the OAuth error structure
 */
export interface OAuthRequiredError {
  type: 'oauth_required'
  provider: OAuthProvider
  toolId: string
  toolName: string
  requiredScopes?: string[]
}

/**
 * Custom hook to handle OAuth errors during workflow execution
 */
export function useOAuthErrorHandler() {
  const [modalState, setModalState] = useState<{
    isOpen: boolean
    provider: OAuthProvider | null
    toolName: string
    requiredScopes?: string[]
  }>({
    isOpen: false,
    provider: null,
    toolName: '',
  })

  const handleOAuthError = useCallback((error: any) => {
    // Check if the error is an OAuth required error
    try {
      if (typeof error === 'string' && error.includes('oauth_required')) {
        const errorData: OAuthRequiredError = JSON.parse(error)

        if (errorData.type === 'oauth_required' && errorData.provider) {
          setModalState({
            isOpen: true,
            provider: errorData.provider,
            toolName: errorData.toolName || 'this tool',
            requiredScopes: errorData.requiredScopes,
          })
          return true
        }
      } else if (
        error?.message &&
        typeof error.message === 'string' &&
        error.message.includes('oauth_required')
      ) {
        try {
          const errorData: OAuthRequiredError = JSON.parse(error.message)

          if (errorData.type === 'oauth_required' && errorData.provider) {
            setModalState({
              isOpen: true,
              provider: errorData.provider,
              toolName: errorData.toolName || 'this tool',
              requiredScopes: errorData.requiredScopes,
            })
            return true
          }
        } catch (parseError) {
          console.error('Error parsing OAuth error message:', parseError)
        }
      }
    } catch (e) {
      console.error('Error handling OAuth error:', e)
    }

    return false
  }, [])

  const closeModal = useCallback(() => {
    setModalState((prev) => ({ ...prev, isOpen: false }))
  }, [])

  return {
    modalState,
    handleOAuthError,
    closeModal,
  }
}
