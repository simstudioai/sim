import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import nodemailer from 'nodemailer'
import type SESTransport from 'nodemailer/lib/ses-transport'
import { env } from '@/lib/core/config/env'
import { sendViaNodemailer } from '@/lib/messaging/email/providers/_nodemailer'
import type { MailProvider } from '@/lib/messaging/email/types'

/**
 * AWS SES via nodemailer's SES transport using the AWS SDK v3 client.
 * Credentials resolve through the SDK's default provider chain (env vars,
 * shared config, ECS/EKS task role, EC2 instance profile, SSO).
 */
export function createSesProvider(): MailProvider | null {
  const region = env.AWS_SES_REGION
  if (!region) return null

  const sesClient = new SESv2Client({ region })
  const sesOptions: SESTransport.Options = {
    // double-cast-allowed: @types/nodemailer bundles a nested @aws-sdk/client-sesv2 whose nominal class types do not unify with the top-level install
    SES: { sesClient, SendEmailCommand } as unknown as SESTransport.Options['SES'],
  }
  const transporter = nodemailer.createTransport(sesOptions)

  return {
    name: 'ses',
    send: (data) => sendViaNodemailer(transporter, data, 'ses'),
  }
}
