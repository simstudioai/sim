'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from '@sim/emcn-legacy'
import { useRouter } from 'next/navigation'
import { useQueryState, useQueryStates } from 'nuqs'
import type { ConnectorData } from '@/lib/api/contracts/knowledge/connectors'
import { useSession } from '@/lib/auth/client'
import {
  type ResourceScope,
  resourceScopeFields,
  resourceScopeKey,
} from '@/lib/core/resource-scope'
import { organizationRoutes } from '@/lib/navigation/paths'
import { getConnectorAccessAvailability, SEARCH_SOURCE_TYPES } from '@/lib/sim-search/connectors'
import { defaultLiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'
import {
  managedSourceParam,
  searchSetupAccessParam,
  searchSetupParam,
} from '@/lib/sim-search/params'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import { usePrepareSearchSource, useSearchIndex } from '@/hooks/queries/kb/connectors'
import { useUpdateSearchIntegration } from '@/hooks/queries/search-integrations'
import { usePermissionConfig } from '@/hooks/use-permission-config'

export interface SearchSourceSetupOptions {
  scope: Extract<ResourceScope, { kind: 'organization' }>
  canAdmin: boolean
  memberAccessAvailable: boolean
  mirroredAccessAvailable: boolean
}

/** Owns admin setup and existing source management, including bookmarked OAuth return URLs. */
export function useSearchSourceSetup({
  scope,
  canAdmin,
  memberAccessAvailable,
  mirroredAccessAvailable,
}: SearchSourceSetupOptions) {
  const { data: session } = useSession()
  const {
    integrationAvailability,
    oauthServiceAvailability,
    isIntegrationAvailabilityReady,
    isIntegrationAvailabilityFetching,
    isIntegrationAvailabilityLoading,
    integrationAvailabilityError,
    refetchIntegrationAvailability,
  } = usePermissionConfig()
  const [setup, setSetup] = useQueryStates(
    {
      [searchSetupParam.key]: searchSetupParam.parser,
      [searchSetupAccessParam.key]: searchSetupAccessParam.parser,
    },
    { history: 'replace' }
  )
  const selectedType = setup.addConnector
  const setSelectedType = (type: typeof selectedType) =>
    setSetup({ addConnector: type, ...(type === null ? { 'source-access': null } : {}) })
  const [managedSource, setManagedSource] = useQueryState(
    managedSourceParam.key,
    managedSourceParam.parser.withOptions({ history: 'replace' })
  )
  const [search, setSearch] = useState('')
  const attemptedPreparation = useRef<string | null>(null)
  const router = useRouter()
  const prepare = usePrepareSearchSource()
  const updateSearchIntegration = useUpdateSearchIntegration()
  const { mutate: prepareSource, isPending: preparing } = prepare
  const selectedMeta = selectedType ? CONNECTOR_META_REGISTRY[selectedType] : undefined
  const redirectPersonalSetup = Boolean(
    canAdmin &&
      selectedMeta &&
      setup['source-access'] !== 'members' &&
      !selectedMeta.mirrorsSourceAcls &&
      selectedType !== 'slack' &&
      selectedType !== 'github'
  )
  const redirectManagement = canAdmin && managedSource !== null && selectedType === null
  const { organizationId } = scope
  useEffect(() => {
    if (redirectPersonalSetup && organizationId) {
      router.replace(organizationRoutes(organizationId).integrations)
    }
  }, [redirectPersonalSetup, organizationId, router])
  useEffect(() => {
    if (!redirectManagement || !organizationId || managedSource === null) return
    const routes = organizationRoutes(organizationId)
    if (!managedSource || CONNECTOR_META_REGISTRY[managedSource]) {
      void setManagedSource(null, { history: 'replace', scroll: false })
    } else {
      router.replace(routes.searchSource(managedSource))
    }
  }, [redirectManagement, organizationId, managedSource, router, setManagedSource])
  const open = selectedType !== null || managedSource !== null
  const index = useSearchIndex(scope, {
    enabled: canAdmin && open && !redirectManagement && !redirectPersonalSetup,
  })
  const knowledgeBaseId = index.data?.knowledgeBaseId ?? undefined

  const close = () => {
    if (prepare.isPending) return
    if (selectedType !== null) void setSelectedType(null)
    if (managedSource !== null) void setManagedSource(null)
  }
  const failedQuery = index.isError ? index : null
  const initialMode = (type: string) =>
    type === 'github' || type === 'slack' || setup['source-access'] === 'members'
      ? ('members' as const)
      : ('admin' as const)

  const selectedAccessMode = selectedType ? initialMode(selectedType) : undefined
  const selectedAvailability = selectedMeta
    ? getConnectorAccessAvailability(selectedMeta, integrationAvailability, {
        memberAccessAvailable,
        mirroredAccessAvailable,
        oauthServiceAvailability,
        isIntegrationAvailabilityReady,
      })
    : undefined
  const selectedAvailable = selectedAvailability
    ? selectedAccessMode === 'admin'
      ? selectedAvailability.admin
      : selectedAvailability.members
    : false
  const canPrepareSelected =
    canAdmin &&
    open &&
    !redirectManagement &&
    !redirectPersonalSetup &&
    !index.isPending &&
    !index.isError &&
    !integrationAvailabilityError &&
    selectedAvailable
  const userId = session?.user?.id

  /** A known provider only needs the canonical index prepared, not another selection step. */
  useEffect(() => {
    if (!selectedType || knowledgeBaseId) {
      attemptedPreparation.current = null
      return
    }
    if (!canPrepareSelected || !selectedAccessMode || !userId || preparing) return
    const requestKey = `${userId}:${resourceScopeKey(scope)}:${selectedType}:${selectedAccessMode}`
    if (attemptedPreparation.current === requestKey) return
    attemptedPreparation.current = requestKey
    prepareSource({
      ...resourceScopeFields(scope),
      connectorType: selectedType,
      accessMode: selectedAccessMode,
    })
  }, [
    selectedType,
    knowledgeBaseId,
    canPrepareSelected,
    selectedAccessMode,
    userId,
    preparing,
    scope,
    prepareSource,
  ])

  const handleCreated = async (type: string, connector: ConnectorData, accessMode: string) => {
    await setSelectedType(null)
    const destination = organizationRoutes(scope.organizationId).searchSource(connector.id)
    if (accessMode === 'admin' && type !== 'gitlab') {
      updateSearchIntegration.mutate(
        {
          organizationId: scope.organizationId,
          connectorType: type,
          approved: true,
          policy: {
            ...defaultLiveSearchPolicy(type),
            accessMode: 'service_account',
            sourceId: connector.id,
          },
        },
        {
          onSuccess: () => router.push(destination),
          onError: (error) => {
            toast.error(`Source added but search is not ready: ${error.message}`)
            router.push(destination)
          },
        }
      )
    } else {
      router.push(destination)
    }
  }

  const normalizedSearch = search.trim().toLowerCase()
  const visibleTypes = SEARCH_SOURCE_TYPES.filter(
    ([type, meta]) =>
      (setup['source-access'] === 'members' ||
        meta.mirrorsSourceAcls ||
        type === 'slack' ||
        type === 'github') &&
      `${meta.name} ${meta.description}`.toLowerCase().includes(normalizedSearch)
  )

  const availabilityOf = (meta: Parameters<typeof getConnectorAccessAvailability>[0]) =>
    getConnectorAccessAvailability(meta, integrationAvailability, {
      memberAccessAvailable,
      mirroredAccessAvailable,
      oauthServiceAvailability,
      isIntegrationAvailabilityReady,
    })
  const startSetup = (type: string) => {
    if (knowledgeBaseId) void setSelectedType(searchSetupParam.parser.parse(type))
    else
      prepare.mutate(
        {
          ...resourceScopeFields(scope),
          connectorType: type,
          accessMode: initialMode(type),
        },
        {
          onSuccess: () => void setSelectedType(searchSetupParam.parser.parse(type)),
        }
      )
  }
  const retryPrepare = () => {
    if (!selectedType || !canPrepareSelected || !selectedAccessMode || !userId || preparing) return
    prepareSource({
      ...resourceScopeFields(scope),
      connectorType: selectedType,
      accessMode: selectedAccessMode,
    })
  }
  /** Setup is resolved once the index exists; only then does the connector form have a target. */
  const canShowForm =
    !failedQuery &&
    Boolean(knowledgeBaseId) &&
    (isIntegrationAvailabilityReady || integrationAvailability.size > 0)
  const hidden = !canAdmin || !open || redirectManagement || redirectPersonalSetup
  const waitingForPreparation =
    Boolean(selectedType) &&
    !failedQuery &&
    !integrationAvailabilityError &&
    !prepare.error &&
    (!isIntegrationAvailabilityReady || selectedAvailable)
  return {
    availabilityOf,
    canShowForm,
    close,
    failedQuery,
    handleCreated,
    hidden,
    index,
    initialMode,
    integrationAvailabilityError,
    isIntegrationAvailabilityFetching,
    isIntegrationAvailabilityLoading,
    knowledgeBaseId,
    managedSource,
    prepare,
    preparing,
    refetchIntegrationAvailability,
    retryPrepare,
    search,
    selectedAccessMode,
    selectedAvailable,
    selectedType,
    setSearch,
    setSelectedType,
    startSetup,
    userId,
    visibleTypes,
    waitingForPreparation,
  }
}
