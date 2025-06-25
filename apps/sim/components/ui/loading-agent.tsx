'use client'

export interface LoadingAgentProps {
  /**
   * Size of the loading agent
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
}

export function LoadingAgent({ size = 'md' }: LoadingAgentProps) {
  const pathLength = 120

  const sizes = {
    sm: { width: 16, height: 18 },
    md: { width: 21, height: 24 },
    lg: { width: 30, height: 34 },
  }

  const { width, height } = sizes[size]

  return (
    <svg
      width={width}
      height={height}
      viewBox='0 0 21 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M15.6667 9.25H4.66667C2.64162 9.25 1 10.8916 1 12.9167V18.4167C1 20.4417 2.64162 22.0833 4.66667 22.0833H15.6667C17.6917 22.0833 19.3333 20.4417 19.3333 18.4167V12.9167C19.3333 10.8916 17.6917 9.25 15.6667 9.25Z'
        stroke='#802FFF'
        strokeWidth='1.8'
        strokeLinecap='round'
        strokeLinejoin='round'
        style={{
          strokeDasharray: pathLength,
          strokeDashoffset: pathLength,
          animation: 'dashLoop 3s linear infinite',
        }}
      />
      <path
        d='M10.1663 5.58464C11.1789 5.58464 11.9997 4.76382 11.9997 3.7513C11.9997 2.73878 11.1789 1.91797 10.1663 1.91797C9.15382 1.91797 8.33301 2.73878 8.33301 3.7513C8.33301 4.76382 9.15382 5.58464 10.1663 5.58464Z'
        stroke='#802FFF'
        strokeWidth='1.8'
        strokeLinecap='round'
        strokeLinejoin='round'
        style={{
          strokeDasharray: pathLength,
          strokeDashoffset: pathLength,
          animation: 'dashLoop 3s linear infinite',
          animationDelay: '0.5s',
        }}
      />
      <path
        d='M10.167 5.58594V9.2526M7.41699 16.5859V14.7526M12.917 14.7526V16.5859'
        stroke='#802FFF'
        strokeWidth='1.8'
        strokeLinecap='round'
        strokeLinejoin='round'
        style={{
          strokeDasharray: pathLength,
          strokeDashoffset: pathLength,
          animation: 'dashLoop 3s linear infinite',
          animationDelay: '1s',
        }}
      />
      <style>
        {`
          @keyframes dashLoop {
            0% {
              stroke-dashoffset: ${pathLength};
            }
            50% {
              stroke-dashoffset: 0;
            }
            100% {
              stroke-dashoffset: ${pathLength};
            }
          }
        `}
      </style>
    </svg>
  )
}
