const RING_RADIUS = 5.5
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

interface CountdownRingProps {
  duration: number
  paused?: boolean
  className?: string
}

export function CountdownRing({ duration, paused = false, className }: CountdownRingProps) {
  return (
    <svg
      width='14'
      height='14'
      viewBox='0 0 16 16'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={className}
      style={{ transform: 'rotate(-90deg) scaleX(-1)' }}
    >
      <circle cx='8' cy='8' r={RING_RADIUS} stroke='currentColor' strokeWidth='1.5' opacity={0.2} />
      <circle
        cx='8'
        cy='8'
        r={RING_RADIUS}
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeDasharray={RING_CIRCUMFERENCE}
        style={{
          animation: `notification-countdown ${duration}ms linear forwards`,
          animationPlayState: paused ? 'paused' : 'running',
        }}
      />
    </svg>
  )
}
