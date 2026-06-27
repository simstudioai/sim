/**
 * Yandex Metrica Block Configuration
 */

import { BlockConfig, BlockMeta } from '@sim/workflow-types';

export const yandexMetricaBlock: BlockConfig = {
  type: 'yandex_metrica',
  name: 'Yandex Metrica',
  category: 'tools',
  integrationType: 'Analytics',
  authMode: 'OAuth',
  bgColor: '#FFCC00',

  subBlocks: [
    {
      id: 'method',
      type: 'dropdown',
      title: 'Method',
      required: true,
      visibility: 'user-or-llm',
      mode: 'basic',
    },
    {
      id: 'counter_id',
      type: 'short-input',
      title: 'Counter ID',
      required: true,
      visibility: 'user-or-llm',
      mode: 'basic',
      description: 'Yandex Metrica counter ID',
    },
  ],

  tools: {
    access: [
      'yandex_metrica_get_data',
      'yandex_metrica_get_goals',
      'yandex_metrica_create_goal',
      'yandex_metrica_get_filters',
      'yandex_metrica_get_segments',
      // Add all 15 methods here
    ],
    config: {
      tool: '${method}',
      params: {
        counter_id: '${counter_id}',
      },
    },
  },

  triggers: {
    available: ['yandex_metrica_webhook'],
  },
};

export const yandexMetricaBlockMeta: BlockMeta = {
  tags: ['Analytics', 'Tracking', 'Data'],
  templates: [
    {
      name: 'Daily Analytics Report',
      prompt: 'Build a workflow that pulls daily analytics from Yandex Metrica and sends to email',
    },
    {
      name: 'Goal Tracking Dashboard',
      prompt: 'Create a workflow that fetches goal conversion data every hour',
    },
    {
      name: 'User Segment Analysis',
      prompt: 'Build a workflow that analyzes user segments and exports to CSV',
    },
  ],
  skills: [
    { title: 'Get Analytics Data', action: 'yandex_metrica_get_data' },
    { title: 'List Goals', action: 'yandex_metrica_get_goals' },
    { title: 'Create Goal', action: 'yandex_metrica_create_goal' },
    { title: 'Get Filters', action: 'yandex_metrica_get_filters' },
    { title: 'Get Segments', action: 'yandex_metrica_get_segments' },
  ],
};
