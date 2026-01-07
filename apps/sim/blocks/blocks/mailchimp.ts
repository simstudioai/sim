import { MailchimpIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

export const MailchimpBlock: BlockConfig = {
  type: 'mailchimp',
  name: 'Mailchimp',
  description: 'Manage audiences, campaigns, and marketing automation in Mailchimp',
  longDescription:
    'Integrate Mailchimp into the workflow. Can manage audiences (lists), list members, campaigns, automation workflows, templates, reports, segments, tags, merge fields, interest categories, landing pages, signup forms, and batch operations.',
  docsLink: 'https://docs.sim.ai/tools/mailchimp',
  authMode: AuthMode.ApiKey,
  category: 'tools',
  bgColor: '#FFE01B',
  icon: MailchimpIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Audience/List operations
        { label: 'Get Audiences', id: 'get_audiences' },
        { label: 'Get Audience', id: 'get_audience' },
        { label: 'Create Audience', id: 'create_audience' },
        { label: 'Update Audience', id: 'update_audience' },
        { label: 'Delete Audience', id: 'delete_audience' },
        // Member operations
        { label: 'Get Members', id: 'get_members' },
        { label: 'Get Member', id: 'get_member' },
        { label: 'Add Member', id: 'add_member' },
        { label: 'Add or Update Member', id: 'add_or_update_member' },
        { label: 'Update Member', id: 'update_member' },
        { label: 'Delete Member', id: 'delete_member' },
        { label: 'Archive Member', id: 'archive_member' },
        { label: 'Unarchive Member', id: 'unarchive_member' },
        // Campaign operations
        { label: 'Get Campaigns', id: 'get_campaigns' },
        { label: 'Get Campaign', id: 'get_campaign' },
        { label: 'Create Campaign', id: 'create_campaign' },
        { label: 'Update Campaign', id: 'update_campaign' },
        { label: 'Delete Campaign', id: 'delete_campaign' },
        { label: 'Send Campaign', id: 'send_campaign' },
        { label: 'Schedule Campaign', id: 'schedule_campaign' },
        { label: 'Unschedule Campaign', id: 'unschedule_campaign' },
        { label: 'Replicate Campaign', id: 'replicate_campaign' },
        // Campaign content operations
        { label: 'Get Campaign Content', id: 'get_campaign_content' },
        { label: 'Set Campaign Content', id: 'set_campaign_content' },
        // Automation operations
        { label: 'Get Automations', id: 'get_automations' },
        { label: 'Get Automation', id: 'get_automation' },
        { label: 'Start Automation', id: 'start_automation' },
        { label: 'Pause Automation', id: 'pause_automation' },
        { label: 'Add Subscriber to Automation', id: 'add_subscriber_to_automation' },
        // Template operations
        { label: 'Get Templates', id: 'get_templates' },
        { label: 'Get Template', id: 'get_template' },
        { label: 'Create Template', id: 'create_template' },
        { label: 'Update Template', id: 'update_template' },
        { label: 'Delete Template', id: 'delete_template' },
        // Report operations
        { label: 'Get Campaign Reports', id: 'get_campaign_reports' },
        { label: 'Get Campaign Report', id: 'get_campaign_report' },
        // Segment operations
        { label: 'Get Segments', id: 'get_segments' },
        { label: 'Get Segment', id: 'get_segment' },
        { label: 'Create Segment', id: 'create_segment' },
        { label: 'Update Segment', id: 'update_segment' },
        { label: 'Delete Segment', id: 'delete_segment' },
        { label: 'Get Segment Members', id: 'get_segment_members' },
        { label: 'Add Segment Member', id: 'add_segment_member' },
        { label: 'Remove Segment Member', id: 'remove_segment_member' },
        // Tag operations
        { label: 'Get Member Tags', id: 'get_member_tags' },
        { label: 'Add Member Tags', id: 'add_member_tags' },
        { label: 'Remove Member Tags', id: 'remove_member_tags' },
        // Merge fields operations
        { label: 'Get Merge Fields', id: 'get_merge_fields' },
        { label: 'Get Merge Field', id: 'get_merge_field' },
        { label: 'Create Merge Field', id: 'create_merge_field' },
        { label: 'Update Merge Field', id: 'update_merge_field' },
        { label: 'Delete Merge Field', id: 'delete_merge_field' },
        // Interest categories operations
        { label: 'Get Interest Categories', id: 'get_interest_categories' },
        { label: 'Get Interest Category', id: 'get_interest_category' },
        { label: 'Create Interest Category', id: 'create_interest_category' },
        { label: 'Update Interest Category', id: 'update_interest_category' },
        { label: 'Delete Interest Category', id: 'delete_interest_category' },
        // Interest operations
        { label: 'Get Interests', id: 'get_interests' },
        { label: 'Get Interest', id: 'get_interest' },
        { label: 'Create Interest', id: 'create_interest' },
        { label: 'Update Interest', id: 'update_interest' },
        { label: 'Delete Interest', id: 'delete_interest' },
        // Landing page operations
        { label: 'Get Landing Pages', id: 'get_landing_pages' },
        { label: 'Get Landing Page', id: 'get_landing_page' },
        { label: 'Create Landing Page', id: 'create_landing_page' },
        { label: 'Update Landing Page', id: 'update_landing_page' },
        { label: 'Delete Landing Page', id: 'delete_landing_page' },
        { label: 'Publish Landing Page', id: 'publish_landing_page' },
        { label: 'Unpublish Landing Page', id: 'unpublish_landing_page' },
        // Batch operations
        { label: 'Get Batch Operations', id: 'get_batch_operations' },
        { label: 'Get Batch Operation', id: 'get_batch_operation' },
        { label: 'Create Batch Operation', id: 'create_batch_operation' },
        { label: 'Delete Batch Operation', id: 'delete_batch_operation' },
      ],
      value: () => 'get_audiences',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      password: true,
      placeholder: 'Enter your Mailchimp API key (includes server prefix)',
      required: true,
    },
    // Audience/List fields
    {
      id: 'listId',
      title: 'Audience ID',
      type: 'short-input',
      placeholder: 'Audience/List ID',
      required: {
        field: 'operation',
        value: [
          'get_audience',
          'update_audience',
          'delete_audience',
          'get_members',
          'get_member',
          'add_member',
          'add_or_update_member',
          'update_member',
          'delete_member',
          'archive_member',
          'unarchive_member',
          'get_segments',
          'get_segment',
          'create_segment',
          'update_segment',
          'delete_segment',
          'get_segment_members',
          'add_segment_member',
          'remove_segment_member',
          'get_member_tags',
          'add_member_tags',
          'remove_member_tags',
          'get_merge_fields',
          'get_merge_field',
          'create_merge_field',
          'update_merge_field',
          'delete_merge_field',
          'get_interest_categories',
          'get_interest_category',
          'create_interest_category',
          'update_interest_category',
          'delete_interest_category',
          'get_interests',
          'get_interest',
          'create_interest',
          'update_interest',
          'delete_interest',
        ],
      },
      condition: {
        field: 'operation',
        value: [
          'get_audience',
          'update_audience',
          'delete_audience',
          'get_members',
          'get_member',
          'add_member',
          'add_or_update_member',
          'update_member',
          'delete_member',
          'archive_member',
          'unarchive_member',
          'get_segments',
          'get_segment',
          'create_segment',
          'update_segment',
          'delete_segment',
          'get_segment_members',
          'add_segment_member',
          'remove_segment_member',
          'get_member_tags',
          'add_member_tags',
          'remove_member_tags',
          'get_merge_fields',
          'get_merge_field',
          'create_merge_field',
          'update_merge_field',
          'delete_merge_field',
          'get_interest_categories',
          'get_interest_category',
          'create_interest_category',
          'update_interest_category',
          'delete_interest_category',
          'get_interests',
          'get_interest',
          'create_interest',
          'update_interest',
          'delete_interest',
        ],
      },
    },
    {
      id: 'audienceName',
      title: 'Audience Name',
      type: 'short-input',
      placeholder: 'Name for the audience',
      required: {
        field: 'operation',
        value: ['create_audience'],
      },
      condition: {
        field: 'operation',
        value: ['create_audience', 'update_audience'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a clear, descriptive name for a Mailchimp audience/mailing list based on the user's description.

### GUIDELINES
- Keep it concise but descriptive (2-5 words typically)
- Make it easy to identify the audience purpose
- Use professional naming conventions

### EXAMPLES
"Newsletter subscribers" -> "Newsletter Subscribers"
"Customers who bought product X" -> "Product X Customers"
"Event attendees from 2024" -> "2024 Event Attendees"

Return ONLY the audience name - no explanations.`,
        placeholder: 'Describe the audience...',
      },
    },
    {
      id: 'contact',
      title: 'Contact Information',
      type: 'long-input',
      placeholder: 'JSON object with company, address1, city, state, zip, country',
      required: {
        field: 'operation',
        value: ['create_audience'],
      },
      condition: {
        field: 'operation',
        value: ['create_audience', 'update_audience'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object with contact information for a Mailchimp audience based on the user's description.

### REQUIRED FIELDS
- company: Company or organization name
- address1: Street address
- city: City name
- state: State/province
- zip: Postal/ZIP code
- country: Country code (e.g., "US", "CA", "GB")

### EXAMPLE OUTPUT
{"company": "Acme Corp", "address1": "123 Main Street", "city": "San Francisco", "state": "CA", "zip": "94102", "country": "US"}

Return ONLY the JSON object - no explanations or markdown.`,
        placeholder: 'Describe the company contact info...',
        generationType: 'json-object',
      },
    },
    {
      id: 'permissionReminder',
      title: 'Permission Reminder',
      type: 'short-input',
      placeholder: 'Permission reminder text',
      required: {
        field: 'operation',
        value: ['create_audience'],
      },
      condition: {
        field: 'operation',
        value: ['create_audience', 'update_audience'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a permission reminder message for a Mailchimp audience based on the user's description.

This text reminds subscribers how they signed up and why they're receiving emails.

### GUIDELINES
- Be clear about how they joined the list
- Keep it concise (1-2 sentences)
- Make it friendly and professional

### EXAMPLES
"Newsletter signup" -> "You signed up for our newsletter on our website."
"Event registration" -> "You're receiving this email because you registered for one of our events."
"Product purchase" -> "You subscribed to updates when you made a purchase from our store."

Return ONLY the permission reminder text - no explanations.`,
        placeholder: 'Describe how subscribers joined...',
      },
    },
    {
      id: 'campaignDefaults',
      title: 'Campaign Defaults',
      type: 'long-input',
      placeholder: 'JSON object with from_name, from_email, subject, language',
      required: {
        field: 'operation',
        value: ['create_audience'],
      },
      condition: {
        field: 'operation',
        value: ['create_audience', 'update_audience'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object with campaign default settings for a Mailchimp audience based on the user's description.

### REQUIRED FIELDS
- from_name: Sender name that appears in emails
- from_email: Sender email address
- subject: Default email subject line
- language: Language code (e.g., "en" for English)

### EXAMPLE OUTPUT
{"from_name": "Acme Marketing", "from_email": "marketing@acme.com", "subject": "News from Acme", "language": "en"}

Return ONLY the JSON object - no explanations or markdown.`,
        placeholder: 'Describe the campaign defaults...',
        generationType: 'json-object',
      },
    },
    {
      id: 'emailTypeOption',
      title: 'Email Type Option',
      type: 'dropdown',
      options: [
        { label: 'True', id: 'true' },
        { label: 'False', id: 'false' },
      ],
      required: {
        field: 'operation',
        value: ['create_audience'],
      },
      condition: {
        field: 'operation',
        value: ['create_audience', 'update_audience'],
      },
      value: () => 'true',
    },
    // Member fields
    {
      id: 'subscriberEmail',
      title: 'Subscriber Email',
      type: 'short-input',
      placeholder: 'Email address or MD5 hash',
      required: {
        field: 'operation',
        value: [
          'get_member',
          'update_member',
          'delete_member',
          'archive_member',
          'unarchive_member',
          'get_member_tags',
          'add_member_tags',
          'remove_member_tags',
          'add_or_update_member',
          'remove_segment_member',
        ],
      },
      condition: {
        field: 'operation',
        value: [
          'get_member',
          'update_member',
          'delete_member',
          'archive_member',
          'unarchive_member',
          'get_member_tags',
          'add_member_tags',
          'remove_member_tags',
          'add_or_update_member',
          'remove_segment_member',
        ],
      },
    },
    {
      id: 'emailAddress',
      title: 'Email Address',
      type: 'short-input',
      placeholder: 'Member email address',
      required: {
        field: 'operation',
        value: [
          'add_member',
          'add_or_update_member',
          'unarchive_member',
          'add_segment_member',
          'add_subscriber_to_automation',
        ],
      },
      condition: {
        field: 'operation',
        value: [
          'add_member',
          'add_or_update_member',
          'update_member',
          'unarchive_member',
          'add_segment_member',
          'add_subscriber_to_automation',
        ],
      },
    },
    {
      id: 'status',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'Subscribed', id: 'subscribed' },
        { label: 'Unsubscribed', id: 'unsubscribed' },
        { label: 'Cleaned', id: 'cleaned' },
        { label: 'Pending', id: 'pending' },
        { label: 'Transactional', id: 'transactional' },
      ],
      required: {
        field: 'operation',
        value: ['add_member', 'unarchive_member'],
      },
      condition: {
        field: 'operation',
        value: ['get_members', 'add_member', 'update_member', 'unarchive_member'],
      },
    },
    {
      id: 'statusIfNew',
      title: 'Status If New',
      type: 'dropdown',
      options: [
        { label: 'Subscribed', id: 'subscribed' },
        { label: 'Unsubscribed', id: 'unsubscribed' },
        { label: 'Cleaned', id: 'cleaned' },
        { label: 'Pending', id: 'pending' },
        { label: 'Transactional', id: 'transactional' },
      ],
      required: {
        field: 'operation',
        value: ['add_or_update_member'],
      },
      condition: {
        field: 'operation',
        value: ['add_or_update_member'],
      },
    },
    {
      id: 'mergeFields',
      title: 'Merge Fields',
      type: 'long-input',
      placeholder: 'JSON object with merge field values (e.g., {"FNAME": "John", "LNAME": "Doe"})',
      condition: {
        field: 'operation',
        value: ['add_member', 'add_or_update_member', 'update_member'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object with merge field values for a Mailchimp subscriber based on the user's description.

### COMMON MERGE FIELDS
- FNAME: First name
- LNAME: Last name
- PHONE: Phone number
- BIRTHDAY: Birthday (MM/DD format)
- ADDRESS: Mailing address

### EXAMPLE OUTPUT
{"FNAME": "John", "LNAME": "Doe", "PHONE": "+1-555-123-4567"}

Return ONLY the JSON object - no explanations or markdown.`,
        placeholder: 'Describe the subscriber info...',
        generationType: 'json-object',
      },
    },
    {
      id: 'interests',
      title: 'Interests',
      type: 'long-input',
      placeholder: 'JSON object with interest IDs and boolean values',
      condition: {
        field: 'operation',
        value: ['add_member', 'add_or_update_member', 'update_member'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object with interest group settings for a Mailchimp subscriber.

Interest IDs map to boolean values indicating whether the subscriber is interested in that category.

### EXAMPLE OUTPUT
{"abc123def456": true, "xyz789ghi012": false, "mno345pqr678": true}

Note: You'll need actual interest IDs from your Mailchimp audience. Use Get Interest Categories to find them.

Return ONLY the JSON object - no explanations or markdown.`,
        placeholder: 'Describe the interests to set...',
        generationType: 'json-object',
      },
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'long-input',
      placeholder: 'JSON array of tag objects with name and status',
      required: {
        field: 'operation',
        value: ['add_member_tags', 'remove_member_tags'],
      },
      condition: {
        field: 'operation',
        value: ['add_member_tags', 'remove_member_tags'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of tag objects for Mailchimp member tagging based on the user's description.

### TAG OBJECT FORMAT
- name: Tag name
- status: "active" to add, "inactive" to remove

### EXAMPLE OUTPUT
[{"name": "VIP Customer", "status": "active"}, {"name": "Newsletter", "status": "active"}]

Return ONLY the JSON array - no explanations or markdown.`,
        placeholder: 'Describe the tags to add or remove...',
        generationType: 'json-object',
      },
    },
    // Campaign fields
    {
      id: 'campaignId',
      title: 'Campaign ID',
      type: 'short-input',
      placeholder: 'Campaign ID',
      required: {
        field: 'operation',
        value: [
          'get_campaign',
          'update_campaign',
          'delete_campaign',
          'send_campaign',
          'schedule_campaign',
          'unschedule_campaign',
          'replicate_campaign',
          'get_campaign_content',
          'set_campaign_content',
          'get_campaign_report',
        ],
      },
      condition: {
        field: 'operation',
        value: [
          'get_campaign',
          'update_campaign',
          'delete_campaign',
          'send_campaign',
          'schedule_campaign',
          'unschedule_campaign',
          'replicate_campaign',
          'get_campaign_content',
          'set_campaign_content',
          'get_campaign_report',
        ],
      },
    },
    {
      id: 'campaignType',
      title: 'Campaign Type',
      type: 'dropdown',
      options: [
        { label: 'Regular', id: 'regular' },
        { label: 'Plain Text', id: 'plaintext' },
        { label: 'A/B Split', id: 'absplit' },
        { label: 'RSS', id: 'rss' },
        { label: 'Variate', id: 'variate' },
      ],
      required: {
        field: 'operation',
        value: ['create_campaign'],
      },
      condition: {
        field: 'operation',
        value: ['get_campaigns', 'create_campaign'],
      },
    },
    {
      id: 'campaignSettings',
      title: 'Campaign Settings',
      type: 'long-input',
      placeholder: 'JSON object with subject_line, from_name, reply_to, etc. (required for create)',
      required: {
        field: 'operation',
        value: ['create_campaign'],
      },
      condition: {
        field: 'operation',
        value: ['create_campaign', 'update_campaign'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object with campaign settings for a Mailchimp email campaign based on the user's description.

### COMMON SETTINGS
- subject_line: Email subject line
- preview_text: Preview text shown in inbox
- from_name: Sender name
- reply_to: Reply-to email address
- title: Internal campaign title

### EXAMPLE OUTPUT
{"subject_line": "Your Weekly Newsletter", "preview_text": "Check out what's new this week", "from_name": "Acme Team", "reply_to": "hello@acme.com", "title": "Weekly Newsletter - Jan 2024"}

Return ONLY the JSON object - no explanations or markdown.`,
        placeholder: 'Describe the campaign settings...',
        generationType: 'json-object',
      },
    },
    {
      id: 'recipients',
      title: 'Recipients',
      type: 'long-input',
      placeholder: 'JSON object with list_id and optional segment_opts',
      condition: {
        field: 'operation',
        value: ['create_campaign', 'update_campaign'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object defining campaign recipients for a Mailchimp campaign based on the user's description.

### REQUIRED FIELDS
- list_id: The audience/list ID to send to

### OPTIONAL FIELDS
- segment_opts: Segment filtering options
  - saved_segment_id: ID of a saved segment
  - match: "any" or "all" for condition matching
  - conditions: Array of filter conditions

### EXAMPLE OUTPUT
{"list_id": "abc123def", "segment_opts": {"saved_segment_id": 12345}}

Return ONLY the JSON object - no explanations or markdown.`,
        placeholder: 'Describe the recipients...',
        generationType: 'json-object',
      },
    },
    {
      id: 'scheduleTime',
      title: 'Schedule Time',
      type: 'short-input',
      placeholder: 'ISO 8601 date-time (e.g., 2024-12-31T10:00:00+00:00)',
      required: {
        field: 'operation',
        value: ['schedule_campaign'],
      },
      condition: {
        field: 'operation',
        value: ['schedule_campaign'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp with timezone offset based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SS+00:00 (with timezone offset).
Examples:
- "tomorrow at 10am" -> Tomorrow's date at 10:00:00+00:00
- "next Monday at 9am EST" -> Next Monday at 09:00:00-05:00
- "in 2 hours" -> Current time plus 2 hours with appropriate timezone
- "next week Tuesday at noon" -> Calculate next Tuesday at 12:00:00+00:00

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder:
          'Describe when to schedule (e.g., "tomorrow at 10am", "next Monday at 9am")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'html',
      title: 'HTML Content',
      type: 'long-input',
      placeholder: 'HTML content for the campaign',
      condition: {
        field: 'operation',
        value: ['set_campaign_content'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate HTML email content for a Mailchimp campaign based on the user's description.

### GUIDELINES
- Use inline CSS for styling (email clients don't support external stylesheets)
- Keep the design simple and mobile-friendly
- Use tables for layout (better email client support)
- Include proper structure with header, body, and footer sections

### EXAMPLE STRUCTURE
<html>
<body style="font-family: Arial, sans-serif; margin: 0; padding: 20px;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="padding: 20px; background: #f4f4f4;">
      <h1 style="color: #333;">Your Title</h1>
      <p style="color: #666;">Your content here...</p>
    </td></tr>
  </table>
</body>
</html>

Return ONLY the HTML content - no explanations or markdown.`,
        placeholder: 'Describe the email content...',
      },
    },
    {
      id: 'plainText',
      title: 'Plain Text Content',
      type: 'long-input',
      placeholder: 'Plain text content for the campaign',
      condition: {
        field: 'operation',
        value: ['set_campaign_content'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate plain text email content for a Mailchimp campaign based on the user's description.

### GUIDELINES
- Use clear formatting with line breaks
- Keep paragraphs short and readable
- Include clear calls-to-action with full URLs
- Use dashes or asterisks for bullet points

### EXAMPLE
Hello [FNAME],

Thank you for subscribing to our newsletter!

Here's what's new this week:
- Feature update #1
- Exciting announcement
- Upcoming events

Visit our website: https://example.com

Best regards,
The Team

Return ONLY the plain text content - no explanations.`,
        placeholder: 'Describe the email content...',
      },
    },
    {
      id: 'templateId',
      title: 'Template ID',
      type: 'short-input',
      placeholder: 'Template ID',
      required: {
        field: 'operation',
        value: ['get_template', 'update_template', 'delete_template'],
      },
      condition: {
        field: 'operation',
        value: ['get_template', 'update_template', 'delete_template', 'set_campaign_content'],
      },
    },
    {
      id: 'templateName',
      title: 'Template Name',
      type: 'short-input',
      placeholder: 'Template name',
      required: {
        field: 'operation',
        value: ['create_template'],
      },
      condition: {
        field: 'operation',
        value: ['create_template', 'update_template'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a descriptive name for a Mailchimp email template based on the user's description.

### GUIDELINES
- Keep it clear and identifiable
- Include the purpose or use case
- Use professional naming conventions

### EXAMPLES
"Welcome email template" -> "Welcome Email Template"
"Monthly newsletter design" -> "Monthly Newsletter Template"
"Product announcement" -> "Product Announcement Template"

Return ONLY the template name - no explanations.`,
        placeholder: 'Describe the template...',
      },
    },
    {
      id: 'templateHtml',
      title: 'Template HTML',
      type: 'long-input',
      placeholder: 'HTML content for the template',
      required: {
        field: 'operation',
        value: ['create_template'],
      },
      condition: {
        field: 'operation',
        value: ['create_template', 'update_template'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate HTML content for a Mailchimp email template based on the user's description.

### GUIDELINES
- Use mc:edit regions for editable content areas
- Use inline CSS for styling
- Design for mobile-first responsiveness
- Include proper Mailchimp merge tags (*|FNAME|*, *|CURRENT_YEAR|*, etc.)

### EXAMPLE STRUCTURE
<html>
<body style="font-family: Arial, sans-serif;">
  <div mc:edit="header">
    <h1>*|MC:SUBJECT|*</h1>
  </div>
  <div mc:edit="body_content">
    <p>Hello *|FNAME|*,</p>
    <p>Your content here...</p>
  </div>
  <div mc:edit="footer">
    <p>&copy; *|CURRENT_YEAR|* Your Company</p>
  </div>
</body>
</html>

Return ONLY the HTML content - no explanations or markdown.`,
        placeholder: 'Describe the template design...',
      },
    },
    // Automation fields
    {
      id: 'workflowId',
      title: 'Workflow ID',
      type: 'short-input',
      placeholder: 'Automation workflow ID',
      required: {
        field: 'operation',
        value: [
          'get_automation',
          'start_automation',
          'pause_automation',
          'add_subscriber_to_automation',
        ],
      },
      condition: {
        field: 'operation',
        value: [
          'get_automation',
          'start_automation',
          'pause_automation',
          'add_subscriber_to_automation',
        ],
      },
    },
    {
      id: 'workflowEmailId',
      title: 'Workflow Email ID',
      type: 'short-input',
      placeholder: 'Workflow email ID',
      required: {
        field: 'operation',
        value: ['add_subscriber_to_automation'],
      },
      condition: {
        field: 'operation',
        value: ['add_subscriber_to_automation'],
      },
    },
    // Segment fields
    {
      id: 'segmentId',
      title: 'Segment ID',
      type: 'short-input',
      placeholder: 'Segment ID',
      required: {
        field: 'operation',
        value: [
          'get_segment',
          'update_segment',
          'delete_segment',
          'get_segment_members',
          'add_segment_member',
          'remove_segment_member',
        ],
      },
      condition: {
        field: 'operation',
        value: [
          'get_segment',
          'update_segment',
          'delete_segment',
          'get_segment_members',
          'add_segment_member',
          'remove_segment_member',
        ],
      },
    },
    {
      id: 'segmentName',
      title: 'Segment Name',
      type: 'short-input',
      placeholder: 'Segment name',
      required: {
        field: 'operation',
        value: ['create_segment'],
      },
      condition: {
        field: 'operation',
        value: ['create_segment', 'update_segment'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a descriptive name for a Mailchimp audience segment based on the user's description.

### GUIDELINES
- Make it clear who is in the segment
- Keep it concise but informative
- Use professional naming conventions

### EXAMPLES
"Active customers last 30 days" -> "Active Customers - Last 30 Days"
"High value subscribers" -> "High-Value Subscribers"
"Users who opened last campaign" -> "Last Campaign Openers"

Return ONLY the segment name - no explanations.`,
        placeholder: 'Describe the segment...',
      },
    },
    {
      id: 'segmentOptions',
      title: 'Segment Options',
      type: 'long-input',
      placeholder: 'JSON object with conditions for segment',
      condition: {
        field: 'operation',
        value: ['create_segment', 'update_segment'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object with segment conditions for a Mailchimp audience segment based on the user's description.

### SEGMENT OPTIONS FORMAT
- match: "any" or "all" (how conditions combine)
- conditions: Array of condition objects

### CONDITION OBJECT FIELDS
- condition_type: Type of condition (e.g., "EmailActivity", "DateMerge", "TextMerge")
- field: The field to check
- op: Operator (e.g., "is", "contains", "greater", "less")
- value: The value to compare

### EXAMPLE OUTPUT
{"match": "all", "conditions": [{"condition_type": "EmailActivity", "field": "campaign_id", "op": "open", "value": "abc123"}]}

Return ONLY the JSON object - no explanations or markdown.`,
        placeholder: 'Describe the segment conditions...',
        generationType: 'json-object',
      },
    },
    // Merge field fields
    {
      id: 'mergeId',
      title: 'Merge Field ID',
      type: 'short-input',
      placeholder: 'Merge field ID',
      required: {
        field: 'operation',
        value: ['get_merge_field', 'update_merge_field', 'delete_merge_field'],
      },
      condition: {
        field: 'operation',
        value: ['get_merge_field', 'update_merge_field', 'delete_merge_field'],
      },
    },
    {
      id: 'mergeName',
      title: 'Merge Field Name',
      type: 'short-input',
      placeholder: 'Merge field name',
      required: {
        field: 'operation',
        value: ['create_merge_field'],
      },
      condition: {
        field: 'operation',
        value: ['create_merge_field', 'update_merge_field'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a name for a Mailchimp merge field based on the user's description.

Merge fields are custom fields that store subscriber data.

### GUIDELINES
- Use descriptive, clear names
- Keep it concise
- Use Title Case

### EXAMPLES
"Customer phone number" -> "Phone Number"
"Company size" -> "Company Size"
"Preferred language" -> "Preferred Language"

Return ONLY the merge field name - no explanations.`,
        placeholder: 'Describe the merge field...',
      },
    },
    {
      id: 'mergeType',
      title: 'Merge Field Type',
      type: 'dropdown',
      options: [
        { label: 'Text', id: 'text' },
        { label: 'Number', id: 'number' },
        { label: 'Address', id: 'address' },
        { label: 'Phone', id: 'phone' },
        { label: 'Date', id: 'date' },
        { label: 'URL', id: 'url' },
        { label: 'Image URL', id: 'imageurl' },
        { label: 'Radio', id: 'radio' },
        { label: 'Dropdown', id: 'dropdown' },
        { label: 'Birthday', id: 'birthday' },
        { label: 'Zip', id: 'zip' },
      ],
      required: {
        field: 'operation',
        value: ['create_merge_field'],
      },
      condition: {
        field: 'operation',
        value: ['create_merge_field'],
      },
    },
    // Interest category fields
    {
      id: 'interestCategoryId',
      title: 'Interest Category ID',
      type: 'short-input',
      placeholder: 'Interest category ID',
      required: {
        field: 'operation',
        value: [
          'get_interest_category',
          'update_interest_category',
          'delete_interest_category',
          'get_interests',
          'get_interest',
          'create_interest',
          'update_interest',
          'delete_interest',
        ],
      },
      condition: {
        field: 'operation',
        value: [
          'get_interest_category',
          'update_interest_category',
          'delete_interest_category',
          'get_interests',
          'get_interest',
          'create_interest',
          'update_interest',
          'delete_interest',
        ],
      },
    },
    {
      id: 'interestCategoryTitle',
      title: 'Interest Category Title',
      type: 'short-input',
      placeholder: 'Interest category title',
      required: {
        field: 'operation',
        value: ['create_interest_category'],
      },
      condition: {
        field: 'operation',
        value: ['create_interest_category', 'update_interest_category'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a title for a Mailchimp interest category based on the user's description.

Interest categories group related subscriber preferences.

### GUIDELINES
- Make it descriptive of the category
- Keep it concise
- Use Title Case

### EXAMPLES
"Product preferences" -> "Product Preferences"
"Communication frequency" -> "Communication Preferences"
"Topics of interest" -> "Topics of Interest"

Return ONLY the category title - no explanations.`,
        placeholder: 'Describe the interest category...',
      },
    },
    {
      id: 'interestCategoryType',
      title: 'Interest Category Type',
      type: 'dropdown',
      options: [
        { label: 'Checkboxes', id: 'checkboxes' },
        { label: 'Dropdown', id: 'dropdown' },
        { label: 'Radio', id: 'radio' },
        { label: 'Hidden', id: 'hidden' },
      ],
      required: {
        field: 'operation',
        value: ['create_interest_category'],
      },
      condition: {
        field: 'operation',
        value: ['create_interest_category'],
      },
    },
    // Interest fields
    {
      id: 'interestId',
      title: 'Interest ID',
      type: 'short-input',
      placeholder: 'Interest ID',
      required: {
        field: 'operation',
        value: ['get_interest', 'update_interest', 'delete_interest'],
      },
      condition: {
        field: 'operation',
        value: ['get_interest', 'update_interest', 'delete_interest'],
      },
    },
    {
      id: 'interestName',
      title: 'Interest Name',
      type: 'short-input',
      placeholder: 'Interest name',
      required: {
        field: 'operation',
        value: ['create_interest'],
      },
      condition: {
        field: 'operation',
        value: ['create_interest', 'update_interest'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a name for a Mailchimp interest option based on the user's description.

Interests are individual options within an interest category.

### GUIDELINES
- Make it clear and specific
- Keep it concise
- Use Title Case

### EXAMPLES
"Weekly email updates" -> "Weekly Updates"
"Product announcements" -> "Product Announcements"
"Special offers" -> "Special Offers & Promotions"

Return ONLY the interest name - no explanations.`,
        placeholder: 'Describe the interest...',
      },
    },
    // Landing page fields
    {
      id: 'pageId',
      title: 'Landing Page ID',
      type: 'short-input',
      placeholder: 'Landing page ID',
      required: {
        field: 'operation',
        value: [
          'get_landing_page',
          'update_landing_page',
          'delete_landing_page',
          'publish_landing_page',
          'unpublish_landing_page',
        ],
      },
      condition: {
        field: 'operation',
        value: [
          'get_landing_page',
          'update_landing_page',
          'delete_landing_page',
          'publish_landing_page',
          'unpublish_landing_page',
        ],
      },
    },
    {
      id: 'landingPageTitle',
      title: 'Landing Page Title',
      type: 'short-input',
      placeholder: 'Landing page title',
      condition: {
        field: 'operation',
        value: ['create_landing_page', 'update_landing_page'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a title for a Mailchimp landing page based on the user's description.

### GUIDELINES
- Make it compelling and action-oriented
- Keep it concise
- Focus on the value proposition

### EXAMPLES
"Newsletter signup page" -> "Join Our Newsletter"
"Free ebook download" -> "Download Your Free Guide"
"Event registration" -> "Register for Our Exclusive Event"

Return ONLY the landing page title - no explanations.`,
        placeholder: 'Describe the landing page...',
      },
    },
    {
      id: 'landingPageType',
      title: 'Landing Page Type',
      type: 'dropdown',
      options: [
        { label: 'Signup', id: 'signup' },
        { label: 'Click Through', id: 'click-through' },
      ],
      required: {
        field: 'operation',
        value: ['create_landing_page'],
      },
      condition: {
        field: 'operation',
        value: ['create_landing_page'],
      },
    },
    // Batch operation fields
    {
      id: 'batchId',
      title: 'Batch ID',
      type: 'short-input',
      placeholder: 'Batch operation ID',
      required: {
        field: 'operation',
        value: ['get_batch_operation', 'delete_batch_operation'],
      },
      condition: {
        field: 'operation',
        value: ['get_batch_operation', 'delete_batch_operation'],
      },
    },
    {
      id: 'operations',
      title: 'Operations',
      type: 'long-input',
      placeholder: 'JSON array of operations with method, path, body, etc.',
      required: {
        field: 'operation',
        value: ['create_batch_operation'],
      },
      condition: {
        field: 'operation',
        value: ['create_batch_operation'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of batch operations for Mailchimp based on the user's description.

### OPERATION OBJECT FORMAT
- method: HTTP method (GET, POST, PUT, PATCH, DELETE)
- path: API endpoint path
- operation_id: Unique identifier for the operation
- body: Request body (for POST/PUT/PATCH)

### EXAMPLE OUTPUT
[
  {"method": "POST", "path": "/lists/abc123/members", "operation_id": "add_member_1", "body": {"email_address": "user@example.com", "status": "subscribed"}},
  {"method": "POST", "path": "/lists/abc123/members", "operation_id": "add_member_2", "body": {"email_address": "user2@example.com", "status": "subscribed"}}
]

Return ONLY the JSON array - no explanations or markdown.`,
        placeholder: 'Describe the batch operations...',
        generationType: 'json-object',
      },
    },
    // Pagination and filtering
    {
      id: 'count',
      title: 'Count',
      type: 'short-input',
      placeholder: 'Number of results (default: 10, max: 1000)',
      condition: {
        field: 'operation',
        value: [
          'get_audiences',
          'get_members',
          'get_campaigns',
          'get_automations',
          'get_templates',
          'get_campaign_reports',
          'get_segments',
          'get_segment_members',
          'get_merge_fields',
          'get_interest_categories',
          'get_interests',
          'get_landing_pages',
          'get_batch_operations',
        ],
      },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: 'Number of results to skip',
      condition: {
        field: 'operation',
        value: [
          'get_audiences',
          'get_members',
          'get_campaigns',
          'get_automations',
          'get_templates',
          'get_campaign_reports',
          'get_segments',
          'get_segment_members',
          'get_merge_fields',
          'get_interest_categories',
          'get_interests',
          'get_landing_pages',
          'get_batch_operations',
        ],
      },
    },
  ],
  tools: {
    access: [
      'mailchimp_get_audiences',
      'mailchimp_get_audience',
      'mailchimp_create_audience',
      'mailchimp_update_audience',
      'mailchimp_delete_audience',
      'mailchimp_get_members',
      'mailchimp_get_member',
      'mailchimp_add_member',
      'mailchimp_add_or_update_member',
      'mailchimp_update_member',
      'mailchimp_delete_member',
      'mailchimp_archive_member',
      'mailchimp_unarchive_member',
      'mailchimp_get_campaigns',
      'mailchimp_get_campaign',
      'mailchimp_create_campaign',
      'mailchimp_update_campaign',
      'mailchimp_delete_campaign',
      'mailchimp_send_campaign',
      'mailchimp_schedule_campaign',
      'mailchimp_unschedule_campaign',
      'mailchimp_replicate_campaign',
      'mailchimp_get_campaign_content',
      'mailchimp_set_campaign_content',
      'mailchimp_get_automations',
      'mailchimp_get_automation',
      'mailchimp_start_automation',
      'mailchimp_pause_automation',
      'mailchimp_add_subscriber_to_automation',
      'mailchimp_get_templates',
      'mailchimp_get_template',
      'mailchimp_create_template',
      'mailchimp_update_template',
      'mailchimp_delete_template',
      'mailchimp_get_campaign_reports',
      'mailchimp_get_campaign_report',
      'mailchimp_get_segments',
      'mailchimp_get_segment',
      'mailchimp_create_segment',
      'mailchimp_update_segment',
      'mailchimp_delete_segment',
      'mailchimp_get_segment_members',
      'mailchimp_add_segment_member',
      'mailchimp_remove_segment_member',
      'mailchimp_get_member_tags',
      'mailchimp_add_member_tags',
      'mailchimp_remove_member_tags',
      'mailchimp_get_merge_fields',
      'mailchimp_get_merge_field',
      'mailchimp_create_merge_field',
      'mailchimp_update_merge_field',
      'mailchimp_delete_merge_field',
      'mailchimp_get_interest_categories',
      'mailchimp_get_interest_category',
      'mailchimp_create_interest_category',
      'mailchimp_update_interest_category',
      'mailchimp_delete_interest_category',
      'mailchimp_get_interests',
      'mailchimp_get_interest',
      'mailchimp_create_interest',
      'mailchimp_update_interest',
      'mailchimp_delete_interest',
      'mailchimp_get_landing_pages',
      'mailchimp_get_landing_page',
      'mailchimp_create_landing_page',
      'mailchimp_update_landing_page',
      'mailchimp_delete_landing_page',
      'mailchimp_publish_landing_page',
      'mailchimp_unpublish_landing_page',
      'mailchimp_get_batch_operations',
      'mailchimp_get_batch_operation',
      'mailchimp_create_batch_operation',
      'mailchimp_delete_batch_operation',
    ],
    config: {
      tool: (params) => {
        return `mailchimp_${params.operation}`
      },
      params: (params) => {
        const { apiKey, operation, ...rest } = params
        const cleanParams: Record<string, any> = { apiKey }

        Object.entries(rest).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== '') {
            cleanParams[key] = value
          }
        })
        return cleanParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Mailchimp API key with server prefix' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: { type: 'json', description: 'Operation result data' },
  },
}
