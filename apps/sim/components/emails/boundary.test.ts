/**
 * Enforces that every email leaves the app through the shared layer:
 * `render.ts` for the body, `subjects.ts` for the subject.
 *
 * @vitest-environment node
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderInboxResponseEmail } from '@/components/emails/render'

const APP_ROOT = join(__dirname, '../..')
const EMAILS_DIR = join(__dirname)

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/**
 * Only files that actually send mail. Scanning every module under `lib` would
 * flag unrelated `subject:` keys (mail-tool params, schema fixtures).
 * `app/api/tools/ses` is excluded because it sends the end user's own mail
 * through their credentials — it is not a Sim-branded email.
 */
const senderFiles = ['lib', 'app/api', 'background']
  .flatMap((root) => walk(join(APP_ROOT, root)))
  .filter((f) => !f.includes(join(APP_ROOT, 'app/api/tools/ses')))
  .filter((f) => readFileSync(f, 'utf8').includes('sendEmail'))

const rel = (f: string) => f.slice(APP_ROOT.length + 1)

/** Template components, read from `render.ts`'s imports so new ones are covered. */
const renderSource = readFileSync(join(EMAILS_DIR, 'render.ts'), 'utf8')
const templateComponents = [
  ...new Set(
    [...renderSource.slice(0, renderSource.indexOf('export ')).matchAll(/\b(\w*Email)\b/g)].map(
      (m) => m[1]
    )
  ),
]

describe('every email goes through the shared layer', () => {
  it('finds the senders and the templates', () => {
    expect(senderFiles.length).toBeGreaterThan(5)
    expect(templateComponents).toContain('WelcomeEmail')
  })

  it('no sender reaches for a split React Email package', () => {
    // Substring, not an import-statement match — senders here use `await import()` too.
    // `react-email` re-exports `render`, so importing it directly from the
    // meta-package must be caught the same as the split packages.
    const offenders = senderFiles.filter((f) =>
      /@react-email\/(components|render)|['"]react-email['"]/.test(readFileSync(f, 'utf8'))
    )
    expect(offenders.map(rel)).toEqual([])
  })

  it('no sender names a template component instead of its render wrapper', () => {
    const offenders: string[] = []
    for (const file of senderFiles) {
      const src = readFileSync(file, 'utf8')
      for (const component of templateComponents) {
        // Whole-file scan so static and dynamic imports are both covered. The
        // word boundary keeps `PaymentFailedEmail` from matching inside
        // `renderPaymentFailedEmail`.
        if (new RegExp(`\\b${component}\\b`).test(src)) {
          offenders.push(`${rel(file)} -> ${component}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('no sender builds its own subject line', () => {
    const offenders: string[] = []
    for (const file of senderFiles) {
      for (const match of readFileSync(file, 'utf8').matchAll(/subject:\s*(['"`])(.*?)\1/g)) {
        // Bracket-tagged subjects are internal team-inbox alerts, not product email.
        if (match[2].startsWith('[')) continue
        offenders.push(`${rel(file)}: ${match[2]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the agent reply keeps markdown emphasis on the platform weight scale', async () => {
    const html = await renderInboxResponseEmail({
      markdown: 'Some **emphasis** here.',
      chatUrl: 'https://example.test/chat',
    })
    expect(html).not.toMatch(/font-weight:(700|bold)/)
    expect(html).toContain('font-weight:600')
  })
})
