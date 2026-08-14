import { Section, Text } from '@react-email/components'
import { baseStyles, colors, fontWeight } from '@/components/emails/_styles'
import { proFeatures } from '@/components/emails/billing/constants'

const CELL = { ...baseStyles.infoBoxList, padding: '4px 0' }
const LABEL_CELL = {
  ...CELL,
  fontWeight: fontWeight.semibold,
  color: colors.textPrimary,
  width: '45%',
}

/**
 * The "Pro includes" panel shared by the two free-tier upgrade prompts.
 *
 * The two-column table is what keeps a feature and its qualifier on one row
 * across email clients, which a list cannot do reliably.
 */
export function ProFeaturesBox() {
  return (
    <Section style={baseStyles.infoBox}>
      <Text style={baseStyles.infoBoxTitle}>Pro includes</Text>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {proFeatures.map((feature) => (
            <tr key={feature.label}>
              <td style={LABEL_CELL}>{feature.label}</td>
              <td style={CELL}>{feature.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}

export default ProFeaturesBox
