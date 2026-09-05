import { NetSuiteIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import {
  parseOptionalBooleanInput,
  parseOptionalJsonInput,
  parseOptionalNumberInput,
} from '@/blocks/utils'

export const OciSecretsBlock: BlockConfig = {
  type: 'oci_secrets',
  name: 'OCI Secrets',
  description: 'Manage OCI secrets, versions and rotation',
  longDescription:
    'Manage Oracle Cloud Infrastructure secrets with a stored OCI API signing-key service account. Read metadata or deliberately retrieve secret content, manage versions and stages, create and update secrets, configure generation and cross-region replication, schedule or cancel deletion, and monitor rotation work requests. Discover existing vaults and encryption keys without granting this block key-management or cryptographic mutation capabilities. Oracle IAM separately controls secret metadata, secret versions, secret bundles, vaults and keys. Manual OCID inputs avoid discovery permissions; configure the compartment inputs in basic mode to use the pickers. Pending deletion blocks content retrieval, and permanent deletion cannot be reversed. Rotation and creation may still be in progress after acceptance.',
  docsLink: 'https://docs.sim.ai/integrations/oci_secrets',
  category: 'tools',
  integrationType: IntegrationType.Security,
  bgColor: '#C74634',
  icon: NetSuiteIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    defaultTitle: 'OCI Secrets',
    sentences: {
      byOperation: {
        list_secrets: [
          { text: 'List secret metadata in compartment', field: 'compartmentId', core: true },
        ],
        get_secret: [
          {
            text: 'Read secret metadata for',
            field: ['secretSelector', 'manualSecretId'],
            core: true,
          },
        ],
        create_secret: [
          { text: 'Create secret', field: 'secretName', core: true },
          { text: 'in vault', field: ['vaultSelector', 'manualVaultId'], core: true },
        ],
        update_secret: [
          { text: 'Update secret', field: ['secretSelector', 'manualSecretId'], core: true },
        ],
        list_secret_versions: [
          {
            text: 'List managed versions of secret',
            field: ['secretSelector', 'manualSecretId'],
            core: true,
          },
        ],
        get_secret_version: [
          { text: 'Read metadata for version', field: 'secretVersionNumber', core: true },
          { text: 'of secret', field: ['secretSelector', 'manualSecretId'], core: true },
        ],
        schedule_secret_deletion: [
          {
            text: 'Schedule deletion of secret',
            field: ['secretSelector', 'manualSecretId'],
            core: true,
          },
          { text: 'at', field: 'timeOfDeletion' },
        ],
        cancel_secret_deletion: [
          {
            text: 'Cancel deletion of secret',
            field: ['secretSelector', 'manualSecretId'],
            core: true,
          },
        ],
        schedule_secret_version_deletion: [
          { text: 'Schedule deletion of version', field: 'secretVersionNumber', core: true },
          { text: 'of secret', field: ['secretSelector', 'manualSecretId'], core: true },
        ],
        cancel_secret_version_deletion: [
          { text: 'Cancel deletion of version', field: 'secretVersionNumber', core: true },
          { text: 'of secret', field: ['secretSelector', 'manualSecretId'], core: true },
        ],
        rotate_secret: [
          {
            text: 'Start rotation of secret',
            field: ['secretSelector', 'manualSecretId'],
            core: true,
          },
        ],
        cancel_secret_rotation: [
          {
            text: 'Cancel rotation of secret',
            field: ['secretSelector', 'manualSecretId'],
            core: true,
          },
        ],
        change_secret_compartment: [
          { text: 'Move secret', field: ['secretSelector', 'manualSecretId'], core: true },
          { text: 'to compartment', field: 'compartmentId', core: true },
        ],
        get_secret_bundle: [
          {
            text: 'Retrieve content of secret',
            field: ['secretSelector', 'manualSecretId'],
            core: true,
          },
        ],
        get_secret_bundle_by_name: [
          { text: 'Retrieve content of named secret', field: 'secretName', core: true },
          { text: 'from vault', field: ['vaultSelector', 'manualVaultId'], core: true },
        ],
        list_secret_bundle_versions: [
          {
            text: 'List retrievable bundle versions of secret',
            field: ['secretSelector', 'manualSecretId'],
            core: true,
          },
        ],
        list_vaults: [{ text: 'List vaults in compartment', field: 'compartmentId', core: true }],
        get_vault: [
          {
            text: 'Read vault metadata for',
            field: ['vaultSelector', 'manualVaultId'],
            core: true,
          },
        ],
        list_keys: [
          {
            text: 'List key metadata in vault',
            field: ['vaultSelector', 'manualVaultId'],
            core: true,
          },
        ],
        get_key: [
          { text: 'Read key metadata for', field: ['keySelector', 'manualKeyId'], core: true },
        ],
        list_work_requests: [
          {
            text: 'List work requests for secret',
            field: ['secretSelector', 'manualSecretId'],
            core: true,
          },
        ],
        get_work_request: [
          { text: 'Read status of work request', field: 'workRequestId', core: true },
        ],
        list_work_request_errors: [
          { text: 'List errors for work request', field: 'workRequestId', core: true },
        ],
        list_work_request_logs: [
          { text: 'List logs for work request', field: 'workRequestId', core: true },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Secrets', id: 'list_secrets' },
        { label: 'Get Secret', id: 'get_secret' },
        { label: 'Create Secret', id: 'create_secret' },
        { label: 'Update Secret', id: 'update_secret' },
        { label: 'List Secret Versions', id: 'list_secret_versions' },
        { label: 'Get Secret Version', id: 'get_secret_version' },
        { label: 'Schedule Secret Deletion', id: 'schedule_secret_deletion' },
        { label: 'Cancel Secret Deletion', id: 'cancel_secret_deletion' },
        { label: 'Schedule Secret Version Deletion', id: 'schedule_secret_version_deletion' },
        { label: 'Cancel Secret Version Deletion', id: 'cancel_secret_version_deletion' },
        { label: 'Rotate Secret', id: 'rotate_secret' },
        { label: 'Cancel Secret Rotation', id: 'cancel_secret_rotation' },
        { label: 'Change Secret Compartment', id: 'change_secret_compartment' },
        { label: 'Get Secret Bundle', id: 'get_secret_bundle' },
        { label: 'Get Secret Bundle by Name', id: 'get_secret_bundle_by_name' },
        { label: 'List Secret Bundle Versions', id: 'list_secret_bundle_versions' },
        { label: 'List Vaults', id: 'list_vaults' },
        { label: 'Get Vault', id: 'get_vault' },
        { label: 'List Keys', id: 'list_keys' },
        { label: 'Get Key', id: 'get_key' },
        { label: 'List Work Requests', id: 'list_work_requests' },
        { label: 'Get Work Request', id: 'get_work_request' },
        { label: 'List Work Request Errors', id: 'list_work_request_errors' },
        { label: 'List Work Request Logs', id: 'list_work_request_logs' },
      ],
      value: () => 'get_secret_bundle',
    },
    {
      id: 'credential',
      title: 'OCI Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      serviceId: 'oci_secrets',
      credentialKind: 'service-account',
      requiredScopes: getScopesForService('oci_secrets'),
      placeholder: 'Select OCI service account',
      required: true,
    },
    {
      id: 'region',
      title: 'Region',
      type: 'short-input',
      placeholder: 'Credential region by default (e.g., us-ashburn-1)',
    },
    {
      id: 'compartmentId',
      title: 'Compartment OCID',
      type: 'short-input',
      placeholder: 'Compartment OCID; destination compartment when moving a secret',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'list_secrets',
          'create_secret',
          'change_secret_compartment',
          'list_vaults',
          'list_keys',
          'list_work_requests',
        ],
      },
    },
    {
      id: 'vaultCompartmentId',
      title: 'Vault Discovery Compartment',
      type: 'short-input',
      placeholder: 'Compartment OCID used by the picker',
      mode: 'basic',
      condition: {
        field: 'operation',
        value: [
          'list_secrets',
          'create_secret',
          'get_secret_bundle_by_name',
          'get_vault',
          'list_keys',
          'get_key',
        ],
      },
    },
    {
      id: 'secretCompartmentId',
      title: 'Secret Discovery Compartment',
      type: 'short-input',
      placeholder: 'Compartment OCID used by the picker',
      mode: 'basic',
      condition: {
        field: 'operation',
        value: [
          'get_secret',
          'update_secret',
          'list_secret_versions',
          'get_secret_version',
          'schedule_secret_deletion',
          'cancel_secret_deletion',
          'schedule_secret_version_deletion',
          'cancel_secret_version_deletion',
          'rotate_secret',
          'cancel_secret_rotation',
          'change_secret_compartment',
          'get_secret_bundle',
          'list_secret_bundle_versions',
          'list_work_requests',
        ],
      },
    },
    {
      id: 'keyCompartmentId',
      title: 'Key Discovery Compartment',
      type: 'short-input',
      placeholder: 'Compartment OCID used by the picker',
      mode: 'basic',
      condition: { field: 'operation', value: ['create_secret', 'get_key'] },
    },
    {
      id: 'vaultSelector',
      title: 'Vault',
      type: 'project-selector',
      canonicalParamId: 'vaultId',
      selectorKey: 'oci_secrets.vaults',
      serviceId: 'oci_secrets',
      placeholder: 'Select vault',
      mode: 'basic',
      required: {
        field: 'operation',
        value: ['create_secret', 'get_secret_bundle_by_name', 'get_vault', 'list_keys', 'get_key'],
      },
      condition: {
        field: 'operation',
        value: [
          'list_secrets',
          'create_secret',
          'get_secret_bundle_by_name',
          'get_vault',
          'list_keys',
          'get_key',
        ],
      },
      dependsOn: {
        all: ['credential'],
        any: ['credential', 'region', 'compartmentId', 'vaultCompartmentId'],
      },
    },
    {
      id: 'manualVaultId',
      title: 'Vault OCID',
      type: 'short-input',
      canonicalParamId: 'vaultId',
      placeholder: 'Enter vault OCID or reference a previous block',
      mode: 'advanced',
      required: {
        field: 'operation',
        value: ['create_secret', 'get_secret_bundle_by_name', 'get_vault', 'list_keys', 'get_key'],
      },
      condition: {
        field: 'operation',
        value: [
          'list_secrets',
          'create_secret',
          'get_secret_bundle_by_name',
          'get_vault',
          'list_keys',
          'get_key',
        ],
      },
    },
    {
      id: 'secretSelector',
      title: 'Secret',
      type: 'project-selector',
      canonicalParamId: 'secretId',
      selectorKey: 'oci_secrets.secrets',
      serviceId: 'oci_secrets',
      placeholder: 'Select secret',
      mode: 'basic',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'get_secret',
          'update_secret',
          'list_secret_versions',
          'get_secret_version',
          'schedule_secret_deletion',
          'cancel_secret_deletion',
          'schedule_secret_version_deletion',
          'cancel_secret_version_deletion',
          'rotate_secret',
          'cancel_secret_rotation',
          'change_secret_compartment',
          'get_secret_bundle',
          'list_secret_bundle_versions',
          'list_work_requests',
        ],
      },
      dependsOn: {
        all: ['credential'],
        any: [
          'credential',
          'region',
          'compartmentId',
          'secretCompartmentId',
          'vaultSelector',
          'manualVaultId',
        ],
      },
    },
    {
      id: 'manualSecretId',
      title: 'Secret OCID',
      type: 'short-input',
      canonicalParamId: 'secretId',
      placeholder: 'Enter secret OCID or reference a previous block',
      mode: 'advanced',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'get_secret',
          'update_secret',
          'list_secret_versions',
          'get_secret_version',
          'schedule_secret_deletion',
          'cancel_secret_deletion',
          'schedule_secret_version_deletion',
          'cancel_secret_version_deletion',
          'rotate_secret',
          'cancel_secret_rotation',
          'change_secret_compartment',
          'get_secret_bundle',
          'list_secret_bundle_versions',
          'list_work_requests',
        ],
      },
    },
    {
      id: 'keySelector',
      title: 'Key',
      type: 'project-selector',
      canonicalParamId: 'keyId',
      selectorKey: 'oci_secrets.keys',
      serviceId: 'oci_secrets',
      placeholder: 'Select key',
      mode: 'basic',
      required: true,
      condition: { field: 'operation', value: ['create_secret', 'get_key'] },
      dependsOn: {
        all: ['credential'],
        any: [
          'credential',
          'region',
          'compartmentId',
          'keyCompartmentId',
          'vaultSelector',
          'manualVaultId',
          'protectionMode',
        ],
      },
    },
    {
      id: 'manualKeyId',
      title: 'Key OCID',
      type: 'short-input',
      canonicalParamId: 'keyId',
      placeholder: 'Enter key OCID or reference a previous block',
      mode: 'advanced',
      required: true,
      condition: { field: 'operation', value: ['create_secret', 'get_key'] },
    },
    {
      id: 'secretName',
      title: 'Secret Name',
      type: 'short-input',
      placeholder: 'Secret name, unique within its vault; up to 255 characters.',
      required: true,
      condition: { field: 'operation', value: ['create_secret', 'get_secret_bundle_by_name'] },
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Exact secret name filter.',
      required: false,
      condition: { field: 'operation', value: ['list_secrets'] },
      mode: 'advanced',
    },
    {
      id: 'lifecycleState',
      title: 'Lifecycle State',
      type: 'dropdown',
      options: [
        { label: 'CREATING', id: 'CREATING' },
        { label: 'ACTIVE', id: 'ACTIVE' },
        { label: 'UPDATING', id: 'UPDATING' },
        { label: 'DELETING', id: 'DELETING' },
        { label: 'DELETED', id: 'DELETED' },
        { label: 'SCHEDULING_DELETION', id: 'SCHEDULING_DELETION' },
        { label: 'PENDING_DELETION', id: 'PENDING_DELETION' },
        { label: 'CANCELLING_DELETION', id: 'CANCELLING_DELETION' },
        { label: 'FAILED', id: 'FAILED' },
      ],
      required: false,
      condition: { field: 'operation', value: ['list_secrets'] },
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder:
        'Maximum items in one page, from 1 to 1000. Returns a nextPage token when more results remain.',
      required: false,
      condition: {
        field: 'operation',
        value: [
          'list_secrets',
          'list_secret_versions',
          'list_secret_bundle_versions',
          'list_vaults',
          'list_keys',
          'list_work_requests',
          'list_work_request_errors',
          'list_work_request_logs',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: 'Opaque nextPage token from the previous response.',
      required: false,
      condition: {
        field: 'operation',
        value: [
          'list_secrets',
          'list_secret_versions',
          'list_secret_bundle_versions',
          'list_vaults',
          'list_keys',
          'list_work_requests',
          'list_work_request_errors',
          'list_work_request_logs',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'sortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      options: [
        { label: 'ASC', id: 'ASC' },
        { label: 'DESC', id: 'DESC' },
      ],
      required: false,
      condition: {
        field: 'operation',
        value: [
          'list_secrets',
          'list_secret_versions',
          'list_secret_bundle_versions',
          'list_vaults',
          'list_keys',
          'list_work_request_errors',
          'list_work_request_logs',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'secretVersionNumber',
      title: 'Secret Version Number',
      type: 'short-input',
      placeholder: 'Positive secret version number.',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'get_secret_version',
          'schedule_secret_version_deletion',
          'cancel_secret_version_deletion',
        ],
      },
    },
    {
      id: 'ifMatch',
      title: 'If Match',
      type: 'short-input',
      placeholder: 'ETag from a previous response for optimistic concurrency control.',
      required: false,
      condition: {
        field: 'operation',
        value: [
          'update_secret',
          'schedule_secret_deletion',
          'cancel_secret_deletion',
          'schedule_secret_version_deletion',
          'cancel_secret_version_deletion',
          'rotate_secret',
          'cancel_secret_rotation',
          'change_secret_compartment',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'timeOfDeletion',
      title: 'Time Of Deletion',
      type: 'short-input',
      placeholder:
        'RFC 3339 deletion time, 1 to 30 days in the future. Omit for the Oracle default of 30 days.',
      required: false,
      condition: {
        field: 'operation',
        value: ['schedule_secret_deletion', 'schedule_secret_version_deletion'],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt:
          'Generate an RFC 3339 deletion timestamp 1 to 30 days in the future. Return ONLY the timestamp.',
      },
    },
    {
      id: 'retryToken',
      title: 'Retry Token',
      type: 'short-input',
      placeholder:
        'Optional idempotency token, 1 to 64 characters. Oracle tokens expire after 24 hours and can be invalidated by conflicting operations.',
      required: false,
      condition: {
        field: 'operation',
        value: ['create_secret', 'rotate_secret', 'change_secret_compartment'],
      },
      mode: 'advanced',
    },
    {
      id: 'currentVersionNumber',
      title: 'Current Version Number',
      type: 'short-input',
      placeholder:
        'Promote this version to CURRENT. Do not combine with secretContent or secretRules.',
      required: false,
      condition: { field: 'operation', value: ['update_secret'] },
      mode: 'advanced',
    },
    {
      id: 'workRequestId',
      title: 'Work Request OCID',
      type: 'short-input',
      placeholder: 'Work request OCID returned by an asynchronous secret operation.',
      required: true,
      condition: {
        field: 'operation',
        value: ['get_work_request', 'list_work_request_errors', 'list_work_request_logs'],
      },
    },
    {
      id: 'protectionMode',
      title: 'Protection Mode',
      type: 'dropdown',
      options: [
        { label: 'HSM', id: 'HSM' },
        { label: 'SOFTWARE', id: 'SOFTWARE' },
        { label: 'EXTERNAL', id: 'EXTERNAL' },
      ],
      required: false,
      condition: { field: 'operation', value: ['list_keys', 'create_secret', 'get_key'] },
      value: () => 'HSM',
    },
    {
      id: 'algorithm',
      title: 'Algorithm',
      type: 'dropdown',
      options: [
        { label: 'AES', id: 'AES' },
        { label: 'RSA', id: 'RSA' },
        { label: 'ECDSA', id: 'ECDSA' },
      ],
      required: false,
      condition: { field: 'operation', value: ['list_keys'] },
      mode: 'advanced',
    },
    {
      id: 'length',
      title: 'Length',
      type: 'short-input',
      placeholder: 'Key length filter in bytes, as supported by the selected algorithm.',
      required: false,
      condition: { field: 'operation', value: ['list_keys'] },
      mode: 'advanced',
    },
    {
      id: 'curveId',
      title: 'Elliptic Curve',
      type: 'dropdown',
      options: [
        { label: 'NIST_P256', id: 'NIST_P256' },
        { label: 'NIST_P384', id: 'NIST_P384' },
        { label: 'NIST_P521', id: 'NIST_P521' },
      ],
      required: false,
      condition: { field: 'operation', value: ['list_keys'] },
      mode: 'advanced',
    },
    {
      id: 'sortBy',
      title: 'Sort By',
      type: 'dropdown',
      mode: 'advanced',
      condition: { field: 'operation', value: ['list_secrets', 'list_vaults', 'list_keys'] },
      options: (params) =>
        params?.values.operation === 'list_secrets'
          ? [
              { label: 'Name', id: 'NAME' },
              { label: 'Created Time', id: 'TIMECREATED' },
            ]
          : [
              { label: 'Display Name', id: 'DISPLAYNAME' },
              { label: 'Created Time', id: 'TIMECREATED' },
            ],
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Secret description. Avoid confidential information in metadata fields.',
      condition: { field: 'operation', value: ['create_secret', 'update_secret'] },
      mode: 'advanced',
    },
    {
      id: 'secretContent',
      title: 'Secret Content',
      type: 'code',
      language: 'json',
      placeholder:
        'Content object with contentType:"BASE64", optional base64 content, name and stage (CURRENT or PENDING). Maximum 25600 base64 characters. Creation requires content or automatic generation and allows only CURRENT. An update may omit content to generate a version using the stored generation configuration.',
      condition: { field: 'operation', value: ['create_secret', 'update_secret'] },
      required: {
        field: 'operation',
        value: ['create_secret'],
        and: { field: 'enableAutoGeneration', value: true, not: true },
      },
    },
    {
      id: 'secretRules',
      title: 'Secret Rules',
      type: 'code',
      language: 'json',
      placeholder:
        'At most one SECRET_EXPIRY_RULE and one SECRET_REUSE_RULE. Expiry fields: secretVersionExpiryInterval (P1D to P90D), timeOfAbsoluteExpiry (RFC 3339, 1 to 365 days), isSecretContentRetrievalBlockedOnExpiry. Reuse field: isEnforcedOnDeletedSecretVersions.',
      condition: { field: 'operation', value: ['create_secret', 'update_secret'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'At most one SECRET_EXPIRY_RULE and one SECRET_REUSE_RULE. Expiry fields: secretVersionExpiryInterval (P1D to P90D), timeOfAbsoluteExpiry (RFC 3339, 1 to 365 days), isSecretContentRetrievalBlockedOnExpiry. Reuse field: isEnforcedOnDeletedSecretVersions. Return ONLY the JSON value.',
      },
    },
    {
      id: 'freeformTags',
      title: 'Freeform Tags',
      type: 'code',
      language: 'json',
      placeholder: 'Free-form string key/value tags. Send {} to clear them.',
      condition: { field: 'operation', value: ['create_secret', 'update_secret'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Free-form string key/value tags. Send {} to clear them. Return ONLY the JSON value.',
      },
    },
    {
      id: 'definedTags',
      title: 'Defined Tags',
      type: 'code',
      language: 'json',
      placeholder:
        'Defined tags by namespace, for example {"Operations":{"CostCenter":"42"}}. Send {} to clear them.',
      condition: { field: 'operation', value: ['create_secret', 'update_secret'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Defined tags by namespace, for example {"Operations":{"CostCenter":"42"}}. Send {} to clear them. Return ONLY the JSON value.',
      },
    },
    {
      id: 'metadata',
      title: 'Metadata',
      type: 'code',
      language: 'json',
      placeholder: 'Additional metadata as JSON key/value pairs.',
      condition: { field: 'operation', value: ['create_secret', 'update_secret'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt: 'Additional metadata as JSON key/value pairs. Return ONLY the JSON value.',
      },
    },
    {
      id: 'enableAutoGeneration',
      title: 'Enable Auto Generation',
      type: 'switch',
      placeholder:
        'Generate new content with secretGenerationContext instead of supplying secretContent.',
      condition: { field: 'operation', value: ['create_secret', 'update_secret'] },
    },
    {
      id: 'secretGenerationContext',
      title: 'Secret Generation Context',
      type: 'code',
      language: 'json',
      placeholder:
        'Generation object with generationType, generationTemplate and optional secretTemplate. PASSPHRASE templates: SECRETS_DEFAULT_PASSWORD or DBAAS_DEFAULT_PASSWORD, optional passphraseLength. SSH_KEY: RSA_2048, RSA_3072 or RSA_4096. BYTES: BYTES_512 or BYTES_1024.',
      condition: { field: 'operation', value: ['create_secret', 'update_secret'] },
      required: {
        field: 'operation',
        value: ['create_secret'],
        and: { field: 'enableAutoGeneration', value: true },
      },
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Generation object with generationType, generationTemplate and optional secretTemplate. PASSPHRASE templates: SECRETS_DEFAULT_PASSWORD or DBAAS_DEFAULT_PASSWORD, optional passphraseLength. SSH_KEY: RSA_2048, RSA_3072 or RSA_4096. BYTES: BYTES_512 or BYTES_1024. Return ONLY the JSON value.',
      },
    },
    {
      id: 'rotationConfig',
      title: 'Rotation Config',
      type: 'code',
      language: 'json',
      placeholder:
        'Rotation configuration: {targetSystemDetails:{targetSystemType:"ADB",adbId:"<ocid>"} or {targetSystemType:"FUNCTION",functionId:"<ocid>"},isScheduledRotationEnabled?,rotationInterval?:"P30D"}. Scheduled intervals: P1D to P360D. The target and its IAM permissions must already exist.',
      condition: { field: 'operation', value: ['create_secret', 'update_secret'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Rotation configuration: {targetSystemDetails:{targetSystemType:"ADB",adbId:"<ocid>"} or {targetSystemType:"FUNCTION",functionId:"<ocid>"},isScheduledRotationEnabled?,rotationInterval?:"P30D"}. Scheduled intervals: P1D to P360D. The target and its IAM permissions must already exist. Return ONLY the JSON value.',
      },
    },
    {
      id: 'replicationConfig',
      title: 'Replication Config',
      type: 'code',
      language: 'json',
      placeholder:
        'Cross-region replication: {replicationTargets:[{targetKeyId,targetRegion,targetVaultId}],isWriteForwardEnabled?}. Configure the source secret; Oracle enforces target limits and replica write restrictions.',
      condition: { field: 'operation', value: ['create_secret', 'update_secret'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Cross-region replication: {replicationTargets:[{targetKeyId,targetRegion,targetVaultId}],isWriteForwardEnabled?}. Configure the source secret; Oracle enforces target limits and replica write restrictions. Return ONLY the JSON value.',
      },
    },
    {
      id: 'versionNumber',
      title: 'Version Number',
      type: 'short-input',
      placeholder:
        'Retrieve this positive version number. Set at most one of versionNumber, secretVersionName and stage. Omit all three for CURRENT.',
      mode: 'advanced',
      condition: { field: 'operation', value: ['get_secret_bundle', 'get_secret_bundle_by_name'] },
    },
    {
      id: 'secretVersionName',
      title: 'Secret Version Name',
      type: 'short-input',
      placeholder:
        'Retrieve the uniquely named version. Mutually exclusive with versionNumber and stage.',
      mode: 'advanced',
      condition: { field: 'operation', value: ['get_secret_bundle', 'get_secret_bundle_by_name'] },
    },
    {
      id: 'stage',
      title: 'Stage',
      type: 'dropdown',
      options: [
        { label: 'CURRENT', id: 'CURRENT' },
        { label: 'PENDING', id: 'PENDING' },
        { label: 'LATEST', id: 'LATEST' },
        { label: 'PREVIOUS', id: 'PREVIOUS' },
        { label: 'DEPRECATED', id: 'DEPRECATED' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: ['get_secret_bundle', 'get_secret_bundle_by_name'] },
    },
    {
      id: 'decodeContent',
      title: 'Decode Content',
      type: 'switch',
      placeholder:
        'Also return secretValue as UTF-8 text. Defaults to false; invalid UTF-8 is rejected. The original base64 content is preserved.',
      mode: 'advanced',
      condition: { field: 'operation', value: ['get_secret_bundle', 'get_secret_bundle_by_name'] },
    },
  ],
  tools: {
    access: [
      'oci_secrets_list_secrets',
      'oci_secrets_get_secret',
      'oci_secrets_create_secret',
      'oci_secrets_update_secret',
      'oci_secrets_list_secret_versions',
      'oci_secrets_get_secret_version',
      'oci_secrets_schedule_secret_deletion',
      'oci_secrets_cancel_secret_deletion',
      'oci_secrets_schedule_secret_version_deletion',
      'oci_secrets_cancel_secret_version_deletion',
      'oci_secrets_rotate_secret',
      'oci_secrets_cancel_secret_rotation',
      'oci_secrets_change_secret_compartment',
      'oci_secrets_get_secret_bundle',
      'oci_secrets_get_secret_bundle_by_name',
      'oci_secrets_list_secret_bundle_versions',
      'oci_secrets_list_vaults',
      'oci_secrets_get_vault',
      'oci_secrets_list_keys',
      'oci_secrets_get_key',
      'oci_secrets_list_work_requests',
      'oci_secrets_get_work_request',
      'oci_secrets_list_work_request_errors',
      'oci_secrets_list_work_request_logs',
    ],
    config: {
      tool: (params) => `oci_secrets_${params.operation}`,
      params: (params) => ({
        compartmentId: params.compartmentId,
        secretId: params.secretId,
        secretName: params.secretName,
        vaultId: params.vaultId,
        keyId: params.keyId,
        name: params.name || undefined,
        lifecycleState: params.lifecycleState || undefined,
        limit: parseOptionalNumberInput(params.limit, 'Limit'),
        page: params.page || undefined,
        sortOrder: params.sortOrder || undefined,
        secretVersionNumber: parseOptionalNumberInput(
          params.secretVersionNumber,
          'Secret Version Number'
        ),
        ifMatch: params.ifMatch || undefined,
        timeOfDeletion: params.timeOfDeletion || undefined,
        retryToken: params.retryToken || undefined,
        currentVersionNumber: parseOptionalNumberInput(
          params.currentVersionNumber,
          'Current Version Number'
        ),
        workRequestId: params.workRequestId,
        protectionMode: params.protectionMode || undefined,
        algorithm: params.algorithm || undefined,
        length: parseOptionalNumberInput(params.length, 'Length'),
        curveId: params.curveId || undefined,
        description: params.description || undefined,
        secretContent: parseOptionalJsonInput(params.secretContent, 'Secret Content'),
        secretRules: parseOptionalJsonInput(params.secretRules, 'Secret Rules'),
        freeformTags: parseOptionalJsonInput(params.freeformTags, 'Freeform Tags'),
        definedTags: parseOptionalJsonInput(params.definedTags, 'Defined Tags'),
        metadata: parseOptionalJsonInput(params.metadata, 'Metadata'),
        enableAutoGeneration: parseOptionalBooleanInput(params.enableAutoGeneration),
        secretGenerationContext: parseOptionalJsonInput(
          params.secretGenerationContext,
          'Secret Generation Context'
        ),
        rotationConfig: parseOptionalJsonInput(params.rotationConfig, 'Rotation Config'),
        replicationConfig: parseOptionalJsonInput(params.replicationConfig, 'Replication Config'),
        versionNumber: parseOptionalNumberInput(params.versionNumber, 'Version Number'),
        secretVersionName: params.secretVersionName || undefined,
        stage: params.stage || undefined,
        decodeContent: parseOptionalBooleanInput(params.decodeContent),
        region: params.region || undefined,
        sortBy: params.sortBy || undefined,
      }),
    },
  },
  inputs: {
    oauthCredential: {
      type: 'string',
      description: 'Stored OCI service-account credential',
    },
    compartmentId: {
      type: 'string',
      description: 'Compartment OCID. For Move Secret, this is the destination compartment.',
    },
    secretId: {
      type: 'string',
      description: 'Secret OCID.',
    },
    secretName: {
      type: 'string',
      description: 'Secret name, unique within its vault; up to 255 characters.',
    },
    vaultId: {
      type: 'string',
      description: 'Vault OCID. Key discovery additionally requires read access to this vault.',
    },
    keyId: {
      type: 'string',
      description: 'Encryption key OCID. Creating a secret requires a compatible enabled AES key.',
    },
    name: {
      type: 'string',
      description: 'Exact secret name filter.',
    },
    lifecycleState: {
      type: 'string',
      description:
        'Secret lifecycle state: CREATING, ACTIVE, UPDATING, DELETING, DELETED, SCHEDULING_DELETION, PENDING_DELETION, CANCELLING_DELETION or FAILED.',
    },
    limit: {
      type: 'number',
      description:
        'Maximum items in one page, from 1 to 1000. Returns a nextPage token when more results remain.',
    },
    page: {
      type: 'string',
      description: 'Opaque nextPage token from the previous response.',
    },
    sortOrder: {
      type: 'string',
      description: 'Sort direction: ASC or DESC.',
    },
    secretVersionNumber: {
      type: 'number',
      description: 'Positive secret version number.',
    },
    ifMatch: {
      type: 'string',
      description: 'ETag from a previous response for optimistic concurrency control.',
    },
    timeOfDeletion: {
      type: 'string',
      description:
        'RFC 3339 deletion time, 1 to 30 days in the future. Omit for the Oracle default of 30 days.',
    },
    retryToken: {
      type: 'string',
      description:
        'Optional idempotency token, 1 to 64 characters. Oracle tokens expire after 24 hours and can be invalidated by conflicting operations.',
    },
    currentVersionNumber: {
      type: 'number',
      description:
        'Promote this version to CURRENT. Do not combine with secretContent or secretRules.',
    },
    workRequestId: {
      type: 'string',
      description: 'Work request OCID returned by an asynchronous secret operation.',
    },
    protectionMode: {
      type: 'string',
      description:
        'Key protection mode: HSM, SOFTWARE or EXTERNAL. Oracle defaults to HSM; omission does not list every mode.',
    },
    algorithm: {
      type: 'string',
      description: 'Key algorithm filter: AES, RSA or ECDSA.',
    },
    length: {
      type: 'number',
      description: 'Key length filter in bytes, as supported by the selected algorithm.',
    },
    curveId: {
      type: 'string',
      description: 'Elliptic curve filter: NIST_P256, NIST_P384 or NIST_P521.',
    },
    description: {
      type: 'string',
      description: 'Secret description. Avoid confidential information in metadata fields.',
    },
    secretContent: {
      type: 'json',
      description:
        'Content object with contentType:"BASE64", optional base64 content, name and stage (CURRENT or PENDING). Maximum 25600 base64 characters. Creation requires content or automatic generation and allows only CURRENT. An update may omit content to generate a version using the stored generation configuration.',
    },
    secretRules: {
      type: 'json',
      description:
        'At most one SECRET_EXPIRY_RULE and one SECRET_REUSE_RULE. Expiry fields: secretVersionExpiryInterval (P1D to P90D), timeOfAbsoluteExpiry (RFC 3339, 1 to 365 days), isSecretContentRetrievalBlockedOnExpiry. Reuse field: isEnforcedOnDeletedSecretVersions.',
    },
    freeformTags: {
      type: 'json',
      description: 'Free-form string key/value tags. Send {} to clear them.',
    },
    definedTags: {
      type: 'json',
      description:
        'Defined tags by namespace, for example {"Operations":{"CostCenter":"42"}}. Send {} to clear them.',
    },
    metadata: {
      type: 'json',
      description: 'Additional metadata as JSON key/value pairs.',
    },
    enableAutoGeneration: {
      type: 'boolean',
      description:
        'Generate new content with secretGenerationContext instead of supplying secretContent.',
    },
    secretGenerationContext: {
      type: 'json',
      description:
        'Generation object with generationType, generationTemplate and optional secretTemplate. PASSPHRASE templates: SECRETS_DEFAULT_PASSWORD or DBAAS_DEFAULT_PASSWORD, optional passphraseLength. SSH_KEY: RSA_2048, RSA_3072 or RSA_4096. BYTES: BYTES_512 or BYTES_1024.',
    },
    rotationConfig: {
      type: 'json',
      description:
        'Rotation configuration: {targetSystemDetails:{targetSystemType:"ADB",adbId:"<ocid>"} or {targetSystemType:"FUNCTION",functionId:"<ocid>"},isScheduledRotationEnabled?,rotationInterval?:"P30D"}. Scheduled intervals: P1D to P360D. The target and its IAM permissions must already exist.',
    },
    replicationConfig: {
      type: 'json',
      description:
        'Cross-region replication: {replicationTargets:[{targetKeyId,targetRegion,targetVaultId}],isWriteForwardEnabled?}. Configure the source secret; Oracle enforces target limits and replica write restrictions.',
    },
    versionNumber: {
      type: 'number',
      description:
        'Retrieve this positive version number. Set at most one of versionNumber, secretVersionName and stage. Omit all three for CURRENT.',
    },
    secretVersionName: {
      type: 'string',
      description:
        'Retrieve the uniquely named version. Mutually exclusive with versionNumber and stage.',
    },
    stage: {
      type: 'string',
      description:
        'Version stage: CURRENT, PENDING, LATEST, PREVIOUS or DEPRECATED. Mutually exclusive with versionNumber and secretVersionName.',
    },
    decodeContent: {
      type: 'boolean',
      description:
        'Also return secretValue as UTF-8 text. Defaults to false; invalid UTF-8 is rejected. The original base64 content is preserved.',
    },
    region: {
      type: 'string',
      description: 'Region',
    },
    sortBy: {
      type: 'string',
      description: 'Sort field',
    },
  },
  outputs: {
    status: {
      type: 'number',
      description: 'Oracle HTTP status; 202 means accepted, not completed',
    },
    opcRequestId: {
      type: 'string',
      description: 'Oracle request ID',
    },
    etag: {
      type: 'string',
      description: 'ETag for optimistic concurrency control when returned',
      condition: {
        field: 'operation',
        value: [
          'get_secret',
          'create_secret',
          'update_secret',
          'get_secret_version',
          'schedule_secret_deletion',
          'cancel_secret_deletion',
          'schedule_secret_version_deletion',
          'cancel_secret_version_deletion',
          'change_secret_compartment',
          'get_secret_bundle',
          'get_vault',
          'get_key',
        ],
      },
    },
    nextPage: {
      type: 'string',
      description: 'Continuation token for list operations',
      condition: {
        field: 'operation',
        value: [
          'list_secrets',
          'list_secret_versions',
          'list_secret_bundle_versions',
          'list_vaults',
          'list_keys',
          'list_work_requests',
          'list_work_request_errors',
          'list_work_request_logs',
        ],
      },
    },
    workRequestId: {
      type: 'string',
      description: 'Work request OCID returned when rotation is accepted',
      condition: { field: 'operation', value: 'rotate_secret' },
    },
    secretValue: {
      type: 'string',
      description: 'UTF-8 secret text, only when explicitly requested with decodeContent',
      condition: { field: 'operation', value: ['get_secret_bundle', 'get_secret_bundle_by_name'] },
    },
    secret: {
      type: 'json',
      description:
        'Secret metadata (id, secretName, lifecycleState, currentVersionNumber, rules, rotation and replication configuration)',
      condition: { field: 'operation', value: ['get_secret', 'create_secret', 'update_secret'] },
    },
    secrets: {
      type: 'json',
      description:
        'Secret summaries (id, secretName, compartmentId, vaultId, lifecycleState, expiration and rotation metadata)',
      condition: { field: 'operation', value: 'list_secrets' },
    },
    secretVersion: {
      type: 'json',
      description:
        'Managed secret version metadata (secretId, versionNumber, name, stages, timeOfCurrentVersionExpiry)',
      condition: { field: 'operation', value: 'get_secret_version' },
    },
    secretVersions: {
      type: 'json',
      description:
        'Managed version summaries (secretId, versionNumber, name, stages, timeOfExpiry)',
      condition: { field: 'operation', value: 'list_secret_versions' },
    },
    secretBundle: {
      type: 'json',
      description:
        'Retrieved secret bundle (secretId, versionNumber, versionName, stages, metadata, secretBundleContent with base64 content)',
      condition: { field: 'operation', value: ['get_secret_bundle', 'get_secret_bundle_by_name'] },
    },
    secretBundleVersions: {
      type: 'json',
      description:
        'Bundle version summaries (secretId, versionNumber, versionName, stages and timestamps)',
      condition: { field: 'operation', value: 'list_secret_bundle_versions' },
    },
    vault: {
      type: 'json',
      description:
        'Vault metadata (id, displayName, lifecycleState, managementEndpoint, cryptoEndpoint)',
      condition: { field: 'operation', value: 'get_vault' },
    },
    vaults: {
      type: 'json',
      description: 'Vault summaries (id, displayName, compartmentId, lifecycleState and endpoints)',
      condition: { field: 'operation', value: 'list_vaults' },
    },
    key: {
      type: 'json',
      description:
        'Key metadata (id, displayName, lifecycleState, protectionMode, keyShape, currentKeyVersion)',
      condition: { field: 'operation', value: 'get_key' },
    },
    keys: {
      type: 'json',
      description: 'Key summaries (id, displayName, lifecycleState, protectionMode and algorithm)',
      condition: { field: 'operation', value: 'list_keys' },
    },
    workRequest: {
      type: 'json',
      description: 'Work request (id, status, percentComplete, resources and timestamps)',
      condition: { field: 'operation', value: 'get_work_request' },
    },
    workRequests: {
      type: 'json',
      description:
        'Work request summaries (id, operationType, status, percentComplete and timestamps)',
      condition: { field: 'operation', value: 'list_work_requests' },
    },
    errors: {
      type: 'json',
      description: 'Work request errors (code, message, timestamp)',
      condition: { field: 'operation', value: 'list_work_request_errors' },
    },
    logs: {
      type: 'json',
      description: 'Work request activity entries (message, timestamp)',
      condition: { field: 'operation', value: 'list_work_request_logs' },
    },
  },
}

export const OciSecretsBlockMeta = {
  tags: ['cloud', 'secrets-management'],
  url: 'https://docs.oracle.com/en-us/iaas/Content/secret-management/home.htm',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Retrieve Application Credentials',
      prompt:
        'On a workflow request, retrieve the CURRENT bundle for a configured secret and pass it to the authorized application step. Keep secret contents out of summaries.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['security', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Review Secret Expiration',
      prompt:
        'On a daily schedule, list secret metadata in a compartment and summarize upcoming expiration times and rotation status.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['security', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Stage Secret Versions',
      prompt:
        'On a release request, update a secret with PENDING content. After target-system validation, promote the selected version in a separate update and report its version number.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['security', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Monitor Secret Rotation',
      prompt:
        'On an approved rotation request, start rotation and use its work request ID to read status, errors and logs. Report progress without claiming completion at acceptance.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['security', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Configure Secret Replication',
      prompt:
        'On a disaster-recovery configuration request, update the source secret replication targets using pre-existing target vaults and keys, then read back the configuration.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['security', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Retire Deprecated Versions',
      prompt:
        'On a maintenance request, list secret versions and schedule deletion of selected DEPRECATED versions. Report the selected versions and requested deletion time.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['security', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Discover Vault Encryption Keys',
      prompt:
        'On a secret provisioning request, list vaults and compatible enabled AES keys, create the secret with the chosen resource IDs and return its metadata.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['security', 'automation'],
    },
  ],
  skills: [
    {
      name: 'retrieve-application-secret',
      description:
        'Retrieve an explicitly selected secret version for an authorized application workflow.',
      content:
        '# Retrieve Application Secret\n\n## Steps\n1. Identify the secret OCID or its exact name and vault OCID.\n2. Choose at most one version number, version name or stage. Omission selects CURRENT.\n3. Retrieve the bundle. Preserve base64 content; request UTF-8 decoding only for textual secrets.\n\n## Guidance\nPass the content only to the intended authorized consumer. Summarize identifiers and version metadata rather than secret content.\n\n[Oracle documentation](https://docs.oracle.com/en-us/iaas/Content/secret-management/overview.htm)',
    },
    {
      name: 'review-secret-lifecycle',
      description: 'Review secret inventory, expiration and scheduled deletion metadata.',
      content:
        '# Review Secret Lifecycle\n\n## Steps\n1. List one page of secret metadata in the requested compartment.\n2. Continue with nextPage only as needed for the requested inventory.\n3. Review expiration, deletion and rotation fields without retrieving bundles.\n\n## Guidance\nReport resource IDs, lifecycle states and upcoming maintenance.\n\n[Oracle documentation](https://docs.oracle.com/en-us/iaas/Content/secret-management/Concepts/manage-secrets.htm)',
    },
    {
      name: 'stage-and-promote-secret',
      description: 'Stage a new secret version and promote it after the target system is ready.',
      content:
        '# Stage and Promote a Secret\n\n## Steps\n1. Update the secret with BASE64 content at PENDING.\n2. List versions and identify the staged version.\n3. After the target-system change is verified, update currentVersionNumber in a separate request.\n\n## Guidance\nReport the promoted version. Changing OCI content alone does not update an external application.\n\n[Oracle documentation](https://docs.oracle.com/en-us/iaas/Content/secret-management/Concepts/secret-versions.htm)',
    },
    {
      name: 'monitor-secret-rotation',
      description: 'Start configured rotation and inspect its asynchronous progress.',
      content:
        '# Monitor Secret Rotation\n\n## Steps\n1. Read secret metadata and confirm an existing configured rotation target.\n2. Start rotation and capture workRequestId.\n3. Read work request status, errors and logs when requested.\n\n## Guidance\nDistinguish accepted, in-progress and completed operations. Work requests are retained for 12 hours.\n\n[Oracle documentation](https://docs.oracle.com/en-us/iaas/Content/secret-management/Concepts/work-requests.htm)',
    },
    {
      name: 'configure-secret-replication',
      description: 'Configure a source secret for cross-region disaster recovery.',
      content:
        '# Configure Secret Replication\n\n## Steps\n1. Read the source secret and identify existing destination vaults and keys.\n2. Update replicationConfig with the requested target region, vault and key OCIDs.\n3. Read the source configuration again.\n\n## Guidance\nReport configured targets and replica restrictions; do not equate accepted configuration with completed replication.\n\n[Oracle documentation](https://docs.oracle.com/en-us/iaas/Content/secret-management/Concepts/secret-replication.htm)',
    },
    {
      name: 'retire-secret-versions',
      description: 'Schedule deletion of obsolete versions with a recovery window.',
      content:
        '# Retire Secret Versions\n\n## Steps\n1. List managed secret versions and their stages.\n2. Select only eligible DEPRECATED versions.\n3. Schedule their deletion and retain identifiers so scheduled deletion can be canceled before permanent removal.\n\n## Guidance\nReport requested deletions and recovery deadlines. Cancellation does not promote a version.\n\n[Oracle documentation](https://docs.oracle.com/en-us/iaas/Content/secret-management/Concepts/secret-versions.htm)',
    },
  ],
} as const satisfies BlockMeta
