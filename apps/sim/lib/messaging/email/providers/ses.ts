import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import nodemailer from 'nodemailer'
import type SESTransport from 'nodemailer/lib/ses-transport'
import { env } from '@/lib/core/config/env'
import { sendViaNodemailer } from '@/lib/messaging/email/providers/_nodemailer'
import type { MailProvider } from '@/lib/messaging/email/types'

/**
 * AWS SES via nodemailer's SES transport using the AWS SDK v3 client.
 *
 * Credentials are resolved through the SDK's default credential provider
 * chain (env vars, shared config, ECS/EKS task role, EC2 instance profile,
 * SSO). Only the region needs to be set explicitly via `AWS_SES_REGION`.
 */
export function createSesProvider(): MailProvider | null {
  const region = env.AWS_SES_REGION
  if (!region) return null

  const sesClient = new SESv2Client({ region })
  // `@types/nodemailer` bundles its own copy of `@aws-sdk/client-sesv2`, so the
  // SendEmailCommand and SESv2Client we import are structurally identical at
  // runtime but TS sees them as a different declarations. Cast through the
  // nodemailer SES shape to bridge the two type identities.
  const sesOptions: SESTransport.Options = {
    SES: { sesClient, SendEmailCommand } as SESTransport.Options['SES'],
  }
  const transporter = nodemailer.createTransport(sesOptions)

  return {
    name: 'ses',
    send: (data) => sendViaNodemailer(transporter, data, 'ses'),
  }
}
