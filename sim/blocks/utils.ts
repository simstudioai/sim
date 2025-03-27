import { SubBlockState } from '@/stores/workflows/workflow/types'
import { BlockOutput, OutputConfig } from '@/blocks/types'

interface CodeLine {
  id: string
  content: string
}

function isEmptyValue(value: SubBlockState['value']): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (typeof value === 'number') return false
  if (Array.isArray(value)) {
    // Handle code editor's array of lines format
    if (value.length === 0) return true
    if (isCodeEditorValue(value)) {
      return value.every((line: any) => !line.content.trim())
    }
    return value.length === 0
  }
  return false
}

function isCodeEditorValue(value: any[]): value is CodeLine[] {
  return value.length > 0 && 'id' in value[0] && 'content' in value[0]
}

export function resolveOutputType(
  outputs: Record<string, OutputConfig>,
  subBlocks: Record<string, SubBlockState>
): Record<string, BlockOutput> {
  const resolvedOutputs: Record<string, BlockOutput> = {}

  for (const [key, outputConfig] of Object.entries(outputs)) {
    // If no dependencies, use the type directly
    if (!outputConfig.dependsOn) {
      resolvedOutputs[key] = outputConfig.type
      continue
    }

    // Handle dependent output types
    const subBlock = subBlocks[outputConfig.dependsOn.subBlockId]
    resolvedOutputs[key] = isEmptyValue(subBlock?.value)
      ? outputConfig.dependsOn.condition.whenEmpty
      : outputConfig.dependsOn.condition.whenFilled
  }

  return resolvedOutputs
}

export function processDallEResponse(response: any) {
  if (!response.data || !response.data.length) {
    throw new Error('Invalid DALL-E response: missing data field');
  }

  const imageData = response.data[0];
  
  if (!imageData.url) {
    throw new Error('Invalid DALL-E response: no image URL found');
  }
  
  return {
    imageUrl: imageData.url,
    provider: 'DALL-E',
    metadata: {
      prompt: imageData.revised_prompt || response.prompt,
      model: response.model || 'dall-e-2' || 'dall-e-3',
      width: parseInt((response.size || '1024x1024').split('x')[0]) || 1024,
      height: parseInt((response.size || '1024x1024').split('x')[1]) || 1024,
      format: 'url',
      quality: response.quality || 'standard',
      style: response.style || 'vivid',
    }
  };
}

// Process Stable Diffusion response
export function processStableDiffusionResponse(response: any) {
  if (!response.artifacts || !response.artifacts.length) {
    throw new Error('Invalid Stable Diffusion response: missing artifacts');
  }

  const artifact = response.artifacts[0];
  
  // Handle both URL and base64 formats
  let imageUrl = artifact.url;
  if (!imageUrl && artifact.base64) {
    const format = artifact.finish_reason === 'SUCCESS' ? 'png' : 'webp';
    imageUrl = `data:image/${format};base64,${artifact.base64}`;
  }
  
  if (!imageUrl) {
    throw new Error('Invalid Stable Diffusion response: no image data found');
  }

  return {
    imageUrl,
    provider: 'Stable Diffusion',
    metadata: {
      prompt: artifact.prompt?.text || artifact.prompt,
      seed: artifact.seed,
      width: artifact.width,
      height: artifact.height,
      model: response.model || 'stable-diffusion-xl',
      format: imageUrl.startsWith('data:') ? 'base64' : 'url',
      steps: response.steps,
      cfgScale: response.cfg_scale,
    }
  };
}

// Process Midjourney response (example for third-party API)
export function processMidjourneyResponse(response: any) {
  if (!response.result || !response.result.imageUrl) {
    throw new Error('Invalid Midjourney response: missing image URL');
  }

  return {
    imageUrl: response.result.imageUrl,
    provider: 'Midjourney',
    metadata: {
      prompt: response.prompt || '',
      width: response.width || 1024,
      height: response.height || 1024,
      model: response.version || 'v5',
      format: response.format || 'png',
      jobId: response.result.jobId,
    }
  };
}

// Main processor function that determines the appropriate parser based on provider
export function processImageGenerationResponse(response: any, provider: string) {
  console.log(`Processing ${provider} response:`, response);
  
  switch (provider) {
    case 'DALL-E':
      return processDallEResponse(response);
    case 'Stable Diffusion':
      return processStableDiffusionResponse(response);
    case 'Midjourney':
      return processMidjourneyResponse(response);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

// Error handler for image generation APIs
export function handleImageGenerationError(error: any, provider: string) {
  console.error(`${provider} image generation error:`, error);
  
  // Extract useful error information based on provider
  let errorMessage = `${provider} image generation failed: `;
  
  if (error.response) {
    // Handle structured API errors
    if (provider === 'DALL-E' && error.response.data?.error) {
      errorMessage += error.response.data.error.message || JSON.stringify(error.response.data.error);
    } else if (provider === 'Stable Diffusion' && error.response.data?.message) {
      errorMessage += error.response.data.message;
    } else {
      // Generic error response handling
      errorMessage += JSON.stringify(error.response.data || 'Unknown API error');
    }
  } else if (error.message) {
    // Handle standard errors
    errorMessage += error.message;
  } else {
    // Fallback for unknown error formats
    errorMessage += 'Unknown error occurred';
  }
  
  return {
    error: true,
    message: errorMessage,
    provider,
  };
}