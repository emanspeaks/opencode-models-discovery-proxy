import type { Plugin, PluginInput, PluginOptions } from "@opencode-ai/plugin"
import { ToastNotifier } from '../ui/toast-notifier'
import { createProviderHook } from './provider-hook'
import { createEventHook } from './event-hook'
import { createChatParamsHook } from './chat-params-hook'
import { createPluginLogger } from './logger'
import { parsePluginConfig } from '../types/plugin-config'

export const ModelDiscoveryPlugin: Plugin = async (input: PluginInput, options?: PluginOptions) => {
  const { client } = input
  const logger = createPluginLogger(client, { category: 'plugin' })

  if (!client || typeof client !== 'object') {
    logger.error('Invalid client provided to plugin')
    return {
      event: async () => { },
      "chat.params": async () => { }
    }
  }

  logger.info('Model discovery plugin initialized')

  const pluginConfig = parsePluginConfig(options || {})
  const toastNotifier = new ToastNotifier(client)

  const hooks: any = {
    event: createEventHook(logger.child({ category: 'event' })),
    "chat.params": createChatParamsHook(),
  }

  if (pluginConfig.provider) {
    hooks.provider = createProviderHook(
      pluginConfig,
      toastNotifier,
      logger.child({ category: 'provider' })
    )
  } else {
    logger.warn('No provider configured — set "provider" in plugin options to enable model discovery')
  }

  return hooks
}
