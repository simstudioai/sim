/**
 * Heuristic language detection for a fenced code block that has no explicit ` ```lang ` tag.
 * Used only to drive syntax highlighting + the picker label — the detected value is NEVER
 * written back to the markdown, so opening a file never mutates it. Restricted to the grammars
 * {@link CodeBlockHighlight} actually registers with Prism; returns `null` when unsure.
 */
const DETECTORS: ReadonlyArray<{ language: string; test: RegExp }> = [
  // Real HTML: a closing tag, an opening tag with an attribute, or a doctype/comment. Deliberately
  // NOT a bare `<Word>` so generics (`List<String>`, `Vec<T>`) aren't misread as markup.
  { language: 'markup', test: /<\/[a-z][\w-]*\s*>|<[a-z][\w-]*\s+[\w:-]+=|<!(?:doctype\b|--)/i },
  {
    language: 'sql',
    test: /\b(?:select\s+[\w*]|insert\s+into|update\s+\w+\s+set|delete\s+from|create\s+table)/i,
  },
  { language: 'python', test: /^\s*(def|class)\s+\w+|^\s*(import|from)\s+\w|\bprint\(|\belif\b/m },
  {
    language: 'bash',
    test: /^#!.*\b(ba)?sh\b|^\s*(sudo|apt|brew|npm|yarn|bun|git|cd|echo|export|chmod|mkdir)\s|\$\(/m,
  },
  {
    language: 'go',
    test: /^\s*package\s+\w+|\bfunc\s+(\(\w[^)]*\)\s+)?\w+\s*\(|\btype\s+\w+\s+(struct|interface)\b|\bfmt\.\w|:=/m,
  },
  {
    language: 'rust',
    test: /\bfn\s+\w+\s*[(<]|\blet\s+mut\b|\bimpl\b|\bpub\s+(fn|struct|enum|mod)\b|println!/,
  },
  {
    language: 'java',
    test: /\b(public|private|protected)\s+(static\s+)?(final\s+)?(class|void|int|String|boolean)\b|System\.out\.print/,
  },
  {
    language: 'typescript',
    test: /\b(interface|type)\s+\w+\s*[={]|:\s*(string|number|boolean)\b|\bimport\s+type\b|\bas\s+\w+\s*;/,
  },
  {
    language: 'javascript',
    test: /\b(const|let|var|function)\s|=>|console\.\w+|\brequire\(|\bexport\s+(default|const)\b/,
  },
  { language: 'css', test: /[.#]?[\w-]+\s*\{[^}]*[\w-]+\s*:[^};]+;?[^}]*\}/ },
  { language: 'yaml', test: /^[\w-]+:\s+\S/m },
]

function looksLikeJson(sample: string): boolean {
  const trimmed = sample.trim()
  if (!/^[[{]/.test(trimmed)) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

export function detectLanguage(code: string): string | null {
  const sample = code.slice(0, 2000)
  if (!sample.trim()) return null
  if (looksLikeJson(sample)) return 'json'
  for (const { language, test } of DETECTORS) {
    if (test.test(sample)) return language
  }
  return null
}
