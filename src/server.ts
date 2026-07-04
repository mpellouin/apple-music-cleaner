import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppleMusicClient } from './client.js'
import {
  CATEGORIES,
  deleteItems,
  deleteRatings,
  findRatings,
  listCategory,
  ratedIds,
  type Failure,
  type RatingTarget,
  type WipeItem,
} from './wipe.js'

const HOST = process.env.HOST ?? '127.0.0.1'
const PORT = Number(process.env.PORT ?? 3000)
const WEB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../web')

function readJson(req: IncomingMessage): Promise<Record<string, string>> {
  return new Promise((res, rej) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      try {
        res(JSON.parse(data))
      } catch {
        rej(new Error('Invalid JSON body'))
      }
    })
    req.on('error', rej)
  })
}

function ndjson(res: ServerResponse): (obj: unknown) => void {
  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-cache',
    'x-accel-buffering': 'no',
  })
  return (obj) => res.write(JSON.stringify(obj) + '\n')
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

async function clientFrom(req: IncomingMessage): Promise<{ client: AppleMusicClient; mode?: string }> {
  const body = await readJson(req)
  if (!body.devToken || !body.userToken) throw new Error('Both tokens are required.')
  return {
    client: new AppleMusicClient({ devToken: body.devToken, mediaUserToken: body.userToken }),
    mode: body.mode,
  }
}

async function handleInventory(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const send = ndjson(res)
  try {
    const { client } = await clientFrom(req)
    let songs: WipeItem[] = []
    for (const cat of CATEGORIES) {
      const items = await listCategory(client, cat)
      if (cat.key === 'songs') songs = items
      send({ event: 'category', key: cat.key, count: items.length })
    }
    const favIds = new Set(await ratedIds(client, 'library-songs', songs.map((s) => s.id), 1))
    const favorites = songs.filter((s) => favIds.has(s.id))
    send({ event: 'favorites', count: favorites.length, tracks: favorites.map((f) => f.label) })
    send({ event: 'done' })
  } catch (e) {
    send({ event: 'error', message: errMessage(e) })
  }
  res.end()
}

async function handleClean(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const send = ndjson(res)
  try {
    const { client, mode } = await clientFrom(req)
    const progress = (label: string) => (done: number, total: number) =>
      send({ event: 'progress', label, done, total })

    if (mode === 'favorites') {
      send({ event: 'phase', label: 'Scanning your library' })
      const songsCat = CATEGORIES.find((c) => c.key === 'songs')!
      const songs = await listCategory(client, songsCat)
      const favIds = new Set(await ratedIds(client, 'library-songs', songs.map((s) => s.id), 1))
      const favorites = songs.filter((s) => favIds.has(s.id))
      send({ event: 'found', count: favorites.length })
      if (favorites.length === 0) {
        send({ event: 'done', deleted: 0, failed: 0, failures: [] })
        return void res.end()
      }
      send({ event: 'phase', label: 'Removing favorites' })
      const targets: RatingTarget[] = favorites.map((f) => ({ ratingType: 'library-songs', id: f.id }))
      const failures = await deleteRatings(client, targets, progress('Removing favorites'))
      send({
        event: 'done',
        deleted: favorites.length - failures.length,
        failed: failures.length,
        failures: failures.map((f) => f.label),
      })
    } else if (mode === 'wipe') {
      send({ event: 'phase', label: 'Inventorying your library' })
      const inventory: { cat: (typeof CATEGORIES)[number]; items: WipeItem[] }[] = []
      for (const cat of CATEGORIES) {
        const items = await listCategory(client, cat)
        inventory.push({ cat, items })
        send({ event: 'category', key: cat.key, count: items.length })
      }
      send({ event: 'phase', label: 'Finding ratings' })
      const ratings: RatingTarget[] = []
      for (const { cat, items } of inventory) ratings.push(...(await findRatings(client, cat, items)))
      const total = inventory.reduce((n, { items }) => n + items.length, 0) + ratings.length
      send({ event: 'found', count: total })

      const failures: Failure[] = []
      if (ratings.length > 0) {
        send({ event: 'phase', label: 'Clearing ratings' })
        failures.push(...(await deleteRatings(client, ratings, progress('Clearing ratings'))))
      }
      for (const { cat, items } of inventory) {
        if (items.length === 0) continue
        send({ event: 'phase', label: `Deleting ${cat.key}` })
        failures.push(...(await deleteItems(client, cat, items, progress(`Deleting ${cat.key}`))))
      }
      send({
        event: 'done',
        deleted: total - failures.length,
        failed: failures.length,
        failures: failures.map((f) => f.label),
      })
    } else {
      throw new Error(`Unknown mode: ${mode}`)
    }
  } catch (e) {
    send({ event: 'error', message: errMessage(e) })
  }
  res.end()
}

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = req.url === '/' || req.url === '/index.html' ? 'index.html' : null
  if (!path) {
    res.writeHead(404).end('Not found')
    return
  }
  try {
    const html = await readFile(resolve(WEB_DIR, path))
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html)
  } catch {
    res.writeHead(404).end('Not found')
  }
}

createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/inventory') return void handleInventory(req, res)
  if (req.method === 'POST' && req.url === '/api/clean') return void handleClean(req, res)
  return void serveStatic(req, res)
}).listen(PORT, HOST, () => {
  console.log(`apple-music-cleaner running at http://${HOST}:${PORT}`)
})
