import { toError } from '@sim/utils/errors'
import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'
import { awsSesCreateConfigurationSetContract } from '@/lib/api/contracts/tools/aws/ses-create-configuration-set'
import { awsSesCreateEmailIdentityContract } from '@/lib/api/contracts/tools/aws/ses-create-email-identity'
import { awsSesCreateTemplateContract } from '@/lib/api/contracts/tools/aws/ses-create-template'
import { awsSesDeleteEmailIdentityContract } from '@/lib/api/contracts/tools/aws/ses-delete-email-identity'
import { awsSesDeleteSuppressedDestinationContract } from '@/lib/api/contracts/tools/aws/ses-delete-suppressed-destination'
import { awsSesDeleteTemplateContract } from '@/lib/api/contracts/tools/aws/ses-delete-template'
import { awsSesGetAccountContract } from '@/lib/api/contracts/tools/aws/ses-get-account'
import { awsSesGetEmailIdentityContract } from '@/lib/api/contracts/tools/aws/ses-get-email-identity'
import { awsSesGetSuppressedDestinationContract } from '@/lib/api/contracts/tools/aws/ses-get-suppressed-destination'
import { awsSesGetTemplateContract } from '@/lib/api/contracts/tools/aws/ses-get-template'
import { awsSesListIdentitiesContract } from '@/lib/api/contracts/tools/aws/ses-list-identities'
import { awsSesListSuppressedDestinationsContract } from '@/lib/api/contracts/tools/aws/ses-list-suppressed-destinations'
import { awsSesListTemplatesContract } from '@/lib/api/contracts/tools/aws/ses-list-templates'
import { awsSesPutSuppressedDestinationContract } from '@/lib/api/contracts/tools/aws/ses-put-suppressed-destination'
import { awsSesSendBulkEmailContract } from '@/lib/api/contracts/tools/aws/ses-send-bulk-email'
import { awsSesSendCustomVerificationEmailContract } from '@/lib/api/contracts/tools/aws/ses-send-custom-verification-email'
import { awsSesSendEmailContract } from '@/lib/api/contracts/tools/aws/ses-send-email'
import { awsSesSendTemplatedEmailContract } from '@/lib/api/contracts/tools/aws/ses-send-templated-email'
import { awsSesUpdateTemplateContract } from '@/lib/api/contracts/tools/aws/ses-update-template'
import {
  executeSesCreateConfigurationSet,
  executeSesCreateEmailIdentity,
  executeSesCreateTemplate,
  executeSesDeleteEmailIdentity,
  executeSesDeleteSuppressedDestination,
  executeSesDeleteTemplate,
  executeSesGetAccount,
  executeSesGetEmailIdentity,
  executeSesGetSuppressedDestination,
  executeSesGetTemplate,
  executeSesListIdentities,
  executeSesListSuppressedDestinations,
  executeSesListTemplates,
  executeSesPutSuppressedDestination,
  executeSesSendBulkEmail,
  executeSesSendCustomVerificationEmail,
  executeSesSendEmail,
  executeSesSendTemplatedEmail,
  executeSesUpdateTemplate,
  SesOperationInputError,
} from '@/lib/internal/ses/operations'
import { parseInternalToolInput } from '@/lib/internal/tool-operations/parse-input'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

async function executeOperation<C extends AnyApiRouteContract>(
  contract: C,
  input: unknown,
  execute: (input: ContractBody<C>, signal?: AbortSignal) => Promise<unknown>,
  errorMessage: string,
  signal?: AbortSignal
): Promise<Response> {
  const parsed = parseInternalToolInput(contract, input)
  if (!parsed.success) return parsed.response

  try {
    const result = await execute(parsed.data, signal)
    signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof SesOperationInputError) {
      return Response.json({ error: error.message }, { status: 400 })
    }
    return Response.json({ error: `${errorMessage}: ${toError(error).message}` }, { status: 500 })
  }
}

