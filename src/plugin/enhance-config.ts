import { ModelStatusCache } from '../cache/model-status-cache'
import { ToastNotifier } from '../ui/toast-notifier'
import { categorizeModel, formatModelName, extractModelOwner } from '../utils'
import { normalizeBaseURL, checkProviderHealth, discoverModelsFromProvider, autoDetectOpenAICompatibleProvider, canDiscoverModels } from '../utils/openai-compatible-api'
import { getProviderFilter, getDiscoveryConfig, getModelRegexFilter, shouldDiscoverModel, shouldDiscoverProvider } from '../types/plugin-config'
import type { PluginLogger } from './logger'
import type { PluginInput } from '@opencode-ai/plugin'
import type { OpenAIModel } from '../types'
import type { PluginConfig } from '../types/plugin-config'

const modelStatusCache = new ModelStatusCache()

interface DiscoveredProvider {
  name: string
  baseURL: string
  models: Record<string, any>
}

export async function enhanceConfig(
  config: any,
  client: PluginInput['client'],
  toastNotifier: ToastNotifier,
  pluginConfig: PluginConfig,
  logger: PluginLogger
): Promise<void> {
  modelStatusCache.invalidateAll()

  try {
    const providers = config.provider || {}
    const openAICompatibleProviders: DiscoveredProvider[] = []
    const providerFilter = getProviderFilter(pluginConfig)
    const modelRegexFilter = getModelRegexFilter(pluginConfig, logger.child({ category: 'filtering' }))
    const discoveryConfig = getDiscoveryConfig(pluginConfig)


    const globalDiscoveryEnabled = discoveryConfig.enabled
    // Global discovery disabled, check the provider level discovery

    for (const [providerName, providerConfig] of Object.entries(providers)) {
      const p = providerConfig as any
      const discoveryConfigForProvider = p.options.modelsDiscovery || {}

      if (globalDiscoveryEnabled === false) { //global discovery disabled, check the provider level discovery
        if (discoveryConfigForProvider.enabled !== true) {
          logger.debug(`Provider ${providerName} model discovery disabled by configuration`)
          continue
        }
      }

      if (!canDiscoverModels(p)) {
        continue
      }

      // be careful, here we need to check both provider filter and provider level discovery
      // the p.options.modelsDiscovery has higher priority than provider filter
      if (!shouldDiscoverProvider(providerName, providerFilter) && !discoveryConfigForProvider.enabled) {
        logger.debug(`Provider ${providerName} model discovery disabled by filter configuration`)
        continue
      }

      let baseURL: string
      let displayName = providerName

      if (p.options?.baseURL) {
        baseURL = normalizeBaseURL(p.options.baseURL)
      } else {
        continue
      }

      const apiKey = p.options?.apiKey

      const isHealthy = await checkProviderHealth(baseURL, apiKey)
      if (!isHealthy) {
        // Provider offline - silent, this is normal for health checks
        continue
      }

      let models: OpenAIModel[]
      try {
        models = await discoverModelsFromProvider(baseURL, apiKey)
      } catch (error) {
        logger.warn('Provider model discovery failed', {
          provider: providerName,
          baseURL,
          error: error instanceof Error ? error.message : String(error),
        })
        continue
      }

      if (models.length === 0) {
        continue
      }

      const existingModels = p.models || {}
      const discoveredModels: Record<string, any> = {}
      let chatModelsCount = 0
      let embeddingModelsCount = 0

      // model level config
      const hasModelRegexFilterInProviderConfig = !!discoveryConfigForProvider.models?.includeRegex?.length || !!discoveryConfigForProvider.models?.excludeRegex?.length
      const modelRegexFilterInProviderConfig = getModelRegexFilter(discoveryConfigForProvider, logger.child({ category: 'filtering' }))
      let smartModelNameEnabled = discoveryConfigForProvider.smartModelName
      if (smartModelNameEnabled === undefined) {
        smartModelNameEnabled = pluginConfig.smartModelName
      }
      for (const model of models) {
        const modelKey = model.id
        if (!existingModels[modelKey]) {
          // if provider has model filter, use it, otherwise use global model filter
          if (hasModelRegexFilterInProviderConfig && !shouldDiscoverModel(model.id, modelRegexFilterInProviderConfig)
            || !hasModelRegexFilterInProviderConfig && !shouldDiscoverModel(model.id, modelRegexFilter)
          ) {
            continue
          }

          const modelType = categorizeModel(model.id)
          const owner = extractModelOwner(model.id)
          const modelConfig: any = {
            id: model.id,
            name: smartModelNameEnabled ? formatModelName(model) : model.id,
          }

          if (owner) {
            modelConfig.organizationOwner = owner
          }

          if (modelType === 'embedding') {
            embeddingModelsCount++
            modelConfig.modalities = {
              input: ["text"],
              output: ["embedding"]
            }
          } else if (modelType === 'chat') {
            chatModelsCount++
            modelConfig.modalities = {
              input: ["text", "image"],
              output: ["text"]
            }
          }

          discoveredModels[modelKey] = modelConfig
        }
      }

      if (Object.keys(discoveredModels).length > 0) {
        p.models = {
          ...existingModels,
          ...discoveredModels,
        }

        openAICompatibleProviders.push({
          name: displayName,
          baseURL,
          models: discoveredModels
        })

        if (chatModelsCount === 0 && embeddingModelsCount > 0) {
          // Provider only has embedding models
        }
      }
    }

    if (openAICompatibleProviders.length > 0) {
      const totalModels = openAICompatibleProviders.reduce((sum, p) => sum + Object.keys(p.models).length, 0)
      logger.info('Provider model discovery completed', {
        providerCount: openAICompatibleProviders.length,
        modelCount: totalModels,
      })
    }

    if (Object.keys(providers).length === 0) {
      const detected = await autoDetectOpenAICompatibleProvider()
      if (detected) {
        logger.info('Detected OpenAI-compatible provider but found no configured providers', {
          provider: detected.name,
          baseURL: detected.baseURL,
        })
      }
    }

    try {
      for (const [providerName, providerConfig] of Object.entries(providers)) {
        const p = providerConfig as any
        if (!canDiscoverModels(p) || !shouldDiscoverProvider(providerName, providerFilter)) {
          continue
        }
        if (p.options?.baseURL) {
          const baseURL = normalizeBaseURL(p.options.baseURL)
          if (discoveryConfig.ttl) {
            modelStatusCache.setTTL(baseURL, discoveryConfig.ttl)
          }
          if (!modelStatusCache.isValid(baseURL)) {
            await modelStatusCache.getModels(baseURL, async () => {
              return await discoverModelsFromProvider(baseURL).then(models => models.map(m => m.id))
            })
          }
        }
      }
    } catch (error) {
      logger.warn('Model status cache refresh failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  } catch (error) {
    logger.error('Unexpected error in enhanceConfig', {
      error: error instanceof Error ? error.message : String(error),
    })
    toastNotifier.warning("Plugin configuration failed", "Configuration Error").catch(() => { })
  }
}
