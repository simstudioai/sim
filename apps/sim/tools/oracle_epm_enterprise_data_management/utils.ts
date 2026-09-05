import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { OutputProperty, ToolConfig, ToolOutputProperty } from '@/tools/types'

export const edmAuthParams = {
  oauthCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Reusable Oracle EPM service-account credential',
  },
  accessToken: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Basic authentication token injected from the selected EPM credential',
  },
  instanceUrl: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Environment URL injected from the selected EPM credential',
  },
} satisfies ToolConfig['params']

export function edmOperationInput<P extends object>(operation: string, params: P) {
  return { ...createInternalToolOperationInput(params), operation }
}

export function edmParam(
  type: string,
  required: boolean,
  description: string
): ToolConfig['params'][string] {
  return { type, required, visibility: 'user-or-llm', description }
}

const optionalString = (description: string): OutputProperty => ({
  type: 'string',
  description,
  optional: true,
  nullable: true,
})
const optionalNumber = (description: string): OutputProperty => ({
  type: 'number',
  description,
  optional: true,
  nullable: true,
})
const optionalBoolean = (description: string): OutputProperty => ({
  type: 'boolean',
  description,
  optional: true,
  nullable: true,
})
const timestamp: OutputProperty = {
  type: 'json',
  description:
    'Oracle timestamp: epoch number or ISO timestamp string, depending on service response',
  optional: true,
  nullable: true,
}
const stringArray = (description: string): OutputProperty => ({
  type: 'array',
  description,
  items: { type: 'string' },
})
const objectArray = (
  description: string,
  properties: Record<string, OutputProperty>
): OutputProperty => ({ type: 'array', description, items: { type: 'object', properties } })
const referenceFields = {
  id: { type: 'string', description: 'Resource UUID' },
  name: optionalString('Resource name'),
  description: optionalString('Resource description'),
  links: objectArray('Documented resource links; not arbitrary tool inputs', {
    rel: { type: 'string', description: 'Link relation' },
    href: { type: 'string', description: 'Link target' },
    method: { type: 'string', description: 'Advertised HTTP method', optional: true },
  }),
} satisfies Record<string, OutputProperty>
const reference: OutputProperty = {
  type: 'json',
  description: 'Resource reference (id, name, description, links)',
  properties: referenceFields,
  optional: true,
  nullable: true,
}
const entityFields = {
  ...referenceFields,
  name: { type: 'string', description: 'Resource name' },
  objectStatus: optionalString('Resource object status'),
  timeCreated: timestamp,
  timeModified: timestamp,
  permittedActions: stringArray('Actions permitted for the credential'),
} satisfies Record<string, OutputProperty>
const bindingFields = {
  ...referenceFields,
  bindingType: optionalString('Dimension binding type'),
  viewpoint: reference,
  view: reference,
}
const dimensionFields = {
  ...entityFields,
  dimensionType: optionalString('Dimension type'),
  connected: optionalBoolean('Whether the dimension is connected'),
  externalName: optionalString('External dimension name'),
  isBound: optionalBoolean('Whether the dimension is bound'),
  supportsMapping: optionalBoolean('Whether mappings are supported'),
  supportsMappingExport: optionalBoolean('Whether mapping export is supported'),
  supportsExtracts: optionalBoolean('Whether extracts are supported'),
  supportedDirection: optionalString('Supported import/export direction'),
  bindings: objectArray('Dimension bindings and their view/viewpoint references', bindingFields),
}
const applicationFields = {
  ...entityFields,
  primaryView: reference,
  supportedDirection: optionalString('Supported import/export direction'),
  dimensions: objectArray('Documented application dimensions', dimensionFields),
}
const viewFields = { ...entityFields, master: optionalBoolean('Whether this is a master view') }
const nodeTypeFields = {
  ...referenceFields,
  viewpointId: { type: 'string', description: 'Viewpoint containing this assignment' },
  relatedViewpoints: objectArray('Related viewpoint references', referenceFields),
} satisfies Record<string, OutputProperty>
const viewpointFields = {
  ...entityFields,
  label: optionalString('Viewpoint label'),
  hasHierarchy: optionalBoolean('Whether the viewpoint has a hierarchy'),
  scope: optionalString('Viewpoint scope'),
  bindingType: optionalString('Viewpoint binding type'),
  viewId: optionalString('Containing view UUID'),
  viewName: optionalString('Containing view name'),
  applicationLink: reference,
  dimensionLink: reference,
  nodeSetLink: reference,
  hierarchySetLink: reference,
  nodeTypeAssignments: objectArray('Node-type assignments, not administration objects', {
    nodeTypeLink: reference,
    relatedViewpoints: objectArray('Related viewpoints', referenceFields),
  }),
}
const validationFields = {
  message: optionalString('Validation message'),
  code: optionalString('Validation code'),
  type: optionalString('Validation type'),
  severity: optionalString('Validation severity'),
  userCanResolve: optionalBoolean('Whether the current user can resolve this issue'),
  timeCreated: timestamp,
}
export const edmNodeFields = {
  id: { type: 'string', description: 'Node UUID' },
  name: { type: 'string', description: 'Node name' },
  description: optionalString('Node description'),
  nodeType: reference,
  hasChildren: optionalBoolean('Whether the node has children'),
  location: optionalString('Provider-returned node location'),
  path: objectArray('Provider-returned path references', referenceFields),
  relationshipId: optionalString('Relationship UUID'),
  parentNodeId: optionalString('Parent node UUID'),
  parentName: optionalString('Parent node name'),
  parentNodeTypeId: optionalString('Parent node-type UUID'),
  childCount: optionalNumber('Number of children'),
  locationCount: optionalNumber('Number of node locations'),
  previousLocation: optionalString('Previous location'),
  nextLocation: optionalString('Next location'),
  propertyCount: optionalNumber('Number of properties'),
  propertyValues: objectArray('Documented node and relationship property values', {
    value: optionalString('Property value'),
    displayValue: optionalString('Display value'),
    propertyName: optionalString('Property name'),
    propertyId: optionalString('Property UUID'),
    origin: optionalString('Value origin'),
    propertyLevel: optionalString('Node or relationship level'),
    labels: stringArray('Property labels'),
    readOnly: optionalBoolean('Whether the property is read-only'),
    validated: optionalBoolean('Whether the property was validated'),
  }),
  requestItem: {
    type: 'json',
    description: 'Request item and its validation findings',
    optional: true,
    nullable: true,
    properties: {
      id: { type: 'string', description: 'Request item UUID' },
      name: optionalString('Item name'),
      description: optionalString('Item description'),
      actionCount: optionalNumber('Number of actions'),
      nodeTypeName: optionalString('Node-type name'),
      nodeTypeId: optionalString('Node-type UUID'),
      applicationName: optionalString('Application name'),
      actionSummary: optionalString('Action summary'),
      validations: objectArray('Validation findings', validationFields),
    },
  },
  links: referenceFields.links,
} satisfies Record<string, OutputProperty>
const user: OutputProperty = {
  type: 'json',
  description: 'User identity, excluding authentication and preference fields',
  optional: true,
  nullable: true,
  properties: {
    id: optionalString('User UUID'),
    userName: optionalString('User name'),
    fullName: optionalString('Full name'),
  },
}
const requestFields = {
  id: { type: 'string', description: 'Request UUID' },
  title: optionalString('Request title'),
  description: optionalString('Request description'),
  priority: optionalString('Request priority'),
  origin: optionalString('Request origin'),
  requestType: optionalString('Request type, including subscription-generated requests'),
  status: optionalString('Request status'),
  stage: optionalString('Workflow stage'),
  requestNumber: optionalNumber('Request number'),
  timeCreated: timestamp,
  timeModified: timestamp,
  timeSubmitted: timestamp,
  blockedUntil: timestamp,
  notes: optionalString('Request notes'),
  itemCount: optionalNumber('Number of items'),
  commentCount: optionalNumber('Number of comments'),
  validationErrorCount: optionalNumber('Validation error count'),
  attachmentCount: optionalNumber('Number of attachments'),
  actionCount: optionalNumber('Number of actions'),
  commentRequiredOnTransition: optionalBoolean('Whether the next transition requires a comment'),
  validTransitionActions: stringArray('Currently valid workflow transitions'),
  viewId: optionalString('View UUID'),
  viewName: optionalString('View name'),
  createdByUser: user,
  modifiedByUser: user,
  submittedByUser: user,
  assignedToUser: user,
  owner: user,
  sourceRequest: reference,
  subscriptions: objectArray('Associated subscription references', referenceFields),
  autoSubmitted: optionalBoolean('Whether the request was automatically submitted'),
  links: referenceFields.links,
} satisfies Record<string, OutputProperty>
const subscriptionFields = {
  id: referenceFields.id,
  name: optionalString('Subscription name'),
  description: optionalString('Subscription description'),
  sourceViewpoint: reference,
  targetViewpoint: reference,
  sourceRequest: optionalString('Source request UUID'),
  targetRequest: optionalString('Target request UUID'),
  subscriptionStatus: optionalString('Subscription processing status'),
  message: optionalString('Processing message'),
  assigneeName: optionalString('Assignee name'),
  timeCreated: timestamp,
  timeModified: timestamp,
}
const jobFields = {
  id: referenceFields.id,
  description: optionalString('Job description'),
  origin: optionalString('Job origin'),
  status: { type: 'string', description: 'PENDING, RUNNING, ERROR, or COMPLETED' },
  error: optionalString('Oracle job error text'),
  created: timestamp,
  lastModified: timestamp,
  jobSize: optionalNumber('Total job work'),
  jobProgress: optionalNumber('Completed job work'),
  links: referenceFields.links,
} satisfies Record<string, OutputProperty>
const resultFields = {
  id: jobFields.id,
  description: jobFields.description,
  origin: jobFields.origin,
  status: jobFields.status,
  created: timestamp,
  lastModified: timestamp,
  links: referenceFields.links,
  result: {
    type: 'json',
    description: 'Opaque Oracle JsonNode result; no operation-specific schema is documented',
    optional: true,
  },
} satisfies Record<string, OutputProperty>

