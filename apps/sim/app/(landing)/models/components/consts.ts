import { MODEL_CATALOG_PROVIDERS } from '@/app/(landing)/models/utils'

const colorMap = new Map(
  MODEL_CATALOG_PROVIDERS.filter((p) => p.color).map((p) => [p.id, p.color as string])
)

export function getProviderColor(providerId: string): string {
  return colorMap.get(providerId) ?? '#888888'
}
