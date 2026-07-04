import { existsSync, readFileSync } from 'node:fs'

export interface Config {
  devToken: string
  mediaUserToken: string
}

function loadDotEnv(path = '.env'): void {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
}

export function loadConfig(): Config {
  loadDotEnv()
  const devToken = process.env.AMC_DEV_TOKEN
  const mediaUserToken = process.env.AMC_MEDIA_USER_TOKEN
  if (!devToken || !mediaUserToken) {
    throw new Error(
      'Missing AMC_DEV_TOKEN or AMC_MEDIA_USER_TOKEN. Copy .env.example to .env and fill in both tokens.',
    )
  }
  return { devToken, mediaUserToken }
}
