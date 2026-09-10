import { useId } from 'react'
import { WORDMARK_PATHS, WORDMARK_VIEW_BOX } from '@/lib/branding/wordmark'
import { STACK_LAYERS } from '@/app/(landing)/components/sim-stack/stack-content'
import {
  SLAB,
  STACK_DARK_INK,
  STACK_ENGRAVING,
  STACK_INK,
} from '@/app/(landing)/components/sim-stack/stack-layout'
import { getStrokeProgress, STACK_MOTIFS } from '@/app/(landing)/components/sim-stack/stack-motifs'
import {
  getStackAssemblyProgress,
  getStackLayerProgress,
  getStackSpacing,
  getStackSurfaceProgress,
} from '@/app/(landing)/components/sim-stack/stack-timeline'

interface StackArtworkProps {
  progress: number
  active: number
  dark?: boolean
}
interface PlaneContentProps {
  index: number
  drawing: number
  label: number
  dark: boolean
}

/** One centered name and one abstract motif replace miniature product screens. */
function PlaneContent({ index, drawing, label, dark }: PlaneContentProps) {
  const shimmerId = useId()
  const inkId = `${shimmerId}-ink`
  const ink = dark ? STACK_DARK_INK : STACK_INK
  if (index === 5) {
    return (
      <svg
        x={STACK_ENGRAVING.x - (WORDMARK_VIEW_BOX.width * STACK_ENGRAVING.wordmarkScale) / 2}
        y={STACK_ENGRAVING.y - (WORDMARK_VIEW_BOX.height * STACK_ENGRAVING.wordmarkScale) / 2}
        width={WORDMARK_VIEW_BOX.width * STACK_ENGRAVING.wordmarkScale}
        height={WORDMARK_VIEW_BOX.height * STACK_ENGRAVING.wordmarkScale}
        viewBox={`0 0 ${WORDMARK_VIEW_BOX.width} ${WORDMARK_VIEW_BOX.height}`}
      >
        <defs>
          <radialGradient id={inkId}>
            <stop stopColor={ink.inner} />
            <stop offset='1' stopColor={ink.outer} />
          </radialGradient>
        </defs>
        {WORDMARK_PATHS.map((d, pathIndex) => (
          <path
            key={`${pathIndex}-${d}`}
            d={d}
            fill={`url(#${inkId})`}
            fillOpacity={Math.max(0, (drawing - 0.85) / 0.15)}
            stroke={`url(#${inkId})`}
            strokeWidth='2.8'
            pathLength='1'
            strokeDasharray='1 1'
            strokeDashoffset={1 - getStrokeProgress(drawing, pathIndex, WORDMARK_PATHS.length)}
          />
        ))}
      </svg>
    )
  }

  return (
    <g>
      <g
        transform={`translate(${STACK_ENGRAVING.x} ${STACK_ENGRAVING.y}) scale(${STACK_ENGRAVING.scale})`}
        fill='none'
        strokeWidth='4'
        className='[--motif-stroke:6.4] md:[--motif-stroke:4]'
        strokeLinecap='round'
        strokeLinejoin='round'
      >
        <defs>
          {STACK_MOTIFS[index].map(({ d, x, y, scale, fade }, pathIndex) =>
            fade ? (
              <linearGradient
                key={`${pathIndex}-${d}`}
                id={`${inkId}-motif-${pathIndex}`}
                gradientUnits='userSpaceOnUse'
                x1={fade.x1}
                y1={fade.y1}
                x2={fade.x2}
                y2={fade.y2}
              >
                <stop stopColor={ink.outer} />
                <stop offset='1' stopColor={ink.outer} stopOpacity='0' />
              </linearGradient>
            ) : (
              <radialGradient
                key={`${pathIndex}-${d}`}
                id={`${inkId}-motif-${pathIndex}`}
                gradientUnits='userSpaceOnUse'
                cx={-x / scale}
                cy={-y / scale}
                r={STACK_ENGRAVING.gradientRadius / scale}
              >
                <stop stopColor={ink.inner} />
                <stop offset='1' stopColor={ink.outer} />
              </radialGradient>
            )
          )}
        </defs>
        {STACK_MOTIFS[index].map(({ d, x, y, scale }, pathIndex) => (
          <path
            key={`${pathIndex}-${d}`}
            d={d}
            transform={`translate(${x} ${y}) scale(${scale})`}
            stroke={`url(#${inkId}-motif-${pathIndex})`}
            strokeWidth={`calc(var(--motif-stroke) / ${scale})`}
            pathLength='1'
            strokeDasharray='1 1'
            strokeDashoffset={1 - getStrokeProgress(drawing, pathIndex, STACK_MOTIFS[index].length)}
          />
        ))}
      </g>
      <defs>
        <radialGradient id={inkId}>
          <stop stopColor={ink.inner} />
          <stop offset='1' stopColor={ink.outer} />
        </radialGradient>
        <linearGradient
          id={shimmerId}
          gradientUnits='userSpaceOnUse'
          x1={60 + label * 240 - 40}
          x2={60 + label * 240 + 40}
        >
          <stop stopColor='var(--text-primary)' />
          <stop offset='.5' stopColor='var(--surface-2)' />
          <stop offset='1' stopColor='var(--text-primary)' />
        </linearGradient>
      </defs>
      <text
        opacity={label * label * (3 - 2 * label)}
        x={STACK_ENGRAVING.x}
        y={STACK_ENGRAVING.labelY}
        textAnchor='middle'
        fontSize='18'
        fill={label < 1 ? `url(#${shimmerId})` : `url(#${inkId})`}
        stroke='none'
        letterSpacing='-0.3'
      >
        {STACK_LAYERS[index].title}
      </text>
    </g>
  )
}

