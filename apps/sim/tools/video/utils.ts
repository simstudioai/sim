export function parseBooleanParam(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return undefined

  const normalized = value.trim().toLowerCase()
  if (normalized === 'true' || normalized === '1') return true
  if (normalized === 'false' || normalized === '0' || normalized === '') return false
  return undefined
}

export function parseBooleanParamWithDefault(value: unknown, defaultValue: boolean): boolean {
  return parseBooleanParam(value) ?? defaultValue
}
