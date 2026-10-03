import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Badge } from './badge'

function Icon({ className }: { className?: string }) {
  return <svg className={className} aria-hidden />
}

describe('Badge', () => {
  it.each([
    ['sm', 'text-xs', 'size-[5px]', 'size-2.5'],
    ['md', 'text-caption', 'size-1.5', 'size-3'],
  ] as const)('keeps the %s label, dot and icon proportions', (size, text, dot, icon) => {
    const status = renderToStaticMarkup(
      <Badge size={size} variant='green' dot>
        Live
      </Badge>
    )
    expect(status).toContain(text)
    expect(status).toContain(dot)
    expect(status).toContain('Live')
    expect(
      renderToStaticMarkup(
        <Badge size={size} icon={Icon}>
          Download
        </Badge>
      )
    ).toContain(icon)
  })
})
