import type { ComponentType, ReactNode, Ref } from 'react'
import { Badge, cn, handleKeyboardActivation, Tooltip } from '@sim/emcn'
import { Handle, Position } from 'reactflow'
import { HANDLE_POSITIONS } from '../dimensions'
import { OverflowSpan } from '../lib/overflow-span'
import { tileIconColorClass } from '../lib/tile-icon-color'
import type { BlockRunStatus } from '../types'
import { SubBlockRowView } from './sub-block-row-view'

/**
 * Reusable styles and positioning for Handle components.
 */
const getHandleClasses = (position: 'left' | 'right' | 'top' | 'bottom', isError = false) => {
  const baseClasses = '!z-[0] !cursor-crosshair !border-none !transition-[colors] !duration-150'
  const colorClasses = isError ? '!bg-[var(--text-error)]' : '!bg-[var(--workflow-edge)]'

  const positionClasses = {
    left: '!left-[-8px] !h-5 !w-[7px] !rounded-l-[2px] !rounded-r-none hover-hover:!left-[-11px] hover-hover:!w-[10px] hover-hover:!rounded-l-full',
    right:
      '!right-[-8px] !h-5 !w-[7px] !rounded-r-[2px] !rounded-l-none hover-hover:!right-[-11px] hover-hover:!w-[10px] hover-hover:!rounded-r-full',
    top: '!top-[-8px] !h-[7px] !w-5 !rounded-t-[2px] !rounded-b-none hover-hover:!top-[-11px] hover-hover:!h-[10px] hover-hover:!rounded-t-full',
    bottom:
      '!bottom-[-8px] !h-[7px] !w-5 !rounded-b-[2px] !rounded-t-none hover-hover:!bottom-[-11px] hover-hover:!h-[10px] hover-hover:!rounded-b-full',
  }

  return cn(baseClasses, colorClasses, positionClasses[position])
}

const getHandleStyle = (position: 'horizontal' | 'vertical') => {
  if (position === 'horizontal') {
    return { top: `${HANDLE_POSITIONS.DEFAULT_Y_OFFSET}px`, transform: 'translateY(-50%)' }
  }
  return { left: '50%', transform: 'translateX(-50%)' }
}

/**
 * Props for the pure workflow-block renderer.
 *
 * Presentation comes from the editor (or docs) container: visual flags
 * (enabled/locked/pending/ring), handle topology (condition/router rows), and
 * the resolved badge state (child-deploy, schedule, webhook) are all computed
 * upstream and passed in. The block icon, content rows, and editor-only action
 * bar are injected as slots so the pure renderer carries no store, query, or
 * registry coupling.
 */
export interface WorkflowBlockViewProps {
  /** Block identity and visual state, resolved by the container. */
  id: string
  type: string
  name: string
  isPending?: boolean
  isEnabled: boolean
  isLocked: boolean
  hasRing: boolean
  ringStyles: string
  /** Resolved run-path outcome, drives the muted-name styling. */
  runPathStatus?: BlockRunStatus
  /** Block icon component and its background color. */
  Icon: ComponentType<{ className?: string }>
  iconBgColor: string

  /** Handle orientation and topology, resolved by the container. */
  horizontalHandles: boolean
  shouldShowDefaultHandles: boolean
  hasContentBelowHeader: boolean
  conditionRows: { id: string; title: string; value: string }[]
  routerRows: { id: string; value: string }[]
  /** Router 'Context' summary-row value (router_v2 only). */
  routerContextValue?: string
  /** Connection-cycle guard; reads fresh edge state on every call. */
  wouldCreateConnectionCycle: (source: string, target: string) => boolean

  /** Deprecation badge — editor-only. When set, an amber "deprecated" badge shows;
   * clicking (gated on `canFixDeprecation`) invokes `onFixDeprecation`. */
  deprecationTooltip?: string
  canFixDeprecation?: boolean
  onFixDeprecation?: () => void

  /** Child-workflow deploy badge state — editor-only; omit in read-only contexts. */
  isWorkflowSelector?: boolean
  childWorkflowId?: string
  childIsDeployed?: boolean | null
  childNeedsRedeploy?: boolean
  isDeploying?: boolean
  canAdmin?: boolean
  onDeployChild?: () => void

  /** Schedule badge state — editor-only; omit in read-only contexts. */
  shouldShowScheduleBadge?: boolean
  scheduleIsDisabled?: boolean
  onReactivateSchedule?: () => void

