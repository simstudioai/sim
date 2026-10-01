#!/usr/bin/env bun
/**
 * Asserts no tracked app source or content links the apex marketing origin `https://sim.ai`.
 *
 * The apex 301s to the canonical `https://www.sim.ai`, so every apex link costs visitors and
 * crawlers a redirect hop and splits link equity across two hosts. Code reads the origin from
 * `@sim/utils/site` (re-exported as `SITE_URL` in apps/sim and `SIM_SITE_URL` in apps/docs);
 * MDX links use a relative `/path` or `https://www.sim.ai`.
 *
 * Only link syntax is checked — a Markdown link target or an `href` attribute — because the apex
 * also appears legitimately as an API host, a User-Agent contact URL, or a documented SDK default.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')

const PATHSPECS = [
  'apps/sim/*.ts',
  'apps/sim/*.tsx',
  'apps/sim/*.mdx',
  'apps/docs/*.ts',
  'apps/docs/*.tsx',
  'apps/docs/*.mdx',
]

/** `](https://sim.ai…)` or `href='https://sim.ai…'`, but not `sim.ai.evil.com` or `www.sim.ai`. */
const APEX_LINK = /(?:\]\(|href=\{?['"`])https?:\/\/sim\.ai(?![\w.-])/

const listed = spawnSync('git', ['ls-files', '-z', '--', ...PATHSPECS], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
})

if (listed.status !== 0) {
  console.error(`Site-URL audit failed: \`git ls-files\` exited ${listed.status}.`)
  process.exit(1)
}

const files = listed.stdout
  .split('\0')
  .filter((file) => file.length > 0 && !/\.test\.tsx?$/.test(file))

const offenders: string[] = []
for (const file of files) {
  const source = Bun.file(path.join(ROOT, file))
  if (!(await source.exists())) continue
  const lines = (await source.text()).split('\n')
  lines.forEach((line, index) => {
    if (APEX_LINK.test(line)) offenders.push(`${file}:${index + 1}`)
  })
}

if (offenders.length > 0) {
  console.error(
    `Site-URL audit failed: ${offenders.length} link(s) target the apex https://sim.ai, which 301s to https://www.sim.ai.\n\n` +
      offenders.map((offender) => `  ${offender}`).join('\n') +
      '\n\n  In code, build the URL from SITE_URL (apps/sim) or SIM_SITE_URL (apps/docs).' +
      '\n  In MDX, link with a relative /path or https://www.sim.ai.'
  )
  process.exit(1)
}

console.log(`Site-URL audit passed (${files.length} files, no apex sim.ai links).`)
