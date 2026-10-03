import type { OutputFormat } from '../../config/index'
import { printRecord, text } from '../../output/render'

export function printProtocolResult(format: OutputFormat, result: Record<string, unknown>): void {
  const fields = Object.entries(result).map<[string, string]>(([key, value]) => [key, text(value)])
  printRecord(format, fields, result)
}
