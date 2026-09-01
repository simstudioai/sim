import { Body, Head, Html, Preview, Text } from 'react-email'
import { plainEmailStyles as styles } from '@/components/emails/_styles'
import { getBrandConfig } from '@/ee/whitelabeling'

interface OnboardingFollowupEmailProps {
  userName?: string
}

export function OnboardingFollowupEmail({ userName }: OnboardingFollowupEmailProps) {
  const brand = getBrandConfig()

  return (
    <Html>
      <Head />
      <Preview>Quick question</Preview>
      <Body style={styles.body}>
        <div style={styles.container}>
          <Text style={styles.p}>{userName ? `Hey ${userName},` : 'Hey,'}</Text>
          <Text style={styles.p}>
            It&apos;s been a few days since you signed up. I hope you&apos;re enjoying {brand.name}!
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
            Founder, {brand.name}
          </Text>
        </div>
      </Body>
    </Html>
  )
}

export default OnboardingFollowupEmail
