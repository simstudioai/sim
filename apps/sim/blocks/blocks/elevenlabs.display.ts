import { ElevenLabsIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const ElevenLabsBlockDisplay = {
  type: 'elevenlabs',
  name: 'ElevenLabs',
  description: 'Convert text to speech with ElevenLabs',
  category: 'tools',
  bgColor: '#181C1E',
  icon: ElevenLabsIcon,
  longDescription: 'Integrate ElevenLabs into the workflow. Can convert text to speech.',
  docsLink: 'https://docs.sim.ai/integrations/elevenlabs',
  integrationType: IntegrationType.AI,
} satisfies BlockDisplay

export const ElevenLabsBlockMeta = {
  tags: ['text-to-speech'],
  url: 'https://elevenlabs.io',
  templates: [
    {
      icon: ElevenLabsIcon,
      title: 'ElevenLabs blog-to-podcast',
      prompt:
        'Build a workflow that takes a blog post, narrates it with an ElevenLabs voice, saves the audio file, and posts a player-ready link to the marketing Slack channel.',
      modules: ['agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ElevenLabsIcon,
      title: 'Customer voice greeting generator',
      prompt:
        'Create a workflow that reads a table of new enterprise customers, generates a personalized ElevenLabs voice greeting with their account manager voice, and emails the audio file to the customer on day one.',
      modules: ['tables', 'agent', 'files', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: ElevenLabsIcon,
      title: 'ElevenLabs IVR builder',
      prompt:
        'Build a workflow that generates branded ElevenLabs voice prompts from a tables-driven script, saves each clip as a file, and lists the bundle so it can be wired into the phone tree.',
      modules: ['tables', 'files', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation'],
    },
    {
      icon: ElevenLabsIcon,
      title: 'ElevenLabs + Pulse meeting voice digest',
      prompt:
        'Build a workflow that takes Pulse meeting insights, narrates them with an ElevenLabs voice, and emails the audio digest to the team for asynchronous review.',
      modules: ['agent', 'files', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['pulse', 'gmail'],
    },
    {
      icon: ElevenLabsIcon,
      title: 'ElevenLabs daily voice digest',
      prompt:
        'Build a scheduled daily workflow that generates an ElevenLabs voice digest of the day’s key metrics, saves the audio, and Slacks the player link to leadership.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['founder', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ElevenLabsIcon,
      title: 'ElevenLabs release-notes narrator',
      prompt:
        "Create a workflow that takes new product release notes, rewrites them into a natural spoken script with an agent, generates narration with ElevenLabs text-to-speech, and saves the audio file ready to share as a what's-new update.",
      modules: ['agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content'],
    },
    {
      icon: ElevenLabsIcon,
      title: 'ElevenLabs voicemail responder',
      prompt:
        'Build a workflow that on a new inbound message drafts a short personalized reply with an agent, converts it to speech with ElevenLabs in a chosen voice, and saves the audio so it can be sent as a voice note to the customer.',
      modules: ['agent', 'files', 'workflows'],
      category: 'support',
      tags: ['support', 'communication', 'automation'],
    },
  ],
  skills: [
    {
      name: 'narrate-text-to-speech',
      description:
        'Convert a block of text into natural-sounding speech audio with a chosen ElevenLabs voice.',
      content:
        '# Narrate Text to Speech\n\nGenerate spoken audio from text using ElevenLabs.\n\n## Steps\n1. Take the text to narrate and confirm the target voice ID (ask for one if not provided).\n2. Pick a model — use a multilingual model for non-English or mixed-language text, or a turbo/flash model when low latency matters.\n3. For consistent delivery, set stability higher; for more expressive variation, set it lower. Raise similarity boost to stay closer to the reference voice.\n\n## Output\nReturn the generated audio file and its URL. Confirm the voice and model used so the requester can adjust if the delivery is not right.',
    },
    {
      name: 'narrate-article-as-audio',
      description: 'Turn a long article or blog post into a podcast-style audio narration.',
      content:
        '# Narrate Article as Audio\n\nProduce a listenable audio version of written content.\n\n## Steps\n1. Clean the source text — strip markdown, navigation, and boilerplate so only the readable prose remains. Expand abbreviations the voice should speak in full.\n2. Choose a voice ID suited to the content and a high-quality multilingual model for natural delivery.\n3. Convert the cleaned text to speech, keeping stability moderate so the narration sounds engaging but consistent.\n\n## Output\nReturn the audio file and a player-ready URL, along with the voice used. If the text is very long, note any truncation and suggest splitting it into parts.',
    },
    {
      name: 'generate-voice-prompt',
      description:
        'Generate a short branded voice clip such as an IVR prompt, greeting, or notification.',
      content:
        '# Generate Voice Prompt\n\nCreate a short, polished voice clip for things like phone menus, greetings, or alerts.\n\n## Steps\n1. Take the exact script for the prompt. Keep it concise and confirm pronunciation of any names or numbers.\n2. Select a consistent brand voice ID so every prompt sounds the same.\n3. Set stability high for a steady, professional delivery and convert the script to speech.\n\n## Output\nReturn the audio file and its URL. When generating a set of prompts, list each clip with its script so they can be wired into the phone tree or app.',
    },
  ],
} as const satisfies BlockMeta
