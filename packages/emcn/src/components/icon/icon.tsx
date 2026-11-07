'use client'

import { type SVGProps, useId } from 'react'
import { glyphs } from '#emcn/catalog/icon-geometry'
import { useAssetBasePath } from '#emcn/components/icon/assets'
import styles from '#emcn/components/icon/icon.module.css'
import { interfaceGlyphs } from '#emcn/components/icon/interface-glyphs'
import { providerMark } from '#emcn/components/icon/provider-marks'
import { cn } from '#emcn/lib/cn'

const interfaceGeometry = { ...glyphs, ...interfaceGlyphs }
export type IconName = keyof typeof interfaceGeometry

type IconProps = Omit<SVGProps<SVGSVGElement>, 'name' | 'children' | 'style' | 'css' | 'sx'> & {
  label?: string
} & ({ name: IconName; providerId?: never } | { providerId: string; name?: never })

export function Icon({ name, providerId, label, className, ...props }: IconProps) {
  const id = useId()
  const assetBasePath = useAssetBasePath()
  const mark = name ?? providerMark(providerId, assetBasePath)
  const glyph = typeof mark === 'string' ? interfaceGeometry[mark] : undefined
  return (
    <svg
      {...props}
      className={cn(styles.icon, className)}
      data-interface-icon={glyph && !('artwork' in glyph) ? '' : undefined}
      viewBox={glyph?.viewBox}
      fill={glyph ? undefined : 'currentColor'}
      aria-hidden={
        props['aria-hidden'] ??
        (label || props['aria-label'] || props['aria-labelledby'] ? undefined : true)
      }
      role={
        props.role ?? (label || props['aria-label'] || props['aria-labelledby'] ? 'img' : undefined)
      }
      aria-label={label ?? props['aria-label']}
      focusable={props.focusable ?? 'false'}
    >
      {typeof mark === 'string' ? (
        interfaceGeometry[mark].draw(id)
      ) : (
        <use href={mark.href} width='100%' height='100%' />
      )}
    </svg>
  )
}
