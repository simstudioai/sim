/**
 * Regenerates the email header wordmark raster from the shared brand outlines.
 *
 * Email clients strip inline SVG, so the header has to ship a PNG - but that PNG
 * is derived from the same `WORDMARK_PATHS` the landing navbar renders, and
 * filled with the same `textBody` ink the email's own body copy uses, so the two
 * surfaces cannot drift apart.
 *
 * Run with `bun run apps/sim/scripts/generate-email-wordmark.ts` and commit the
 * result; nothing regenerates it at build time.
 */

import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createLogger } from '@sim/logger'
import sharp from 'sharp'
import { colors } from '@/components/emails/_styles'
import {
  EMAIL_WORDMARK_SCALE,
  EMAIL_WORDMARK_SIZE,
  WORDMARK_PATHS,
  WORDMARK_VIEW_BOX,
} from '@/lib/branding/wordmark'

const logger = createLogger('GenerateEmailWordmark')

const OUTPUT_PATH = path.join(
  import.meta.dirname,
  '..',
  'public',
  'brand',
  'color',
  'email',
  'wordmark.png'
)

function buildSvg(width: number, height: number, fill: string): string {
  const paths = WORDMARK_PATHS.map((d) => `<path d="${d}" />`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${WORDMARK_VIEW_BOX.width} ${WORDMARK_VIEW_BOX.height}"><g fill="${fill}">${paths}</g></svg>`
}

async function main(): Promise<void> {
  const width = EMAIL_WORDMARK_SIZE.width * EMAIL_WORDMARK_SCALE
  const height = EMAIL_WORDMARK_SIZE.height * EMAIL_WORDMARK_SCALE
  const svg = buildSvg(width, height, colors.textBody)

  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer()
  await writeFile(OUTPUT_PATH, png)

  logger.info('Generated email wordmark', {
    output: OUTPUT_PATH,
    pixels: `${width}x${height}`,
    displayedAt: `${EMAIL_WORDMARK_SIZE.width}x${EMAIL_WORDMARK_SIZE.height}`,
    fill: colors.textBody,
    bytes: png.byteLength,
  })
}

await main()
