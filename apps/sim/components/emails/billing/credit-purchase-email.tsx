import { Section, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailButton, EmailLayout, EmailStrong } from '@/components/emails/components'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { getBrandConfig } from '@/ee/whitelabeling'

interface CreditPurchaseEmailProps {
  userName?: string
  amount: number
  newBalance: number
  purchaseDate?: Date
}

export function CreditPurchaseEmail({
  userName,
  amount,
  newBalance,
  purchaseDate = new Date(),
}: CreditPurchaseEmailProps) {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()

  const previewText = `${brand.name}: ${dollarsToCredits(amount).toLocaleString()} credits added to your account`

  return (
    <EmailLayout preview={previewText} showUnsubscribe={false}>
      <Text style={baseStyles.greeting}>{userName ? `Hi ${userName},` : 'Hi,'}</Text>
      <Text style={baseStyles.paragraph}>
        Your credit purchase of{' '}
        <EmailStrong>{dollarsToCredits(amount).toLocaleString()} credits</EmailStrong> has been
        confirmed.
      </Text>

      <Section style={baseStyles.infoBox}>
        <Text style={baseStyles.infoBoxLabel}>Amount Added</Text>
        <Text style={{ ...baseStyles.infoBoxValue, marginBottom: '16px' }}>
          {dollarsToCredits(amount).toLocaleString()} credits
        </Text>
        <Text style={baseStyles.infoBoxLabel}>New Balance</Text>
        <Text style={baseStyles.infoBoxValue}>
          {dollarsToCredits(newBalance).toLocaleString()} credits
        </Text>
      </Section>

      <Text style={baseStyles.paragraph}>
        Credits are applied automatically to your workflow executions.
      </Text>

      <EmailButton href={`${baseUrl}${APP_ENTRY_PATH}`}>View Dashboard</EmailButton>

      <div style={baseStyles.divider} />

      <Text style={baseStyles.footnote}>
        Purchased on {purchaseDate.toLocaleDateString()}. View balance in Settings → Subscription.
      </Text>
    </EmailLayout>
  )
}

export default CreditPurchaseEmail
