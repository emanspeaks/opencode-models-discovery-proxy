import type { Config } from '@opencode-ai/plugin'
import { fetchOpenCodeConfig, normalizeBaseURL } from '../utils/openai-compatible-api'
import { getModelRegexFilter, shouldDiscoverModel, type PluginConfig } from '../types/plugin-config'
import type { ToastNotifier } from '../ui/toast-notifier'
import type { PluginLogger } from './logger'

export function createConfigHook(
  pluginConfig: PluginConfig,
  toastNotifier: ToastNotifier,
  logger: PluginLogger
) {
  return async (config: Config): Promise<void> => {
    try {
      const providerConfig = config.provider?.[pluginConfig.provider]
      const baseURL = providerConfig?.options?.baseURL

      if (typeof baseURL !== 'string' || !baseURL) {
        logger.warn(`Provider ${pluginConfig.provider} has no baseURL configured`)
        return
      }

      const apiKey = providerConfig?.options?.apiKey
      const opencodeConfig = await fetchOpenCodeConfig(
        normalizeBaseURL(baseURL),
        typeof apiKey === 'string' ? apiKey : undefined
      )

      if (!opencodeConfig?.provider) {
        logger.debug(`No /v1/opencode response from provider ${pluginConfig.provider}`)
        return
      }

      const remoteProvider = (opencodeConfig.provider as Record<string, any>)[pluginConfig.provider]
      if (!remoteProvider) {
        logger.debug(`Provider ${pluginConfig.provider} not found in /v1/opencode response`)
        return
      }

      const remoteModels: Record<string, any> = remoteProvider.models ?? {}
      const modelRegexFilter = getModelRegexFilter(pluginConfig, logger.child({ category: 'filtering' }))
      const discoveredModels: Record<string, any> = {}

      for (const [modelKey, modelConfig] of Object.entries(remoteModels)) {
        if (!shouldDiscoverModel(modelKey, modelRegexFilter)) continue

        const { name, tool_call, reasoning, attachment, limit, modalities } = modelConfig as any
        discoveredModels[modelKey] = {
          name: name ?? modelKey,
          ...(tool_call !== undefined && { tool_call }),
          ...(reasoning !== undefined && { reasoning }),
          ...(attachment !== undefined && { attachment }),
          ...(limit && { limit }),
          ...(modalities && { modalities }),
        }
      }

      const count = Object.keys(discoveredModels).length
      if (count === 0) {
        logger.debug(`No models discovered for provider ${pluginConfig.provider}`)
        return
      }

      if (!config.provider) config.provider = {}
      const existing = config.provider[pluginConfig.provider] ?? {}
      config.provider[pluginConfig.provider] = {
        ...existing,
        models: { ...existing.models, ...discoveredModels },
      }

      logger.info(`Injected ${count} models for provider ${pluginConfig.provider}`)
    } catch (error) {
      logger.error('Provider model discovery failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      toastNotifier.warning('Model discovery failed', 'Discovery Error').catch(() => {})
    }
  }
}
