import type { MothershipBlockDetail } from '@/lib/api/contracts/mothership-catalog'
import { PROVIDER_DEFINITIONS } from '@/providers/models'

/** Enrich only authorized, already-published options; these facts never grant model access. */
export function withModelHints(detail: MothershipBlockDetail): MothershipBlockDetail {
  if (
    !detail.inputSchema.some(
      (field) => field.id === 'model' && field.type === 'combobox' && field.options?.length
    )
  )
    return detail
  const models = new Map(
    Object.values(PROVIDER_DEFINITIONS).flatMap((provider) =>
      provider.models.map((model) => [model.id.toLowerCase(), model] as const)
    )
  )
  return {
    ...detail,
    inputSchema: detail.inputSchema.map((field) => {
      if (field.id !== 'model' || field.type !== 'combobox' || !field.options?.length) return field
      return {
        ...field,
        optionsAvailability:
          'Model availability depends on deployment, provider credentials and model permissions; catalog options do not establish access.',
        options: field.options.map((option) => {
          const model = models.get(option.id.toLowerCase())
          return {
            ...option,
            ...(model?.recommended ? { recommended: true as const } : {}),
            ...(model?.speedOptimized ? { speedOptimized: true as const } : {}),
            ...(model?.sunset ? { sunset: { ...model.sunset } } : {}),
          }
        }),
      }
    }),
  }
}