/** Vector metal plates preserve the stack when WebGL is unavailable. */
export function StackFallback({ progress, active, dark = false }: StackArtworkProps) {
  const id = useId().replaceAll(':', '')
  const cornerRadius = (SLAB.cornerRadius / SLAB.width) * 360
  const spacing = getStackSpacing(progress)
  const foundation = getStackSurfaceProgress(progress, 0)
  const base = 245 + getStackAssemblyProgress(progress) * 27 * spacing
  return (
    <svg
      viewBox='67.5 0 1000 800'
      fill='none'
      aria-hidden='true'
      focusable='false'
      className='size-full overflow-visible'
    >
      <defs>
        <linearGradient id={`${id}-face`} x1='0' y1='0' x2='1' y2='1'>
          <stop stopColor={dark ? '#585858' : 'var(--surface-2)'} />
          <stop offset='.48' stopColor={dark ? '#4b4b4b' : 'var(--surface-3)'} />
          <stop offset='1' stopColor={dark ? '#3f3f3f' : 'var(--surface-6)'} />
        </linearGradient>
        <linearGradient id={`${id}-edge`} x1='0' y1='0' x2='0' y2='1'>
          <stop stopColor={dark ? '#6b6b6b' : 'var(--surface-2)'} stopOpacity={dark ? 1 : 0.45} />
          <stop
            offset='1'
            stopColor={dark ? '#2a2a2a' : 'var(--text-secondary)'}
            stopOpacity={dark ? 1 : 0.12}
          />
        </linearGradient>
        <radialGradient id={`${id}-ground`}>
          <stop
            stopColor={dark ? '#000000' : 'var(--text-primary)'}
            stopOpacity={dark ? 0.4 : 0.12}
          />
          <stop offset='1' stopColor={dark ? '#000000' : 'var(--text-primary)'} stopOpacity='0' />
        </radialGradient>
      </defs>
      <ellipse
        opacity={foundation.fill}
        cx='563'
        cy={base + 300}
        rx='340'
        ry='90'
        fill={`url(#${id}-ground)`}
      />
      {STACK_LAYERS.map((layer, index) => {
        const surface = getStackSurfaceProgress(progress, index)
        const { entrance, drawing } = getStackLayerProgress(progress, index)
        const eased = entrance * entrance * (3 - 2 * entrance)
        const y = base - index * 52 * spacing - (1 - eased) * 160
        return (
          <g key={layer.id} data-stack-plane={layer.id} transform={`translate(0 ${y})`}>
            <g opacity={surface.fill}>
              <rect
                transform='matrix(.82 .41 -.82 .41 567.5 13)'
                width='360'
                height='360'
                rx={cornerRadius}
                fill={`url(#${id}-edge)`}
                stroke='var(--text-secondary)'
                strokeWidth='.8'
              />
              <g
                transform='matrix(.82 .41 -.82 .41 567.5 0)'
                stroke='var(--text-secondary)'
                strokeWidth={active === index ? 1.2 : 0.75}
              >
                <rect width='360' height='360' rx={cornerRadius} fill={`url(#${id}-face)`} />
                <rect
                  x='6'
                  y='6'
                  width='348'
                  height='348'
                  rx={cornerRadius - 6}
                  fill='none'
                  stroke='var(--surface-2)'
                  strokeOpacity='.7'
                />
                <g>
                  <PlaneContent index={index} drawing={drawing} label={surface.label} dark={dark} />
                </g>
              </g>
            </g>
            {index === 0 && surface.fill < 1 && (
              <rect
                transform='matrix(.82 .41 -.82 .41 567.5 0)'
                width='360'
                height='360'
                rx={cornerRadius}
                stroke='var(--text-secondary)'
                strokeWidth='1'
                opacity={1 - surface.fill}
                pathLength='1'
                strokeDasharray='1 1'
                strokeDashoffset={1 - surface.outline}
              />
            )}
          </g>
        )
      })}
    </svg>
  )
}
