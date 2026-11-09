'use client'

import { StatusTag } from '@sim/emcn/status'
import { Tooltip } from '@sim/emcn/tooltip'
import type { DeploymentOperationSummary } from '@/platform/lib/data/workflow-deploy'

interface DeployStatusProps {
  isDeployed: boolean
  needsRedeployment: boolean
  attemptStatus?: DeploymentOperationSummary['status']
  attemptError?: string | null
}

/**
 * Where the deployment stands: a pending attempt (retrying once it recorded a transient error) or
 * a failed one, with what it means for the live version, else Live or Update deployment.
 */
export function DeployStatus({
  isDeployed,
  needsRedeployment,
  attemptStatus,
  attemptError,
}: DeployStatusProps) {
  if (attemptStatus === 'preparing' || attemptStatus === 'activating') {
    const retrying = Boolean(attemptError)
    const meaning = retrying
      ? isDeployed
        ? 'Retrying automatically. The current version stays live until cutover completes.'
        : 'Retrying automatically. The workflow goes live once activation completes.'
      : isDeployed
        ? 'A new version is being prepared. The current version stays live until cutover completes.'
        : 'Triggers and schedules are being registered. The workflow goes live once activation completes.'
    return (
      <Tooltip label={retrying ? `${attemptError} ${meaning}` : meaning}>
        <span>
          <StatusTag label={retrying ? 'Retrying' : 'Pending'} intent='warning' live />
        </span>
      </Tooltip>
    )
  }
  if (attemptStatus === 'failed')
    return (
      <Tooltip
        label={`${attemptError || 'Deployment preparation failed.'} ${
          isDeployed
            ? 'The previously deployed version is still live.'
            : 'The workflow remains undeployed.'
        }`}
      >
        <span>
          <StatusTag label='Failed' intent='danger' live />
        </span>
      </Tooltip>
    )
  if (!isDeployed) return null
  return (
    <StatusTag
      label={needsRedeployment ? 'Update deployment' : 'Live'}
      intent={needsRedeployment ? 'warning' : 'success'}
      live
    />
  )
}
