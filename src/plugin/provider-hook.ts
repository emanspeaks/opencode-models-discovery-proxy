import type { ProviderHook, ProviderHookContext } from '@opencode-ai/plugin'
import type { Model as ModelV2, Provider as ProviderV2 } from '@opencode-ai/sdk/v2'
import { fetchOpenCodeConfig, normalizeBaseURL } from '../utils/openai-compatible-api'
import { getModelRegexFilter, shouldDiscoverModel, type PluginConfig } from '../types/plugin-config'
import type { ToastNotifier } from '../ui/toast-notifier'
import type { PluginLogger } from './logger'

function mapModel(
  modelKey: string,
  remoteModel: any,
  remoteProvider: any,
  provider: ProviderV2
): ModelV2 {
  const inputModalities: string[] = remoteModel.modalities?.input ?? ['text']
  const outputModalities: string[] = remoteModel.modalities?.output ?? ['text']

  return {
    id: modelKey,
    providerID: provider.id,
    api: {
      id: modelKey,
      url: (provider.options?.baseURL as string) ?? '',
      npm: (remoteProvider.npm as string) ?? '@ai-sdk/openai-compatible',
    },
    name: (remoteModel.name as string) ?? modelKey,
    capabilities: {
      temperature: true,
      reasoning: (remoteModel.reasoning as boolean) ?? false,
      attachment: (remoteModel.attachment as boolean) ?? false,
      toolcall: (remoteModel.tool_call as boolean) ?? false,
      input: {
        text: inputModalities.includes('text'),
        audio: inputModalities.includes('audio'),
        image: inputModalities.includes('image'),
        video: inputModalities.includes('video'),
        pdf: inputModalities.includes('pdf'),
      },
      output: {
        text: outputModalities.includes('text'),
        audio: outputModalities.includes('audio'),
        image: outputModalities.includes('image'),
        video: outputModalities.includes('video'),
        pdf: outputModalities.includes('pdf'),
      },
      interleaved: false,
    },
    cost: {
      input: 0,
      output: 0,
      cache: { read: 0, write: 0 },
    },
    limit: {
      context: (remoteModel.limit?.context as number) ?? 4096,
      output: (remoteModel.limit?.output as number) ?? 4096,
    },
    status: 'active',
    options: {},
    headers: {},
    release_date: '',
  }
}

export function createProviderHook(
  pluginConfig: PluginConfig,
  toastNotifier: ToastNotifier,
  logger: PluginLogger
): ProviderHook {
  return {
    id: pluginConfig.provider,
    models: async (provider: ProviderV2, _ctx: ProviderHookContext) => {
      try {
        const baseURL = provider.options?.baseURL
        if (typeof baseURL !== 'string' || !baseURL) {
          logger.warn(`Provider ${pluginConfig.provider} has no baseURL configured`)
          return {}
        }

        const opencodeConfig = await fetchOpenCodeConfig(normalizeBaseURL(baseURL), provider.key)

        if (!opencodeConfig?.provider) {
          logger.debug(`No /v1/opencode response from provider ${pluginConfig.provider}`)
          return {}
        }

        const remoteProvider = (opencodeConfig.provider as Record<string, any>)[pluginConfig.provider]
        if (!remoteProvider) {
          logger.debug(`Provider ${pluginConfig.provider} not found in /v1/opencode response`)
          return {}
        }

        const remoteModels: Record<string, any> = remoteProvider.models ?? {}
        const modelRegexFilter = getModelRegexFilter(pluginConfig, logger.child({ category: 'filtering' }))
        const discoveredModels: Record<string, ModelV2> = {}

        for (const [modelKey, modelConfig] of Object.entries(remoteModels)) {
          if (!shouldDiscoverModel(modelKey, modelRegexFilter)) continue
          discoveredModels[modelKey] = mapModel(modelKey, modelConfig as any, remoteProvider, provider)
        }

        const count = Object.keys(discoveredModels).length
        if (count > 0) {
          logger.info(`Discovered ${count} models for provider ${pluginConfig.provider}`)
        }
        return discoveredModels
      } catch (error) {
        logger.error('Provider model discovery failed', {
          error: error instanceof Error ? error.message : String(error),
        })
        toastNotifier.warning('Model discovery failed', 'Discovery Error').catch(() => {})
        return {}
      }
    },
  }
}
