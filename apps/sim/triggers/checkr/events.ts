import { createCheckrTrigger } from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrAdverseActionCanceledTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_adverse_action_canceled'
)

export const checkrAdverseActionCompletedTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_adverse_action_completed'
)

export const checkrAdverseActionCreatedTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_adverse_action_created'
)

export const checkrAdverseActionNoticeNotDeliveredTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_adverse_action_notice_not_delivered'
)

export const checkrAdverseActionPausedTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_adverse_action_paused'
)

export const checkrAdverseActionResumedTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_adverse_action_resumed'
)

export const checkrCandidateCreatedTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_candidate_created'
)

export const checkrCandidateUpdatedTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_candidate_updated'
)

export const checkrContinuousCheckConfirmationRequiredTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_continuous_check_confirmation_required'
)

export const checkrContinuousCheckSubscriptionErrorTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_continuous_check_subscription_error'
)

export const checkrInvitationCompletedTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_invitation_completed'
)

export const checkrInvitationCreatedTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_invitation_created'
)

export const checkrInvitationDeletedTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_invitation_deleted'
)

export const checkrInvitationExpiredTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_invitation_expired'
)

export const checkrReportCanceledTrigger: TriggerConfig =
  createCheckrTrigger('checkr_report_canceled')

/** Primary Checkr trigger: carries the trigger-type dropdown for every Checkr event. */
export const checkrReportCompletedTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_report_completed',
  { includeDropdown: true }
)

export const checkrReportCreatedTrigger: TriggerConfig =
  createCheckrTrigger('checkr_report_created')

export const checkrReportDisputeCompletedTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_report_dispute_completed'
)

export const checkrReportDisputedTrigger: TriggerConfig =
  createCheckrTrigger('checkr_report_disputed')

export const checkrReportEngagedTrigger: TriggerConfig =
  createCheckrTrigger('checkr_report_engaged')

export const checkrReportPausedTrigger: TriggerConfig = createCheckrTrigger('checkr_report_paused')

export const checkrReportPostAdverseActionTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_report_post_adverse_action'
)

export const checkrReportPreAdverseActionTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_report_pre_adverse_action'
)

export const checkrReportResumedTrigger: TriggerConfig =
  createCheckrTrigger('checkr_report_resumed')

export const checkrReportSuspendedTrigger: TriggerConfig =
  createCheckrTrigger('checkr_report_suspended')

export const checkrReportUpdatedTrigger: TriggerConfig =
  createCheckrTrigger('checkr_report_updated')

export const checkrReportUpgradedTrigger: TriggerConfig =
  createCheckrTrigger('checkr_report_upgraded')

export const checkrVerificationCompletedTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_verification_completed'
)

export const checkrVerificationCreatedTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_verification_created'
)

export const checkrVerificationProcessedTrigger: TriggerConfig = createCheckrTrigger(
  'checkr_verification_processed'
)
