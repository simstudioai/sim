import type { Finding } from '#design-conformance/model'

/** Explain style generation separately from changes to authored colour/size values. */
export function configurationExplanation(file: string, finding: Finding): string | undefined {
  if (/^(?:@source|@import)/.test(finding.property))
    return 'Style generation changed: Tailwind source/import directives determine which utilities reach the product stylesheet. Review even when this repairs missing styles.'
  if (finding.property === '@configuration' && /(?:tailwind|postcss)\.config\./.test(file))
    return 'Style generation configuration changed: source scanning, theme settings or plugins can change the CSS shipped to the product. Intentional repairs still need review; proposed configuration was parsed, never executed.'
  return undefined
}