  /** Webhook badge state — editor-only; omit in read-only contexts. */
  showWebhookIndicator?: boolean
  webhookProvider?: string
  webhookPath?: string
  webhookProviderName?: string
  isWebhookConfigured?: boolean
  isWebhookDisabled?: boolean
  webhookId?: string
  onReactivateWebhook?: () => void

  /** Selects this block in the editor panel. */
  onSelect: () => void
  /** Ref attached to the inner content container. */
  contentRef?: Ref<HTMLDivElement>
  /** Editor-only action bar; omit in read-only / preview contexts. */
  actionBar?: ReactNode
  /**
   * Non-branch collapsed subblock summary rows, built by the container.
   * Condition/router/error rows are rendered by the view itself from
   * conditionRows/routerRows.
   */
  rows: ReactNode
}

/**
 * Pure renderer for a workflow block: a header (icon, name, status badges), an
 * optional content section of collapsed subblock rows, and the full handle
 * topology (default/condition/router/error connection handles).
 */
export function WorkflowBlockView({
  id,
  type,
  name,
  isPending,
  isEnabled,
  isLocked,
  hasRing,
  ringStyles,
  runPathStatus,
  Icon,
  iconBgColor,
  horizontalHandles,
  shouldShowDefaultHandles,
  hasContentBelowHeader,
  conditionRows,
  routerRows,
  routerContextValue,
  wouldCreateConnectionCycle,
  deprecationTooltip,
  canFixDeprecation,
  onFixDeprecation,
  isWorkflowSelector,
  childWorkflowId,
  childIsDeployed,
  childNeedsRedeploy,
  isDeploying,
  canAdmin,
  onDeployChild,
  shouldShowScheduleBadge,
  scheduleIsDisabled,
  onReactivateSchedule,
  showWebhookIndicator,
  webhookProvider,
  webhookPath,
  webhookProviderName,
  isWebhookConfigured,
  isWebhookDisabled,
  webhookId,
  onReactivateWebhook,
  onSelect,
  contentRef,
  actionBar,
  rows,
}: WorkflowBlockViewProps) {
  return (
    <div className='group relative'>
      <div
        ref={contentRef}
        role='button'
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(event) => handleKeyboardActivation(event, onSelect)}
        className={cn(
          'workflow-drag-handle relative z-[20] w-[250px] cursor-grab select-none rounded-lg border border-[var(--border-1)] bg-[var(--surface-2)] [&:active]:cursor-grabbing'
        )}
      >
        {isPending && (
          <div className='-top-6 -translate-x-1/2 absolute left-1/2 z-10 transform rounded-t-md bg-amber-500 px-2 py-0.5 text-white text-xs'>
            Next Step
          </div>
        )}

        {actionBar}

        {shouldShowDefaultHandles && (
          <Handle
            type='target'
            position={horizontalHandles ? Position.Left : Position.Top}
            id='target'
            className={getHandleClasses(horizontalHandles ? 'left' : 'top')}
            style={getHandleStyle(horizontalHandles ? 'horizontal' : 'vertical')}
            data-nodeid={id}
            data-handleid='target'
            isConnectableStart={false}
            isConnectableEnd={true}
            isValidConnection={(connection) => {
              if (connection.source === id) return false
              return !wouldCreateConnectionCycle(connection.source!, connection.target!)
            }}
          />
        )}

        <div
          className={cn(
            'flex items-center justify-between p-2',
            hasContentBelowHeader && 'border-[var(--border-1)] border-b'
          )}
        >
          <div className='relative z-10 flex min-w-0 flex-1 items-center gap-2.5'>
            <div
              className='flex size-[24px] flex-shrink-0 items-center justify-center rounded-md'
              style={{
                background: isEnabled ? iconBgColor : 'gray',
              }}
            >
              <Icon
                className={cn(
                  'size-[16px]',
                  isEnabled ? tileIconColorClass(iconBgColor) : 'text-[var(--text-icon)]'
                )}
              />
            </div>
            <OverflowSpan
              value={name}
              className={cn(
                'truncate font-medium text-md',
                !isEnabled && runPathStatus !== 'success' && 'text-[var(--text-muted)]'
              )}
            />
          </div>
          <div className='relative z-10 flex flex-shrink-0 items-center gap-1'>
            {deprecationTooltip && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Badge
                    variant='amber'
                    className={canFixDeprecation ? 'cursor-pointer' : 'cursor-not-allowed'}
                    dot
                    role={canFixDeprecation ? 'button' : undefined}
                    tabIndex={canFixDeprecation ? 0 : undefined}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (canFixDeprecation) onFixDeprecation?.()
                    }}
                    onKeyDown={
                      canFixDeprecation
                        ? (e) => {
                            e.stopPropagation()
                            handleKeyboardActivation(e, () => onFixDeprecation?.())
                          }
                        : undefined
                    }
                  >
                    deprecated
                  </Badge>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <span className='text-sm'>
                    {canFixDeprecation ? deprecationTooltip : 'Edit access required to fix'}
                  </span>
                </Tooltip.Content>
              </Tooltip.Root>
            )}
            {isWorkflowSelector &&
              childWorkflowId &&
              typeof childIsDeployed === 'boolean' &&
              (!childIsDeployed || childNeedsRedeploy) && (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Badge
                      variant={!childIsDeployed ? 'red' : 'amber'}
                      className={canAdmin ? 'cursor-pointer' : 'cursor-not-allowed'}
                      dot
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeployChild?.()
                      }}
                    >
                      {isDeploying ? 'Deploying...' : !childIsDeployed ? 'undeployed' : 'redeploy'}
                    </Badge>
                  </Tooltip.Trigger>
                  <Tooltip.Content>
                    <span className='text-sm'>
                      {!canAdmin
                        ? 'Admin permission required to deploy'
                        : !childIsDeployed
                          ? 'Click to deploy'
                          : 'Click to redeploy'}
                    </span>
                  </Tooltip.Content>
                </Tooltip.Root>
              )}
            {!isEnabled && !isLocked && <Badge variant='gray-secondary'>disabled</Badge>}
            {isLocked && <Badge variant='gray-secondary'>locked</Badge>}

            {type === 'schedule' && shouldShowScheduleBadge && scheduleIsDisabled && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Badge
                    variant='amber'
                    className='cursor-pointer'
                    dot
                    onClick={(e) => {
                      e.stopPropagation()
                      onReactivateSchedule?.()
                    }}
                  >
                    disabled
                  </Badge>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <span className='text-sm'>Click to reactivate</span>
                </Tooltip.Content>
              </Tooltip.Root>
            )}

            {showWebhookIndicator && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Badge variant='orange' dot>
                    Webhook
                  </Badge>
                </Tooltip.Trigger>
                <Tooltip.Content side='top' className='max-w-[300px]'>
                  {webhookProvider && webhookPath ? (
                    <>
                      <p className='text-sm'>{webhookProviderName} Webhook</p>
                      <p className='mt-1 text-muted-foreground text-xs'>Path: {webhookPath}</p>
                    </>
                  ) : (
                    <p className='text-muted-foreground text-sm'>
                      This workflow is triggered by a webhook.
                    </p>
                  )}
                </Tooltip.Content>
              </Tooltip.Root>
            )}

            {isWebhookConfigured && isWebhookDisabled && webhookId && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Badge
                    variant='amber'
                    className='cursor-pointer'
                    dot
                    onClick={(e) => {
                      e.stopPropagation()
                      onReactivateWebhook?.()
                    }}
                  >
                    disabled
                  </Badge>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <span className='text-sm'>Click to reactivate</span>
                </Tooltip.Content>
              </Tooltip.Root>
            )}
            {/* {isActive && (
              <div className='mr-0.5 ml-2 flex size-[16px] items-center justify-center'>
                <div
                  className='h-full w-full animate-spin-slow rounded-full border-[2.5px] border-[rgba(255,102,0,0.25)] border-t-[var(--warning)]'
                  aria-hidden='true'
                />
              </div>
            )} */}
          </div>
        </div>

        {hasContentBelowHeader && (
          <div className='flex flex-col gap-2 p-2'>
            {type === 'condition' ? (
              conditionRows.map((cond) => (
                <SubBlockRowView key={cond.id} title={cond.title} displayValue={cond.value} />
              ))
            ) : type === 'router_v2' ? (
              <>
                <SubBlockRowView key='context' title='Context' displayValue={routerContextValue} />
                {routerRows.map((route, index) => (
                  <SubBlockRowView
                    key={route.id}
                    title={`Route ${index + 1}`}
                    displayValue={route.value}
                  />
                ))}
              </>
            ) : (
              rows
            )}
            {shouldShowDefaultHandles && <SubBlockRowView title='error' />}
          </div>
        )}

        {type === 'condition' && (
          <>
            {conditionRows.map((cond, condIndex) => {
              const topOffset =
                HANDLE_POSITIONS.CONDITION_START_Y +
                condIndex * HANDLE_POSITIONS.CONDITION_ROW_HEIGHT
              return (
                <Handle
                  key={`handle-${cond.id}`}
                  type='source'
                  position={Position.Right}
                  id={`condition-${cond.id}`}
                  className={getHandleClasses('right')}
                  style={{ top: `${topOffset}px`, transform: 'translateY(-50%)' }}
                  data-nodeid={id}
                  data-handleid={`condition-${cond.id}`}
                  isConnectableStart={true}
                  isConnectableEnd={false}
                  isValidConnection={(connection) => {
                    if (connection.target === id) return false
                    return !wouldCreateConnectionCycle(connection.source!, connection.target!)
                  }}
                />
              )
            })}
            <Handle
              type='source'
              position={Position.Right}
              id='error'
              className={getHandleClasses('right', true)}
              style={{
                right: '-7px',
                top: 'auto',
                bottom: `${HANDLE_POSITIONS.ERROR_BOTTOM_OFFSET}px`,
                transform: 'translateY(50%)',
              }}
              data-nodeid={id}
              data-handleid='error'
              isConnectableStart={true}
              isConnectableEnd={false}
              isValidConnection={(connection) => {
                if (connection.target === id) return false
                return !wouldCreateConnectionCycle(connection.source!, connection.target!)
              }}
            />
          </>
        )}

        {type === 'router_v2' && (
          <>
            {routerRows.map((route, routeIndex) => {
              // +1 row offset for context row at the top
              const topOffset =
                HANDLE_POSITIONS.CONDITION_START_Y +
                (routeIndex + 1) * HANDLE_POSITIONS.CONDITION_ROW_HEIGHT
              return (
                <Handle
                  key={`handle-${route.id}`}
                  type='source'
                  position={Position.Right}
                  id={`router-${route.id}`}
                  className={getHandleClasses('right')}
                  style={{ top: `${topOffset}px`, transform: 'translateY(-50%)' }}
                  data-nodeid={id}
                  data-handleid={`router-${route.id}`}
                  isConnectableStart={true}
                  isConnectableEnd={false}
                  isValidConnection={(connection) => {
                    if (connection.target === id) return false
                    return !wouldCreateConnectionCycle(connection.source!, connection.target!)
                  }}
                />
              )
            })}
            <Handle
              type='source'
              position={Position.Right}
              id='error'
              className={getHandleClasses('right', true)}
              style={{
                right: '-7px',
                top: 'auto',
                bottom: `${HANDLE_POSITIONS.ERROR_BOTTOM_OFFSET}px`,
                transform: 'translateY(50%)',
              }}
              data-nodeid={id}
              data-handleid='error'
              isConnectableStart={true}
              isConnectableEnd={false}
              isValidConnection={(connection) => {
                if (connection.target === id) return false
                return !wouldCreateConnectionCycle(connection.source!, connection.target!)
              }}
            />
          </>
        )}

        {type !== 'condition' && type !== 'router_v2' && type !== 'response' && (
          <>
            <Handle
              type='source'
              position={horizontalHandles ? Position.Right : Position.Bottom}
              id='source'
              className={getHandleClasses(horizontalHandles ? 'right' : 'bottom')}
              style={getHandleStyle(horizontalHandles ? 'horizontal' : 'vertical')}
              data-nodeid={id}
              data-handleid='source'
              isConnectableStart={true}
              isConnectableEnd={false}
              isValidConnection={(connection) => {
                if (connection.target === id) return false
                return !wouldCreateConnectionCycle(connection.source!, connection.target!)
              }}
            />

            {shouldShowDefaultHandles && (
              <Handle
                type='source'
                position={Position.Right}
                id='error'
                className={getHandleClasses('right', true)}
                style={{
                  right: '-7px',
                  top: 'auto',
                  bottom: `${HANDLE_POSITIONS.ERROR_BOTTOM_OFFSET}px`,
                  transform: 'translateY(50%)',
                }}
                data-nodeid={id}
                data-handleid='error'
                isConnectableStart={true}
                isConnectableEnd={false}
                isValidConnection={(connection) => {
                  if (connection.target === id) return false
                  return !wouldCreateConnectionCycle(connection.source!, connection.target!)
                }}
              />
            )}
          </>
        )}
        {hasRing && (
          <div className={cn('pointer-events-none absolute inset-0 z-40 rounded-lg', ringStyles)} />
        )}
      </div>
    </div>
  )
}
