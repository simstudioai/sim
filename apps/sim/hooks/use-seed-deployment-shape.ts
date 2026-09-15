'use client'

import { useEffect, useState } from 'react'
import type { DeploymentShape } from '@/lib/api/contracts/workspaces'
import { seedDeploymentShape } from '@/lib/core/config/deployment-shape'

/**
 * Seeds a server-resolved deployment shape during the caller's own render, ahead of its
 * children, then follows later changes to the shape in an effect.
 */
export function useSeedDeploymentShape(shape: DeploymentShape | undefined): void {
  useState(() => seedDeploymentShape(shape))
  useEffect(() => {
    seedDeploymentShape(shape)
  }, [shape])
}
