'use client'

import { Fragment } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { Button } from '@sim/emcn/button'
import { Icon } from '@sim/emcn/icon'
import { OverflowText } from '@sim/emcn/overflow-text'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { RowList } from '@sim/emcn/settings-section/row-list'
import { FailureNotice, Spinner, StatusTag } from '@sim/emcn/status'
import {
  ConnectorRecovery,
  MemberEnrollment,
} from '@/platform/app/(shell)/workspace/[workspaceId]/knowledge/[knowledgeBaseId]/_components/connector-recovery/connector-recovery'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/knowledge/[knowledgeBaseId]/_components/connectors-rail/connectors-rail.module.css'
import {
  CONNECTOR_STATUS,
  connectorMark,
} from '@/platform/app/(shell)/workspace/[workspaceId]/knowledge/[knowledgeBaseId]/_components/knowledge-base/model'
import {
  CONNECTOR_META_REGISTRY,
  type ConnectorData,
  describeSearchSource,
  getConnectorSyncState,
} from '@/platform/lib/data/knowledge/connectors'
import { formatRelativeTime } from '@/platform/shared/time'

interface ConnectorsRailProps {
  workspaceId: string
  knowledgeBaseId: string
  isSearchIndex: boolean
  connectors: readonly ConnectorData[]
  error: Error | null
  onRetry: () => void
  canEdit: boolean
  /** Opens a connector's settings, documents and history. */
  onOpen: (connectorId: string) => void
  onNew: () => void
}

/**
 * The sources that sync into a knowledge base, beside its documents: each with its mark, what it
 * syncs, where its sync stands and when it last ran, and whatever needs attention before it can
 * sync again. A connector opens its dialog; the rail also starts a new one.
 */
export function ConnectorsRail({
  workspaceId,
  knowledgeBaseId,
  isSearchIndex,
  connectors,
  error,
  onRetry,
  canEdit,
  onOpen,
  onNew,
}: ConnectorsRailProps) {
  const scroller = useScrollEdges<HTMLElement>('vertical')
  const now = Date.now()
  return (
    <aside ref={scroller} className={styles.rail} aria-label='Connectors'>
      <div className={styles.heading}>
        <h2 data-type='T093'>Connectors</h2>
        {canEdit && (
          <Button variant='quiet' size='compact' icon='I074' onClick={onNew}>
            New
          </Button>
        )}
      </div>
      {error ? (
        <FailureNotice message='Could not load connectors.' onRetry={onRetry} />
      ) : connectors.length === 0 ? (
        <p className={styles.empty} data-type='T060'>
          No connected sources yet.
        </p>
      ) : (
        <RowList label='Connected sources'>
          {connectors.map((connector) => {
            const meta = CONNECTOR_META_REGISTRY[connector.connectorType]
            const name = meta?.name ?? connector.connectorType
            const state = getConnectorSyncState(connector)
            const status = CONNECTOR_STATUS[state.effectiveStatus] ?? CONNECTOR_STATUS.active
            const source = meta ? describeSearchSource(meta, connector.sourceConfig) : ''
            const lastSync = state.lastSyncAt
              ? `Synced ${formatRelativeTime(new Date(state.lastSyncAt).getTime(), now)}`
              : state.syncInFlight
                ? undefined
                : 'Not synced yet'
            return (
              <Fragment key={connector.id}>
                <ActivityRow
                  leading={<Icon providerId={connectorMark(connector.connectorType)} />}
                  title={name}
                  wrapDetail
                  detailContent={
                    <span className={styles.detail}>
                      {source && <OverflowText text={source}>{source}</OverflowText>}
                      <span className={styles.tags}>
                        <StatusTag
                          label={status.label}
                          intent={status.intent}
                          leading={state.syncInFlight ? <Spinner /> : undefined}
                        />
                        {state.syncsPerMember && <StatusTag label='Per member' />}
                        {lastSync}
                      </span>
                    </span>
                  }
                  onOpen={() => onOpen(connector.id)}
                />
                <li className={styles.attention}>
                  {connector.accessRewritePending && (
                    <span className={styles.pending} data-type='T052'>
                      <Spinner />
                      Updating access
                    </span>
                  )}
                  {connector.viewerMembership && connector.viewerMembership !== 'connected' && (
                    <MemberEnrollment
                      knowledgeBaseId={knowledgeBaseId}
                      connectorId={connector.id}
                      isSearchIndex={isSearchIndex}
                      membership={connector.viewerMembership}
                    />
                  )}
                  <ConnectorRecovery
                    workspaceId={workspaceId}
                    knowledgeBaseId={knowledgeBaseId}
                    connector={connector}
                    isSearchIndex={isSearchIndex}
                    canEdit={canEdit}
                    onOpenSettings={() => onOpen(connector.id)}
                  />
                </li>
              </Fragment>
            )
          })}
        </RowList>
      )}
    </aside>
  )
}
