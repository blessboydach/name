// ============================================================
//  VANGUARD MD — index.js (LOADER)
//
//  Protected By Dach Tech Team 🥤
//  Copyright mradminblue2026 💙
//  All rights reserved 🔒
//  Reverse engineering / modifications strictly forbidden ❌
//  unless prior permission from developer 🧑‍💻
//  Collaborations & Contributions Welcome 🤗
//  Credit to Lord Mega - Popkid Tech - Taylor - Mr Unique Hacker 🙏
//  Vanguard Md is on Fire 🔥
//
//  This loader:
//   1. Fetches bots.bin from the backend repo
//   2. Decrypts it into memory
//   3. Fetches assets/ and data/ files, writes them to disk
//   4. Installs deps if needed
//   5. Runs the app entirely from memory
// ============================================================

'use strict'

const fs     = require('fs')
const path   = require('path')
const https  = require('https')
const crypto = require('crypto')
const cp     = require('child_process')
const vm     = require('vm')
const Module = require('module')
const { fileURLToPath } = require('url')

// ── Save originals ──────────────────────────────────────────
const _fs = {
  readFileSync: fs.readFileSync, readFile: fs.readFile,
  writeFileSync: fs.writeFileSync, writeFile: fs.writeFile,
  appendFileSync: fs.appendFileSync, appendFile: fs.appendFile,
  existsSync: fs.existsSync,
  statSync: fs.statSync, lstatSync: fs.lstatSync,
  stat: fs.stat, lstat: fs.lstat,
  readdirSync: fs.readdirSync, readdir: fs.readdir,
  unlinkSync: fs.unlinkSync, unlink: fs.unlink,
  realpathSync: fs.realpathSync, realpath: fs.realpath,
  openSync: fs.openSync, open: fs.open,
  createReadStream: fs.createReadStream,
  createWriteStream: fs.createWriteStream,
  mkdirSync: fs.mkdirSync, mkdir: fs.mkdir,
  rmdirSync: fs.rmdirSync,
  copyFileSync: fs.copyFileSync,
  rmSync: fs.rmSync, renameSync: fs.renameSync,
}
const _execSync = cp.execSync
const _exec     = cp.exec
const _spawn    = cp.spawn
const _spawnSync = cp.spawnSync
const _stdout   = process.stdout.write.bind(process.stdout)
const _stderr   = process.stderr.write.bind(process.stderr)
const _console = {
  log: console.log.bind(console), error: console.error.bind(console),
  warn: console.warn.bind(console), info: console.info.bind(console),
  debug: console.debug.bind(console),
}

// ════════════════════════════════════════════════════════════
//  CONFIG
// ════════════════════════════════════════════════════════════
const BASE         = __dirname
const BLOB_FILE    = path.join(BASE, 'bots.bin')
const BACKEND_RAW  = 'https://raw.githubusercontent.com/blessboydach/greenwater/main'

const ENTRY_FILENAME = path.join(BASE, '__entry__.js')
const APP_ENTRY_KEY  = 'index.js'

const SEED_PARTS = ['vgmd', 'dach', '2026', 'fire', 'blob', 'secure', 'v1']
const BUILD_SEED = SEED_PARTS.join('-') + '::' + 'x'.repeat(16)
const BUILD_KEY  = crypto.createHash('sha256').update(BUILD_SEED).digest()

const MAGIC       = Buffer.from('VGBOT001')
const HEADER_SIZE = 64
const IV_LEN      = 12
const TAG_LEN     = 16

const JS_EXT   = new Set(['.js', '.mjs', '.cjs'])
const JSON_EXT = new Set(['.json'])

// Directories handled as real runtime dirs on disk
const RUNTIME_DIRS = ['session', 'sessions', 'tmp', 'temp']

// Directories the loader fetches from backend and writes to disk
// (these are the "external" dirs from developermode.js)
const EXTERNAL_DIRS = ['assets', 'data']

// Never descend into node_modules for blob lookup
const NODE_MODULES = path.sep + 'node_modules' + path.sep

const LOG = '[VANGUARD-MD]'
const rawLog = (...a) => _console.log(LOG, ...a)

// ════════════════════════════════════════════════════════════
//  CRYPTO
// ════════════════════════════════════════════════════════════
function decryptGCM(ctBuf, key, iv, tag) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(ctBuf), d.final()])
}

