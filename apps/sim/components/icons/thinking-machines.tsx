import type { SVGProps } from 'react'

interface ThinkingMachinesIconProps extends SVGProps<SVGSVGElement> {}

export function ThinkingMachinesIcon(props: ThinkingMachinesIconProps) {
  return (
    <svg {...props} viewBox='0 0 32 32' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <rect width='32' height='32' fill='#111111' rx='8' />
      <text
        x='16'
        y='20.5'
        fill='#FFFFFF'
        fontFamily='ui-sans-serif, system-ui, sans-serif'
        fontSize='12'
        fontWeight='600'
        textAnchor='middle'
      >
        TM
      </text>
    </svg>
  )
}
