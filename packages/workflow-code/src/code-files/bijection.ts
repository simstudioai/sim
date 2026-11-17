import { fromCodeFile } from './from-file'
import { type CodeFileLanguage, toCodeFile } from './to-file'

type CodeFileBijection =
  | { ok: true; file: string }
  | {
      ok: false
      /** `syntax`: the file form does not parse; `lossy`: it parses but reads back differently. */
      reason: 'syntax' | 'lossy'
    }

/**
 * The printer's self-check before it writes function code to a file: the file form is usable only
 * when reading it back yields the stored code exactly.
 * Code that already names `$ref`/`$env` in code position, or a reference followed by a member
 * access (`<a.b>.length`), reads back differently and fails here, so the printer falls back to an
 * inline `js` template with `W_CODE_FILE_INLINED`. So does code holding a carriage return: a
 * checkout normalizes code files to LF (`functions/** text eol=lf`), which would rewrite the
 * stored code on the next apply, while the inline form escapes `\r`.
 */
export function checkCodeFileBijection(
  code: string,
  language: CodeFileLanguage
): CodeFileBijection {
  if (code.includes('\r')) return { ok: false, reason: 'lossy' }
  const file = toCodeFile(code, language)
  const back = fromCodeFile(file, language)
  if (!back.ok) return { ok: false, reason: 'syntax' }
  return back.code === code ? { ok: true, file } : { ok: false, reason: 'lossy' }
}
