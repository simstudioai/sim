import type ts from '@typescript/typescript6'

/** Static imports lifted out of Function bodies by execution and syntax validation alike. */
export function collectJavaScriptImportSegments(
  sourceFile: ts.SourceFile,
  parser: Pick<typeof ts, 'isImportDeclaration' | 'isImportEqualsDeclaration'>
): { text: string; start: number; end: number }[] {
  return sourceFile.statements.flatMap((statement) =>
    parser.isImportDeclaration(statement) || parser.isImportEqualsDeclaration(statement)
      ? [
          {
            text: statement.getFullText(sourceFile).trim(),
            start: statement.getFullStart(),
            end: statement.getEnd(),
          },
        ]
      : []
  )
}