export const executeSesTool: InternalToolOperationHandler = async ({ toolId, input, signal }) => {
  signal?.throwIfAborted()

  switch (toolId) {
    case 'ses_create_configuration_set':
      return executeOperation(
        awsSesCreateConfigurationSetContract,
        input,
        executeSesCreateConfigurationSet,
        'Failed to create configuration set',
        signal
      )
    case 'ses_create_email_identity':
      return executeOperation(
        awsSesCreateEmailIdentityContract,
        input,
        executeSesCreateEmailIdentity,
        'Failed to create email identity',
        signal
      )
    case 'ses_create_template':
      return executeOperation(
        awsSesCreateTemplateContract,
        input,
        executeSesCreateTemplate,
        'Failed to create template',
        signal
      )
    case 'ses_delete_email_identity':
      return executeOperation(
        awsSesDeleteEmailIdentityContract,
        input,
        executeSesDeleteEmailIdentity,
        'Failed to delete email identity',
        signal
      )
    case 'ses_delete_suppressed_destination':
      return executeOperation(
        awsSesDeleteSuppressedDestinationContract,
        input,
        executeSesDeleteSuppressedDestination,
        'Failed to remove suppressed destination',
        signal
      )
    case 'ses_delete_template':
      return executeOperation(
        awsSesDeleteTemplateContract,
        input,
        executeSesDeleteTemplate,
        'Failed to delete template',
        signal
      )
    case 'ses_get_account':
      return executeOperation(
        awsSesGetAccountContract,
        input,
        executeSesGetAccount,
        'Failed to get account information',
        signal
      )
    case 'ses_get_email_identity':
      return executeOperation(
        awsSesGetEmailIdentityContract,
        input,
        executeSesGetEmailIdentity,
        'Failed to get email identity',
        signal
      )
    case 'ses_get_suppressed_destination':
      return executeOperation(
        awsSesGetSuppressedDestinationContract,
        input,
        executeSesGetSuppressedDestination,
        'Failed to get suppressed destination',
        signal
      )
    case 'ses_get_template':
      return executeOperation(
        awsSesGetTemplateContract,
        input,
        executeSesGetTemplate,
        'Failed to get template',
        signal
      )
    case 'ses_list_identities':
      return executeOperation(
        awsSesListIdentitiesContract,
        input,
        executeSesListIdentities,
        'Failed to list identities',
        signal
      )
    case 'ses_list_suppressed_destinations':
      return executeOperation(
        awsSesListSuppressedDestinationsContract,
        input,
        executeSesListSuppressedDestinations,
        'Failed to list suppressed destinations',
        signal
      )
    case 'ses_list_templates':
      return executeOperation(
        awsSesListTemplatesContract,
        input,
        executeSesListTemplates,
        'Failed to list templates',
        signal
      )
    case 'ses_put_suppressed_destination':
      return executeOperation(
        awsSesPutSuppressedDestinationContract,
        input,
        executeSesPutSuppressedDestination,
        'Failed to add suppressed destination',
        signal
      )
    case 'ses_send_bulk_email':
      return executeOperation(
        awsSesSendBulkEmailContract,
        input,
        executeSesSendBulkEmail,
        'Failed to send bulk email',
        signal
      )
    case 'ses_send_custom_verification_email':
      return executeOperation(
        awsSesSendCustomVerificationEmailContract,
        input,
        executeSesSendCustomVerificationEmail,
        'Failed to send custom verification email',
        signal
      )
    case 'ses_send_email':
      return executeOperation(
        awsSesSendEmailContract,
        input,
        executeSesSendEmail,
        'Failed to send email',
        signal
      )
    case 'ses_send_templated_email':
      return executeOperation(
        awsSesSendTemplatedEmailContract,
        input,
        executeSesSendTemplatedEmail,
        'Failed to send templated email',
        signal
      )
    case 'ses_update_template':
      return executeOperation(
        awsSesUpdateTemplateContract,
        input,
        executeSesUpdateTemplate,
        'Failed to update template',
        signal
      )
    default:
      return Response.json({ error: `Unsupported SES tool: ${toolId}` }, { status: 500 })
  }
}
