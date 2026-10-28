# GitHub Release Upload Guide

This guide covers building and publishing a Windows installer for
Swiped Perfectly Just-in-time from this repository: the 64-bit build for Windows
10 and later (the one the in-app updater delivers), an optional 32-bit build,
and the separate Electron 22 build for Windows 7.

## Build the Windows 10/11 installer

1. Set `version` in `package.json` to a new version that does not already have
   a GitHub release.
2. Build the installer:

   ```powershell
   npm run dist
   ```

3. Confirm the generated files in `release/`:
   - `SwipedPerfectlyJustInTime.Setup.<version>.x64.exe`
   - `SwipedPerfectlyJustInTime.Setup.<version>.x64.exe.blockmap`
   - `latest.yml`

`npm run dist` passes `--x64`, and `build.nsis.artifactName` includes `${arch}`,
so the 64-bit installer is what `latest.yml` names: **the in-app updater always
delivers the x64 build**. The architecture is part of the file name, so the
32-bit installer can never overwrite the updater's file.

Do not rename the installer or manually edit `latest.yml`; electron-builder
generates matching filenames, hashes, and sizes.

### Optional 32-bit build

```powershell
npm run dist:ia32
```

This writes `release-ia32/SwipedPerfectlyJustInTime.Setup.<version>.ia32.exe`
(plus its blockmap and a local `latest.yml`). The separate output directory is
deliberate: building 32-bit must never replace `release/latest.yml`, or the
updater would start delivering 32-bit again. Attach the `.ia32.exe` to the same
GitHub release as an extra download.

## Publish the release

Replace `<version>` below with the version in `package.json`, then create the
release in the repository configured by this app:

```powershell
gh release create v<version> `
  "release\SwipedPerfectlyJustInTime.Setup.<version>.x64.exe" `
  "release\SwipedPerfectlyJustInTime.Setup.<version>.x64.exe.blockmap" `
  "release\latest.yml" `
  --repo jencendencia/bantay-pasok `
  --title "v<version>" `
  --generate-notes
```

Then attach any optional builds to that same release:

```powershell
gh release upload v<version> "release-ia32\SwipedPerfectlyJustInTime.Setup.<version>.ia32.exe"
gh release upload v<version> "release-win7\SwipedPerfectlyJustInTime.Setup.<version>.win7.exe"
```

Verify the release and its asset names:

```powershell
gh release view v<version> --repo jencendencia/bantay-pasok
Select-String -Path release\latest.yml -Pattern 'version:|url:|path:'
```

The `url` and `path` in `latest.yml` must match the uploaded `.exe` asset
exactly. Do not delete an existing release just to reuse its version; publish a
new version instead.

## Windows 7 installer (Electron 22)

Windows 10 and later run the normal build above. Electron 23 dropped Windows 7,
so Windows 7 needs a separate build on **Electron 22.3.27**, which is what
`electron-builder.win7.json` configures (x64, per-machine NSIS, output
`release-win7/`, artifact `SwipedPerfectlyJustInTime.Setup.<version>.win7.exe`,
`publish: null`). It is not part of `dist`, `dist:ia32`, or `dist:dir`; it must
be invoked explicitly.

### Build

1. Build the app code with the same steps as above (`npm run build`), then:

   ```bash
   npx electron-builder --win --config electron-builder.win7.json --config.npmRebuild=false
   ```

2. Confirm `release-win7/SwipedPerfectlyJustInTime.Setup.<version>.win7.exe`
   exists (about 78 MB).

### Why `--config.npmRebuild=false`

`better-sqlite3` is ABI-specific rather than N-API, and the project pins
`better-sqlite3@11.10.0`, whose published prebuilds start at Electron ABI 116.
There is **no prebuild for Electron 22 / ABI 110**, so electron-builder falls
back to `node-gyp`, which fails here with:

```
Error: Could not find any Visual Studio installation to use
⨯ node-gyp failed to rebuild '...\node_modules\better-sqlite3'
```

(The repo path also contains a space, which node-gyp warns about.) That failed
run also wipes `node_modules/better-sqlite3/build/`, so the module stops working
for every Electron version until it is restored — see *Restore the dev binary*.

So the win7 package is built with a pre-compiled ABI 110 x64
`better_sqlite3.node` placed in `node_modules/better-sqlite3/build/Release/`
before packaging, and the rebuild is skipped. Sources for that binary:

- **Reuse it** from an already-built win7 package:
  `release-win7/win-unpacked/resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node`
- **Or compile it once** on a machine with Visual Studio 2022 + the *Desktop
  development with C++* workload, by running the same command **without**
  `--config.npmRebuild=false`.
- **Or upgrade `better-sqlite3`** to a version that publishes an ABI 110
  prebuild — check the asset list of its GitHub release for
  `electron-v110-win32-x64.tar.gz` before relying on it.

The binary is tied to the `better-sqlite3` version, so re-check it whenever that
dependency changes.

`@serialport/bindings-cpp` is N-API and ships its own prebuilds, so it needs no
special handling.

### Verify the package before uploading

Run the packaged executable as Node — this fails loudly if the native module's
ABI does not match Electron 22:

```bash
ELECTRON_RUN_AS_NODE=1 "./release-win7/win-unpacked/Swiped Perfectly Just-in-time.exe" -e "
console.log('electron', process.versions.electron, 'abi', process.versions.modules, 'arch', process.arch);
const D = require(process.cwd() + '/node_modules/better-sqlite3');
const db = new D(':memory:'); db.exec('create table t(a integer)');
db.prepare('insert into t values (?)').run(1);
console.log('sqlite ok', JSON.stringify(db.prepare('select a from t').get()));
"
```

Expected: `electron 22.3.27 abi 110 arch x64` followed by `sqlite ok {"a":1}`.
(PowerShell: `$env:ELECTRON_RUN_AS_NODE = "1"` first.)

Also confirm the package contains the new code, and that the installer matches
the local file:

```bash
A=release-win7/win-unpacked/resources/app.asar
grep -ac '"version": "<version>"' "$A"   # expect 1 (the app's package.json)
grep -ac 'already checked in' "$A"       # expect non-zero: a string from the new scan code
sha256sum "release-win7/SwipedPerfectlyJustInTime.Setup.<version>.win7.exe"
```

Then compare that sha256 with the `digest` GitHub reports for the uploaded
asset (`gh release view v<version> --json assets -q '.assets[] | "\(.name) \(.digest)"'`).

### Restore the dev binary

After the win7 build, `node_modules` holds an ABI 110 binary that the regular
Electron 33 dev run and packaging cannot load. Restore it before doing anything
else:

```bash
cd node_modules/better-sqlite3
npx prebuild-install -r electron -t <installed-electron-version> --arch x64
```

Get the version from `node_modules/electron/dist/version` (33.4.11 at the time
of writing) and check the result by loading `better-sqlite3` under
`ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe`; the same ABI
test above should print ABI 130.

### Publish

Add the win7 installer to the release that the 32-bit build created — do not
open a second release for it:

```bash
gh release upload v<version> "release-win7/SwipedPerfectlyJustInTime.Setup.<version>.win7.exe" --clobber
```

The win7 build has `publish: null`, so it has no `latest.yml` entry and no
blockmap: it is a manual download and never delivered by the in-app updater.
Leave `latest.yml` pointing at the Windows 10+ installer, and mention in the
release notes which file is for which Windows version.

## Token management

Public GitHub releases do not require an upload token beyond an authenticated
GitHub CLI session. For private repositories, provide `GH_TOKEN` through the
environment; never commit tokens to source code.
