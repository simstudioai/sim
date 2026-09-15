'use client'

import { useEffect, useState } from 'react'
import type { DeploymentShape } from '@/lib/api/contracts/workspaces'
import { seedDeploymentShape } from '@/lib/core/config/deployment-shape'

/**
 * Installs a server-resolved deployment shape for browser readers. Seeds from the
 * provider's own render, ahead of any child, so the first paint already reads the
 * server value; the effect then follows the shape as it refetches. The lazy
 * initializer is React's once-per-mount hook for work that must precede children.
 * Lives outside the reader because block definitions import the reader into React
 * Server Component graphs, where React hooks are rejected.
 */
export function useSeedDeploymentShape(shape: DeploymentShape | undefined): void {
  useState(() => seedDeploymentShape(shape))
  useEffect(() => {
    seedDeploymentShape(shape)
  }, [shape])
}
