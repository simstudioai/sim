import { memo } from 'react'

const RX = '2.59574'

interface BlockRect {
  opacity: number
  width: string
  height: string
  fill: string
  x?: string
  y?: string
  transform?: string
}

const RECTS = {
  topRight: [
    { opacity: 1, x: '0', y: '0', width: '16.8626', height: '33.7252', fill: '#2ABBF8' },
    { opacity: 0.6, x: '0', y: '0', width: '85.3433', height: '16.8626', fill: '#2ABBF8' },
    { opacity: 1, x: '0', y: '0', width: '16.8626', height: '16.8626', fill: '#2ABBF8' },
    { opacity: 0.6, x: '34.2403', y: '0', width: '34.2403', height: '33.7252', fill: '#2ABBF8' },
    { opacity: 1, x: '34.2403', y: '0', width: '16.8626', height: '16.8626', fill: '#2ABBF8' },
    {
      opacity: 1,
      x: '51.6188',
      y: '16.8626',
      width: '16.8626',
      height: '16.8626',
      fill: '#2ABBF8',
    },
    { opacity: 1, x: '68.4812', y: '0', width: '54.6502', height: '16.8626', fill: '#00F701' },
    { opacity: 0.6, x: '106.268', y: '0', width: '34.2403', height: '33.7252', fill: '#00F701' },
    { opacity: 0.6, x: '106.268', y: '0', width: '51.103', height: '16.8626', fill: '#00F701' },
    {
      opacity: 1,
      x: '123.6484',
      y: '16.8626',
      width: '16.8626',
      height: '16.8626',
      fill: '#00F701',
    },
    { opacity: 0.6, x: '157.371', y: '0', width: '34.2403', height: '16.8626', fill: '#FFCC02' },
    { opacity: 1, x: '157.371', y: '0', width: '16.8626', height: '16.8626', fill: '#FFCC02' },
    { opacity: 0.6, x: '208.993', y: '0', width: '68.4805', height: '16.8626', fill: '#FA4EDF' },
    { opacity: 0.6, x: '209.137', y: '0', width: '16.8626', height: '33.7252', fill: '#FA4EDF' },
    { opacity: 0.6, x: '243.233', y: '0', width: '34.2403', height: '33.7252', fill: '#FA4EDF' },
    { opacity: 1, x: '243.233', y: '0', width: '16.8626', height: '16.8626', fill: '#FA4EDF' },
    { opacity: 0.6, x: '260.096', y: '0', width: '34.04', height: '16.8626', fill: '#FA4EDF' },
    {
      opacity: 1,
      x: '260.611',
      y: '16.8626',
      width: '16.8626',
      height: '16.8626',
      fill: '#FA4EDF',
    },
  ],
  bottomLeft: [
    { opacity: 1, x: '0', y: '0', width: '16.8626', height: '33.7252', fill: '#2ABBF8' },
    { opacity: 0.6, x: '0', y: '0', width: '85.3433', height: '16.8626', fill: '#2ABBF8' },
    { opacity: 1, x: '0', y: '0', width: '16.8626', height: '16.8626', fill: '#2ABBF8' },
    { opacity: 0.6, x: '34.2403', y: '0', width: '34.2403', height: '33.7252', fill: '#2ABBF8' },
    { opacity: 1, x: '34.2403', y: '0', width: '16.8626', height: '16.8626', fill: '#2ABBF8' },
    {
      opacity: 1,
      x: '51.6188',
      y: '16.8626',
      width: '16.8626',
      height: '16.8626',
      fill: '#2ABBF8',
    },
    { opacity: 1, x: '68.4812', y: '0', width: '54.6502', height: '16.8626', fill: '#00F701' },
    { opacity: 0.6, x: '106.268', y: '0', width: '34.2403', height: '33.7252', fill: '#00F701' },
    { opacity: 0.6, x: '106.268', y: '0', width: '51.103', height: '16.8626', fill: '#00F701' },
    {
      opacity: 1,
      x: '123.6484',
      y: '16.8626',
      width: '16.8626',
      height: '16.8626',
      fill: '#00F701',
    },
  ],
  bottomRight: [
    {
      opacity: 0.6,
      width: '16.8626',
      height: '33.726',
      fill: '#FA4EDF',
      transform: 'matrix(0 1 1 0 0 0)',
    },
    {
      opacity: 0.6,
      width: '34.241',
      height: '16.8626',
      fill: '#FA4EDF',
      transform: 'matrix(0 1 1 0 16.891 0)',
    },
    {
      opacity: 0.6,
      width: '16.8626',
      height: '68.482',
      fill: '#FA4EDF',
      transform: 'matrix(-1 0 0 1 33.739 16.888)',
    },
    {
      opacity: 0.6,
      width: '16.8626',
      height: '33.726',
      fill: '#FA4EDF',
      transform: 'matrix(0 1 1 0 0 33.776)',
    },
    {
      opacity: 1,
      width: '16.8626',
      height: '16.8626',
      fill: '#FA4EDF',
      transform: 'matrix(-1 0 0 1 33.739 34.272)',
    },
    {
      opacity: 0.6,
      width: '16.8626',
      height: '34.24',
      fill: '#2ABBF8',
      transform: 'matrix(-1 0 0 1 33.787 68)',
    },
    {
      opacity: 0.4,
      width: '16.8626',
      height: '16.8626',
      fill: '#1A8FCC',
      transform: 'matrix(-1 0 0 1 33.787 85)',
    },
  ],
} as const satisfies Record<string, readonly BlockRect[]>

const GLOBAL_OPACITY = 0.55

const BlockGroup = memo(function BlockGroup({
  width,
  height,
  viewBox,
  rects,
}: {
  width: number
  height: number
  viewBox: string
  rects: readonly BlockRect[]
}) {
  return (
    <svg
      width={width}
      height={height}
      viewBox={viewBox}
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className='h-auto w-full'
      style={{ opacity: GLOBAL_OPACITY }}
    >
      {rects.map((r, i) => (
        <rect
          key={i}
          x={r.x}
          y={r.y}
          width={r.width}
          height={r.height}
          rx={RX}
          fill={r.fill}
          transform={r.transform}
          opacity={r.opacity}
        />
      ))}
    </svg>
  )
})

export function AnimatedBlocks() {
  return (
    <div
      className='pointer-events-none fixed inset-0 z-0 hidden overflow-hidden lg:block'
      aria-hidden='true'
    >
      <div className='absolute top-[93px] right-0 w-[calc(140px+10.76vw)] max-w-[295px]'>
        <BlockGroup width={295} height={34} viewBox='0 0 295 34' rects={RECTS.topRight} />
      </div>

      <div className='-left-24 absolute bottom-0 w-[calc(140px+10.76vw)] max-w-[295px] rotate-180'>
        <BlockGroup width={295} height={34} viewBox='0 0 295 34' rects={RECTS.bottomLeft} />
      </div>

      <div className='-bottom-2 absolute right-0 w-[calc(16px+1.25vw)] max-w-[34px]'>
        <BlockGroup width={34} height={102} viewBox='0 0 34 102' rects={RECTS.bottomRight} />
      </div>
    </div>
  )
}
