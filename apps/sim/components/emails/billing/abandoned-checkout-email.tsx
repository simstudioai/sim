import { Body, Head, Html, Preview, Text } from '@react-email/components'
import { plainEmailStyles as styles } from '@/components/emails/_styles'
import { getBrandConfig } from '@/ee/whitelabeling'

interface AbandonedCheckoutEmailProps {
  userName?: string
}

export function AbandonedCheckoutEmail({ userName }: AbandonedCheckoutEmailProps) {
  const brand = getBrandConfig()

  return (
    <Html>
      <Head />
      <Preview>Did you run into an issue with your upgrade?</Preview>
      <Body style={styles.body}>
        <div style={styles.container}>
          <Text style={styles.p}>{userName ? `Hi ${userName},` : 'Hi,'}</Text>
          <Text style={styles.p}>
            I saw that you tried to upgrade your {brand.name} plan but didn&apos;t end up completing
            it.
          </Text>
          <Text style={styles.p}>
            Did you run into an issue, or did you have a question? Here to help.
          </Text>
          <Text style={styles.p}>
            — Emir
            <br />
            Founder, {brand.name}
          </Text>
        </div>
      </Body>
    </Html>
  )
}

export default AbandonedCheckoutEmail
