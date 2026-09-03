export const ORACLE_B2C_SERVICE_API_PATH = '/services/rest/connect/v1.4'

export const DEFAULT_APPLICATION_CONTEXT = 'Sim'
export const MAX_APPLICATION_CONTEXT_LENGTH = 40

export const DEFAULT_PAGE_LIMIT = 100
export const MAX_PAGE_LIMIT = 1000

export const ORACLE_B2C_SERVICE_COLLECTIONS = {
  answers: 'answers',
  contacts: 'contacts',
  incidents: 'incidents',
  organizations: 'organizations',
} as const

export type OracleB2CServiceCollection =
  (typeof ORACLE_B2C_SERVICE_COLLECTIONS)[keyof typeof ORACLE_B2C_SERVICE_COLLECTIONS]

/**
 * Oracle collection responses contain only id, lookupName, createdTime, and
 * updatedTime unless fields are selected. Keep these projections fixed so list
 * tools return the summary data they advertise without loading large child
 * collections such as incident threads or contact email addresses.
 */
export const ORACLE_B2C_SERVICE_LIST_FIELDS: Record<OracleB2CServiceCollection, string> = {
  answers:
    'id,lookupName,createdTime,updatedTime,answerType,language,summary,keywords,statusWithType,publishOnDate,expiresDate',
  contacts:
    'id,lookupName,createdTime,updatedTime,name,title,disabled,externalReference,organization',
  incidents:
    'id,lookupName,createdTime,updatedTime,subject,primaryContact,organization,queue,severity,category,product,statusWithType,assignedTo',
  organizations:
    'id,lookupName,createdTime,updatedTime,name,externalReference,parent,industry,numberOfEmployees',
}

/**
 * Oracle's Connect REST API represents these two incident-thread values as
 * named IDs. The documented incident-response example uses Email (9) as the
 * channel and Response (2) as the entry type.
 */
export const INCIDENT_RESPONSE_CHANNEL_ID = 9
export const INCIDENT_RESPONSE_ENTRY_TYPE_ID = 2
