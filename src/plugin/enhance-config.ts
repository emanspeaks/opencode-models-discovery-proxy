import { ToastNotifier } from '../ui/toast-notifier'
import { normalizeBaseURL, fetchOpenCodeConfig, canDiscoverModels } from '../utils/openai-compatible-api'
import { getProviderFilter, getDiscoveryConfig, getModelRegexFilter, getProviderModelRegexFilter, shouldDiscoverModel, shouldDiscoverProviderWithOverride } from '../types/plugin-config'
import type { PluginLogger } from './logger'
import type { PluginInput } from '@opencode-ai/plugin'
import type { PluginConfig } from '../types/plugin-config'

export async function enhanceConfig(
  config: any,
  client: PluginInput['client'],
  toastNotifier: ToastNotifier,
  pluginConfig: PluginConfig,
  logger: PluginLogger
): Promise<void> {
  try {
    const providers = config.provider || {}
    const discoveredProviders: { name: string; baseURL: string; modelCount: number }[] = []
    const providerFilter = getProviderFilter(pluginConfig)
    const modelRegexFilter = getModelRegexFilter(pluginConfig, logger.child({ category: 'filtering' }))
    const discoveryConfig = getDiscoveryConfig(pluginConfig)
    const globalDiscoveryEnabled = discoveryConfig.enabled

    for (const [providerName, providerConfig] of Object.entries(providers)) {
      const p = providerConfig as any
      const providerDiscoveryConfig = p.options?.modelsDiscovery ?? {}

      if (!canDiscoverModels(p)) {
        continue
      }

      if (!shouldDiscoverProviderWithOverride(providerName, providerFilter, globalDiscoveryEnabled, providerDiscoveryConfig)) {
        logger.debug(`Provider ${providerName} model discovery disabled by configuration`)
        continue
      }

      let baseURL: string
      if (p.options?.baseURL) {
        baseURL = normalizeBaseURL(p.options.baseURL)
      } else {
        continue
      }

      const apiKey = p.options?.apiKey
      const opencodeConfig = await fetchOpenCodeConfig(baseURL, apiKey)

      if (!opencodeConfig?.provider) {
        continue
      }

      const existingModels = p.models || {}
      const discoveredModels: Record<string, any> = {}

      const hasProviderModelRegexFilter = !!providerDiscoveryConfig.models?.includeRegex?.length || !!providerDiscoveryConfig.models?.excludeRegex?.length
      const providerModelRegexFilter = getProviderModelRegexFilter(providerDiscoveryConfig, logger.child({ category: 'filtering' }))

      const remoteProvider = (opencodeConfig.provider as Record<string, any>)[providerName]
      if (!remoteProvider) {
        logger.debug(`Provider ${providerName} not found in remote /v1/opencode response — skipping`)
        continue
      }
      const remoteModels: Record<string, any> = remoteProvider?.models || {}
      for (const [modelKey, modelConfig] of Object.entries(remoteModels)) {
        if (existingModels[modelKey]) {
          continue
        }
        const activeModelRegexFilter = hasProviderModelRegexFilter ? providerModelRegexFilter : modelRegexFilter
        if (!shouldDiscoverModel(modelKey, activeModelRegexFilter)) {
          continue
        }
        discoveredModels[modelKey] = modelConfig
      }

      if (Object.keys(discoveredModels).length > 0) {
        p.models = {
          ...existingModels,
          ...discoveredModels,
        }

        discoveredProviders.push({
          name: providerName,
          baseURL,
          modelCount: Object.keys(discoveredModels).length,
        })
      }
    }

    if (discoveredProviders.length > 0) {
      const totalModels = discoveredProviders.reduce((sum, p) => sum + p.modelCount, 0)
      logger.info('Provider model discovery completed', {
        providerCount: discoveredProviders.length,
        modelCount: totalModels,
      })
    }

  } catch (error) {
    logger.error('Unexpected error in enhanceConfig', {
      error: error instanceof Error ? error.message : String(error),
    })
    toastNotifier.warning("Plugin configuration failed", "Configuration Error").catch(() => { })
  }
}
