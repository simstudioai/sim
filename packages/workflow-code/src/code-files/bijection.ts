import { fromCodeFile } from './from-file'
import { type CodeFileLanguage, toCodeFile } from './to-file'

export type CodeFileBijection =
  | { ok: true; file: string }
  | {
      ok: false
      /** `syntax`: the file form does not parse; `lossy`: it parses but reads back differently. */
      reason: 'syntax' | 'lossy'
    }

/**
 * The printer's self-check before it writes function code to a file (build-spec decision 9,
 * s3 D6): the file form is usable only when reading it back yields the stored code exactly.
 * Code that already names `$ref`/`$env` in code position, or a reference followed by a member
 * access (`<a.b>.length`), reads back differently and fails here, so the printer falls back to an
 * inline `js` template with `W_CODE_FILE_INLINED`.
 */
export function checkCodeFileBijection(
  code: string,
  language: CodeFileLanguage
): CodeFileBijection {
  const file = toCodeFile(code, language)
  const back = fromCodeFile(file, language)
  if (!back.ok) return { ok: false, reason: 'syntax' }
  return back.code === code ? { ok: true, file } : { ok: false, reason: 'lossy' }
}

/**
 * The code-file codec the printer takes (`createPrintWorkflow(codec)`, src/print/printer.ts):
 * `toFile` is `null` unless the file form reads back to the stored code exactly, and `fromFile`
 * is `null` for a file that does not parse.
 */
export interface CodeFileCodec {
  toFile(code: string, language: CodeFileLanguage): string | null
  fromFile(text: string, language: CodeFileLanguage): string | null
}

export const codeFileCodec: CodeFileCodec = {
  toFile(code, language) {
    const check = checkCodeFileBijection(code, language)
    return check.ok ? check.file : null
  },
  fromFile(text, language) {
    const back = fromCodeFile(text, language)
    return back.ok ? back.code : null
  },
}
