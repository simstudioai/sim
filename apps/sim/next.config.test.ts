/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import nextConfig from '@/next.config'

describe('Next.js server dependency packaging', () => {
  it('keeps pdfjs external to the production server bundle', () => {
    expect(nextConfig.serverExternalPackages).toContain('pdfjs-dist')
    expect(nextConfig.serverExternalPackages).toContain('@napi-rs/canvas')
  })
})
