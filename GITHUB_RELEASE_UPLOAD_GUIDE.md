# GitHub Release Upload Guide

This guide covers building and publishing a Windows 32-bit installer for
Swiped Perfectly Just-in-time from this repository.

## Build the 32-bit installer

1. Set `version` in `package.json` to a new version that does not already have
   a GitHub release.
2. Build the installer:

   ```powershell
   npm run dist:ia32
   ```

3. Confirm the generated files in `release/`:
   - `SwipedPerfectlyJustInTime.Setup.<version>.exe`
   - `SwipedPerfectlyJustInTime.Setup.<version>.exe.blockmap`
   - `latest.yml`

The dedicated `dist:ia32` command passes `--ia32` to electron-builder. The
configured artifact name uses dots and has no spaces. Do not rename the
installer or manually edit `latest.yml`; electron-builder generates matching
filenames, hashes, and sizes.

## Publish the release

Replace `<version>` below with the version in `package.json`, then create the
release in the repository configured by this app:

```powershell
gh release create v<version> `
  "release\SwipedPerfectlyJustInTime.Setup.<version>.exe" `
  "release\SwipedPerfectlyJustInTime.Setup.<version>.exe.blockmap" `
  "release\latest.yml" `
  --repo jencendencia/bantay-pasok `
  --title "v<version>" `
  --generate-notes
```

Verify the release and its asset names:

```powershell
gh release view v<version> --repo jencendencia/bantay-pasok
Select-String -Path release\latest.yml -Pattern 'version:|url:|path:'
```

The `url` and `path` in `latest.yml` must match the uploaded `.exe` asset
exactly. Do not delete an existing release just to reuse its version; publish a
new version instead.

## Token management

Public GitHub releases do not require an upload token beyond an authenticated
GitHub CLI session. For private repositories, provide `GH_TOKEN` through the
environment; never commit tokens to source code.
