'use client'

import dynamic from 'next/dynamic'
import type { BlockPreviewProps } from '@/components/workflow-preview/block-preview'
import type { OutputBundleProps } from '@/components/workflow-preview/output-bundle'
import type { WorkflowPreviewProps } from '@/components/workflow-preview/workflow-preview'

const loading = () => null

/** Keeps the canvas libraries off ordinary reading pages while preserving server-rendered previews. */
export const WorkflowPreview = dynamic<WorkflowPreviewProps>(
  () =>
    import('@/components/workflow-preview/workflow-preview').then(
      (module) => module.WorkflowPreview
    ),
  { loading }
)

export const BlockPreview = dynamic<BlockPreviewProps>(
  () => import('@/components/workflow-preview/block-preview').then((module) => module.BlockPreview),
  { loading }
)

export const OutputBundle = dynamic<OutputBundleProps>(
  () => import('@/components/workflow-preview/output-bundle').then((module) => module.OutputBundle),
  { loading }
)