// ════════════════════════════════════════════════════════════
//  BLOB STATE
// ════════════════════════════════════════════════════════════
const BLOB = {
  buffer: null,
  index:  null,
  files:  new Map(),
  dirs:   new Map(),
  external: {},
  loaded: false,
}

function pathToBlobKey(fp) {
  const s = typeof fp === 'string' ? fp : String(fp)
  if (s === BASE) return ''
  const prefix = BASE + path.sep
  if (!s.startsWith(prefix)) return null
  return s.slice(prefix.length).split(path.sep).join('/')
}

function blobKeyToPath(key) {
  if (!key) return BASE
  return path.join(BASE, key.split('/').join(path.sep))
}

function blobRead(key) {
  const entry = BLOB.files.get(key)
  if (!entry) return null
  const start = HEADER_SIZE + BLOB.index.indexSize + entry.off
  const ct = BLOB.buffer.slice(start, start + entry.size)
  const iv = Buffer.from(entry.iv, 'base64')
  const tag = Buffer.from(entry.tag, 'base64')
  try { return decryptGCM(ct, BUILD_KEY, iv, tag) }
  catch { return null }
}

// ════════════════════════════════════════════════════════════
//  HTTP
// ════════════════════════════════════════════════════════════
function rawFetch(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'))
    const u = new URL(url)
    const req = https.get({
      host: u.host,
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'vg-boot/1.0' },
      timeout: 180000
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume()
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).toString()
        return resolve(rawFetch(next, redirects + 1))
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('Timeout')))
  })
}

async function rawFetchTo(url, destPath) {
  const buf = await rawFetch(url)
  await _fs.promises.mkdir(path.dirname(destPath), { recursive: true })
  await _fs.promises.writeFile(destPath, buf)
  return buf.length
}

// ══════════════════════════════════ ══════════════════════════
//  BLOB LOADING
// ════════════════════════════════════════════════════════════
async function fetchBlob() {
  rawLog('📦 Downloading package...')
  const buf = await rawFetch(`${BACKEND_RAW}/bots.bin`)
  if (buf.length < HEADER_SIZE || !buf.slice(0, 8).equals(MAGIC)) {
    throw new Error('Invalid blob format')
  }
  await _fs.promises.writeFile(BLOB_FILE, buf)
  return buf
}

function parseBlob(buf) {
  const indexSize = buf.readUInt32BE(16)
  const indexIV = buf.slice(20, 32)
  const indexTAG = buf.slice(32, 48)
  const indexCT = buf.slice(HEADER_SIZE, HEADER_SIZE + indexSize)
  const indexBuf = decryptGCM(indexCT, BUILD_KEY, indexIV, indexTAG)
  const indexObj = JSON.parse(indexBuf.toString('utf8'))

  BLOB.buffer = buf
  BLOB.index = indexObj
  BLOB.index.indexSize = indexSize
  BLOB.files = new Map(Object.entries(indexObj.files || {}))
  BLOB.dirs = new Map(
    Object.entries(indexObj.dirs || {}).map(([k, v]) => [k, new Set(v)])
  )
  BLOB.external = indexObj.external || {}
  BLOB.loaded = true
}

function loadLocalBlob() {
  if (!_fs.existsSync(BLOB_FILE)) return false
  try {
    const buf = _fs.readFileSync(BLOB_FILE)
    if (buf.length < HEADER_SIZE || !buf.slice(0, 8).equals(MAGIC)) return false
    parseBlob(buf)
    return true
  } catch { return false }
}

// ════════════════════════════════════════════════════════════
//  EXTERNAL DIR SYNC
// ════════════════════════════════════════════════════════════
async function syncExternalDirs() {
  const entries = Object.entries(BLOB.external)
  if (!entries.length) return

  rawLog(`📁 Syncing ${entries.length} external file(s)...`)

  // Only sync files that are missing or whose hash changed
  let downloaded = 0
  let skipped = 0

  const CONCURRENCY = 6
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY)
    await Promise.all(batch.map(async ([rel, meta]) => {
      const abs = path.join(BASE, rel.split('/').join(path.sep))

      // Skip if file exists and hash matches
      try {
        if (_fs.existsSync(abs)) {
          const existing = _fs.readFileSync(abs)
          const h = crypto.createHash('sha1').update(existing).digest('hex')
          if (h === meta.sha1) { skipped++; return }
        }
      } catch {}

      try {
        const size = await rawFetchTo(`${BACKEND_RAW}/${rel}`, abs)
        downloaded++
        rawLog(`  ↓ ${rel} (${size < 1024 * 1024 ? (size / 1024).toFixed(1) + ' KB' : (size / 1024 / 1024).toFixed(2) + ' MB'})`)
      } catch (e) {
        _console.error(LOG, `  ✗ Failed ${rel}: ${e.message}`)
      }
    }))
  }

  rawLog(`📁 External sync complete — ${downloaded} new, ${skipped} cached`)
}

