'use client'

import type { CodeUsageGeneratorFn } from 'fumadocs-openapi/requests/generators'
import { createCodeUsageGeneratorRegistry } from 'fumadocs-openapi/requests/generators'
import { registerDefault } from 'fumadocs-openapi/requests/generators/all'

/**
 * Context handed to {@link generateWithAuth} by the server: which built-in
 * generator to delegate to, and the auth headers the sample must send.
 */
export interface AuthCodeSampleContext {
  generatorId: string
  headers: Record<string, string>
}

const generators = createCodeUsageGeneratorRegistry()
registerDefault(generators)

/**
 * Wraps a built-in code-usage generator so the sample carries the operation's
 * security headers. Fumadocs builds request data from declared parameters only,
 * so an operation's security requirement never reaches the generated snippet.
 */
export const generateWithAuth: CodeUsageGeneratorFn = (url, data, context) => {
  const { generatorId, headers } = context.server as AuthCodeSampleContext
  const generator = generators.get(generatorId)
  if (!generator) {
    throw new Error(`[docs] Unknown code usage generator: ${generatorId}`)
  }

  const authHeaders: Record<string, { value: string }> = {}
  for (const [name, value] of Object.entries(headers)) {
    authHeaders[name] = { value }
  }

  return generator.generate(url, { ...data, header: { ...authHeaders, ...data.header } }, context)
}
