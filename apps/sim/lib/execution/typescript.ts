type TypeScriptModule = typeof import('@typescript/typescript6')

let typescriptModule: Promise<TypeScriptModule> | null = null

/**
 * The TypeScript compiler, imported on first use: it is large, and most
 * requests never parse or transpile user code. A failed import is dropped so
 * the next call retries it.
 */
export function loadTypeScript(): Promise<TypeScriptModule> {
  typescriptModule ??= import('@typescript/typescript6').then(
    (mod) => (mod?.default ?? mod) as TypeScriptModule,
    (error) => {
      typescriptModule = null
      throw error
    }
  )
  return typescriptModule
}