// ════════════════════════════════════════════════════════════
//  RUNTIME DIRS
// ════════════════════════════════════════════════════════════
function ensureRuntimeDirs() {
  for (const name of [...RUNTIME_DIRS, ...EXTERNAL_DIRS]) {
    try { _fs.mkdirSync(path.join(BASE, name), { recursive: true }) } catch {}
  }
}

// ════════════════════════════════════════════════════════════
//  CONTENT DECODING
// ════════════════════════════════════════════════════════════
function decodeContent(buf, encoding) {
  if (!encoding) return buf
  if (typeof encoding === 'string') {
    if (encoding === 'buffer') return buf
    try { return buf.toString(encoding) } catch { return buf.toString('utf8') }
  }
  if (typeof encoding === 'object') {
    const enc = encoding.encoding
    if (!enc || enc === 'buffer') return buf
    try { return buf.toString(enc) } catch { return buf.toString('utf8') }
  }
  return buf
}

// ════════════════════════════════════════════════════════════
//  FS PATCH
// ════════════════════════════════════════════════════════════
function patchFs() {
  let _statsProto = null
  try {
    _statsProto = Object.getPrototypeOf(_fs.statSync(__filename))
  } catch {
    try { _statsProto = Object.getPrototypeOf(_fs.statSync(BASE)) } catch {}
  }

  function makeStat(isFile, size) {
    const now = new Date()
    const nowMs = now.getTime()
    const s = _statsProto ? Object.create(_statsProto) : {}
    s.dev = 0; s.ino = 0
    s.mode = isFile ? 33188 : 16877
    s.nlink = 1; s.uid = 0; s.gid = 0; s.rdev = 0
    s.size = size
    s.blksize = 4096
    s.blocks = Math.ceil(size / 512)
    s.atimeMs = nowMs; s.mtimeMs = nowMs; s.ctimeMs = nowMs; s.birthtimeMs = nowMs
    s.atime = now; s.mtime = now; s.ctime = now; s.birthtime = now
    if (typeof s.isFile !== 'function') s.isFile = () => isFile
    if (typeof s.isDirectory !== 'function') s.isDirectory = () => !isFile
    if (typeof s.isSymbolicLink !== 'function') s.isSymbolicLink = () => false
    if (typeof s.isBlockDevice !== 'function') s.isBlockDevice = () => false
    if (typeof s.isCharacterDevice !== 'function') s.isCharacterDevice = () => false
    if (typeof s.isFIFO !== 'function') s.isFIFO = () => false
    if (typeof s.isSocket !== 'function') s.isSocket = () => false
    return s
  }

  function isNodeModules(p) {
    return typeof p === 'string' && p.includes(NODE_MODULES)
  }

  function blobLookup(fp) {
    const s = typeof fp === 'string' ? fp : String(fp)
    if (isNodeModules(s)) return null
    const key = pathToBlobKey(s)
    if (key === null || key === '') return null
    return BLOB.files.has(key) ? key : null
  }

  function blobLookupDir(fp) {
    const s = typeof fp === 'string' ? fp : String(fp)
    if (isNodeModules(s)) return null
    const key = pathToBlobKey(s)
    if (key === null) return null
    return BLOB.dirs.has(key) ? key : null
  }

  fs.readFileSync = function (fp, opts, ...rest) {
    const key = blobLookup(fp)
    if (key) {
      const buf = blobRead(key)
      if (buf) return decodeContent(buf, opts)
    }
    return _fs.readFileSync(fp, opts, ...rest)
  }

  fs.readFile = function (fp, opts, cb) {
    if (typeof opts === 'function') { cb = opts; opts = undefined }
    const key = blobLookup(fp)
    if (key) {
      const buf = blobRead(key)
      if (buf) {
        const out = decodeContent(buf, opts)
        return process.nextTick(() => cb(null, out))
      }
    }
    return _fs.readFile(fp, opts, cb)
  }

  fs.statSync = function (fp, ...a) {
    const key = blobLookup(fp)
    if (key) {
      const entry = BLOB.files.get(key)
      return makeStat(true, entry ? entry.size : 0)
    }
    const dKey = blobLookupDir(fp)
    if (dKey !== null) return makeStat(false, 0)
    return _fs.statSync(fp, ...a)
  }
  fs.lstatSync = fs.statSync

  fs.stat = function (fp, opts, cb) {
    if (typeof opts === 'function') { cb = opts; opts = undefined }
    try { return process.nextTick(() => cb(null, fs.statSync(fp))) }
    catch (e) { return process.nextTick(() => cb(e)) }
  }
  fs.lstat = fs.stat

  fs.existsSync = function (fp) {
    if (blobLookup(fp)) return true
    if (blobLookupDir(fp) !== null) return true
    try { return _fs.existsSync(fp) } catch { return false }
  }

  fs.readdirSync = function (dir, opts) {
    const dKey = blobLookupDir(dir)
    if (dKey !== null) {
      const names = Array.from(BLOB.dirs.get(dKey))
      if (opts && opts.withFileTypes) {
        return names.map(name => {
          const childKey = dKey ? dKey + '/' + name : name
          const isDir = BLOB.dirs.has(childKey)
          const s = makeStat(!isDir, 0)
          s.name = name
          return s
        })
      }
      return names
    }
    return _fs.readdirSync(dir, opts)
  }

  fs.readdir = function (dir, opts, cb) {
    if (typeof opts === 'function') { cb = opts; opts = undefined }
    try { return process.nextTick(() => cb(null, fs.readdirSync(dir, opts))) }
    catch (e) { return process.nextTick(() => cb(e)) }
  }

  fs.writeFileSync = function (fp, ...a) {
    try { _fs.mkdirSync(path.dirname(String(fp)), { recursive: true }) } catch {}
    return _fs.writeFileSync(fp, ...a)
  }
  fs.writeFile = function (fp, ...a) {
    try { _fs.mkdirSync(path.dirname(String(fp)), { recursive: true }) } catch {}
    return _fs.writeFile(fp, ...a)
  }
  fs.appendFileSync = function (fp, ...a) {
    try { _fs.mkdirSync(path.dirname(String(fp)), { recursive: true }) } catch {}
    return _fs.appendFileSync(fp, ...a)
  }
  fs.appendFile = function (fp, ...a) { return _fs.appendFile(fp, ...a) }
  fs.createWriteStream = function (fp, ...a) {
    try { _fs.mkdirSync(path.dirname(String(fp)), { recursive: true }) } catch {}
    return _fs.createWriteStream(fp, ...a)
  }

  fs.unlinkSync = function (fp, ...a) { return _fs.unlinkSync(fp, ...a) }
  fs.unlink = function (fp, ...a) { return _fs.unlink(fp, ...a) }

  fs.openSync = function (fp, ...a) { return _fs.openSync(fp, ...a) }
  fs.open = function (fp, ...a) { return _fs.open(fp, ...a) }

  fs.createReadStream = function (fp, opts) {
    const key = blobLookup(fp)
    if (key) {
      const buf = blobRead(key)
      if (buf) {
        const { Readable } = require('stream')
        let data = buf
        if (opts && typeof opts === 'object') {
          const start = Number.isInteger(opts.start) && opts.start >= 0 ? opts.start : 0
          const endRaw = Number.isInteger(opts.end) && opts.end >= 0 ? opts.end + 1 : buf.length
          const end = Math.min(endRaw, buf.length)
          if (start > 0 || end < buf.length) data = buf.slice(start, end)
        }
        return Readable.from(data)
      }
    }
    return _fs.createReadStream(fp, opts)
  }

  fs.realpathSync = function (fp, ...a) { return _fs.realpathSync(fp, ...a) }
  fs.realpath = function (fp, ...a) { return _fs.realpath(fp, ...a) }

  fs.mkdirSync = function (dir, ...a) { return _fs.mkdirSync(dir, ...a) }
  fs.mkdir = function (dir, ...a) { return _fs.mkdir(dir, ...a) }
}

