import { useCallback, useEffect, useState } from 'react'

/**
 * Return type for the useChildDeployment hook
 */
export interface UseChildDeploymentReturn {
  /** The active version number of the child workflow */
  activeVersion: number | null
  /** Whether the child workflow has an active deployment */
  isDeployed: boolean | null
  /** Whether the deployment information is currently being fetched */
  isLoading: boolean
  /** Function to manually refetch deployment status */
  refetch: () => void
}

/**
 * Custom hook for managing child workflow deployment information
 *
 * @param childWorkflowId - The ID of the child workflow
 * @returns Deployment status and version information
 */
export function useChildDeployment(childWorkflowId: string | undefined): UseChildDeploymentReturn {
  const [activeVersion, setActiveVersion] = useState<number | null>(null)
  const [isDeployed, setIsDeployed] = useState<boolean | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [refetchTrigger, setRefetchTrigger] = useState(0)

  const fetchActiveVersion = useCallback(async (wfId: string) => {
    let cancelled = false

    try {
      setIsLoading(true)
      const res = await fetch(`/api/workflows/${wfId}/deployments`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      })

      if (!res.ok) {
        if (!cancelled) {
          setActiveVersion(null)
          setIsDeployed(null)
        }
        return
      }

      const json = await res.json()
      const versions = Array.isArray(json?.data?.versions)
        ? json.data.versions
        : Array.isArray(json?.versions)
          ? json.versions
          : []

      const active = versions.find((v: any) => v.isActive)

      if (!cancelled) {
        const v = active ? Number(active.version) : null
        setActiveVersion(v)
        setIsDeployed(v != null) // true if deployed, false if undeployed
      }
    } catch {
      if (!cancelled) {
        setActiveVersion(null)
        setIsDeployed(null)
      }
    } finally {
      if (!cancelled) setIsLoading(false)
    }

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (childWorkflowId) {
      void fetchActiveVersion(childWorkflowId)
    } else {
      setActiveVersion(null)
      setIsDeployed(null)
    }
  }, [childWorkflowId, refetchTrigger, fetchActiveVersion])

  const refetch = useCallback(() => {
    setRefetchTrigger((prev) => prev + 1)
  }, [])

  return {
    activeVersion,
    isDeployed,
    isLoading,
    refetch,
  }
}
