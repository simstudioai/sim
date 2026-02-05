import { Link, Section, Text } from '@react-email/components'
import { baseStyles, colors } from '@/components/emails/_styles'
import { EmailLayout } from '@/components/emails/components'
import { getBaseUrl } from '@/lib/core/utils/urls'
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

  const previewText = `${brand.name}: $${amount.toFixed(2)} in credits added to your account`

  return (
    <EmailLayout preview={previewText} showUnsubscribe={false}>
      <Text style={{ ...baseStyles.paragraph, marginTop: 0 }}>
        {userName ? `Hi ${userName},` : 'Hi,'}
      </Text>
      <Text style={baseStyles.paragraph}>
        Your credit purchase of <strong>${amount.toFixed(2)}</strong> has been confirmed.
      </Text>

      <Section style={baseStyles.infoBox}>
        <Text
          style={{
            margin: 0,
            fontSize: '14px',
            color: colors.textMuted,
            fontFamily: baseStyles.fontFamily,
          }}
        >
          Amount Added
        </Text>
        <Text
          style={{
            margin: '4px 0 16px',
            fontSize: '24px',
            fontWeight: 'bold',
            color: colors.textPrimary,
            fontFamily: baseStyles.fontFamily,
          }}
        >
          ${amount.toFixed(2)}
        </Text>
        <Text
          style={{
            margin: 0,
            fontSize: '14px',
            color: colors.textMuted,
            fontFamily: baseStyles.fontFamily,
          }}
        >
          New Balance
        </Text>
        <Text
          style={{
            margin: '4px 0 0',
            fontSize: '24px',
            fontWeight: 'bold',
            color: colors.textPrimary,
            fontFamily: baseStyles.fontFamily,
          }}
        >
          ${newBalance.toFixed(2)}
        </Text>
      </Section>

      <Text style={baseStyles.paragraph}>
        Credits are applied automatically to your workflow executions.
      </Text>

      <Link href={`${baseUrl}/workspace`} style={{ textDecoration: 'none' }}>
        <Text style={baseStyles.button}>View Dashboard</Text>
      </Link>

      {/* Divider */}
      <div style={baseStyles.divider} />

      <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
        Purchased on {purchaseDate.toLocaleDateString()}. View balance in Settings → Subscription.
      </Text>
    </EmailLayout>
  )
}

export default CreditPurchaseEmail
