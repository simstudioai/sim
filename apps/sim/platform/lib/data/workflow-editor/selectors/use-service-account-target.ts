import { useMemo } from 'react'
import { useServiceAccountConnectTarget } from '@/components/integrations/connect-service-account-modal/use-service-account-connect'
import { getServiceConfigByServiceId } from '@/lib/oauth/utils'

type ServiceAccountProviderId = Parameters<
  typeof useServiceAccountConnectTarget
>[0]['serviceAccountProviderId']

/**
 * The service-account setup a credential picker offers for its service: the provider id, the
 * vendor-accurate label, whether the viewer may see it, and the Atlassian product an Atlassian key
 * is for. Only service-account and merged pickers resolve one; a plain OAuth picker gets `null`.
 */
export function useServiceAccountTarget(serviceId: string, enabled: boolean) {
  const service = useMemo(
    () => (enabled ? getServiceConfigByServiceId(serviceId) : null),
    [enabled, serviceId]
  )
  const target = useServiceAccountConnectTarget({
    serviceAccountProviderId: service?.serviceAccountProviderId as ServiceAccountProviderId,
    serviceName: service?.name,
    serviceIcon: service?.icon,
  })
  const atlassianProduct: 'jira' | 'confluence' =
    service?.providerId === 'confluence' ? 'confluence' : 'jira'
  return useMemo(() => target && { ...target, atlassianProduct }, [target, atlassianProduct])
}
