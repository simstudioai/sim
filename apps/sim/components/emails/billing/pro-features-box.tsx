import { Section, Text } from '@react-email/components'
import { baseStyles, colors, fontWeight, typography } from '@/components/emails/_styles'
import { proFeatures } from '@/components/emails/billing/constants'

/**
 * The "Pro includes" panel shared by the two free-tier upgrade prompts
 * ({@link CreditsExhaustedEmail}, {@link FreeTierUpgradeEmail}).
 *
 * A plain `infoBox` with a two-column table body — the table is what keeps the
 * label and its qualifier on one row across email clients, which a list cannot
 * do reliably.
 */
export function ProFeaturesBox() {
  return (
    <Section style={baseStyles.infoBox}>
      <Text style={baseStyles.infoBoxTitle}>Pro includes</Text>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {proFeatures.map((feature) => (
            <tr key={feature.label}>
              <td
                style={{
                  padding: '4px 0',
                  fontSize: typography.fontSize.md,
                  lineHeight: '1.6',
                  fontWeight: fontWeight.semibold,
                  color: colors.textPrimary,
                  fontFamily: typography.fontFamily,
                  width: '45%',
                }}
              >
                {feature.label}
              </td>
              <td
                style={{
                  padding: '4px 0',
                  fontSize: typography.fontSize.md,
                  lineHeight: '1.6',
                  color: colors.textBody,
                  fontFamily: typography.fontFamily,
                }}
              >
                {feature.desc}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}

export default ProFeaturesBox
