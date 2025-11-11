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

      // Fetch both deployment versions and workflow metadata in parallel
      const [deploymentsRes, workflowRes] = await Promise.all([
        fetch(`/api/workflows/${wfId}/deployments`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        }),
        fetch(`/api/workflows/${wfId}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        }),
      ])

      if (!deploymentsRes.ok || !workflowRes.ok) {
        if (!cancelled) {
          setActiveVersion(null)
          setIsDeployed(null)
          setNeedsRedeploy(false)
        }
        return
      }

      const deploymentsJson = await deploymentsRes.json()
      const workflowJson = await workflowRes.json()

      const versions = Array.isArray(deploymentsJson?.data?.versions)
        ? deploymentsJson.data.versions
        : Array.isArray(deploymentsJson?.versions)
          ? deploymentsJson.versions
          : []

      const active = versions.find((v: any) => v.isActive)
      const workflowUpdatedAt = workflowJson?.data?.updatedAt || workflowJson?.updatedAt

      if (!cancelled) {
        const v = active ? Number(active.version) : null
        const deployed = v != null
        setActiveVersion(v)
        setIsDeployed(deployed)

        // Check if workflow has been updated since deployment
        if (deployed && active?.createdAt && workflowUpdatedAt) {
          const deploymentTime = new Date(active.createdAt).getTime()
          const updateTime = new Date(workflowUpdatedAt).getTime()
          setNeedsRedeploy(updateTime > deploymentTime)
        } else {
          setNeedsRedeploy(false)
        }
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
