import { ToolConfig } from '../types'
import { ImageGenerationParams, ImageGenerationResponse } from './types'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('Image Generation')

export const imageGenerationTool: ToolConfig<ImageGenerationParams, ImageGenerationResponse> = {
  id: 'image_generation',
  name: 'Image Generation',
  description: 'Generate images using DALL-E',
  version: '1.0.0',
  params: {
    prompt: {
      type: 'string',
      required: true,
      description: 'The prompt to generate the image from',
    },
    model: {
      type: 'string',
      required: false,
      description: 'The model to use for image generation (dall-e-2 or dall-e-3)',
    },
    resolution: {
      type: 'string',
      required: false,
      description: 'The resolution of the generated image',
    },
    quality: {
      type: 'string',
      required: false,
      description: 'The quality of the generated image (standard or hd)',
    },
    style: {
      type: 'string',
      required: false,
      description: 'The style of the generated image (vivid or natural)',
    },
    n: {
      type: 'number',
      required: false,
      description: 'Number of images to generate',
    },
    apiKey: {
      type: 'string',
      required: true,
      description: 'Your OpenAI API key',
    },
  },
  request: {
    url: () => 'https://api.openai.com/v1/images/generations',
    method: 'POST',
    headers: (params: ImageGenerationParams) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.apiKey}`
    }),
    body: (params: ImageGenerationParams) => {
      const model = params.model || 'dall-e-3';
      const baseBody = {
        model,
        prompt: params.prompt,
        n: params.n || 1,
      };

      if (model === 'dall-e-3') {
        return {
          ...baseBody,
          size: params.resolution || '1024x1024',
          quality: params.quality || 'standard',
          style: params.style || 'vivid'
        };
      }

      return {
        ...baseBody,
        size: params.resolution || '1024x1024'
      };
    }
  },
  validate: async (params: ImageGenerationParams): Promise<boolean> => {
    if (!params.prompt || !params.apiKey) {
      throw new Error('Missing required fields: prompt and apiKey are required');
    }

    // Validate API key format
    if (!params.apiKey.startsWith('sk-')) {
      throw new Error('Invalid API key format: must start with "sk-"');
    }

    // Validate model
    if (params.model && !['dall-e-2', 'dall-e-3'].includes(params.model)) {
      throw new Error('Invalid model: only dall-e-2 and dall-e-3 are supported');
    }

    // Validate resolution based on model
    const model = params.model || 'dall-e-3';
    if (model === 'dall-e-3') {
      const validResolutions = ['1024x1024', '1024x1792', '1792x1024'];
      if (params.resolution && !validResolutions.includes(params.resolution)) {
        throw new Error(`Invalid resolution for DALL-E 3. Must be one of: ${validResolutions.join(', ')}`);
      }
    } else {
      const validResolutions = ['256x256', '512x512', '1024x1024'];
      if (params.resolution && !validResolutions.includes(params.resolution)) {
        throw new Error(`Invalid resolution for DALL-E 2. Must be one of: ${validResolutions.join(', ')}`);
      }
    }

    // Validate quality (only for DALL-E 3)
    if (model === 'dall-e-3' && params.quality && !['standard', 'hd'].includes(params.quality)) {
      throw new Error('Invalid quality for DALL-E 3. Must be either "standard" or "hd"');
    }

    // Validate style (only for DALL-E 3)
    if (model === 'dall-e-3' && params.style && !['vivid', 'natural'].includes(params.style)) {
      throw new Error('Invalid style for DALL-E 3. Must be either "vivid" or "natural"');
    }

    // Validate number of images
    if (params.n !== undefined) {
      if (model === 'dall-e-3' && params.n !== 1) {
        throw new Error('Invalid number of images: DALL-E 3 only supports n=1');
      }
      if (model === 'dall-e-2' && (params.n < 1 || params.n > 10)) {
        throw new Error('Invalid number of images: DALL-E 2 supports n=1 to 10');
      }
    }

    return true;
  },
  transformResponse: async (response: Response, params?: ImageGenerationParams): Promise<ImageGenerationResponse> => {
    const result = await response.json();
    
    logger.info('Image generation response:', {
      result,
      params
    });

    return {
      success: true,
      output: {
        content: result.data?.[0]?.url || '',
        model: params?.model || 'dall-e-3',
        provider: 'DALL-E',
        metadata: {
          created: result.created,
          revisedPrompt: params?.model === 'dall-e-3' ? result.data?.[0]?.revised_prompt : undefined,
          prompt: params?.prompt,
        },
      },
    };
  },
  transformError: async (error: any): Promise<ImageGenerationResponse> => {
    logger.error('Image generation error:', {
      status: error.status,
      statusText: error.statusText,
      message: error.message,
      data: error.data,
      timestamp: new Date().toISOString(),
    });

    if (error.data?.error?.code) {
      const code = error.data.error.code;
      switch (code) {
        case 'invalid_api_key':
          throw new Error('Invalid API key. Please check your OpenAI API key.');
        case 'content_policy_violation':
          throw new Error('Content policy violation. Please modify your prompt.');
        case 'invalid_model':
          throw new Error('Invalid model specified.');
        case 'invalid_resolution':
          throw new Error('Invalid resolution specified.');
        case 'rate_limit_exceeded':
          throw new Error('Rate limit exceeded. Please wait before trying again.');
        case 'insufficient_quota':
          throw new Error('Insufficient quota. Please check your account balance.');
      }
    }

    // Handle HTTP status codes
    if (error.status === 401) {
      throw new Error('Authentication failed. Please check your API key.');
    }
    if (error.status === 403) {
      throw new Error('Access denied. Please check your API key permissions.');
    }
    if (error.status === 400) {
      throw new Error('Invalid request. Please check your parameters.');
    }
    if (error.status >= 500) {
      throw new Error('Server error. Please try again later.');
    }

    throw new Error(
      `Image generation failed: ${error.message || error.statusText || 'Unknown error'}`
    );
  }
};

export default imageGenerationTool; 