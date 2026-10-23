const INTEGRAL_JSON_NUMBER_TOKEN = /^-?(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/
const NON_NEGATIVE_INTEGRAL_TOKEN = /^(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/
const DEFAULT_MAX_SOURCE_LENGTH = 128

function compareDecimalMagnitudeToInteger(magnitude: string, value: number): number {
  const normalizedMagnitude = magnitude.replace(/^0+/, '') || '0'
  const integer = String(value)
  if (normalizedMagnitude.length !== integer.length) {
    return normalizedMagnitude.length < integer.length ? -1 : 1
  }
  if (normalizedMagnitude === integer) return 0
  return normalizedMagnitude < integer ? -1 : 1
}

function trailingZeroCount(value: string): number {
  let count = 0
  for (let index = value.length - 1; index >= 0 && value[index] === '0'; index--) count++
  return count
}

/** Whether one JSON number token denotes an exact integer without expanding its exponent. */
export function isOracleFusionIntegralJsonNumberToken(source: string): boolean {
  const match = INTEGRAL_JSON_NUMBER_TOKEN.exec(source)
  if (!match) return false
  const coefficient = `${match[1]}${match[2] ?? ''}`
  if (/^0+$/.test(coefficient)) return true

  const fractionDigits = match[2]?.length ?? 0
  const exponentSource = match[3] ?? '0'
  const exponentMagnitude = exponentSource.replace(/^[+-]/, '').replace(/^0+/, '') || '0'
  const availableTrailingZeros = trailingZeroCount(coefficient)

  if (exponentSource.startsWith('-')) {
    if (compareDecimalMagnitudeToInteger(exponentMagnitude, availableTrailingZeros) > 0) {
      return false
    }
    return fractionDigits + Number(exponentMagnitude) <= availableTrailingZeros
  }
  if (compareDecimalMagnitudeToInteger(exponentMagnitude, fractionDigits) >= 0) return true
  return fractionDigits - Number(exponentMagnitude) <= availableTrailingZeros
}

function parseBoundedExponent(exponentText: string, maximumMagnitude: number): number | undefined {
  const negative = exponentText.startsWith('-')
  const unsigned = exponentText.replace(/^[+-]/, '').replace(/^0+(?=\d)/, '')
  const maximum = String(maximumMagnitude)
  if (
    unsigned.length > maximum.length ||
    (unsigned.length === maximum.length && unsigned > maximum)
  ) {
    return undefined
  }
  const magnitude = Number(unsigned)
  return negative ? -magnitude : magnitude
}

export interface OracleFusionDecimalIdentifierOptions {
  maxDigits: number
  maxSourceLength?: number
}

/** Canonicalizes one exact non-negative integral identifier without JS-number precision loss. */
export function normalizeOracleFusionDecimalIdentifier(
  value: unknown,
  options: OracleFusionDecimalIdentifierOptions
): string | undefined {
  const maxSourceLength = options.maxSourceLength ?? DEFAULT_MAX_SOURCE_LENGTH
  if (
    !Number.isSafeInteger(options.maxDigits) ||
    options.maxDigits < 1 ||
    !Number.isSafeInteger(maxSourceLength) ||
    maxSourceLength < 1 ||
    options.maxDigits > maxSourceLength
  ) {
    throw new Error('Oracle Fusion decimal identifier limits are invalid')
  }
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 && String(value).length <= options.maxDigits
      ? String(value)
      : undefined
  }
  if (typeof value !== 'string' || value.length > maxSourceLength) return undefined
  const match = NON_NEGATIVE_INTEGRAL_TOKEN.exec(value)
  if (!match) return undefined

  const integer = match[1]
  const fraction = match[2] ?? ''
  const exponentText = match[3] ?? '0'
  const coefficient = `${integer}${fraction}`
  if (/^0+$/.test(coefficient)) return '0'
  const significantCoefficient = coefficient.replace(/^0+/, '')
  const maximumRelevantExponent = Math.max(integer.length, fraction.length + options.maxDigits)
  const exponent = parseBoundedExponent(exponentText, maximumRelevantExponent)
  if (exponent === undefined) return undefined

  const scale = exponent - fraction.length
  if (scale >= 0) {
    if (significantCoefficient.length + scale > options.maxDigits) return undefined
    return `${significantCoefficient}${'0'.repeat(scale)}`
  }

  const fractionalDigits = -scale
  if (fractionalDigits > significantCoefficient.length) return undefined
  const suffix = significantCoefficient.slice(significantCoefficient.length - fractionalDigits)
  if (!/^0*$/.test(suffix)) return undefined
  const normalized =
    significantCoefficient.slice(0, significantCoefficient.length - fractionalDigits) || '0'
  return normalized.length <= options.maxDigits ? normalized : undefined
}
