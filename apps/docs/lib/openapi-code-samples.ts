import type { InlineCodeUsageGenerator } from 'fumadocs-openapi/requests/generators'
import { createCodeUsageGeneratorRegistry } from 'fumadocs-openapi/requests/generators'
import { registerDefault } from 'fumadocs-openapi/requests/generators/all'
import { generateWithAuth } from '@/lib/openapi-code-samples-client'

const generators = createCodeUsageGeneratorRegistry()
registerDefault(generators)

/**
 * Replace every built-in language sample with one that prepends `headers`,
 * preserving the built-in tab order, language, and label.
 */
export function buildAuthCodeSamples(headers: Record<string, string>): InlineCodeUsageGenerator[] {
  return Array.from(generators.map().entries()).map(([id, generator]) => ({
    id,
    lang: generator.lang,
    label: generator.label,
    source: generateWithAuth,
    serverContext: { generatorId: id, headers },
  }))
}