// ════════════════════════════════════════════════════════════
//  CHILD_PROCESS PATCH
// ════════════════════════════════════════════════════════════
const INSTALL_RE = /\b(npm\s+(install|i|ci)|yarn(\s+install)?|pnpm\s+install)\b/
const isInstallCmd = (cmd) => typeof cmd === 'string' && INSTALL_RE.test(cmd)
function isInstallArgv(cmd, args) {
  if (typeof cmd !== 'string' || !Array.isArray(args)) return false
  const base = path.basename(cmd)
  if (base === 'npm' && /^(install|i|ci)$/.test(args[0])) return true
  if (base === 'yarn' && (args.length === 0 || args[0] === 'install')) return true
  if (base === 'pnpm' && args[0] === 'install') return true
  return false
}

function patchChildProcess() {
  cp.execSync = function (cmd, opts) {
    if (isInstallCmd(cmd)) return Buffer.from('')
    return _execSync(cmd, opts)
  }
  cp.spawnSync = function (cmd, args, opts) {
    if (isInstallArgv(cmd, args)) {
      return { status: 0, signal: null, pid: 0,
        output: [null, Buffer.from(''), Buffer.from('')],
        stdout: Buffer.from(''), stderr: Buffer.from('') }
    }
    return _spawnSync(cmd, args, opts)
  }
  cp.exec = function (cmd, opts, cb) {
    if (isInstallCmd(cmd)) {
      if (typeof opts === 'function') { cb = opts; opts = {} }
      if (typeof cb === 'function') process.nextTick(() => cb(null, '', ''))
      return { kill() {}, pid: 0, on() {}, once() {}, unref() {}, removeAllListeners() {} }
    }
    return _exec(cmd, opts, cb)
  }
  cp.spawn = function (cmd, args, opts) {
    if (isInstallArgv(cmd, args)) {
      const { EventEmitter } = require('events')
      const fake = new EventEmitter()
      fake.pid = 0
      fake.stdout = new EventEmitter()
      fake.stderr = new EventEmitter()
      fake.stdin = { write() {}, end() {} }
      fake.kill = () => {}
      fake.unref = () => {}
      process.nextTick(() => fake.emit('close', 0))
      return fake
    }
    return _spawn(cmd, args, opts)
  }
}

