// Release publisher for PlanetNavigator.
//
// Builds the mod and the app, then uploads the Windows installer, its blockmap, latest.yml
// (the electron-updater feed) and a manual-install mod zip to a *draft* GitHub release named
// v<version>. Review the draft on GitHub, write the notes and click Publish: that creates the
// tag and makes the release visible to installed apps, which then update themselves.
//
// This runs locally rather than in CI because the mod compiles against the game's own
// assemblies (Assembly-CSharp.dll etc.), which are not available on a build runner.
//
// Usage (from the repo root, with `gh auth login` done or GH_TOKEN set):
//   npm run release                 full build + publish
//   npm run release -- --skip-mod   reuse app/resources/mod/PlanetNavigator.dll as-is
//   npm run release -- --dirty      allow uncommitted changes
//
// Version bump checklist (all four must agree, the script checks):
//   package.json, app/package.json, mod/PlanetNavigator/PlanetNavigator.csproj (<Version>),
//   mod/PlanetNavigator/PluginInfo.cs (PLUGIN_VERSION)

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appDir = path.join(root, 'app')
const args = new Set(process.argv.slice(2))
const skipMod = args.has('--skip-mod')
const allowDirty = args.has('--dirty')

function fail(msg) {
  console.error(`\nrelease: ${msg}`)
  process.exit(1)
}

// Everything is spawned without a shell: real executables only (node, dotnet, gh, git, tar), and
// the npm CLIs by their JS entry points, so no .cmd shims and no argument-escaping surprises.
const bin = (pkg, file) => path.join(root, 'node_modules', pkg, file)

/** Runs a command with inherited stdio; exits on failure. */
function run(cmd, cmdArgs, opts = {}) {
  console.log(`\n$ ${cmd} ${cmdArgs.join(' ')}`)
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', cwd: root, ...opts })
  if (r.error) fail(`${cmd}: ${r.error.message}`)
  if (r.status !== 0) fail(`${cmd} exited with ${r.status ?? r.signal}`)
}

/** Runs a command and returns trimmed stdout, or null on failure. */
function capture(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8', cwd: root, ...opts })
  return r.status === 0 ? r.stdout.trim() : null
}

/** Draft releases carrying `tag` (GitHub allows several drafts with the same tag name). */
function draftsForTag(tag) {
  const out = capture('gh', ['api', '--paginate', 'repos/ChadOhman/PlanetNavigator/releases'])
  if (out === null) fail('gh api releases failed')
  // --paginate concatenates one JSON array per page.
  const releases = out.replace(/\]\s*\[/g, ',')
  return JSON.parse(releases).filter((r) => r.draft && r.tag_name === tag)
}

/**
 * electron-builder uploads the installer and its blockmap in parallel and, when neither upload
 * finds a release yet, each creates its own draft. Fold everything into a single draft so the
 * app finds all assets in one place, re-uploading strays from app/dist under their GitHub names
 * (spaces become dashes there, which is also what latest.yml references).
 */
async function mergeDuplicateDrafts(tag, distDir) {
  const drafts = draftsForTag(tag)
  if (drafts.length <= 1) return
  drafts.sort((a, b) => b.assets.length - a.assets.length || a.id - b.id)
  const [keep, ...extras] = drafts
  console.log(`\nMerging ${extras.length} duplicate draft(s) of ${tag} into release ${keep.id}`)
  const have = new Set(keep.assets.map((a) => a.name))
  const stage = path.join(distDir, 'upload-stage')
  await rm(stage, { recursive: true, force: true })
  await mkdir(stage, { recursive: true })
  const local = new Map((await readdir(distDir)).map((f) => [f.replace(/\s/g, '-'), path.join(distDir, f)]))
  for (const extra of extras) {
    for (const asset of extra.assets) {
      if (have.has(asset.name)) continue
      const src = local.get(asset.name)
      if (!src) fail(`asset ${asset.name} on duplicate draft ${extra.id} has no local file in ${distDir}`)
      const staged = path.join(stage, asset.name)
      await copyFile(src, staged)
      run('gh', ['api', '-X', 'POST', '-H', 'Content-Type: application/octet-stream',
        `${keep.upload_url.replace(/\{.*$/, '')}?name=${encodeURIComponent(asset.name)}`,
        '--input', staged, '--silent'])
      have.add(asset.name)
    }
    run('gh', ['api', '-X', 'DELETE', `repos/ChadOhman/PlanetNavigator/releases/${extra.id}`])
  }
}