function collection(
  description: string,
  properties: Record<string, OutputProperty>
): ToolOutputProperty {
  return {
    type: 'json',
    description,
    properties: {
      items: objectArray(description, properties),
      count: { type: 'number', description: 'Number of returned items' },
      truncated: {
        type: 'boolean',
        description: 'More items exist or the provider indicated additional results',
      },
    },
  }
}

export const edmOutputs = {
  applications: collection('Bounded application collection', applicationFields),
  dimensions: collection('Bounded dimension collection', dimensionFields),
  views: collection('Bounded view collection', viewFields),
  viewpoints: collection('Bounded viewpoint collection', viewpointFields),
  nodeTypes: collection('Bounded viewpoint-assigned node-type references', nodeTypeFields),
  nodeType: {
    type: 'json',
    description: 'Selected node-type assignment reference',
    properties: nodeTypeFields,
  },
  node: {
    type: 'json',
    description: 'Node properties and documented request information',
    properties: edmNodeFields,
  },
  nodes: objectArray('Bounded flat node page', edmNodeFields),
  request: {
    type: 'json',
    description: 'Request workflow, ownership, validation counts, and source relationships',
    properties: requestFields,
  },
  requests: collection('Bounded requests matching the selected window and filters', requestFields),
  lineage: {
    type: 'json',
    description: 'Request lineage and subscription processing instances',
    properties: {
      requestLineageNodes: objectArray('Related requests in the lineage', {
        id: referenceFields.id,
        title: requestFields.title,
        origin: requestFields.origin,
        status: requestFields.status,
        autoSubmitted: requestFields.autoSubmitted,
        sourceRequest: reference,
        timeCreated: timestamp,
        viewpoints: objectArray('Related viewpoints', referenceFields),
        incompleteSubscriptions: objectArray(
          'Incomplete subscription instances',
          subscriptionFields
        ),
        links: referenceFields.links,
      }),
      subscriptionInstances: objectArray('Subscription processing instances', subscriptionFields),
      links: referenceFields.links,
    },
  },
  job: {
    type: 'json',
    description: 'Current Oracle job snapshot',
    nullable: true,
    properties: jobFields,
  },
  result: {
    type: 'json',
    description: 'Oracle job-result envelope; its nested result is opaque',
    properties: resultFields,
    optional: true,
  },
  file: { type: 'file', description: 'Result stored as a canonical Sim UserFile', optional: true },
  jobId: { type: 'string', description: 'Job UUID for resumable status/result retrieval' },
  completed: {
    type: 'boolean',
    description:
      'True when Oracle job status is COMPLETED; inspect result and reports for business success',
  },
  timedOut: {
    type: 'boolean',
    description: 'Local polling ended before completion; the remote job may still be running',
  },
  fileName: { type: 'string', description: 'Oracle file name', optional: true },
  applicationId: { type: 'string', description: 'Selected application UUID' },
  requestId: { type: 'string', description: 'Selected request UUID' },
  attachmentId: { type: 'string', description: 'Uploaded attachment UUID' },
  attachmentUri: { type: 'string', description: 'Validated request attachment URI' },
  deleted: { type: 'boolean', description: 'Whether Oracle accepted the request deletion' },
  count: { type: 'number', description: 'Number of returned nodes' },
  offset: { type: 'number', description: 'Requested node offset' },
  nextOffset: {
    type: 'number',
    description: 'Next node offset, if additional nodes may exist',
    nullable: true,
  },
  hasMore: { type: 'boolean', description: 'Whether additional nodes may exist' },
  truncated: { type: 'boolean', description: 'Whether traversal or page output was bounded' },
  providerRequests: { type: 'number', description: 'Provider requests consumed by this traversal' },
  truncationReasons: stringArray('Reached limits or detected repeated/cyclic traversal'),
  remainingFrontier: objectArray('Unvisited traversal frontier, including depth and page offset', {
    parentNodeId: {
      type: 'string',
      description: 'Parent node UUID; null for roots',
      nullable: true,
    },
    parentLocation: {
      type: 'string',
      description: 'Traversal parent location; null for roots',
      nullable: true,
    },
    path: stringArray('Traversal ancestor node UUIDs'),
    depth: { type: 'number', description: 'Depth of the next nodes' },
    offset: { type: 'number', description: 'Unvisited page offset' },
  }),
  mapKeys: objectArray('Mapping locations and source/target node-type references', {
    location: { type: 'string', description: 'Mapping location' },
    sourceNodeType: reference,
    targetNodeType: reference,
    defaultLocation: optionalBoolean('Whether this is the default mapping location'),
  }),
} satisfies Record<string, ToolOutputProperty>

export const edmAsyncOutputs = {
  jobId: edmOutputs.jobId,
  job: edmOutputs.job,
  completed: edmOutputs.completed,
  timedOut: edmOutputs.timedOut,
  result: edmOutputs.result,
  file: edmOutputs.file,
  fileName: edmOutputs.fileName,
}

export const edmHierarchyOutput: ToolOutputProperty = objectArray(
  'Flat traversal occurrences; traversalPath is the visited path, distinct from provider path/location',
  {
    ...edmNodeFields,
    depth: { type: 'number', description: 'Traversal depth, with roots at zero' },
    traversalPath: stringArray('Node UUIDs along this traversal occurrence'),
    traversalParentLocation: {
      type: 'string',
      description: 'Traversal parent UUID path; null for roots',
      nullable: true,
    },
  }
)
