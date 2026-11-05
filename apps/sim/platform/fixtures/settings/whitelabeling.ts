import { toRecord } from '@sim/utils/object'
import type { SettingsFixtureState } from '@/platform/fixtures/settings/state'

const STAR_MARK =
  '<path fill="#389480" d="M16 1l3.8 11.2L31 16l-11.2 3.8L16 31l-3.8-11.2L1 16l11.2-3.8z"/>'

function sampleImage(wordmark: boolean) {
  const width = wordmark ? 166 : 32
  const text = wordmark
    ? '<text x="38" y="23" font-family="sans-serif" font-size="22" font-weight="bold" fill="#389480">Northstar</text>'
    : ''
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="32" viewBox="0 0 ${width} 32">${STAR_MARK}${text}</svg>`)}`
}

function initialBranding(state: SettingsFixtureState) {
  if (state.scenario === 'empty') return {}
  const stress = state.scenario === 'stress'
  return {
    brandName: stress ? 'Northstar International Customer Operations and Research' : 'Northstar',
    logoUrl: sampleImage(false),
    wordmarkUrl: sampleImage(true),
    primaryColor: '#23594c',
    primaryHoverColor: '#194237',
    accentColor: '#d99941',
    accentHoverColor: '#bd802e',
    supportEmail: stress
      ? 'international-operations-support@northstar.example'
      : 'support@northstar.example',
    documentationUrl: stress
      ? 'https://northstar.example/reference/international-customer-operations'
      : 'https://northstar.example/docs',
    termsUrl: 'https://northstar.example/terms',
    privacyUrl: 'https://northstar.example/privacy',
  }
}

/** The settings response omits cleared overrides, restoring their workspace fallback. */
export async function whitelabelFixture(request: Request, state: SettingsFixtureState) {
  const key = 'whitelabel'
  const values = { ...toRecord(state.records.get(key) ?? initialBranding(state)) }
  if (request.method === 'PUT') {
    for (const [field, value] of Object.entries(toRecord(await request.json()))) {
      if (value === null) delete values[field]
      else values[field] = value
    }
    state.records.set(key, values)
  }
  return { success: true, isEnterprise: true, data: values }
}

/** Keeps selected image bytes in the fixture document for subsequent Settings visits. */
export function readBrandImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Could not read the image.'))
    }
    reader.onerror = () => reject(new Error('Could not read the image.'))
    reader.readAsDataURL(file)
  })
}
