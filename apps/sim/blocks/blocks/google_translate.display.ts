import { GoogleTranslateIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const GoogleTranslateBlockDisplay = {
  type: 'google_translate',
  name: 'Google Translate',
  description: 'Translate text using Google Cloud Translation',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GoogleTranslateIcon,
  longDescription:
    'Translate and detect languages using the Google Cloud Translation API. Supports auto-detection of the source language.',
  docsLink: 'https://docs.sim.ai/integrations/google_translate',
  integrationType: IntegrationType.AI,
} satisfies BlockDisplay

export const GoogleTranslateBlockMeta = {
  tags: ['google-workspace', 'content-management', 'automation'],
  url: 'https://cloud.google.com/translate',
  templates: [
    {
      icon: GoogleTranslateIcon,
      title: 'Google Translate doc localizer',
      prompt:
        'Create a workflow that watches a Google Drive folder of source-language docs, translates each into target languages with Google Translate while preserving structure, and writes the localized files back.',
      modules: ['files', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['content', 'enterprise'],
      alsoIntegrations: ['google_drive'],
    },
    {
      icon: GoogleTranslateIcon,
      title: 'Multilingual support replier',
      prompt:
        'Build a workflow that detects the language of a new Intercom message, translates it to the agent language with Google Translate, drafts a reply, then translates the reply back before sending.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'communication'],
      alsoIntegrations: ['intercom'],
    },
    {
      icon: GoogleTranslateIcon,
      title: 'Google Translate + Hugging Face confidence',
      prompt:
        'Create a workflow that runs Google Translate then scores translation quality with a Hugging Face model, flags low-confidence segments for human review, and writes the scored output.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['content', 'enterprise'],
      alsoIntegrations: ['huggingface'],
    },
    {
      icon: GoogleTranslateIcon,
      title: 'Google Translate + Mistral Parser localization',
      prompt:
        'Build a workflow that uses Mistral Parser to extract structured content from source-language PDFs and Google Translate to localize each section while preserving structure.',
      modules: ['files', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['content', 'enterprise'],
      alsoIntegrations: ['mistral_parse'],
    },
    {
      icon: GoogleTranslateIcon,
      title: 'Google Translate Confluence localization',
      prompt:
        'Create a workflow that watches Confluence pages tagged for localization, translates each into the target languages with Google Translate, and publishes localized copies.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['content', 'enterprise'],
      alsoIntegrations: ['confluence'],
    },
    {
      icon: GoogleTranslateIcon,
      title: 'Multilingual support replies',
      prompt:
        "Build a workflow that on a new support ticket detects the customer's language with Google Translate, translates the message to English for the agent, drafts a reply, then translates the response back into the customer's language before sending.",
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'communication', 'automation'],
    },
    {
      icon: GoogleTranslateIcon,
      title: 'Slack channel translator',
      prompt:
        "Create a workflow that watches an international Slack channel, detects non-English messages with Google Translate, translates them to the team's language, and posts the translation in a thread so everyone stays in the loop.",
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'communication'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'translate-to-language',
      description:
        'Translate a block of text into a target language using Google Cloud Translation.',
      content:
        '# Translate To Language\n\nTranslate text into a specified target language.\n\n## Steps\n1. Take the source text and the target language code (e.g. es, fr, ja).\n2. If the source language is unknown, detect it first; otherwise pass it explicitly for accuracy.\n3. Call translate text with the target language and capture the translated output.\n4. For long content, split into paragraph-sized chunks and translate each to preserve formatting.\n\n## Output\nReturn the translated text along with the detected or supplied source language and the target language. Preserve line breaks from the original.',
    },
    {
      name: 'detect-and-route-language',
      description: 'Detect the language of incoming text and route or label it accordingly.',
      content:
        '# Detect and Route Language\n\nIdentify the language of a message so it can be routed, labeled, or translated.\n\n## Steps\n1. Call detect language on the input text and capture the language code and confidence.\n2. If confidence is low, fall back to detecting on a longer sample or flag as uncertain.\n3. Decide the route: if the detected language differs from the team language, translate it; otherwise pass through unchanged.\n\n## Output\nReturn the detected language code, confidence, and a recommended action (translate or pass-through). Include the translated text when translation was performed.',
    },
    {
      name: 'localize-message-set',
      description:
        'Translate one source message into several target languages for multilingual delivery.',
      content:
        '# Localize Message Set\n\nProduce localized versions of a single message for multiple audiences.\n\n## Steps\n1. Take the source text and the list of target language codes.\n2. For each target language, call translate text with the source language set explicitly for consistency.\n3. Keep placeholders, names, and URLs intact across all translations.\n\n## Output\nReturn a mapping of language code to translated text. Note any target language where translation appeared incomplete or unchanged.',
    },
  ],
} as const satisfies BlockMeta
