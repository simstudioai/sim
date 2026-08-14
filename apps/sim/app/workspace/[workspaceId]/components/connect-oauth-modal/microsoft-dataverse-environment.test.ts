/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { useMicrosoftDataverseEnvironmentForm } from '@/app/workspace/[workspaceId]/components/connect-oauth-modal/microsoft-dataverse-environment'

type FormResult = ReturnType<typeof useMicrosoftDataverseEnvironmentForm>

function renderEnvironmentForm(props: Parameters<typeof useMicrosoftDataverseEnvironmentForm>[0]): {
  result: () => FormResult
  unmount: () => void
} {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root: Root = createRoot(container)
  let latest: FormResult

  function Probe() {
    latest = useMicrosoftDataverseEnvironmentForm(props)
    return null
  }

  act(() => root.render(createElement(Probe)))
  return {
    result: () => latest,
    unmount: () => act(() => root.unmount()),
  }
}

describe('useMicrosoftDataverseEnvironmentForm', () => {
  it('collects and validates a free environment value', () => {
    const hook = renderEnvironmentForm({
      fallbackScopes: ['legacy'],
      open: true,
      providerId: 'microsoft-dataverse',
      required: true,
    })

    expect(hook.result()).toMatchObject({
      effectiveScopes: ['openid', 'profile', 'email', 'offline_access'],
      enabled: true,
      isComplete: false,
      isLocked: false,
      value: '',
    })

    act(() => hook.result().setValue('https://evil.example'))
    act(() => expect(hook.result().validate()).toBeUndefined())
    expect(hook.result().error).toContain('supported public-cloud Microsoft Dynamics host')

    act(() => hook.result().setValue(' https://contoso.crm4.dynamics.com/ '))
    act(() => expect(hook.result().validate()).toBe('https://contoso.api.crm4.dynamics.com'))
    expect(hook.result().effectiveScopes).toEqual([
      'openid',
      'profile',
      'email',
      'https://contoso.api.crm4.dynamics.com/.default',
      'offline_access',
    ])
    hook.unmount()
  })

  it('locks workflow and reconnect flows to their supplied environment', () => {
    const hook = renderEnvironmentForm({
      fallbackScopes: ['legacy'],
      lockedEnvironmentUrl: 'https://contoso.crm.dynamics.com',
      open: true,
      providerId: 'microsoft-dataverse',
      required: true,
    })

    expect(hook.result()).toMatchObject({
      enabled: true,
      isComplete: true,
      isLocked: true,
      value: 'https://contoso.crm.dynamics.com',
    })
    expect(hook.result().validate()).toBe('https://contoso.api.crm.dynamics.com')
    hook.unmount()
  })

  it('does not affect ordinary OAuth providers', () => {
    const hook = renderEnvironmentForm({
      fallbackScopes: ['scope-a'],
      open: true,
      providerId: 'salesforce',
      required: true,
    })

    expect(hook.result()).toMatchObject({
      effectiveScopes: ['scope-a'],
      enabled: false,
      isComplete: true,
      isLocked: false,
      value: '',
    })
    hook.unmount()
  })
})
