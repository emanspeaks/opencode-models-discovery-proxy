# Release Process

Releases are triggered automatically when a PR is merged to `main`, provided the version in `package.json` has been bumped. The workflow will fail and block the merge if the version matches the latest git tag.

## How to Release

1. In your PR branch, bump the version in `package.json` manually (e.g. `0.8.5` → `0.8.6`)
2. Merge the PR to `main`
3. The release workflow fires automatically and:
   - Verifies the version is new (fails if the tag already exists)
   - Runs type checking and tests
   - Creates and pushes a git tag (`v0.8.6`)
   - Creates a GitHub release with generated notes
   - Publishes to npm

## Version Conventions

- **patch** (`0.1.0 → 0.1.1`): Bug fixes, small improvements
- **minor** (`0.1.0 → 0.2.0`): New features, backwards compatible
- **major** (`0.1.0 → 1.0.0`): Breaking changes

## Prerequisites

<!-- ### Repository Secret

Add `NPM_TOKEN` to your GitHub repository secrets (Settings → Secrets and variables → Actions). Generate one at npmjs.com → Access Tokens → Classic Token with `Automation` type. -->

### Branch Protection (recommended)

In your repo's branch protection settings for `main`, add the following as required status checks:

- `Version must be bumped` — blocks merge if `package.json` version was not changed vs main
- `Build and test` — blocks merge if type checking or tests fail

These are defined in `.github/workflows/ci.yml` and run automatically on every PR to main.

## Manual Release (if needed)

If you need to release outside of CI:

```bash
# Ensure you are on main with a clean working tree
git checkout main && git pull

# Tag, create GitHub release, and publish to npm
bun scripts/release.ts
```

Requires `gh` CLI authenticated (`gh auth login`) and npm credentials configured (`npm login` or `NPM_TOKEN` env var set).

## Troubleshooting

### Workflow fails: "already tagged"

The version in `package.json` was not bumped before merging. Push a follow-up commit to `main` with an incremented version — the workflow will re-trigger.

### npm publish fails with auth error

<!-- Verify the `NPM_TOKEN` secret is set in the repository and has publishing permissions. Generate a new token at npmjs.com if needed. -->
Ensure the GitHub Actions workflow is configured as a trusted publisher for the npm package

### GitHub release creation fails

Ensure the workflow has `contents: write` permission (already set) and that `GITHUB_TOKEN` is available (it is by default in Actions).
