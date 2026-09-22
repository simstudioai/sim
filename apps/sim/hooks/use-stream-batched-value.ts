'use client'

import { useEffect, useRef, useState } from 'react'

/** Limits preview document replacement while a file is being streamed. */
export function useStreamBatchedValue(
  value: string,
  streaming: boolean,
  intervalMs: number
): string {
  const [batched, setBatched] = useState(value)
  const lastAppliedAtRef = useRef(0)
  useEffect(() => {
    if (!streaming) {
      lastAppliedAtRef.current = 0
      setBatched(value)
      return
    }
    const elapsed = Date.now() - lastAppliedAtRef.current
    if (elapsed >= intervalMs) {
      lastAppliedAtRef.current = Date.now()
      setBatched(value)
      return
    }
    const timer = setTimeout(() => {
      lastAppliedAtRef.current = Date.now()
      setBatched(value)
    }, intervalMs - elapsed)
    return () => clearTimeout(timer)
  }, [value, streaming, intervalMs])
  return streaming ? batched : value
}