// ════════════════════════════════════════════════════════════
//  MODULE PATCH
// ════════════════════════════════════════════════════════════
function patchModule() {
  const originalResolve = Module._resolveFilename.bind(Module)
  const originalLoad = Module._load.bind(Module)

  function tryBlobResolve(request, parent) {
    if (!request.startsWith('./') && !request.startsWith('../') && !path.isAbsolute(request)) {
      return null
    }
    let absPath
    if (path.isAbsolute(request)) absPath = path.resolve(request)
    else {
      const parentDir = (parent && parent.filename) ? path.dirname(parent.filename) : BASE
      absPath = path.resolve(parentDir, request)
    }
    if (absPath !== BASE && !absPath.startsWith(BASE + path.sep)) return null

    const key = pathToBlobKey(absPath)
    if (key === null || key === '') return null

    if (BLOB.files.has(key)) return blobKeyToPath(key)

    const ext = path.extname(absPath).toLowerCase()
    if (!ext) {
      for (const s of ['.js', '.json', '.mjs', '.cjs']) {
        if (BLOB.files.has(key + s)) return blobKeyToPath(key + s)
      }
      for (const s of ['/index.js', '/index.json']) {
        if (BLOB.files.has(key + s)) return blobKeyToPath(key + s)
      }
    }
    for (const s of ['/index.js', '/index.json']) {
      if (BLOB.files.has(key + s)) return blobKeyToPath(key + s)
    }
    return null
  }

  function compileFromBlob(diskPath, key) {
    if (Module._cache[diskPath]) return Module._cache[diskPath].exports
    const buf = blobRead(key)
    if (!buf) throw new Error('Blob read failed: ' + key)
    const mod = new Module(diskPath, null)
    mod.filename = diskPath
    mod.paths = Module._nodeModulePaths(path.dirname(diskPath))

    const ext = path.extname(key).toLowerCase()

    if (JSON_EXT.has(ext)) {
      mod.exports = JSON.parse(buf.toString('utf8'))
      mod.loaded = true
      Module._cache[diskPath] = mod
      return mod.exports
    }
    if (JS_EXT.has(ext) || ext === '') {
      const code = buf.toString('utf8')
      const wrapper = Module.wrap(code)
      const script = new vm.Script(wrapper, { filename: diskPath })
      const compiled = script.runInThisContext()
      compiled.call(mod.exports, mod.exports, mod.require.bind(mod), mod,
        diskPath, path.dirname(diskPath))
      mod.loaded = true
      Module._cache[diskPath] = mod
      return mod.exports
    }
    mod.exports = buf.toString('utf8')
    mod.loaded = true
    Module._cache[diskPath] = mod
    return mod.exports
  }

  Module._resolveFilename = function (request, parent, isMain, options) {
    try { return originalResolve(request, parent, isMain, options) }
    catch (e) {
      const fallback = tryBlobResolve(request, parent)
      if (fallback) return fallback
      throw e
    }
  }

  Module._load = function (request, parent, isMain) {
    if (request === 'fs/promises' || request === 'node:fs/promises') return fs.promises
    let resolved
    try { resolved = Module._resolveFilename(request, parent, isMain) }
    catch { return originalLoad(request, parent, isMain) }

    const key = pathToBlobKey(resolved)
    if (key && BLOB.files.has(key)) return compileFromBlob(resolved, key)
    return originalLoad(request, parent, isMain)
  }
}

