/**
 * Monaco's TypeScript Monarch grammar ships without a declaration file. Only the two exports the
 * Code tab reads are declared: it colors the printed source with this grammar under its own
 * language id, so no TypeScript worker or diagnostics start for a display-only model.
 */
declare module 'monaco-editor/languages/definitions/typescript/typescript' {
  import type { languages } from 'monaco-editor'

  export const conf: languages.LanguageConfiguration
  export const language: languages.IMonarchLanguage
}
