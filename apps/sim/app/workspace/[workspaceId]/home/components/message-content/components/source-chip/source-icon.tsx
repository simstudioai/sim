'use client'

import { useState } from 'react'
import { cn } from '@sim/emcn'
import { FileText } from '@sim/emcn/icons'
import { stripVersionSuffix } from '@sim/utils/string'
import { GoogleDocsIcon, GoogleSheetsIcon, GoogleSlidesIcon } from '@/components/icons'
import { faviconUrl } from '@/lib/core/utils/favicon'
import { blockTypeToIconMap } from '@/lib/integrations/icon-mapping'
import { externalLinkHostname } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-link'
import type { SourceTagData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { BrandIcon, type StyleableIcon } from '@/blocks/brand-icon'

/**
 * Brand marks by base block type. A connector id names the same product as its
 * integration block (`confluence`, `google_drive`), so the block's mark serves
 * the chip — through the catalog icon map rather than the connector registry,
 * which would drag seventy connector modules into every surface that renders
 * chat. Versioned catalog types (`gmail_v2`) collapse onto their base name.
 */
const BRAND_ICON_BY_BASE_TYPE: ReadonlyMap<string, StyleableIcon> = new Map(
  Object.entries(blockTypeToIconMap).map(([type, icon]) => [stripVersionSuffix(type), icon])
)

/** Docs, Sheets and Slides share a hostname; the first path segment identifies the product. */
const GOOGLE_DOCUMENT_ICON_BY_PATH: ReadonlyMap<string, StyleableIcon> = new Map([
  ['document', GoogleDocsIcon],
  ['spreadsheets', GoogleSheetsIcon],
  ['presentation', GoogleSlidesIcon],
])

interface SourceIconProps {
  source: SourceTagData
  size?: 'default' | 'inline'
}

/** Shared document mark, connector mark, favicon and fallback across all source presentations. */
export function SourceIcon({ source, size = 'default' }: SourceIconProps) {
  const [failedHostname, setFailedHostname] = useState<string | null>(null)
  const hostname = externalLinkHostname(source.url)
  const ConnectorIcon = source.connectorType
    ? BRAND_ICON_BY_BASE_TYPE.get(stripVersionSuffix(source.connectorType))
    : undefined
  const DocumentIcon =
    hostname === 'docs.google.com'
      ? GOOGLE_DOCUMENT_ICON_BY_PATH.get(new URL(source.url).pathname.split('/')[1] ?? '')
      : undefined
  const Icon = DocumentIcon ?? ConnectorIcon
  const className = cn('shrink-0', size === 'inline' ? 'size-[12px]' : 'size-[14px]')
  if (Icon) return <BrandIcon icon={Icon} className={className} />
  if (hostname && failedHostname !== hostname) {
    return (
      <img
        src={faviconUrl(hostname, 64)}
        alt=''
        referrerPolicy='no-referrer'
        className={cn(className, 'rounded-sm')}
        onError={() => setFailedHostname(hostname)}
      />
    )
  }
  return <FileText aria-hidden className={cn(className, 'text-[var(--text-icon)]')} />
}
