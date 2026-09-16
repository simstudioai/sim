'use client'

import { EnterpriseMenuPreview } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/enterprise-menu-preview'
import { KnowledgeMenuPreview } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/knowledge-menu-preview'

interface PlatformFeaturePreviewProps {
  product: 'knowledge' | 'enterprise'
}

/** Keeps native controls and their icon props inside the client preview boundary. */
export function PlatformFeaturePreview({ product }: PlatformFeaturePreviewProps) {
  return product === 'knowledge' ? (
    <KnowledgeMenuPreview layout='hero' />
  ) : (
    <EnterpriseMenuPreview layout='hero' />
  )
}