async function readVersions() {
  const rootPkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version
  const appPkg = JSON.parse(await readFile(path.join(appDir, 'package.json'), 'utf8')).version
  const csproj = await readFile(path.join(root, 'mod/PlanetNavigator/PlanetNavigator.csproj'), 'utf8')
  const csprojVer = csproj.match(/<Version>([^<]+)<\/Version>/)?.[1]
  const pluginInfo = await readFile(path.join(root, 'mod/PlanetNavigator/PluginInfo.cs'), 'utf8')
  const pluginVer = pluginInfo.match(/PLUGIN_VERSION\s*=\s*"([^"]+)"/)?.[1]
  return { 'package.json': rootPkg, 'app/package.json': appPkg, 'PlanetNavigator.csproj': csprojVer, 'PluginInfo.cs': pluginVer }
}

const versions = await readVersions()
const version = versions['app/package.json']
const mismatched = Object.entries(versions).filter(([, v]) => v !== version)
if (!version || mismatched.length) {
  fail(`version mismatch, all must equal app/package.json (${version}):\n` +
    Object.entries(versions).map(([k, v]) => `  ${k}: ${v ?? '(missing)'}`).join('\n'))
}
const tag = `v${version}`
console.log(`Releasing PlanetNavigator ${version} as ${tag}`)

if (!allowDirty) {
  const status = capture('git', ['status', '--porcelain'])
  if (status === null) fail('git status failed')
  if (status) fail(`working tree has uncommitted changes (commit them, or pass --dirty):\n${status}`)
}

// A published (non-draft) release for this tag means the version was not bumped.
const existing = capture('gh', ['release', 'view', tag, '--json', 'isDraft', '--jq', '.isDraft'])
if (existing === 'false') fail(`${tag} is already published on GitHub; bump the version first`)
if (existing === 'true') console.log(`Draft ${tag} already exists; its assets will be replaced.`)

// electron-builder's GitHub publisher needs GH_TOKEN; fall back to the gh CLI's stored token.
if (!process.env.GH_TOKEN) {
  const token = capture('gh', ['auth', 'token'])
  if (!token) fail('set GH_TOKEN or run `gh auth login`')
  process.env.GH_TOKEN = token
}

const modDll = path.join(appDir, 'resources/mod/PlanetNavigator.dll')
if (skipMod) {
  if (!existsSync(modDll)) fail(`--skip-mod given but ${modDll} does not exist`)
  console.log(`Reusing ${modDll}`)
} else {
  // NoDeploy: don't touch the live game folder (and don't fail on its locked DLL if the game runs).
  run('dotnet', ['build', 'mod', '-c', 'Release', '-p:NoDeploy=true'])
}

run('node', ['tools/make-icon.mjs'])
run('node', [bin('electron-vite', 'bin/electron-vite.js'), 'build'], { cwd: appDir })
run('node', [bin('electron-builder', 'cli.js'), '--publish', 'always'], { cwd: appDir })

const distDir = path.join(appDir, 'dist')
await mergeDuplicateDrafts(tag, distDir)

// Manual-install zip: PlanetNavigator/PlanetNavigator.dll + README, unzip into BepInEx/plugins.
const stage = path.join(distDir, 'mod-zip')
await rm(stage, { recursive: true, force: true })
await mkdir(path.join(stage, 'PlanetNavigator'), { recursive: true })
await copyFile(modDll, path.join(stage, 'PlanetNavigator/PlanetNavigator.dll'))
await writeFile(
  path.join(stage, 'PlanetNavigator/README.md'),
  `# PlanetNavigator mod ${version}\n\n` +
    'BepInEx 5 (x64) plugin for The Planet Crafter. Unzip this archive into\n' +
    '`<game>\\BepInEx\\plugins\\` so the DLL ends up at\n' +
    '`<game>\\BepInEx\\plugins\\PlanetNavigator\\PlanetNavigator.dll`.\n\n' +
    'The PlanetNavigator desktop app can install this for you from Settings > Game setup.\n' +
    'https://github.com/ChadOhman/PlanetNavigator\n'
)
const zipPath = path.join(distDir, `PlanetNavigator-mod-${version}.zip`)
await rm(zipPath, { force: true })
// bsdtar's -a picks the zip format from the extension. Windows ships it in System32; use that
// path explicitly because Git for Windows puts GNU tar (no zip support) earlier on PATH.
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
run(tar, ['-a', '-cf', zipPath, '-C', stage, 'PlanetNavigator'])
run('gh', ['release', 'upload', tag, zipPath, '--clobber'])

const url = capture('gh', ['release', 'view', tag, '--json', 'url', '--jq', '.url'])
console.log(`\nDraft release ready: ${url ?? tag}`)
console.log('Add release notes and click "Publish release" to ship it. Installed apps pick it up on their next check.')
