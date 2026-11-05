import { useId } from 'react'
import { glyphs, type IconName } from '@/platform/design-system/catalog/icon-geometry'
import styles from '@/platform/design-system/components/icon/icon.module.css'
import { providerMark } from '@/platform/design-system/components/icon/provider-marks'

type IconProps = { label?: string } & (
  | { name: IconName; providerId?: never }
  | { providerId: string; name?: never }
)

export function Icon({ name, providerId, label }: IconProps) {
  const id = useId()
  const mark = name ?? providerMark(providerId)
  const glyph = typeof mark === 'string' ? glyphs[mark] : undefined
  return (
    <svg
      className={styles.icon}
      data-interface-icon={glyph && !('artwork' in glyph) ? '' : undefined}
      viewBox={glyph?.viewBox}
      fill={glyph ? undefined : 'currentColor'}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable='false'
    >
      {typeof mark === 'string' ? (
        glyphs[mark].draw(id)
      ) : (
        <use href={mark.href} width='100%' height='100%' />
      )}
    </svg>
  )
}
