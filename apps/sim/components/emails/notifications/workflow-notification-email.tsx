import { Link, Section, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailLayout } from '@/components/emails/components'
import { getBrandConfig } from '@/ee/whitelabeling'

/**
 * Serialized rate limit status for email payloads.
 * Note: This differs from the canonical RateLimitStatus in @/lib/core/rate-limiter
 * which uses Date for resetAt. This version uses string for JSON serialization.
 */
export interface EmailRateLimitStatus {
  requestsPerMinute: number
  remaining: number
  maxBurst?: number
  resetAt?: string
}

export interface EmailRateLimitsData {
  sync?: EmailRateLimitStatus
  async?: EmailRateLimitStatus
}

export interface EmailUsageData {
  currentPeriodCost: number
  limit: number
  percentUsed: number
  isExceeded?: boolean
}

export interface WorkflowNotificationEmailProps {
  workflowName: string
  status: 'success' | 'error'
  trigger: string
  duration: string
  cost: string
  logUrl: string
  alertReason?: string
  finalOutput?: unknown
  rateLimits?: EmailRateLimitsData
  usageData?: EmailUsageData
}

function formatJsonForEmail(data: unknown): string {
  return JSON.stringify(data, null, 2)
}

export function WorkflowNotificationEmail({
  workflowName,
  status,
  trigger,
  duration,
  cost,
  logUrl,
  alertReason,
  finalOutput,
  rateLimits,
  usageData,
}: WorkflowNotificationEmailProps) {
  const brand = getBrandConfig()
  const isError = status === 'error'
  const statusText = isError ? 'Error' : 'Success'

  const previewText = alertReason
    ? `${brand.name}: Alert - ${workflowName}`
    : isError
      ? `${brand.name}: Workflow Failed - ${workflowName}`
      : `${brand.name}: Workflow Completed - ${workflowName}`

  const message = alertReason
    ? 'An alert was triggered for your workflow.'
    : isError
      ? 'Your workflow execution failed.'
      : 'Your workflow completed successfully.'

  return (
    <EmailLayout preview={previewText} showUnsubscribe={true}>
      <Text style={{ ...baseStyles.paragraph, marginTop: 0 }}>Hello,</Text>
      <Text style={baseStyles.paragraph}>{message}</Text>

      <Section style={baseStyles.infoBox}>
        {alertReason && (
          <Text style={baseStyles.infoBoxList}>
            <strong>Reason:</strong> {alertReason}
          </Text>
        )}
        <Text style={{ ...baseStyles.infoBoxList, marginTop: alertReason ? '4px' : 0 }}>
          <strong>Workflow:</strong> {workflowName}
        </Text>
        <Text style={{ ...baseStyles.infoBoxList, marginTop: '4px' }}>
          <strong>Status:</strong> {statusText}
        </Text>
        <Text style={{ ...baseStyles.infoBoxList, marginTop: '4px' }}>
          <strong>Trigger:</strong> {trigger}
        </Text>
        <Text style={{ ...baseStyles.infoBoxList, marginTop: '4px' }}>
          <strong>Duration:</strong> {duration}
        </Text>
        <Text style={{ ...baseStyles.infoBoxList, marginTop: '4px' }}>
          <strong>Cost:</strong> {cost}
        </Text>
      </Section>

      <Link href={logUrl} style={{ textDecoration: 'none' }}>
        <Text style={baseStyles.button}>View Execution Log</Text>
      </Link>

      {rateLimits && (rateLimits.sync || rateLimits.async) ? (
        <>
          <div style={baseStyles.divider} />
          <Section style={baseStyles.infoBox}>
            <Text style={baseStyles.infoBoxTitle}>Rate Limits</Text>
            {rateLimits.sync && (
              <Text style={baseStyles.infoBoxList}>
                Sync: {rateLimits.sync.remaining} of {rateLimits.sync.requestsPerMinute} remaining
              </Text>
            )}
            {rateLimits.async && (
              <Text style={{ ...baseStyles.infoBoxList, marginTop: rateLimits.sync ? '4px' : 0 }}>
                Async: {rateLimits.async.remaining} of {rateLimits.async.requestsPerMinute}{' '}
                remaining
              </Text>
            )}
          </Section>
        </>
      ) : null}

      {usageData ? (
        <>
          <div style={baseStyles.divider} />
          <Section style={baseStyles.infoBox}>
            <Text style={baseStyles.infoBoxTitle}>Usage</Text>
            <Text style={baseStyles.infoBoxList}>
              ${usageData.currentPeriodCost.toFixed(2)} of ${usageData.limit.toFixed(2)} used (
              {usageData.percentUsed.toFixed(1)}%)
            </Text>
          </Section>
        </>
      ) : null}

      {finalOutput ? (
        <>
          <div style={baseStyles.divider} />
          <Section style={baseStyles.infoBox}>
            <Text style={baseStyles.infoBoxTitle}>Final Output</Text>
            <Text style={{ ...baseStyles.codeBlock, marginTop: '8px' }}>
              {formatJsonForEmail(finalOutput)}
            </Text>
          </Section>
        </>
      ) : null}

      <div style={baseStyles.divider} />

      <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
        You're receiving this because you subscribed to workflow notifications.
      </Text>
    </EmailLayout>
  )
}

export default WorkflowNotificationEmail
