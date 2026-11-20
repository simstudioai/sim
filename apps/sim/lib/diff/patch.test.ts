/**
 * @vitest-environment node
 */
import { parsePatchFiles } from '@pierre/diffs'
import { describe, expect, it } from 'vitest'
import { toFileDiffs } from '@/lib/diff/patch'
import { parseUnifiedDiff } from '@/lib/diff/unified'

const agentEdit = `--- sim:file/onboarding
+++ sim:file/onboarding
@@ Getting started @@
 ## Getting started
-Invite your team from settings.
+Invite your team from Settings → Members.
+New members get the Editor role.
@@ Billing @@
 Plans are billed monthly.
-Contact sales for annual pricing.
+Annual plans save 20%.
@@
-Old footer.
+New footer.`

type Hunk = ReturnType<typeof render>[number]['hunks'][number]

function render(source: string) {
  return toFileDiffs(parseUnifiedDiff(source), 'notes.md')
}

describe('toFileDiffs', () => {
  it('keeps every line of a diff without line numbers, in order and on its side', () => {
    const [file] = render(agentEdit)
    expect(file.name).toBe('notes.md')
    expect(file.deletionLines.map((line) => line.trimEnd())).toEqual([
      '## Getting started',
      'Invite your team from settings.',
      'Plans are billed monthly.',
      'Contact sales for annual pricing.',
      'Old footer.',
    ])
    expect(file.additionLines.map((line) => line.trimEnd())).toEqual([
      '## Getting started',
      'Invite your team from Settings → Members.',
      'New members get the Editor role.',
      'Plans are billed monthly.',
      'Annual plans save 20%.',
      'New footer.',
    ])
  })

  it('separates every hunk that has a heading or follows another, showing only the heading', () => {
    const [file] = render(agentEdit)
    expect(file.hunks.map((hunk) => [hunk.hunkSpecs, hunk.collapsedBefore > 0])).toEqual([
      ['Getting started', true],
      ['Billing', true],
      ['⋯', true],
    ])
  })

  it('draws no separator above a leading hunk that has no heading', () => {
    const [file] = render('-old line\n+new line')
    expect(file.hunks).toHaveLength(1)
    expect(file.hunks[0].collapsedBefore).toBe(0)
  })

  it('keeps the real line numbers of a git diff', () => {
    const [file] = render(`--- a/src/usage.ts
+++ b/src/usage.ts
@@ -12,3 +12,4 @@ export function check() {
 const a = 1
-const b = 2
+const b = 3
+const c = 4
 return a`)
    expect(file.name).toBe('src/usage.ts')
    expect(file.hunks[0]).toMatchObject({
      deletionStart: 12,
      deletionCount: 3,
      additionStart: 12,
      additionCount: 4,
      hunkSpecs: 'export function check() {',
    })
  })

  it('accepts a hunk that only adds lines', () => {
    const [file] = render(`--- a/new.ts
+++ b/new.ts
@@ -0,0 +1,2 @@
+export const a = 1
+export const b = 2`)
    expect(file.hunks[0]).toMatchObject({ deletionCount: 0, additionCount: 2, additionStart: 1 })
    expect(file.additionLines).toHaveLength(2)
  })

  it.each([
    [
      'a pure insertion',
      '--- a/big.ts\n+++ b/big.ts\n@@ -100,0 +101,2 @@ function tail() {\n+const a = 1\n+const b = 2',
    ],
    [
      'a pure deletion',
      '--- a/big.ts\n+++ b/big.ts\n@@ -40,2 +39,0 @@\n-const a = 1\n-const b = 2',
    ],
  ])('places %s where its header says, as Pierre reads the original patch', (_, source) => {
    const [original] = parsePatchFiles(source)[0].files
    const [file] = render(source)
    const position = ({ deletionStart, deletionCount, additionStart, additionCount }: Hunk) => ({
      deletionStart,
      deletionCount,
      additionStart,
      additionCount,
    })
    expect(position(file.hunks[0])).toEqual(position(original.hunks[0]))
  })

  it('keeps a change block as written instead of realigning its lines by similarity', () => {
    const [file] = render(`--- a/total.ts
+++ b/total.ts
@@ -1,2 +1,4 @@
-const total = sum(items)
+// recompute
+const total = sum(items) + tax
+return total
 x`)
    expect(
      file.hunks[0].hunkContent.map((block) =>
        block.type === 'change' ? [block.deletions, block.additions] : block.type
      )
    ).toEqual([[1, 3], 'context'])
  })

  it('splits a multi-file git diff into one diff per file', () => {
    const files = render(`diff --git a/app/main.py b/app/main.py
--- a/app/main.py
+++ b/app/main.py
@@ -1,2 +1,2 @@
-import os
+import sys
 x = 1
diff --git a/config.json b/config.json
--- a/config.json
+++ b/config.json
@@ -2,1 +2,1 @@
-  "a": 1
+  "a": 2`)
    expect(files.map((file) => file.name)).toEqual(['app/main.py', 'config.json'])
  })
})
