// Test script to verify the plugin exports correctly
import { ModelDiscoveryPlugin } from "./src/index.ts"

console.log("Plugin loaded successfully!")
console.log("Plugin type:", typeof ModelDiscoveryPlugin)

// Test that it's a function
if (typeof ModelDiscoveryPlugin === "function") {
  console.log("✓ Plugin is a function")
} else {
  console.error("✗ Plugin is not a function")
  process.exit(1)
}

// Test that it can be called (mock input)
  const mockInput = {
    client: {} as any,
    project: {} as any,
    directory: "/tmp",
    worktree: "/tmp",
    serverUrl: new URL("http://localhost:3000"),
    $: {} as any,
  }

ModelDiscoveryPlugin(mockInput)
  .then((hooks: any) => {
    console.log("✓ Plugin initializes successfully")
    console.log("Hooks returned:", Object.keys(hooks))

    if (hooks.config) {
      console.log("✓ Config hook exists")
    } else {
      console.error("✗ Config hook missing")
      process.exit(1)
    }

    if (hooks.event) {
      console.log("✓ Event hook exists")
    } else {
      console.error("✗ Event hook missing")
      process.exit(1)
    }

    console.log("\n✅ All tests passed!")
  })
  .catch((error: any) => {
    console.error("✗ Plugin initialization failed:", error)
    process.exit(1)
  })
