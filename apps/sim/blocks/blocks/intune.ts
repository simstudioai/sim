import { IntuneIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

export const IntuneBlock: BlockConfig = {
  type: 'intune',
  name: 'Microsoft Intune',
  description: 'Manage devices, application inventory, and compliance with Microsoft Intune',
  longDescription:
    'Read managed device and detected application inventories, inspect compliance policy status and device configuration metadata, and request device sync, restart, remote lock, or retirement. Uses Microsoft Graph v1.0 with a work or school account and an active Intune tenant license. Remote actions depend on device platform and the connected administrator’s Intune permissions.',
  docsLink: 'https://docs.sim.ai/integrations/intune',
  category: 'tools',
  integrationType: IntegrationType.Security,
  bgColor: '#0078D4',
  icon: IntuneIcon,
  authMode: AuthMode.OAuth,
  canvasPresentation: {
    defaultTitle: 'Microsoft Intune',
    sentences: {
      byOperation: {
        intune_list_devices: ['List managed devices'],
        intune_get_device: [{ text: 'Read device', field: 'managedDeviceId', core: true }],
        intune_list_detected_apps: ['List detected applications'],
        intune_get_detected_app: [
          { text: 'Read detected application', field: 'detectedAppId', core: true },
        ],
        intune_list_app_devices: [
          { text: 'List devices with application', field: 'detectedAppId', core: true },
        ],
        intune_list_compliance_policies: ['List compliance policies'],
        intune_get_compliance_policy: [
          { text: 'Read compliance policy', field: 'compliancePolicyId', core: true },
        ],
        intune_list_compliance_policy_device_statuses: [
          {
            text: 'Read device statuses for compliance policy',
            field: 'compliancePolicyId',
            core: true,
          },
        ],
        intune_list_device_configurations: ['List device configurations'],
        intune_get_device_configuration: [
          { text: 'Read device configuration', field: 'configurationId', core: true },
        ],
        intune_sync_device: [{ text: 'Sync device', field: 'managedDeviceId', core: true }],
        intune_reboot_device: [{ text: 'Reboot device', field: 'managedDeviceId', core: true }],
        intune_remote_lock_device: [{ text: 'Lock device', field: 'managedDeviceId', core: true }],
        intune_retire_device: [{ text: 'Retire device', field: 'managedDeviceId', core: true }],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Devices', id: 'intune_list_devices' },
        { label: 'Get Device', id: 'intune_get_device' },
        { label: 'List Detected Apps', id: 'intune_list_detected_apps' },
        { label: 'Get Detected App', id: 'intune_get_detected_app' },
        { label: 'List App Devices', id: 'intune_list_app_devices' },
        { label: 'List Compliance Policies', id: 'intune_list_compliance_policies' },
        { label: 'Get Compliance Policy', id: 'intune_get_compliance_policy' },
        {
          label: 'List Compliance Policy Device Statuses',
          id: 'intune_list_compliance_policy_device_statuses',
        },
        { label: 'List Device Configurations', id: 'intune_list_device_configurations' },
        { label: 'Get Device Configuration', id: 'intune_get_device_configuration' },
        { label: 'Sync Device', id: 'intune_sync_device' },
        { label: 'Reboot Device', id: 'intune_reboot_device' },
        { label: 'Remote Lock Device', id: 'intune_remote_lock_device' },
        { label: 'Retire Device', id: 'intune_retire_device' },
      ],
      value: () => 'intune_list_devices',
    },
    {
      id: 'credential',
      title: 'Microsoft Intune Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      serviceId: 'microsoft-intune',
      requiredScopes: getScopesForService('microsoft-intune'),
      required: true,
    },
    {
      id: 'managedDeviceId',
      title: 'Managed Device ID',
      type: 'short-input',
      placeholder: 'Enter the Intune managed device ID',
      condition: {
        field: 'operation',
        value: [
          'intune_get_device',
          'intune_sync_device',
          'intune_reboot_device',
          'intune_remote_lock_device',
          'intune_retire_device',
        ],
      },
      required: true,
    },
    {
      id: 'detectedAppId',
      title: 'Detected App ID',
      type: 'short-input',
      placeholder: 'Enter the detected application ID',
      condition: {
        field: 'operation',
        value: ['intune_get_detected_app', 'intune_list_app_devices'],
      },
      required: true,
    },
    {
      id: 'compliancePolicyId',
      title: 'Compliance Policy ID',
      type: 'short-input',
      placeholder: 'Enter the compliance policy ID',
      condition: {
        field: 'operation',
        value: ['intune_get_compliance_policy', 'intune_list_compliance_policy_device_statuses'],
      },
      required: true,
    },
    {
      id: 'configurationId',
      title: 'Configuration ID',
      type: 'short-input',
      placeholder: 'Enter the device configuration ID',
      condition: { field: 'operation', value: ['intune_get_device_configuration'] },
      required: true,
    },
    {
      id: 'confirmAction',
      title: 'Confirm Device Action',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['intune_reboot_device', 'intune_remote_lock_device', 'intune_retire_device'],
      },
      required: true,
    },
    {
      id: 'filter',
      title: 'Device Filter',
      type: 'short-input',
      placeholder: "complianceState eq 'noncompliant'",
      mode: 'advanced',
      condition: { field: 'operation', value: ['intune_list_devices'] },
      wandConfig: {
        enabled: true,
        prompt:
          "Generate a Microsoft Graph managedDevices OData filter. Examples: complianceState eq 'noncompliant', operatingSystem eq 'Windows', deviceName eq 'LAPTOP-01'. Use only documented managedDevice filter properties. Return ONLY the OData filter expression.",
        placeholder: 'Describe which managed devices to find',
      },
    },
    {
      id: 'top',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '1 to 1000 (defaults to 100)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'intune_list_devices',
          'intune_list_detected_apps',
          'intune_list_app_devices',
          'intune_list_compliance_policies',
          'intune_list_compliance_policy_device_statuses',
          'intune_list_device_configurations',
        ],
      },
    },
    {
      id: 'nextLink',
      title: 'Next Page URL',
      type: 'short-input',
      placeholder: 'Paste nextLink from the previous page',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'intune_list_devices',
          'intune_list_detected_apps',
          'intune_list_app_devices',
          'intune_list_compliance_policies',
          'intune_list_compliance_policy_device_statuses',
          'intune_list_device_configurations',
        ],
      },
    },
  ],
  tools: {
    access: [
      'intune_list_devices',
      'intune_get_device',
      'intune_list_detected_apps',
      'intune_get_detected_app',
      'intune_list_app_devices',
      'intune_list_compliance_policies',
      'intune_get_compliance_policy',
      'intune_list_compliance_policy_device_statuses',
      'intune_list_device_configurations',
      'intune_get_device_configuration',
      'intune_sync_device',
      'intune_reboot_device',
      'intune_remote_lock_device',
      'intune_retire_device',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => ({
        top:
          params.top === '' || params.top === undefined || params.top === null
            ? undefined
            : Number(params.top),
        confirmAction: params.confirmAction === true || params.confirmAction === 'true',
      }),
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Intune operation to perform' },
    oauthCredential: { type: 'string', description: 'Connected Microsoft Intune account' },
    managedDeviceId: {
      type: 'string',
      description: 'Intune managed device ID, distinct from the Entra device ID',
    },
    detectedAppId: { type: 'string', description: 'Detected application ID' },
    compliancePolicyId: { type: 'string', description: 'Device compliance policy ID' },
    configurationId: { type: 'string', description: 'Device configuration ID' },
    confirmAction: {
      type: 'boolean',
      description: 'Confirm restart, remote lock, or retirement of the selected device',
    },
    filter: { type: 'string', description: 'OData filter for managed devices' },
    top: { type: 'number', description: 'Requested page size (1 to 1000, default 100)' },
    nextLink: {
      type: 'string',
      description: 'Resource-bound continuation URL from the preceding page',
    },
  },
  outputs: {
    devices: {
      type: 'json',
      description:
        'Managed devices (id, deviceName, operatingSystem, osVersion, complianceState, userPrincipalName, lastSyncDateTime, isEncrypted, serialNumber, manufacturer, model)',
      condition: { field: 'operation', value: ['intune_list_devices', 'intune_list_app_devices'] },
    },
    device: {
      type: 'json',
      description:
        'Managed device (id, deviceName, operatingSystem, osVersion, complianceState, managementState, userPrincipalName, lastSyncDateTime, isEncrypted, serialNumber, storage capacity)',
      condition: { field: 'operation', value: ['intune_get_device'] },
    },
    apps: {
      type: 'json',
      description:
        'Detected applications (id, displayName, version, publisher, platform, sizeInByte, deviceCount)',
      condition: { field: 'operation', value: ['intune_list_detected_apps'] },
    },
    app: {
      type: 'json',
      description:
        'Detected application (id, displayName, version, publisher, platform, sizeInByte, deviceCount)',
      condition: { field: 'operation', value: ['intune_get_detected_app'] },
    },
    policies: {
      type: 'json',
      description:
        'Compliance policy metadata (id, displayName, description, createdDateTime, lastModifiedDateTime, version)',
      condition: { field: 'operation', value: ['intune_list_compliance_policies'] },
    },
    policy: {
      type: 'json',
      description:
        'Common compliance policy metadata (id, displayName, description, createdDateTime, lastModifiedDateTime, version); excludes platform-specific rule settings',
      condition: { field: 'operation', value: ['intune_get_compliance_policy'] },
    },
    configurations: {
      type: 'json',
      description:
        'Device configuration metadata (id, displayName, description, createdDateTime, lastModifiedDateTime, version)',
      condition: { field: 'operation', value: ['intune_list_device_configurations'] },
    },
    configuration: {
      type: 'json',
      description:
        'Common device configuration metadata (id, displayName, description, createdDateTime, lastModifiedDateTime, version); excludes platform-specific settings',
      condition: { field: 'operation', value: ['intune_get_device_configuration'] },
    },
    deviceStatuses: {
      type: 'json',
      description:
        'Device status records (id, deviceDisplayName, deviceModel, userName, userPrincipalName, status, lastReportedDateTime, complianceGracePeriodExpirationDateTime)',
      condition: { field: 'operation', value: ['intune_list_compliance_policy_device_statuses'] },
    },
    nextLink: {
      type: 'string',
      description: 'Next page URL, or null when no page remains',
      condition: {
        field: 'operation',
        value: [
          'intune_list_devices',
          'intune_list_detected_apps',
          'intune_list_app_devices',
          'intune_list_compliance_policies',
          'intune_list_compliance_policy_device_statuses',
          'intune_list_device_configurations',
        ],
      },
    },
    accepted: {
      type: 'boolean',
      description: 'Whether Intune accepted the request; device completion is asynchronous',
      condition: {
        field: 'operation',
        value: [
          'intune_sync_device',
          'intune_reboot_device',
          'intune_remote_lock_device',
          'intune_retire_device',
        ],
      },
    },
  },
}

