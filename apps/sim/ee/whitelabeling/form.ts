import { HEX_COLOR_REGEX } from '@/lib/branding'
import type { WhitelabelSettingsPayload } from '@/ee/whitelabeling/hooks/whitelabel'

/** Shapes typed or pasted text into a hex color as it is entered. */
export function normalizeHexInput(raw: string): string {
  let value = raw.trim()
  if (value && !value.startsWith('#')) value = `#${value}`
  value = value.slice(0, 1) + value.slice(1).replace(/[^0-9a-fA-F]/g, '')
  return value.slice(0, 7)
}

interface WhitelabelForm {
  brandName: string
  logoUrl: string | null
  wordmarkUrl: string | null
  primaryColor: string
  primaryHoverColor: string
  accentColor: string
  accentHoverColor: string
  supportEmail: string
  documentationUrl: string
  termsUrl: string
  privacyUrl: string
}

/** The message for the first color that would not save, or null when all of them would. */
export function findInvalidWhitelabelColor(form: WhitelabelForm): string | null {
  const colors: Array<[string, string]> = [
    ['Primary color', form.primaryColor],
    ['Primary hover color', form.primaryHoverColor],
    ['Accent color', form.accentColor],
    ['Accent hover color', form.accentHoverColor],
  ]
  for (const [fieldName, value] of colors) {
    if (value && !HEX_COLOR_REGEX.test(value)) {
      return `${fieldName} must be a valid hex color (e.g. #33c482)`
    }
  }
  return null
}

/** The whole document the update saves. An empty field clears its stored value. */
export function toWhitelabelPayload(form: WhitelabelForm): WhitelabelSettingsPayload {
  return {
    brandName: form.brandName || null,
    logoUrl: form.logoUrl || null,
    wordmarkUrl: form.wordmarkUrl || null,
    primaryColor: form.primaryColor || null,
    primaryHoverColor: form.primaryHoverColor || null,
    accentColor: form.accentColor || null,
    accentHoverColor: form.accentHoverColor || null,
    supportEmail: form.supportEmail || null,
    documentationUrl: form.documentationUrl || null,
    termsUrl: form.termsUrl || null,
    privacyUrl: form.privacyUrl || null,
  }
}
