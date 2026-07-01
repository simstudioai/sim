import { useEffect, useRef, useState } from 'react'
import { requestJson } from '@/lib/api/client/request'
import { validateChatIdentifierContract } from '@/lib/api/contracts/chats'

const IDENTIFIER_PATTERN = /^[a-z0-9-]+$/
const DEBOUNCE_MS = 500

interface IdentifierValidationState {
  isChecking: boolean
  error: string | null
  isValid: boolean
}

type SyncValidation =
  | { status: 'resolved'; error: string | null; isValid: boolean }
  | { status: 'needsCheck' }

/**
 * Computes the synchronous portion of identifier validation.
 * Returns a resolved state for cases decidable without a network call, or
 * `needsCheck` when the identifier must be verified against the server.
 */
function computeSyncValidation(
  identifier: string,
  originalIdentifier?: string,
  isEditingExisting?: boolean
): SyncValidation {
  if (!identifier.trim()) {
    return { status: 'resolved', error: null, isValid: false }
  }

  if (originalIdentifier && identifier === originalIdentifier) {
    return { status: 'resolved', error: null, isValid: true }
  }

  if (isEditingExisting && !originalIdentifier) {
    return { status: 'resolved', error: null, isValid: true }
  }

  if (!IDENTIFIER_PATTERN.test(identifier)) {
    return {
      status: 'resolved',
      error: 'Identifier can only contain lowercase letters, numbers, and hyphens',
      isValid: false,
    }
  }

  return { status: 'needsCheck' }
}

/** Maps a synchronous validation result to the exposed state shape. */
function toValidationState(sync: SyncValidation): IdentifierValidationState {
  if (sync.status === 'resolved') {
    return { isChecking: false, error: sync.error, isValid: sync.isValid }
  }
  return { isChecking: true, error: null, isValid: false }
}

/**
 * Hook for validating chat identifier availability with debounced API checks
 * @param identifier - The identifier to validate
 * @param originalIdentifier - The original identifier when editing an existing chat
 * @param isEditingExisting - Whether we're editing an existing chat deployment
 */
export function useIdentifierValidation(
  identifier: string,
  originalIdentifier?: string,
  isEditingExisting?: boolean
): IdentifierValidationState {
  const sync = computeSyncValidation(identifier, originalIdentifier, isEditingExisting)

  const [state, setState] = useState<IdentifierValidationState>(() => toValidationState(sync))

  const prevDepsRef = useRef({ identifier, originalIdentifier, isEditingExisting })
  const prev = prevDepsRef.current
  if (
    prev.identifier !== identifier ||
    prev.originalIdentifier !== originalIdentifier ||
    prev.isEditingExisting !== isEditingExisting
  ) {
    prevDepsRef.current = { identifier, originalIdentifier, isEditingExisting }
    setState(toValidationState(sync))
  }

  useEffect(() => {
    if (
      computeSyncValidation(identifier, originalIdentifier, isEditingExisting).status !==
      'needsCheck'
    ) {
      return
    }

    const handle = setTimeout(async () => {
      try {
        const data = await requestJson(validateChatIdentifierContract, {
          query: { identifier },
        })

        if (!data.available) {
          setState({
            isChecking: false,
            error: data.error || 'This identifier is already in use',
            isValid: false,
          })
        } else {
          setState({ isChecking: false, error: null, isValid: true })
        }
      } catch {
        setState({
          isChecking: false,
          error: 'Error checking identifier availability',
          isValid: false,
        })
      }
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(handle)
    }
  }, [identifier, originalIdentifier, isEditingExisting])

  return state
}
