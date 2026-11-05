import { useId } from 'react'
import { glyphs, type IconName } from '@/platform/design-system/catalog/icon-geometry'
import styles from '@/platform/design-system/components/icon/icon.module.css'

interface IconProps {
  name: IconName
  label?: string
}

export function Icon({ name, label }: IconProps) {
  const id = useId()
  const glyph = glyphs[name]
  return (
    <svg
      className={styles.icon}
      data-interface-icon={'artwork' in glyph ? undefined : ''}
      viewBox={glyph.viewBox}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable='false'
    >
      {glyph.draw(id)}
    </svg>
  )
}
