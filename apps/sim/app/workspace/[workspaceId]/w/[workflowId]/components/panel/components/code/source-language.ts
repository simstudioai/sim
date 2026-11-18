import type * as MonacoApi from 'monaco-editor'

/**
 * Display-only TypeScript: the printed source colored with Monaco's TypeScript grammar under a
 * language id of its own. Under `typescript` the model would start the TypeScript worker and run
 * diagnostics over up to 1.2 MB of source nobody can edit.
 */
export const SOURCE_LANGUAGE_ID = 'sim-workflow-source'

const loadTypeScriptGrammar = () =>
  import('monaco-editor/languages/definitions/typescript/typescript')

/** Registers {@link SOURCE_LANGUAGE_ID} once per Monaco instance; pass as `beforeMount`. */
export function registerSourceLanguage(monaco: typeof MonacoApi): void {
  if (monaco.languages.getLanguages().some((language) => language.id === SOURCE_LANGUAGE_ID)) {
    return
  }
  monaco.languages.register({ id: SOURCE_LANGUAGE_ID })
  monaco.languages.registerTokensProviderFactory(SOURCE_LANGUAGE_ID, {
    create: async () => (await loadTypeScriptGrammar()).language,
  })
  monaco.languages.onLanguageEncountered(SOURCE_LANGUAGE_ID, async () => {
    monaco.languages.setLanguageConfiguration(
      SOURCE_LANGUAGE_ID,
      (await loadTypeScriptGrammar()).conf
    )
  })
}
