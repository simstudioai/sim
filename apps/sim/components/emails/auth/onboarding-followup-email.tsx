import { Body, Head, Html, Preview, Text } from '@react-email/components'

interface OnboardingFollowupEmailProps {
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

export function OnboardingFollowupEmail({ userName }: OnboardingFollowupEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Quick question</Preview>
      <Body style={styles.body}>
        <div style={styles.container}>
          <Text style={styles.p}>{userName ? `Hey ${userName},` : 'Hey,'}</Text>
          <Text style={styles.p}>
            It&apos;s been a few days since you signed up. I hope you&apos;re enjoying Sim!
          </Text>
          <Text style={styles.p}>
            I&apos;d love to know — what did you expect when you signed up vs. what did you get?
          </Text>
          <Text style={styles.p}>
            A reply with your thoughts would really help us improve the product for everyone.
          </Text>
          <Text style={styles.p}>
            Thanks,
            <br />
            Emir
            <br />
            Founder, Sim
          </Text>
        </div>
      </Body>
    </Html>
  )
}

export default OnboardingFollowupEmail
