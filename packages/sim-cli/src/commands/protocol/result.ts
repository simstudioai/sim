import type { OutputFormat } from '../../config/index.js'
import { printRecord, text } from '../../output/render.js'

export function printProtocolResult(format: OutputFormat, result: Record<string, unknown>): void {
  const fields = Object.entries(result).map<[string, string]>(([key, value]) => [key, text(value)])
  printRecord(format, fields, result)
}
