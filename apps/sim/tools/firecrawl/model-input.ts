import { isPlainRecord } from '@sim/utils/object'
import type { FirecrawlFormat, ScrapeOptions } from '@/tools/firecrawl/types'

type ProjectedFormat = Record<string, unknown>

function modelVisibleFormatFields(format: FirecrawlFormat): ProjectedFormat {
  if (!isPlainRecord(format) || typeof format.type !== 'string') return {}

  const selected: ProjectedFormat = {}
  if (format.type === 'json' || format.type === 'changeTracking') {
    if (Object.hasOwn(format, 'prompt')) selected.prompt = format.prompt
    if (Object.hasOwn(format, 'schema')) selected.schema = format.schema
  }
  if (format.type === 'question' && Object.hasOwn(format, 'question')) {
    selected.question = format.question
  }
  return selected
}

function haveExactKeys(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => Object.hasOwn(right, key))
}

/** Selects only Firecrawl format fields documented as model instructions or schemas. */
export function selectFirecrawlFormatModelInput(
  formats: FirecrawlFormat[] | undefined
): ProjectedFormat[] | undefined {
  return formats?.map(modelVisibleFormatFields)
}

/** Returns whether any requested output format sends page content through a model. */
export function hasFirecrawlModelInputFormat(formats: FirecrawlFormat[] | undefined): boolean {
  return (
    formats?.some(
      (format) =>
        (typeof format === 'string' &&
          (format === 'json' ||
            format === 'changeTracking' ||
            format === 'question' ||
            format === 'summary')) ||
        (isPlainRecord(format) &&
          (format.type === 'json' ||
            format.type === 'changeTracking' ||
            format.type === 'question' ||
            format.type === 'summary'))
    ) ?? false
  )
}

function isPdfFile(input: unknown): boolean {
  if (!isPlainRecord(input)) return false
  if (
    typeof input.type === 'string' &&
    input.type.split(';', 1)[0].trim().toLowerCase() === 'application/pdf'
  ) {
    return true
  }

  return [input.name, input.path, input.url, input.key].some((candidate) => {
    if (typeof candidate !== 'string') return false
    return candidate.split(/[?#]/, 1)[0].trim().toLowerCase().endsWith('.pdf')
  })
}

function hasModelBoundPdfParser(parsers: unknown): boolean {
  if (!Array.isArray(parsers)) return false
  return parsers.some((parser) => {
    if (typeof parser === 'string') return parser.trim().toLowerCase() === 'pdf'
    if (
      !isPlainRecord(parser) ||
      typeof parser.type !== 'string' ||
      parser.type.trim().toLowerCase() !== 'pdf'
    ) {
      return false
    }
    return typeof parser.mode !== 'string' || parser.mode.trim().toLowerCase() !== 'fast'
  })
}

/** Returns whether Firecrawl can send the uploaded document through generation or OCR. */
export function hasFirecrawlParseModelInput(params: {
  file: unknown
  formats?: unknown
  parsers?: unknown
}): boolean {
  const formats = Array.isArray(params.formats)
    ? (params.formats.filter(
        (format) => typeof format === 'string' || isPlainRecord(format)
      ) as FirecrawlFormat[])
    : undefined
  if (hasFirecrawlModelInputFormat(formats)) return true
  if (Array.isArray(params.parsers) && params.parsers.length > 0) {
    return hasModelBoundPdfParser(params.parsers)
  }
  return isPdfFile(params.file)
}

/** Reapplies projected Firecrawl format leaves without changing format controls or array shape. */
export function applyFirecrawlFormatModelInput(
  original: FirecrawlFormat[] | undefined,
  projected: unknown
): FirecrawlFormat[] | undefined {
  if (original === undefined) {
    if (projected !== undefined) throw new Error('Unexpected projected Firecrawl formats')
    return undefined
  }
  if (!Array.isArray(projected) || projected.length !== original.length) {
    throw new Error('Projected Firecrawl formats do not match the original formats')
  }

  return original.map((format, index) => {
    const expected = modelVisibleFormatFields(format)
    const projectedFormat = projected[index]
    if (!isPlainRecord(projectedFormat) || !haveExactKeys(expected, projectedFormat)) {
      throw new Error('Projected Firecrawl format fields do not match the original format')
    }
    return isPlainRecord(format) ? { ...format, ...projectedFormat } : format
  })
}

/** Selects nested model-visible fields from Firecrawl scrape options. */
export function selectFirecrawlScrapeOptionsModelInput(
  options: ScrapeOptions | undefined
): Record<string, unknown> | undefined {
  if (options === undefined) return undefined
  return Object.hasOwn(options, 'formats')
    ? { formats: selectFirecrawlFormatModelInput(options.formats) }
    : {}
}

/** Reapplies projected scrape-option fields while preserving every non-model option. */
export function applyFirecrawlScrapeOptionsModelInput(
  original: ScrapeOptions | undefined,
  projected: unknown
): ScrapeOptions | undefined {
  if (original === undefined) {
    if (projected !== undefined) throw new Error('Unexpected projected Firecrawl scrape options')
    return undefined
  }
  if (!isPlainRecord(projected)) {
    throw new Error('Projected Firecrawl scrape options are invalid')
  }

  const expected = selectFirecrawlScrapeOptionsModelInput(original) ?? {}
  if (!haveExactKeys(expected, projected)) {
    throw new Error('Projected Firecrawl scrape options do not match the original options')
  }
  if (!Object.hasOwn(projected, 'formats')) return { ...original }
  return {
    ...original,
    formats: applyFirecrawlFormatModelInput(original.formats, projected.formats),
  }
}
