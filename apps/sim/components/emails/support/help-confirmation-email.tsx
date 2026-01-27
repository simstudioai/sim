import { Text } from '@react-email/components'
import { format } from 'date-fns'
import { baseStyles } from '@/components/emails/_styles'
import { EmailLayout } from '@/components/emails/components'

interface HelpConfirmationEmailProps {
  type?: 'bug' | 'feedback' | 'feature_request' | 'other'
  attachmentCount?: number
  submittedDate?: Date
}

const getTypeLabel = (type: string) => {
  switch (type) {
    case 'bug':
      return 'Bug Report'
    case 'feedback':
      return 'Feedback'
    case 'feature_request':
      return 'Feature Request'
    case 'other':
      return 'General Inquiry'
    default:
      return 'Request'
  }
}

export function HelpConfirmationEmail({
  type = 'other',
  attachmentCount = 0,
  submittedDate = new Date(),
}: HelpConfirmationEmailProps) {
  const typeLabel = getTypeLabel(type)

  return (
    <EmailLayout
      preview={`Your ${typeLabel.toLowerCase()} has been received`}
      showUnsubscribe={false}
    >
      <Text style={baseStyles.paragraph}>Hello,</Text>
      <Text style={baseStyles.paragraph}>
        We've received your <strong>{typeLabel.toLowerCase()}</strong> and will get back to you
        shortly.
      </Text>

      {attachmentCount > 0 && (
        <Text style={baseStyles.paragraph}>
          {attachmentCount} image{attachmentCount > 1 ? 's' : ''} attached.
        </Text>
      )}

      {/* Divider */}
      <div style={baseStyles.divider} />

      <Text style={{ ...baseStyles.footerText, textAlign: 'left' }}>
        Submitted on {format(submittedDate, 'MMMM do, yyyy')}.
      </Text>
    </EmailLayout>
  )
}

export default HelpConfirmationEmail
