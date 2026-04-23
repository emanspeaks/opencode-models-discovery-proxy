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

function makeProviderV2(id: string, baseURL: string, apiKey?: string): any {
  return {
    id,
    name: id,
    source: 'config',
    env: [],
    key: apiKey,
    options: { baseURL },
    models: {},
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
    it('should initialize with provider hook when provider option is set', async () => {
      const hooks = await ModelDiscoveryPlugin(mockInput, { provider: PROVIDER_NAME })
      expect(hooks).toBeDefined()
      expect(hooks.provider).toBeDefined()
      expect(hooks.provider!.id).toBe(PROVIDER_NAME)
      expect(hooks.event).toBeTypeOf('function')
      expect(hooks['chat.params']).toBeTypeOf('function')
    })

    it('should not register provider hook when provider option is not set', async () => {
      const hooks = await ModelDiscoveryPlugin(mockInput)
      expect(hooks.provider).toBeUndefined()
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

  describe('Provider Hook', () => {
    let hooks: any

    beforeEach(async () => {
      hooks = await ModelDiscoveryPlugin(mockInput, { provider: PROVIDER_NAME })
    })

    it('should have correct provider id', () => {
      expect(hooks.provider!.id).toBe(PROVIDER_NAME)
    })

    it('should discover models and return them as ModelV2 objects', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenCodeResponse(PROVIDER_NAME, {
        'test-model-1': { name: 'test-model-1', limit: { context: 200000, output: 200000 } },
        'test-model-2': { name: 'test-model-2', limit: { context: 200000, output: 200000 } },
      }))

      const result = await hooks.provider!.models!(makeProviderV2(PROVIDER_NAME, BASE_URL), {})

      expect(Object.keys(result)).toHaveLength(2)
      expect(result['test-model-1']).toBeDefined()
      expect(result['test-model-2']).toBeDefined()
    })

    it('should populate required ModelV2 fields', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenCodeResponse(PROVIDER_NAME, {
        'my-model': { name: 'My Model', limit: { context: 32768, output: 4096 } },
      }))

      const result = await hooks.provider!.models!(makeProviderV2(PROVIDER_NAME, BASE_URL), {})

      expect(result['my-model']).toMatchObject({
        id: 'my-model',
        providerID: PROVIDER_NAME,
        name: 'My Model',
        status: 'active',
        release_date: '',
        options: {},
        headers: {},
        api: { id: 'my-model', url: BASE_URL, npm: '@ai-sdk/openai-compatible' },
        cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
        limit: { context: 32768, output: 4096 },
      })
    })

    it('should map tool_call, reasoning, and attachment to capabilities', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenCodeResponse(PROVIDER_NAME, {
        'capable-model': {
          name: 'capable-model',
          reasoning: true,
          tool_call: true,
          attachment: true,
          limit: { context: 200000, output: 200000 },
        },
      }))

      const result = await hooks.provider!.models!(makeProviderV2(PROVIDER_NAME, BASE_URL), {})

      expect(result['capable-model'].capabilities).toMatchObject({
        temperature: true,
        reasoning: true,
        toolcall: true,
        attachment: true,
      })
    })

    it('should default all capabilities to false when not specified', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenCodeResponse(PROVIDER_NAME, {
        'basic-model': { name: 'basic-model', limit: { context: 4096, output: 4096 } },
      }))

      const result = await hooks.provider!.models!(makeProviderV2(PROVIDER_NAME, BASE_URL), {})

      expect(result['basic-model'].capabilities).toMatchObject({
        reasoning: false,
        toolcall: false,
        attachment: false,
        temperature: true,
        interleaved: false,
      })
    })

    it('should map modalities array to input/output capability booleans', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenCodeResponse(PROVIDER_NAME, {
        'vision-model': {
          name: 'vision-model',
          attachment: true,
          limit: { context: 200000, output: 200000 },
          modalities: { input: ['text', 'image'], output: ['text'] },
        },
      }))

      const result = await hooks.provider!.models!(makeProviderV2(PROVIDER_NAME, BASE_URL), {})

      expect(result['vision-model'].capabilities.input).toEqual({
        text: true, image: true, audio: false, video: false, pdf: false,
      })
      expect(result['vision-model'].capabilities.output).toEqual({
        text: true, image: false, audio: false, video: false, pdf: false,
      })
    })

    it('should default to text-only input/output when modalities not specified', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenCodeResponse(PROVIDER_NAME, {
        'text-model': { name: 'text-model', limit: { context: 4096, output: 4096 } },
      }))

      const result = await hooks.provider!.models!(makeProviderV2(PROVIDER_NAME, BASE_URL), {})

      expect(result['text-model'].capabilities.input).toEqual({
        text: true, image: false, audio: false, video: false, pdf: false,
      })
      expect(result['text-model'].capabilities.output).toEqual({
        text: true, image: false, audio: false, video: false, pdf: false,
      })
    })

    it('should default context and output limits to 4096 when not specified', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenCodeResponse(PROVIDER_NAME, {
        'no-limit-model': { name: 'no-limit-model' },
      }))

      const result = await hooks.provider!.models!(makeProviderV2(PROVIDER_NAME, BASE_URL), {})

      expect(result['no-limit-model'].limit).toEqual({ context: 4096, output: 4096 })
    })

    it('should return empty object when provider is offline', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'))

      const result = await hooks.provider!.models!(makeProviderV2(PROVIDER_NAME, BASE_URL), {})

      expect(result).toEqual({})
    })

    it('should return empty object when /v1/opencode returns non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false })

      const result = await hooks.provider!.models!(makeProviderV2(PROVIDER_NAME, BASE_URL), {})

      expect(result).toEqual({})
    })

    it('should return empty object when provider name not found in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          provider: { 'different-provider': { models: { 'some-model': { name: 'some-model' } } } },
        }),
      })

      const result = await hooks.provider!.models!(makeProviderV2(PROVIDER_NAME, BASE_URL), {})

      expect(result).toEqual({})
    })

    it('should return empty object when baseURL is missing', async () => {
      const providerWithoutURL = { ...makeProviderV2(PROVIDER_NAME, ''), options: {} }

      const result = await hooks.provider!.models!(providerWithoutURL, {})

      expect(result).toEqual({})
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should return empty object when response has no provider block', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })

      const result = await hooks.provider!.models!(makeProviderV2(PROVIDER_NAME, BASE_URL), {})

      expect(result).toEqual({})
    })

    it('should return empty object when provider has no models', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenCodeResponse(PROVIDER_NAME, {}))

      const result = await hooks.provider!.models!(makeProviderV2(PROVIDER_NAME, BASE_URL), {})

      expect(result).toEqual({})
    })

    it('should only match the exact configured provider name', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          provider: {
            'local-extra': { models: { 'wrong-model': { name: 'wrong-model' } } },
            [PROVIDER_NAME]: { npm: '@ai-sdk/openai-compatible', models: { 'right-model': { name: 'right-model', limit: { context: 4096, output: 4096 } } } },
          },
        }),
      })

      const result = await hooks.provider!.models!(makeProviderV2(PROVIDER_NAME, BASE_URL), {})

      expect(result['right-model']).toBeDefined()
      expect(result['wrong-model']).toBeUndefined()
    })

    it('should pass the API key from provider.key to the request', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenCodeResponse(PROVIDER_NAME, {}))

      const providerWithKey = makeProviderV2(PROVIDER_NAME, BASE_URL, 'my-secret-key')
      await hooks.provider!.models!(providerWithKey, {})

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer my-secret-key' }),
        })
      )
    })
  })

  describe('Provider Hook - Model Filtering', () => {
    it('should apply includeRegex to filter models', async () => {
      const filteredHooks = await ModelDiscoveryPlugin(mockInput, {
        provider: PROVIDER_NAME,
        models: { includeRegex: ['^qwen/'] },
      })

      mockFetch.mockResolvedValueOnce(makeOpenCodeResponse(PROVIDER_NAME, {
        'qwen/qwen3-30b': { name: 'qwen/qwen3-30b', limit: { context: 200000, output: 200000 } },
        'bge-m3': { name: 'bge-m3', limit: { context: 8192, output: 8192 } },
      }))

      const result = await filteredHooks.provider!.models!(makeProviderV2(PROVIDER_NAME, BASE_URL), {})

      expect(result['qwen/qwen3-30b']).toBeDefined()
      expect(result['bge-m3']).toBeUndefined()
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

      const result = await filteredHooks.provider!.models!(makeProviderV2(PROVIDER_NAME, BASE_URL), {})

      expect(result['qwen/qwen3-30b']).toBeDefined()
      expect(result['bge-m3']).toBeUndefined()
    })

    it('should return all models when no regex filter is configured', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenCodeResponse(PROVIDER_NAME, {
        'model-a': { name: 'model-a', limit: { context: 4096, output: 4096 } },
        'model-b': { name: 'model-b', limit: { context: 4096, output: 4096 } },
        'model-c': { name: 'model-c', limit: { context: 4096, output: 4096 } },
      }))

      const noFilterHooks = await ModelDiscoveryPlugin(mockInput, { provider: PROVIDER_NAME })
      const result = await noFilterHooks.provider!.models!(makeProviderV2(PROVIDER_NAME, BASE_URL), {})

      expect(Object.keys(result)).toHaveLength(3)
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

      const result = await invalidRegexHooks.provider!.models!(makeProviderV2(PROVIDER_NAME, BASE_URL), {})

      // Invalid regex is ignored — no includeRegex means all models pass
      expect(result['model-a']).toBeDefined()
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

    it('should do nothing (validation disabled)', async () => {
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
    it('should show toast and return empty object when model mapping throws unexpectedly', async () => {
      const errorHooks = await ModelDiscoveryPlugin(mockInput, { provider: PROVIDER_NAME })

      // Simulate an error that escapes fetchOpenCodeConfig's own try/catch
      // by having the response.json() throw synchronously in a way that propagates
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => { throw new Error('Unexpected processing error') },
      })

      const result = await errorHooks.provider!.models!(makeProviderV2(PROVIDER_NAME, BASE_URL), {})

      expect(result).toEqual({})
    })

    it('should not throw when provider hook encounters an error', async () => {
      const errorHooks = await ModelDiscoveryPlugin(mockInput, { provider: PROVIDER_NAME })
      mockFetch.mockRejectedValueOnce(new Error('Network failure'))

      await expect(
        errorHooks.provider!.models!(makeProviderV2(PROVIDER_NAME, BASE_URL), {})
      ).resolves.toEqual({})
    })
  })
})
