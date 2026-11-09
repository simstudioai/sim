'use client'

import type { ReactNode } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { Icon } from '@sim/emcn/icon'
import { Modal } from '@sim/emcn/modal'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow } from '@sim/emcn/settings-section'
import { FailureNotice, InlineNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { SourceSetupForm } from '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/source-setup'
import {
  getSearchConnectionLabels,
  type ResourceScope,
  useSearchSourceSetup,
} from '@/platform/lib/data/search-sources'

interface SourceSetupProps {
  /** The page under setup, kept mounted behind everything but the connection form. */
  children: ReactNode
  scope: Extract<ResourceScope, { kind: 'organization' }>
  backLabel: string
  canAdmin: boolean
  memberAccessAvailable: boolean
  mirroredAccessAvailable: boolean
}

/** The URL's setup state: the connection form once its index exists, otherwise why it cannot be. */
export function SourceSetup({ backLabel, children, ...options }: SourceSetupProps) {
  const { scope } = options
  const setup = useSearchSourceSetup(options)
  if (setup.hidden) return children
  const { selectedType, knowledgeBaseId, userId } = setup
  if (setup.canShowForm && knowledgeBaseId && selectedType && userId) {
    const accessMode = setup.initialMode(selectedType)
    return (
      <SourceSetupForm
        key={`${userId}:${knowledgeBaseId}:${selectedType}:${accessMode}`}
        scope={scope}
        knowledgeBaseId={knowledgeBaseId}
        connectorType={selectedType}
        accessMode={accessMode}
        draftKey={`${userId}:organization:${scope.organizationId}:${knowledgeBaseId}:${selectedType}:${accessMode}`}
        backLabel={backLabel}
        onClose={() => void setup.setSelectedType(null)}
        onCreated={(type, connector) => void setup.handleCreated(type, connector, accessMode)}
      />
    )
  }
  if (setup.waitingForPreparation) return children
  const { failedQuery, prepare } = setup
  const availabilityError = setup.integrationAvailabilityError
  const dismissedByPending = prepare.isPending
  return (
    <>
      {children}
      <Modal
        open
        onOpenChange={(open) => {
          if (!open && !dismissedByPending) setup.close()
        }}
        title={
          selectedType
            ? getSearchConnectionLabels(selectedType, setup.selectedAccessMode).title
            : 'Add source'
        }
        cancelLabel='Close'
        confirmLabel='Done'
      >
        {failedQuery ? (
          <FailureNotice
            title='Source setup'
            message={getErrorMessage(failedQuery.error, 'Could not load source setup')}
            retrying={failedQuery.isFetching}
            onRetry={() => void failedQuery.refetch()}
          />
        ) : availabilityError ? (
          <FailureNotice
            title='Connection availability'
            message={getErrorMessage(availabilityError, 'Could not load connection availability')}
            retrying={setup.isIntegrationAvailabilityFetching}
            onRetry={() => void setup.refetchIntegrationAvailability()}
          />
        ) : setup.isIntegrationAvailabilityLoading ? null : setup.managedSource ? (
          setup.index.isPending ? null : (
            <EmptyState title='This source is no longer available.' />
          )
        ) : selectedType ? (
          !setup.selectedAvailable ? (
            <EmptyState title={`Not available in this ${scope.kind}`} />
          ) : prepare.error ? (
            <FailureNotice
              message={getErrorMessage(prepare.error, 'Could not prepare source setup')}
              retrying={setup.preparing}
              onRetry={setup.retryPrepare}
            />
          ) : null
        ) : (
          <>
            <SearchField
              label='Search sources'
              placeholder='Search sources…'
              value={setup.search}
              onValueChange={setup.setSearch}
            />
            {setup.visibleTypes.map(([type, meta]) => {
              const { admin: central, members } = setup.availabilityOf(meta)
              const available = setup.initialMode(type) === 'members' ? members : central
              return (
                <SettingsRow
                  key={type}
                  label={meta.name}
                  leading={<Icon providerId={type} />}
                  description={
                    !available
                      ? `Not available in this ${scope.kind}`
                      : central
                        ? meta.adminSetupHint
                        : undefined
                  }
                >
                  {available && (
                    <Button
                      variant='primary'
                      size='compact'
                      disabled={prepare.isPending || setup.index.isPending}
                      onClick={() => setup.startSetup(type)}
                    >
                      Set up
                    </Button>
                  )}
                </SettingsRow>
              )
            })}
            {setup.visibleTypes.length === 0 && <EmptyState title='No matching sources.' />}
            {prepare.error && <InlineNotice intent='danger' message={prepare.error.message} />}
          </>
        )}
      </Modal>
    </>
  )
}
