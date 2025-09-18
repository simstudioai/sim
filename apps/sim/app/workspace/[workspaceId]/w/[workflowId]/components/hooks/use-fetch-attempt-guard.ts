'use client'

import { useRef } from 'react'

export function useFetchAttemptGuard() {
  const lastAttemptKeyRef = useRef<string>('')

  const shouldAttempt = (key: string): boolean => {
    return lastAttemptKeyRef.current !== key
  }

  const markAttempt = (key: string) => {
    lastAttemptKeyRef.current = key
  }

  const reset = () => {
    lastAttemptKeyRef.current = ''
  }

  return { shouldAttempt, markAttempt, reset }
}
