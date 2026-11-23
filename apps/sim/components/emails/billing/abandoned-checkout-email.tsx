import { Body, Head, Html, Preview, Text } from '@react-email/components'
import { plainEmailStyles as styles } from '@/components/emails/_styles'

interface AbandonedCheckoutEmailProps {
  userName?: string
}

export function AbandonedCheckoutEmail({ userName }: AbandonedCheckoutEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Did you run into an issue with your upgrade?</Preview>
      <Body style={styles.body}>
        <div style={styles.container}>
          <Text style={styles.p}>{userName ? `Hi ${userName},` : 'Hi,'}</Text>
          <Text style={styles.p}>
            I saw that you tried to upgrade your Sim plan but didn&apos;t end up completing it.
          </Text>
          <Text style={styles.p}>
            Did you run into an issue, or did you have a question? Here to help.
          </Text>
          <Text style={styles.p}>
            — Emir
            <br />
            Founder, Sim
          </Text>
        </div>
      </Body>
    </Html>
  )
}

export default AbandonedCheckoutEmail
