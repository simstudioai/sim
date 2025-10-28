import { useEffect, useState } from 'react'

/**
 * Custom hook for managing child workflow deployment information
 *
 * @param childWorkflowId - The ID of the child workflow
 * @returns Deployment status and version information
 */
export function useChildDeployment(childWorkflowId: string | undefined) {
  const [activeVersion, setActiveVersion] = useState<number | null>(null)
  const [isDeployed, setIsDeployed] = useState<boolean>(false)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    const fetchActiveVersion = async (wfId: string) => {
      try {
        setIsLoading(true)
        const res = await fetch(`/api/workflows/${wfId}/deployments`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        })

        if (!res.ok) {
          if (!cancelled) {
            setActiveVersion(null)
            setIsDeployed(false)
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
          setIsDeployed(v != null)
        }
      } catch {
        if (!cancelled) {
          setActiveVersion(null)
          setIsDeployed(false)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    if (childWorkflowId) {
      void fetchActiveVersion(childWorkflowId)
    } else {
      setActiveVersion(null)
      setIsDeployed(false)
    }

    return () => {
      cancelled = true
    }
  }, [childWorkflowId])

  return {
    activeVersion,
    isDeployed,
    isLoading,
  }
}
