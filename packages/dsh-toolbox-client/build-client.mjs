import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('.', import.meta.url))
const uiRoot = resolve(packageRoot, '../../native/YourAllIn1Helper/src-ui')
const require = createRequire(resolve(uiRoot, 'package.json'))
const { build } = require('vite')
const configFile = resolve(packageRoot, 'vite.embedded.config.mjs')
const outputDir = resolve(packageRoot, '.embedded-build')

await build({ configFile })

const dashboardBundle = await readFile(resolve(outputDir, 'dashboard.cjs'), 'utf8')
const dashboardStyles = await readFile(resolve(outputDir, 'style.css'), 'utf8')
const clientPath = resolve(packageRoot, 'client.js')
const client = await readFile(clientPath, 'utf8')
const start = '/* embedded-dashboard-bundle:start */'
const end = '/* embedded-dashboard-bundle:end */'
const startIndex = client.indexOf(start)
const endIndex = client.indexOf(end)
if (startIndex < 0 || endIndex < startIndex) throw new Error('Client bundle is missing embedded dashboard markers')

const bundle = `
    const embeddedDashboard = (() => {
      const module = { exports: {} }
      const exports = module.exports
      ${dashboardBundle}
      return module.exports
    })()
    const embeddedDashboardStyles = ${JSON.stringify(dashboardStyles)}
`
const generated = `${client.slice(0, startIndex + start.length)}${bundle}${client.slice(endIndex)}`
await writeFile(clientPath, generated)
console.log(`Embedded Vue dashboard in Client bundle (${Buffer.byteLength(generated)} bytes)`)
