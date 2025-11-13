import { useCallback, useEffect, useState } from 'react'

/**
 * Return type for the useChildDeployment hook
 */
export interface UseChildDeploymentReturn {
  /** The active version number of the child workflow */
  activeVersion: number | null
  /** Whether the child workflow has an active deployment */
  isDeployed: boolean | null
  /** Whether the child workflow needs redeployment due to changes */
  needsRedeploy: boolean
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
  const [needsRedeploy, setNeedsRedeploy] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [refetchTrigger, setRefetchTrigger] = useState(0)

  const fetchActiveVersion = useCallback(async (wfId: string) => {
    let cancelled = false

    try {
      setIsLoading(true)

      // Use the workflow status API which provides accurate deployment and change detection
      // This uses the same logic as the main deploy button (comparing actual workflow state)
      const statusRes = await fetch(`/api/workflows/${wfId}/status`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      })

      if (!statusRes.ok) {
        if (!cancelled) {
          setActiveVersion(null)
          setIsDeployed(null)
          setNeedsRedeploy(false)
        }
        return
      }

      const statusData = await statusRes.json()

      // Also fetch deployments to get the active version number
      const deploymentsRes = await fetch(`/api/workflows/${wfId}/deployments`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      })

      let activeVersion = null
      if (deploymentsRes.ok) {
        const deploymentsJson = await deploymentsRes.json()
        const versions = Array.isArray(deploymentsJson?.data?.versions)
          ? deploymentsJson.data.versions
          : Array.isArray(deploymentsJson?.versions)
            ? deploymentsJson.versions
            : []

        const active = versions.find((v: any) => v.isActive)
        activeVersion = active ? Number(active.version) : null
      }

      if (!cancelled) {
        setActiveVersion(activeVersion)
        setIsDeployed(statusData.isDeployed || false)
        setNeedsRedeploy(statusData.needsRedeployment || false)
      }
    } catch {
      if (!cancelled) {
        setActiveVersion(null)
        setIsDeployed(null)
        setNeedsRedeploy(false)
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
      setNeedsRedeploy(false)
    }
  }, [childWorkflowId, refetchTrigger, fetchActiveVersion])

  const refetch = useCallback(() => {
    setRefetchTrigger((prev) => prev + 1)
  }, [])

  return {
    activeVersion,
    isDeployed,
    needsRedeploy,
    isLoading,
    refetch,
  }
}