export const IntuneBlockMeta = {
  tags: ['microsoft-365', 'monitoring', 'automation'],
  url: 'https://www.microsoft.com/en-us/security/business/microsoft-intune',
  templates: [
    {
      icon: IntuneIcon,
      title: 'Daily Compliance Review',
      prompt:
        'Build a scheduled agent that reads Intune managed devices and flags noncompliant devices with their owners and last check-in times. Publish a concise report with device IDs for follow-up.',
      modules: ['scheduled', 'agent'],
      category: 'operations',
      tags: ['automation', 'microsoft-365'],
    },
    {
      icon: IntuneIcon,
      title: 'Software Inventory Audit',
      prompt:
        'Build an agent that pages through Intune detected apps, groups names and versions, and identifies installations of software on a supplied review list. Return affected application IDs and device counts.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'microsoft-365'],
    },
    {
      icon: IntuneIcon,
      title: 'Application Exposure Review',
      prompt:
        'When an application version is flagged for review, use Intune detected apps to identify its record and list the managed devices where it is installed. Produce the device names, owners, and compliance states.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'microsoft-365'],
    },
    {
      icon: IntuneIcon,
      title: 'Policy Deployment Triage',
      prompt:
        'Build an agent that reads a selected Intune compliance policy and its device statuses. Summarize compliant, noncompliant, conflicting, and error results with last report times.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['automation', 'microsoft-365'],
    },
    {
      icon: IntuneIcon,
      title: 'Device Check-In Follow-Up',
      prompt:
        'Build a scheduled agent that finds Intune devices with stale check-in times and requests a sync for approved device IDs. Report accepted sync requests separately from later device check-ins.',
      modules: ['scheduled', 'workflows'],
      category: 'support',
      tags: ['automation', 'microsoft-365'],
    },
    {
      icon: IntuneIcon,
      title: 'Approved Device Retirement',
      prompt:
        'When an administrator approves a device retirement, read the Intune device and verify its ID and owner. Request retirement only with explicit confirmation and report that the request was accepted.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'microsoft-365'],
    },
    {
      icon: IntuneIcon,
      title: 'Help Desk Device Actions',
      prompt:
        'Build an agent that reads an Intune device during an IT support request, summarizes its operating system and compliance status, and requests a restart or remote lock only after an administrator explicitly confirms the action.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['automation', 'microsoft-365'],
    },
  ],
  skills: [
    {
      name: 'review-device-compliance',
      description: 'Summarize noncompliant managed devices and the freshness of their status.',
      content:
        '# Review Device Compliance\n\n## Steps\n1. Read managed devices using the complianceState filter or inspect their returned compliance states.\n2. Continue with nextLink only as needed, keeping the same operation and a bounded page budget.\n3. Summarize owners, operating systems, and last check-in times. For a selected policy, read its device statuses for policy-specific context.\n\n## Output\nReturn device IDs, compliance states, and the last known check-in. Clearly state when a page budget means the report is partial.\n\n## Reference\n[Microsoft documentation](https://learn.microsoft.com/en-us/intune/device-security/compliance/monitor-policy)',
    },
    {
      name: 'audit-detected-applications',
      description:
        'Review discovered software names, versions, publishers, and affected device counts.',
      content:
        '# Audit Detected Applications\n\n## Steps\n1. Read detected apps one page at a time.\n2. Compare application names and versions against the supplied software review criteria.\n3. For an application that needs investigation, read its details and list the managed devices where it was detected.\n\n## Output\nReturn application IDs, versions, counts, and affected device IDs. Discovered app inventory refreshes periodically and is not a live scan.\n\n## Reference\n[Microsoft documentation](https://learn.microsoft.com/en-gb/intune/app-management/discovered-apps)',
    },
    {
      name: 'triage-policy-compliance',
      description: 'Inspect a compliance policy and summarize its per-device status.',
      content:
        '# Triage Policy Compliance\n\n## Steps\n1. List compliance policies and select the requested policy ID.\n2. Read the common policy metadata, then page through its device statuses.\n3. Group statuses and identify devices reporting errors, conflicts, or noncompliance.\n\n## Output\nReturn the policy ID, version, status groups, and last report times. These tools return common metadata, not platform-specific compliance rule settings.\n\n## Reference\n[Microsoft documentation](https://learn.microsoft.com/en-us/intune/device-management/reports/overview)',
    },
    {
      name: 'refresh-device-check-in',
      description:
        'Request an Intune sync while distinguishing request acceptance from device completion.',
      content:
        '# Refresh Device Check-In\n\n## Steps\n1. Read the requested managed device and confirm its Intune ID and latest check-in.\n2. Request a sync for the selected device.\n3. If follow-up is requested, read the device again later and compare lastSyncDateTime.\n\n## Output\nReturn whether the sync request was accepted and the latest observed check-in time. Do not claim policies have applied merely because Graph returned success.\n\n## Reference\n[Microsoft documentation](https://learn.microsoft.com/en-us/intune/device-management/actions/sync)',
    },
    {
      name: 'assess-application-exposure',
      description: 'Find the managed devices affected by a reviewed software version.',
      content:
        '# Assess Application Exposure\n\n## Steps\n1. Locate the detected application by name, publisher, and version from the app inventory.\n2. List the devices associated with the detected application ID, continuing only within an explicit page budget.\n3. Summarize operating systems, owners, and device compliance states for follow-up.\n\n## Output\nReturn the specific application version and affected device IDs. Do not infer vulnerabilities from a name alone or claim the inventory is real-time.\n\n## Reference\n[Microsoft documentation](https://learn.microsoft.com/en-gb/intune/app-management/discovered-apps)',
    },
    {
      name: 'retire-approved-device',
      description:
        'Retire a selected managed device after an administrator explicitly approves removal of company data.',
      content:
        '# Retire Approved Device\n\n## Steps\n1. Read the managed device and verify its Intune ID, owner, and platform against the approved request.\n2. Explain that retirement removes company data and management; verify the administrator has completed their backup and recovery-key procedures where applicable.\n3. Only with explicit user confirmation, request retirement for that device.\n\n## Output\nReport request acceptance without claiming completion. Retirement occurs when the device checks in, and availability depends on platform and administrator permissions.\n\n## Reference\n[Microsoft documentation](https://learn.microsoft.com/en-us/intune/device-management/actions/retire)',
    },
  ],
} as const satisfies BlockMeta
