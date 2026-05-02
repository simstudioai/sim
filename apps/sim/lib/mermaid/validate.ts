import { toError } from '@sim/utils/errors'

export interface MermaidValidationResult {
  ok: boolean
  error?: string
  errorName?: string
}

export async function validateMermaidSource(source: string): Promise<MermaidValidationResult> {
  try {
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'default',
    })
    mermaid.setParseErrorHandler?.(() => undefined)
    await mermaid.parse(source)
    return { ok: true }
  } catch (error) {
    const err = toError(error)
    return {
      ok: false,
      error: err.message || 'Invalid Mermaid diagram',
      errorName: err.name || 'MermaidParseError',
    }
  }
}
