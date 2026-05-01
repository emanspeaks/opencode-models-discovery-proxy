import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ModelDiscoveryPlugin } from '../src/index.ts'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

if (!globalThis.AbortSignal.timeout) {
  globalThis.AbortSignal.timeout = vi.fn(() => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 5000)
    return controller.signal
  })
}

const PROVIDER_NAME = 'local'
const BASE_URL = 'http://127.0.0.1:11434'

function makeOpenCodeResponse(providerName: string, models: Record<string, any>, extraProviderFields: Record<string, any> = {}) {
  return {
    ok: true,
    json: async () => ({
      $schema: 'https://opencode.ai/config.json',
      provider: {
        [providerName]: {
          npm: '@ai-sdk/openai-compatible',
          name: providerName,
          options: { baseURL: BASE_URL },
          ...extraProviderFields,
          models,
        },
      },
    }),
  }
}

function makeConfig(providerName: string, baseURL: string, apiKey?: string): any {
  return {
    provider: {
      [providerName]: {
        npm: '@ai-sdk/openai-compatible',
        name: providerName,
        options: {
          baseURL,
          ...(apiKey && { apiKey }),
        },
      },
    },
  }
}

describe('ModelDiscovery Plugin', () => {
  let mockClient: any
  let mockInput: any

  beforeEach(() => {
    mockFetch.mockClear()

    mockClient = {
      app: {
        log: vi.fn().mockResolvedValue(true),
      },
      tui: {
        showToast: vi.fn().mockResolvedValue(true),
      },
    }

    mockInput = {
      client: mockClient,
      project: {
        id: 'test-project',
        name: 'test',
        path: '/tmp',
        worktree: '',
        time: { created: Date.now() },
      },
      directory: '/tmp',
      worktree: '',
      $: vi.fn(),
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Plugin Initialization', () => {
    it('should initialize with config hook when provider option is set', async () => {
      const hooks = await ModelDiscoveryPlugin(mockInput, { provider: PROVIDER_NAME })
      expect(hooks).toBeDefined()
      expect(hooks.config).toBeTypeOf('function')
      expect(hooks.event).toBeTypeOf('function')
      expect(hooks['chat.params']).toBeTypeOf('function')
    })

    it('should not register config hook when provider option is not set', async () => {
      const hooks = await ModelDiscoveryPlugin(mockInput)
      expect(hooks.config).toBeUndefined()
      expect(hooks.event).toBeTypeOf('function')
      expect(hooks['chat.params']).toBeTypeOf('function')
    })

    it('should log a warning when provider option is not set', async () => {
      await ModelDiscoveryPlugin(mockInput)
      expect(mockClient.app.log).toHaveBeenCalledWith(expect.objectContaining({
        body: expect.objectContaining({
          level: 'warn',
          message: expect.stringContaining('provider'),
        }),
      }))
    })

    it('should handle invalid client gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const hooks = await ModelDiscoveryPlugin({ ...mockInput, client: null })
      expect(hooks).toBeDefined()
      expect(hooks.event).toBeTypeOf('function')
      expect(hooks['chat.params']).toBeTypeOf('function')
      expect(consoleSpy).toHaveBeenCalledWith(
        '[opencode-models-discovery-proxy] Invalid client provided to plugin',
        { category: 'plugin' }
      )
      consoleSpy.mockRestore()
    })
  })

  describe('Config Hook', () => {
    let hooks: any

    beforeEach(async () => {
      hooks = await ModelDiscoveryPlugin(mockInput, { provider: PROVIDER_NAME })
    })

    it('should inject discovered models into config.provider[name].models', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenCodeResponse(PROVIDER_NAME, {
        'test-model-1': { name: 'test-model-1', limit: { context: 200000, output: 200000 } },
        'test-model-2': { name: 'test-model-2', limit: { context: 200000, output: 200000 } },
      }))

      const config = makeConfig(PROVIDER_NAME, BASE_URL)
      await hooks.config!(config)

      expect(Object.keys(config.provider[PROVIDER_NAME].models)).toHaveLength(2)
      expect(config.provider[PROVIDER_NAME].models['test-model-1']).toBeDefined()
      expect(config.provider[PROVIDER_NAME].models['test-model-2']).toBeDefined()
    })

    it('should inject model name and limit fields', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenCodeResponse(PROVIDER_NAME, {
        'my-model': { name: 'My Model', limit: { context: 32768, output: 4096 } },
      }))

      const config = makeConfig(PROVIDER_NAME, BASE_URL)
      await hooks.config!(config)

      expect(config.provider[PROVIDER_NAME].models['my-model']).toMatchObject({
        name: 'My Model',
        limit: { context: 32768, output: 4096 },
      })
    })

    it('should use model key as name when remote name is absent', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenCodeResponse(PROVIDER_NAME, {
        'unnamed-model': { limit: { context: 4096, output: 4096 } },
      }))

      const config = makeConfig(PROVIDER_NAME, BASE_URL)
      await hooks.config!(config)

      expect(config.provider[PROVIDER_NAME].models['unnamed-model'].name).toBe('unnamed-model')
    })

    it('should inject tool_call, reasoning, and attachment fields', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenCodeResponse(PROVIDER_NAME, {
        'capable-model': {
          name: 'capable-model',
          reasoning: true,
          tool_call: true,
          attachment: true,
          limit: { context: 200000, output: 200000 },
        },
      }))

      const config = makeConfig(PROVIDER_NAME, BASE_URL)
      await hooks.config!(config)

      expect(config.provider[PROVIDER_NAME].models['capable-model']).toMatchObject({
        reasoning: true,
        tool_call: true,
        attachment: true,
      })
    })

    it('should omit capability fields when not specified by the remote model', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenCodeResponse(PROVIDER_NAME, {
        'basic-model': { name: 'basic-model', limit: { context: 4096, output: 4096 } },
      }))

      const config = makeConfig(PROVIDER_NAME, BASE_URL)
      await hooks.config!(config)

      const model = config.provider[PROVIDER_NAME].models['basic-model']
      expect(model.reasoning).toBeUndefined()
      expect(model.tool_call).toBeUndefined()
      expect(model.attachment).toBeUndefined()
    })

    it('should pass through modalities from the remote model', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenCodeResponse(PROVIDER_NAME, {
        'vision-model': {
          name: 'vision-model',
          attachment: true,
          limit: { context: 200000, output: 200000 },
          modalities: { input: ['text', 'image'], output: ['text'] },
        },
      }))

      const config = makeConfig(PROVIDER_NAME, BASE_URL)
      await hooks.config!(config)

      expect(config.provider[PROVIDER_NAME].models['vision-model'].modalities).toEqual({
        input: ['text', 'image'],
        output: ['text'],
      })
    })

    it('should omit modalities when not specified by the remote model', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenCodeResponse(PROVIDER_NAME, {
        'text-model': { name: 'text-model', limit: { context: 4096, output: 4096 } },
      }))

      const config = makeConfig(PROVIDER_NAME, BASE_URL)
      await hooks.config!(config)

      expect(config.provider[PROVIDER_NAME].models['text-model'].modalities).toBeUndefined()
    })

    it('should preserve existing models in config when injecting', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenCodeResponse(PROVIDER_NAME, {
        'new-model': { name: 'new-model' },
      }))

      const config = makeConfig(PROVIDER_NAME, BASE_URL)
      config.provider[PROVIDER_NAME].models = { 'existing-model': { name: 'existing-model' } }
      await hooks.config!(config)

      expect(config.provider[PROVIDER_NAME].models['existing-model']).toBeDefined()
      expect(config.provider[PROVIDER_NAME].models['new-model']).toBeDefined()
    })

    it('should do nothing when provider is offline', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'))

      const config = makeConfig(PROVIDER_NAME, BASE_URL)
      await hooks.config!(config)

      expect(config.provider[PROVIDER_NAME].models).toBeUndefined()
      expect(mockClient.tui.showToast).not.toHaveBeenCalled()
    })

    it('should do nothing when /v1/opencode returns non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false })

      const config = makeConfig(PROVIDER_NAME, BASE_URL)
      await hooks.config!(config)

      expect(config.provider[PROVIDER_NAME].models).toBeUndefined()
    })

    it('should do nothing when provider name not found in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          provider: { 'different-provider': { models: { 'some-model': { name: 'some-model' } } } },
        }),
      })

      const config = makeConfig(PROVIDER_NAME, BASE_URL)
      await hooks.config!(config)

      expect(config.provider[PROVIDER_NAME].models).toBeUndefined()
    })

    it('should warn and skip fetch when baseURL is missing from config', async () => {
      const config = { provider: { [PROVIDER_NAME]: { options: {} } } }
      await hooks.config!(config)

      expect(mockFetch).not.toHaveBeenCalled()
      expect((config.provider[PROVIDER_NAME] as any).models).toBeUndefined()
    })

    it('should do nothing when response has no provider block', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })

      const config = makeConfig(PROVIDER_NAME, BASE_URL)
      await hooks.config!(config)

      expect(config.provider[PROVIDER_NAME].models).toBeUndefined()
    })

    it('should do nothing when remote provider has no models', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenCodeResponse(PROVIDER_NAME, {}))

      const config = makeConfig(PROVIDER_NAME, BASE_URL)
      await hooks.config!(config)

      expect(config.provider[PROVIDER_NAME].models).toBeUndefined()
    })

    it('should only match the exact configured provider name', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          provider: {
            'local-extra': { models: { 'wrong-model': { name: 'wrong-model' } } },
            [PROVIDER_NAME]: { npm: '@ai-sdk/openai-compatible', models: { 'right-model': { name: 'right-model' } } },
          },
        }),
      })

      const config = makeConfig(PROVIDER_NAME, BASE_URL)
      await hooks.config!(config)

      expect(config.provider[PROVIDER_NAME].models['right-model']).toBeDefined()
      expect(config.provider[PROVIDER_NAME].models['wrong-model']).toBeUndefined()
    })

    it('should pass the API key from config provider options to the request', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenCodeResponse(PROVIDER_NAME, {}))

      const config = makeConfig(PROVIDER_NAME, BASE_URL, 'my-secret-key')
      await hooks.config!(config)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer my-secret-key' }),
        })
      )
    })
  })

  describe('Config Hook - Model Filtering', () => {
    it('should apply includeRegex to filter models', async () => {
      const filteredHooks = await ModelDiscoveryPlugin(mockInput, {
        provider: PROVIDER_NAME,
        models: { includeRegex: ['^qwen/'] },
      })

      mockFetch.mockResolvedValueOnce(makeOpenCodeResponse(PROVIDER_NAME, {
        'qwen/qwen3-30b': { name: 'qwen/qwen3-30b', limit: { context: 200000, output: 200000 } },
        'bge-m3': { name: 'bge-m3', limit: { context: 8192, output: 8192 } },
      }))

      const config = makeConfig(PROVIDER_NAME, BASE_URL)
      await filteredHooks.config!(config)

      expect(config.provider[PROVIDER_NAME].models['qwen/qwen3-30b']).toBeDefined()
      expect(config.provider[PROVIDER_NAME].models['bge-m3']).toBeUndefined()
    })

    it('should apply excludeRegex to filter models', async () => {
      const filteredHooks = await ModelDiscoveryPlugin(mockInput, {
        provider: PROVIDER_NAME,
        models: { excludeRegex: ['^bge-'] },
      })

      mockFetch.mockResolvedValueOnce(makeOpenCodeResponse(PROVIDER_NAME, {
        'qwen/qwen3-30b': { name: 'qwen/qwen3-30b', limit: { context: 200000, output: 200000 } },
        'bge-m3': { name: 'bge-m3', limit: { context: 8192, output: 8192 } },
      }))

      const config = makeConfig(PROVIDER_NAME, BASE_URL)
      await filteredHooks.config!(config)

      expect(config.provider[PROVIDER_NAME].models['qwen/qwen3-30b']).toBeDefined()
      expect(config.provider[PROVIDER_NAME].models['bge-m3']).toBeUndefined()
    })

    it('should inject all models when no regex filter is configured', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenCodeResponse(PROVIDER_NAME, {
        'model-a': { name: 'model-a', limit: { context: 4096, output: 4096 } },
        'model-b': { name: 'model-b', limit: { context: 4096, output: 4096 } },
        'model-c': { name: 'model-c', limit: { context: 4096, output: 4096 } },
      }))

      const noFilterHooks = await ModelDiscoveryPlugin(mockInput, { provider: PROVIDER_NAME })
      const config = makeConfig(PROVIDER_NAME, BASE_URL)
      await noFilterHooks.config!(config)

      expect(Object.keys(config.provider[PROVIDER_NAME].models)).toHaveLength(3)
    })

    it('should handle invalid regex patterns gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const invalidRegexHooks = await ModelDiscoveryPlugin(mockInput, {
        provider: PROVIDER_NAME,
        models: { includeRegex: ['[invalid'] },
      })

      mockFetch.mockResolvedValueOnce(makeOpenCodeResponse(PROVIDER_NAME, {
        'model-a': { name: 'model-a', limit: { context: 4096, output: 4096 } },
      }))

      const config = makeConfig(PROVIDER_NAME, BASE_URL)
      await invalidRegexHooks.config!(config)

      // Invalid regex is ignored — no effective includeRegex means all models pass
      expect(config.provider[PROVIDER_NAME].models['model-a']).toBeDefined()
      consoleSpy.mockRestore()
    })
  })

  describe('Event Hook', () => {
    let pluginHooks: any

    beforeEach(async () => {
      pluginHooks = await ModelDiscoveryPlugin(mockInput, { provider: PROVIDER_NAME })
    })

    it('should validate event input', async () => {
      await pluginHooks.event({ event: null })
      expect(mockClient.app.log).toHaveBeenLastCalledWith(expect.objectContaining({
        body: expect.objectContaining({
          service: 'opencode-models-discovery-proxy',
          level: 'error',
          message: 'Invalid event input',
          extra: expect.objectContaining({
            category: 'event',
            errors: expect.arrayContaining(['event: event is required and must be an object']),
          }),
        }),
      }))
    })

    it('should handle session events gracefully', async () => {
      await pluginHooks.event({ event: { type: 'session.created' } })
      expect(true).toBe(true)
    })
  })

  describe('Chat Params Hook', () => {
    let pluginHooks: any

    beforeEach(async () => {
      pluginHooks = await ModelDiscoveryPlugin(mockInput, { provider: PROVIDER_NAME })
    })

    it('should be defined as a function', () => {
      expect(pluginHooks['chat.params']).toBeTypeOf('function')
    })

    it('should do nothing (no-op)', async () => {
      const input = {
        sessionID: 'test-session',
        model: { id: 'test-model' },
        provider: {
          npm: '@ai-sdk/openai-compatible',
          info: { id: PROVIDER_NAME },
          options: { baseURL: BASE_URL },
        },
      }
      const output: any = {}

      await pluginHooks['chat.params'](input, output)

      expect(output).toEqual({})
      expect(mockClient.tui.showToast).not.toHaveBeenCalled()
    })
  })

  describe('Error Handling', () => {
    it('should show toast when an unexpected error occurs during model injection', async () => {
      const errorHooks = await ModelDiscoveryPlugin(mockInput, { provider: PROVIDER_NAME })

      mockFetch.mockResolvedValueOnce(makeOpenCodeResponse(PROVIDER_NAME, {
        'some-model': { name: 'some-model' },
      }))

      // Freeze config.provider so the assignment config.provider[name] = ... throws
      const config = makeConfig(PROVIDER_NAME, BASE_URL)
      Object.freeze(config.provider)

      await errorHooks.config!(config)

      expect(mockClient.tui.showToast).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ message: 'Model discovery failed' }),
        })
      )
    })

    it('should not throw when config hook encounters a network error', async () => {
      const errorHooks = await ModelDiscoveryPlugin(mockInput, { provider: PROVIDER_NAME })
      mockFetch.mockRejectedValueOnce(new Error('Network failure'))

      const config = makeConfig(PROVIDER_NAME, BASE_URL)
      await expect(errorHooks.config!(config)).resolves.toBeUndefined()
    })
  })
})
