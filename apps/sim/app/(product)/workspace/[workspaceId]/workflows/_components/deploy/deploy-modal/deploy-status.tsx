'use client'

import { InlineNotice } from '@sim/emcn/status'
import type { DeploymentOperationSummary } from '@/platform/lib/data/workflow-deploy'

interface DeployStatusProps {
  isDeployed: boolean
  attemptStatus?: DeploymentOperationSummary['status']
  attemptError?: string | null
}

/**
 * A deployment attempt still in flight (retrying once it recorded a transient error) or one that
 * failed, with what it means for the live version. A settled deployment needs no notice: the
 * versions table marks the live version and the footer offers Update when the draft changed.
 */
export function DeployStatus({ isDeployed, attemptStatus, attemptError }: DeployStatusProps) {
  if (attemptStatus === 'preparing' || attemptStatus === 'activating') {
    const meaning = attemptError
      ? isDeployed
        ? 'Retrying automatically. The current version stays live until cutover completes.'
        : 'Retrying automatically. The workflow goes live once activation completes.'
      : isDeployed
        ? 'A new version is being prepared. The current version stays live until cutover completes.'
        : 'Triggers and schedules are being registered. The workflow goes live once activation completes.'
    return (
      <InlineNotice
        intent='warning'
        message={attemptError ? `${attemptError} ${meaning}` : meaning}
      />
    )
  }
  if (attemptStatus === 'failed')
    return (
      <InlineNotice
        intent='danger'
        message={`${attemptError || 'Deployment preparation failed.'} ${
          isDeployed
            ? 'The previously deployed version is still live.'
            : 'The workflow remains undeployed.'
        }`}
      />
    )
  return null
}
