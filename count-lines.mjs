// 统计当前工作目录代码量：按 js / css / html 分组（按文件后缀），只数行数
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, extname, relative } from 'node:path'

const GROUPS = {
  js: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts'],
  css: ['.css', '.scss', '.sass', '.less'],
  html: ['.html', '.htm'],
}
const EXT_TO_GROUP = {}
for (const [group, exts] of Object.entries(GROUPS)) {
  for (const ext of exts) EXT_TO_GROUP[ext] = group
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '.next', '.nuxt', '.cache', 'out',
])

const root = process.cwd()
const totals = {}   // group -> { lines, files }
const byExt = {}    // ext -> { lines, files }

function countLines(file) {
  let n = 0
  try {
    const text = readFileSync(file, 'utf8')
    for (const ch of text) if (ch === '\n') n++
    if (text.length > 0 && !text.endsWith('\n')) n++
  } catch { /* 忽略无法读取的文件 */ }
  return n
}

function walk(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch { return }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) {
      walk(p)
    } else {
      const ext = extname(name).toLowerCase()
      const group = EXT_TO_GROUP[ext]
      if (!group) continue
      const lines = countLines(p)
      totals[group] ??= { lines: 0, files: 0 }
      totals[group].lines += lines
      totals[group].files++
      byExt[ext] ??= { lines: 0, files: 0 }
      byExt[ext].lines += lines
      byExt[ext].files++
    }
  }
}

walk(root)

const pad = (s, w) => String(s).padStart(w)
const fmt = n => n.toLocaleString('en-US')

console.log(`目录: ${root}`)
console.log('')
console.log(pad('分组', 8) + pad('文件数', 8) + pad('行数', 10) + '  说明')
console.log('-'.repeat(46))
let totalLines = 0, totalFiles = 0
for (const group of Object.keys(GROUPS)) {
  const t = totals[group] ?? { lines: 0, files: 0 }
  totalLines += t.lines
  totalFiles += t.files
  console.log(
    pad(group, 8) + pad(t.files, 8) + pad(fmt(t.lines), 10) +
    `  (${GROUPS[group].join(' ')} 共 ${GROUPS[group].length} 种后缀)`
  )
}
console.log('-'.repeat(46))
console.log(pad('合计', 8) + pad(totalFiles, 8) + pad(fmt(totalLines), 10))
console.log('')
console.log('按后缀明细:')
for (const [ext, t] of Object.entries(byExt).sort((a, b) => b[1].lines - a[1].lines)) {
  console.log(`  ${pad(ext, 6)} ${pad(t.files, 6)} 个文件  ${pad(fmt(t.lines), 10)} 行`)
}
