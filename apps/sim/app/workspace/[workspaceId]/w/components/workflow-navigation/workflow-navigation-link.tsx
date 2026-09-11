'use client'

import type { ComponentProps } from 'react'
import Link from 'next/link'
import { useWorkflowNavigation } from '@/app/workspace/[workspaceId]/w/components/workflow-navigation/workflow-navigation-provider'

interface WorkflowNavigationLinkProps
  extends Omit<ComponentProps<typeof Link>, 'href' | 'onNavigate'> {
  href: string
}

/** Preserves Link's selection and new-tab behavior while announcing same-tab navigation. */
export function WorkflowNavigationLink({
  href,
  replace,
  scroll,
  transitionTypes,
  ...props
}: WorkflowNavigationLinkProps) {
  const navigate = useWorkflowNavigation()

  return (
    <Link
      {...props}
      href={href}
      replace={replace}
      scroll={scroll}
      transitionTypes={transitionTypes}
      onNavigate={
        navigate
          ? (event) => {
              event.preventDefault()
              navigate(href, { replace, scroll, transitionTypes })
            }
          : undefined
      }
    />
  )
}
