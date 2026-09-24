import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ShimmerText } from './shimmer-text'

describe('ShimmerText', () => {
  it('preserves the requested element, consumer classes, and native attributes', () => {
    const html = renderToStaticMarkup(
      <ShimmerText as='div' className='text-sm' data-testid='streaming-body'>
        Writing a reply
      </ShimmerText>
    )
    expect(html).toMatch(/^<div /)
    expect(html).toContain('text-sm')
    expect(html).toContain('data-testid="streaming-body"')
    expect(html).toContain('Writing a reply</div>')
  })
})
