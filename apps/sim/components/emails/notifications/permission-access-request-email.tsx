import { Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailButton, EmailLayout } from '@/components/emails/components'
import { getBrandConfig } from '@/ee/whitelabeling'

interface PermissionAccessRequestEmailProps {
  kind: 'created' | 'decided'
  requestLink: string
}

/** Request details stay behind authenticated review, including in forwarded messages. */
export function PermissionAccessRequestEmail({
  kind,
  requestLink,
}: PermissionAccessRequestEmailProps) {
  const brand = getBrandConfig()
  const needsReview = kind === 'created'

  return (
    <EmailLayout
      preview={
        needsReview
          ? `An access request needs your review on ${brand.name}`
          : `Your access request was updated on ${brand.name}`
      }
      showUnsubscribe={false}
    >
      <Text style={baseStyles.greeting}>Hi,</Text>
      <Text style={baseStyles.paragraph}>
        {needsReview
          ? `There is a pending access request for an organization you administer on ${brand.name}. Sign in to review the request.`
          : `Your access request on ${brand.name} has been updated. Sign in to view its current status.`}
      </Text>
      <EmailButton href={requestLink}>
        {needsReview ? 'Review request' : 'View request'}
      </EmailButton>
    </EmailLayout>
  )
}
