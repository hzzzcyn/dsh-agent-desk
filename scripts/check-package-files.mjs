#!/usr/bin/env node
/**
 * 打包前校验：package.json 里声明的每个文件都必须真实存在于磁盘。
 *
 * 背景：0.2.2 的 package.json 声明了 "icon": "icon.svg" 且 files 里也列了 icon.svg，
 * 但文件从未创建，npm 打包时静默跳过，安装后插件页报 ENOENT。
 * 这个脚本在 `npm run check` 与 `npm pack`（prepack）前各跑一次，缺失就非零退出。
 *
 * 支持 files 里的字面路径（文件或目录）与简单通配符 `*`、`**`、`?`；
 * 不支持 brace 展开，写了 `{a,b}` 会按字面匹配并在缺失时暴露出来。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function fail(message, code) {
  console.error(`[check-package-files] ${message}`)
  process.exit(code)
}

let pkg
try {
  pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
} catch (err) {
  fail(`无法读取或解析 package.json：${err.message}`, 2)
}

const entries = Array.isArray(pkg.files) ? pkg.files.map(String) : []
if (entries.length === 0) {
  console.warn('[check-package-files] package.json 没有 files 字段，跳过校验')
  process.exit(0)
}

const GLOB_CHARS = /[*?[\]{}]/

function normalize(entry) {
  return entry.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

function walk(dir, out = []) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.name === 'node_modules' || item.name === '.git') continue
    const abs = join(dir, item.name)
    if (item.isDirectory()) walk(abs, out)
    else if (item.isFile()) out.push(abs)
  }
  return out
}

function globToRegExp(pattern) {
  let re = ''
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        i += 1
        if (pattern[i + 1] === '/') {
          i += 1
          re += '(?:[^/]+/)*'
        } else {
          re += '.*'
        }
      } else {
        re += '[^/]*'
      }
    } else if (ch === '?') {
      re += '[^/]'
    } else if ('\\^$+.()|{}[]'.includes(ch)) {
      re += `\\${ch}`
    } else {
      re += ch
    }
  }
  return new RegExp(`^${re}$`)
}

const missing = []
let allFiles = null
const relFiles = () => {
  if (!allFiles) allFiles = walk(root).map((abs) => relative(root, abs).split(sep).join('/'))
  return allFiles
}

for (const raw of entries) {
  const entry = normalize(raw)
  if (!entry) {
    missing.push(JSON.stringify(raw))
    continue
  }
  if (!GLOB_CHARS.test(entry)) {
    if (!existsSync(join(root, ...entry.split('/')))) missing.push(entry)
    continue
  }
  const re = globToRegExp(entry)
  if (!relFiles().some((rel) => re.test(rel))) missing.push(entry)
}

// "icon" 可能不在 files 里，但插件页会读它；单独守一道，避免同类 ENOENT 复发。
const icon = typeof pkg.icon === 'string' ? normalize(pkg.icon) : ''
const iconMissing = icon !== '' && !existsSync(join(root, ...icon.split('/')))
if (iconMissing && !missing.includes(icon)) missing.push(`icon: ${icon}`)

if (missing.length > 0) {
  console.error(`[check-package-files] ${pkg.name || 'package'} 有 ${missing.length} 项声明在磁盘上不存在（根目录：${root}）：`)
  for (const item of missing) console.error(`  - ${item}`)
  console.error('[check-package-files] 请创建缺失文件，或从 package.json 的 files / icon 中移除声明。')
  process.exit(1)
}

console.log(`[check-package-files] OK：${entries.length} 项 files 声明均存在${icon ? `（icon: ${icon}）` : ''}`)
