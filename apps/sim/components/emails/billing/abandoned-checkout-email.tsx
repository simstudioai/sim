import { Body, Head, Html, Preview, Text } from '@react-email/components'

interface AbandonedCheckoutEmailProps {
  userName?: string
}

const styles = {
  body: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    backgroundColor: '#ffffff',
    margin: '0',
    padding: '0',
  },
  container: {
    maxWidth: '560px',
    margin: '40px auto',
    padding: '0 24px',
  },
  p: {
    fontSize: '15px',
    lineHeight: '1.6',
    color: '#1a1a1a',
    margin: '0 0 16px',
  },
} as const

export function AbandonedCheckoutEmail({ userName }: AbandonedCheckoutEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Quick question</Preview>
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
