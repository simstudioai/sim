import { Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/_styles'
import { EmailButton, EmailLayout, EmailStrong } from '@/components/emails/components'

interface PlanEndedEmailProps {
  planName: string
  userName?: string
  upgradeLink: string
}

/**
 * Sent once when a paid plan ends and its payer is back on Free, because workflows built on Sim's
 * hosted models and tools stop working without warning otherwise.
 */
export function PlanEndedEmail({ planName, userName, upgradeLink }: PlanEndedEmailProps) {
  return (
    <EmailLayout preview={`Sim: Your ${planName} plan has ended`} showUnsubscribe={false}>
      <Text style={baseStyles.greeting}>{userName ? `Hi ${userName},` : 'Hi,'}</Text>

      <Text style={baseStyles.paragraph}>
        Your <EmailStrong>{planName}</EmailStrong> plan has ended, and you&apos;re now on the Free
        plan. Sim-hosted models and tools and Chat with Sim are no longer available, so workflows
        and schedules that use them will fail.
      </Text>

      <Text style={baseStyles.paragraph}>
        To keep them running, add your own provider keys under Settings → BYOK, or pick a plan
        again.
      </Text>

      <EmailButton href={upgradeLink}>View plans</EmailButton>

      <div style={baseStyles.divider} />

      <Text style={baseStyles.footnote}>Sent once when a paid plan ends.</Text>
    </EmailLayout>
  )
}

export default PlanEndedEmail
