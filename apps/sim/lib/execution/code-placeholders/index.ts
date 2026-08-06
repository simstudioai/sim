import type {
  CompileCodePlaceholdersInput,
  CompiledCodePlaceholders,
  InternalCompileCodePlaceholdersInput,
} from '@/lib/execution/code-placeholders/types'
import { CodeLanguage } from '@/lib/execution/languages'

export { CodePlaceholderCompileError } from '@/lib/execution/code-placeholders/shared'
export type {
  CodePlaceholderBinding,
  CodePlaceholderPrivateInput,
  CodePlaceholderRuntimeBinding,
  CompileCodePlaceholdersInput,
  CompiledCodePlaceholders,
} from '@/lib/execution/code-placeholders/types'

async function dispatchCodePlaceholderCompilation(
  input: InternalCompileCodePlaceholdersInput
): Promise<CompiledCodePlaceholders> {
  switch (input.language) {
    case CodeLanguage.JavaScript: {
      const { compileJavaScriptPlaceholders } = await import(
        '@/lib/execution/code-placeholders/javascript'
      )
      return compileJavaScriptPlaceholders(input)
    }
    case CodeLanguage.Python: {
      const { compilePythonPlaceholders } = await import('@/lib/execution/code-placeholders/python')
      return compilePythonPlaceholders(input)
    }
    case CodeLanguage.Shell: {
      const { compileShellPlaceholders } = await import('@/lib/execution/code-placeholders/shell')
      return compileShellPlaceholders(input)
    }
  }
}

export async function compileCodePlaceholders(
  input: CompileCodePlaceholdersInput
): Promise<CompiledCodePlaceholders> {
  return dispatchCodePlaceholderCompilation({ ...input, analysisOnly: false })
}

export async function analyzeCodePlaceholders(
  code: string,
  language: CodeLanguage
): Promise<string[]> {
  const compiled = await dispatchCodePlaceholderCompilation({
    code,
    language,
    analysisOnly: true,
  })
  return [...compiled.resolvedSecretNames]
}
