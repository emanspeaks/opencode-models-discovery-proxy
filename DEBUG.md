# Debugging opencode-models-discovery-proxy

## How the Plugin Works (Post v0.9.1)

The plugin uses the `config` hook, which fires with the full user config before OpenCode initializes providers. It reads `config.provider[name].options.baseURL`, fetches models from `/v1/opencode`, and injects them into `config.provider[name].models` — so OpenCode sees the models as if they were written statically in `opencode.jsonc`.

> **Why not the `provider` hook?** As of OpenCode v1.14.30, the `provider.models` hook only fires for providers in the models.dev database. Custom providers added via user config are processed _after_ that hook runs, so it never fires for them.

## Enabling Logs

```bash
opencode --print-logs
```

## Expected Log Sequence

1. `[opencode-models-discovery-proxy] Model discovery plugin initialized` — plugin loaded
2. `[opencode-models-discovery-proxy] [config] Provider <name> has no baseURL configured` — OR:
3. `[opencode-models-discovery-proxy] [config] No /v1/opencode response from provider <name>` — OR:
4. `[opencode-models-discovery-proxy] [config] Injected N models for provider <name>` — success

## What to Check

### 1. Is the plugin loading?

Look for: `Model discovery plugin initialized`

If missing: plugin is not installed or not listed in `opencode.jsonc`.

```bash
npm list opencode-models-discovery-proxy
```

Check your config has:

```jsonc
"plugin": [["opencode-models-discovery-proxy", { "provider": "your-provider-name" }]]
```

### 2. Is the provider configured with a baseURL?

Look for: `Provider <name> has no baseURL configured`

If this appears, your `opencode.jsonc` is missing the provider entry or `options.baseURL`:

```jsonc
"provider": {
  "your-provider-name": {
    "npm": "@ai-sdk/openai-compatible",
    "name": "Your Provider",
    "options": {
      "baseURL": "http://192.168.2.44:5900/v1"
    }
  }
}
```

The plugin name in `plugin` options must **exactly match** the key under `provider`.

### 3. Is the remote server reachable?

Look for: `No /v1/opencode response from provider <name>`

Test the endpoint directly:

```bash
curl http://YOUR_HOST:PORT/v1/opencode
```

The response should be a JSON object with a `provider` key containing your provider name and its models.

### 4. Is your provider name in the remote response?

Look for: `Provider <name> not found in /v1/opencode response`

The provider key in `/v1/opencode` must exactly match the `provider` option in your plugin config.

### 5. Are models being injected?

Look for: `Injected N models for provider <name>`

If N is 0 and no other warning appears, either the remote server returned no models, or all models were filtered out by `includeRegex`/`excludeRegex`.

## Common Issues

### Provider or models not visible in OpenCode UI

1. Confirm the plugin initializes (step 1 above)
2. Confirm models are injected (step 5 above)
3. If injection succeeds but models still don't appear, check that the provider's `npm` package is installed and the `baseURL` is reachable from OpenCode

### Plugin not loading on Windows / Node

OpenCode v1.14.20 fixed dynamic import issues on Windows with Node.js. Ensure you're on OpenCode ≥ 1.14.20.

### "Model discovery failed" toast

An unexpected error occurred during model fetching. Check the logs for an error line immediately before or after the toast. Common causes: network timeout (5s limit), malformed JSON from the remote server, or an exception in regex compilation.
