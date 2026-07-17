'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader } from '@sim/emcn'
import { InterfaceRenderer } from '@/components/interfaces'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  executePublicInterfaceContract,
  getPublicInterfaceContract,
} from '@/lib/api/contracts/interfaces'
import type { PublicInterfaceDto } from '@/lib/interfaces'

interface InterfaceRuntimeProps {
  identifier: string
}

export function InterfaceRuntime({ identifier }: InterfaceRuntimeProps) {
  const [dto, setDto] = useState<PublicInterfaceDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [result, setResult] = useState<{
    success: boolean
    output?: unknown
    error?: string
  } | null>(null)
  const submitAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const data = await requestJson(getPublicInterfaceContract, {
          params: { identifier },
        })
        if (!cancelled) {
          setDto(data)
        }
      } catch (e) {
        if (!cancelled) {
          const message =
            e instanceof ApiClientError
              ? e.message
              : e instanceof Error
                ? e.message
                : 'This interface is not available'
          setError(message)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
      submitAbortRef.current?.abort()
    }
  }, [identifier])

  const onSubmit = useCallback(
    async (actionId: string, values: Record<string, unknown>) => {
      submitAbortRef.current?.abort()
      const controller = new AbortController()
      submitAbortRef.current = controller

      setIsSubmitting(true)
      setResult(null)
      try {
        const data = await requestJson(executePublicInterfaceContract, {
          params: { identifier },
          body: { actionId, values },
          signal: controller.signal,
        })
        setResult({
          success: Boolean(data.success),
          output: data.output,
          error: data.error,
        })
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        if (controller.signal.aborted) return
        const message = e instanceof ApiClientError ? e.message : 'Something went wrong'
        setResult({ success: false, error: message })
      } finally {
        if (!controller.signal.aborted) {
          setIsSubmitting(false)
        }
      }
    },
    [identifier]
  )

  if (loading) {
    return (
      <div className='flex min-h-[50vh] items-center justify-center'>
        <Loader className='h-6 w-6' />
      </div>
    )
  }

  if (error || !dto) {
    return (
      <div className='mx-auto max-w-md px-4 py-16 text-center'>
        <h1 className='mb-2 font-semibold text-xl'>Interface unavailable</h1>
        <p className='text-[var(--text-secondary)] text-sm'>
          {error || 'This interface is not available'}
        </p>
      </div>
    )
  }

  return (
    <InterfaceRenderer dto={dto} onSubmit={onSubmit} isSubmitting={isSubmitting} result={result} />
  )
}