// ════════════════════════════════════════════════════════════
//  ENTRY
// ════════════════════════════════════════════════════════════
function loadEntry() {
  if (!BLOB.files.has(APP_ENTRY_KEY)) {
    throw new Error('Entry missing in blob: ' + APP_ENTRY_KEY)
  }
  const buf = blobRead(APP_ENTRY_KEY)
  if (!buf) throw new Error('Entry read failed')

  const mod = new Module(ENTRY_FILENAME, null)
  mod.filename = ENTRY_FILENAME
  mod.paths = Module._nodeModulePaths(BASE)

  const wrapper = Module.wrap(buf.toString('utf8'))
  const script = new vm.Script(wrapper, { filename: ENTRY_FILENAME })
  const compiled = script.runInThisContext()
  compiled.call(mod.exports, mod.exports, mod.require.bind(mod),
    mod, ENTRY_FILENAME, BASE)
  mod.loaded = true
  Module._cache[ENTRY_FILENAME] = mod
}

// ════════════════════════════════════════════════════════════
//  DEPS
// ════════════════════════════════════════════════════════════
function ensureDeps() {
  const baileys = path.join(BASE, 'node_modules', '@whiskeysockets', 'baileys')
  if (_fs.existsSync(baileys)) return
  const pkg = path.join(BASE, 'package.json')
  if (!_fs.existsSync(pkg)) return

  rawLog('📥 Installing dependencies...')
  try {
    _execSync('npm install --prefer-offline --no-audit --no-fund', {
      cwd: BASE, stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production' }
    })
  } catch (e) {
    _console.error(LOG, 'npm install warning:', e.message)
  }
}

// ════════════════════════════════════════════════════════════
//  MAIN
// ════════════════════════════════════════════════════════════
async function main() {
  ensureRuntimeDirs()

  // Blob — use local if valid, else fetch
  if (!loadLocalBlob()) {
    const buf = await fetchBlob()
    parseBlob(buf)
  }

  rawLog('📂 Extracting...')
  rawLog('🔄 Updating...')
  rawLog('⏳ Please wait...')

  // Sync external dirs (assets, data)
  await syncExternalDirs()

  // Ensure package.json exists locally (needed for npm install)
  if (!_fs.existsSync(path.join(BASE, 'package.json'))) {
    try {
      const pkgBuf = await rawFetch(`${BACKEND_RAW}/package.json`)
      await _fs.promises.writeFile(path.join(BASE, 'package.json'), pkgBuf)
    } catch {}
  }

  ensureDeps()

  patchFs()
  patchModule()
  patchChildProcess()

  rawLog('🚀 Starting Main Bot...')
  loadEntry()
}

main().catch(e => {
  _console.error(LOG, 'Boot error:', e && e.message ? e.message : e)
  process.exit(1)
})