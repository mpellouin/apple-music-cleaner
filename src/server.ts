import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppleMusicClient } from './client.js'
import { buildRuleContext } from './cleanup-context.js'
import { resolvePreset } from './presets.js'
import { applyFavoriteRules, type CleanRules } from './rules.js'
import { captureSnapshot, compareSnapshots, loadSnapshot, saveSnapshot } from './snapshot.js'
import { inspectDevToken } from './token-info.js'
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
import { favoritesFromScan } from './favorites.js'
import { listEmptyPlaylists } from './library-clean.js'
import { removeFavorites } from './remove.js'

const HOST = process.env.HOST ?? '127.0.0.1'
const PORT = Number(process.env.PORT ?? 3000)
const WEB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../web')

type JsonBody = Record<string, string | number | boolean | undefined>

function readJson(req: IncomingMessage): Promise<JsonBody> {
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

async function clientFrom(req: IncomingMessage): Promise<{
  client: AppleMusicClient
  body: JsonBody
}> {
  const body = await readJson(req)
  if (!body.devToken || !body.userToken) throw new Error('Both tokens are required.')
  return {
    client: new AppleMusicClient({
      devToken: String(body.devToken),
      mediaUserToken: String(body.userToken),
    }),
    body,
  }
}

function rulesFromBody(body: JsonBody): CleanRules {
  const rules: CleanRules = {}
  if (body.preset) Object.assign(rules, resolvePreset(String(body.preset)))
  if (body.noPlaysWithinDays) rules.noPlaysWithinDays = Number(body.noPlaysWithinDays)
  if (body.neverPlayed === true || body.neverPlayed === 'true') rules.neverPlayed = true
  if (body.duplicatesOnly === true || body.duplicatesOnly === 'true') rules.duplicatesOnly = true
  if (body.orphanAlbum === true || body.orphanAlbum === 'true') rules.orphanAlbumOnly = true
  if (body.excludePurchased === true || body.excludePurchased === 'true') rules.excludePurchased = true
  return rules
}

async function handleInventory(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const send = ndjson(res)
  try {
    const { client, body } = await clientFrom(req)
    const token = inspectDevToken(String(body.devToken))
    send({
      event: 'token',
      expired: token.expired,
      message: token.message,
      expiresAt: token.expiresAt?.toISOString(),
    })

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

async function handlePreview(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const send = ndjson(res)
  try {
    const { client, body } = await clientFrom(req)
    send({ event: 'phase', label: 'Scanning favorites' })
    const favorites = await favoritesFromScan(client)
    const rules = rulesFromBody(body)
    const ctx = await buildRuleContext(client, rules)
    const selection = applyFavoriteRules(favorites, rules, ctx)
    send({
      event: 'done',
      count: selection.targets.length,
      preview: selection.targetsWithReasons.map(({ track, reasons }) => ({
        label: `${track.name} — ${track.artist}`,
        reasons,
      })),
    })
  } catch (e) {
    send({ event: 'error', message: errMessage(e) })
  }
  res.end()
}

async function handleClean(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const send = ndjson(res)
  try {
    const { client, body } = await clientFrom(req)
    const mode = String(body.mode ?? '')
    const dryRun = String(body.dryRun) === 'true'
    const progress = (label: string) => (done: number, total: number) =>
      send({ event: 'progress', label, done, total })

    if (mode === 'selective') {
      send({ event: 'phase', label: dryRun ? 'Previewing selective cleanup' : 'Applying selective cleanup' })
      const favorites = await favoritesFromScan(client)
      const rules = rulesFromBody(body)
      const ctx = await buildRuleContext(client, rules)
      const selection = applyFavoriteRules(favorites, rules, ctx)
      send({ event: 'found', count: selection.targets.length })
      if (dryRun || selection.targets.length === 0) {
        send({
          event: 'done',
          deleted: 0,
          failed: 0,
          failures: [],
          dryRun: true,
          preview: selection.targetsWithReasons.map(({ track, reasons }) => ({
            label: `${track.name} — ${track.artist}`,
            reasons,
          })),
        })
        return void res.end()
      }
      const failures = await removeFavorites(client, selection.targets, progress('Removing favorites'))
      send({
        event: 'done',
        deleted: selection.targets.length - failures.length,
        failed: failures.length,
        failures: failures.map((f) => `${f.track.name} — ${f.track.artist}`),
        dryRun: false,
      })
    } else if (mode === 'favorites') {
      send({ event: 'phase', label: dryRun ? 'Previewing favorites to remove' : 'Scanning your library' })
      const songsCat = CATEGORIES.find((c) => c.key === 'songs')!
      const songs = await listCategory(client, songsCat)
      const favIds = new Set(await ratedIds(client, 'library-songs', songs.map((s) => s.id), 1))
      const favorites = songs.filter((s) => favIds.has(s.id))
      send({ event: 'found', count: favorites.length, tracks: favorites.map((f) => f.label) })
      if (favorites.length === 0) {
        send({ event: 'done', deleted: 0, failed: 0, failures: [], dryRun })
        return void res.end()
      }
      if (dryRun) {
        send({ event: 'done', deleted: 0, failed: 0, failures: [], dryRun: true, preview: favorites.map((f) => f.label) })
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
        dryRun: false,
      })
    } else if (mode === 'empty-playlists') {
      send({ event: 'phase', label: 'Finding empty playlists' })
      const empty = await listEmptyPlaylists(client)
      send({ event: 'found', count: empty.length, tracks: empty.map((p) => p.label) })
      if (dryRun || empty.length === 0) {
        send({ event: 'done', deleted: 0, failed: 0, failures: [], dryRun: true, preview: empty.map((p) => p.label) })
        return void res.end()
      }
      const cat = CATEGORIES.find((c) => c.key === 'playlists')!
      const failures = await deleteItems(client, cat, empty, progress('Deleting empty playlists'))
      send({
        event: 'done',
        deleted: empty.length - failures.length,
        failed: failures.length,
        failures: failures.map((f) => f.label),
        dryRun: false,
      })
    } else if (mode === 'wipe') {
      send({ event: 'phase', label: dryRun ? 'Previewing library wipe' : 'Inventorying your library' })
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

      if (dryRun) {
        send({
          event: 'done',
          deleted: 0,
          failed: 0,
          failures: [],
          dryRun: true,
          preview: { items: total - ratings.length, ratings: ratings.length },
        })
        return void res.end()
      }

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
        dryRun: false,
      })
    } else {
      throw new Error(`Unknown mode: ${mode}`)
    }
  } catch (e) {
    send({ event: 'error', message: errMessage(e) })
  }
  res.end()
}

async function handleSnapshot(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const send = ndjson(res)
  try {
    const { client, body } = await clientFrom(req)
    const action = String(body.action ?? 'save')
    const path = String(body.path ?? 'snapshot.json')
    if (action === 'compare') {
      const before = loadSnapshot(path)
      const after = await captureSnapshot(client)
      send({ event: 'compare', lines: compareSnapshots(before, after) })
    } else {
      const snap = await captureSnapshot(client)
      saveSnapshot(path, snap)
      send({ event: 'saved', path, capturedAt: snap.capturedAt })
    }
    send({ event: 'done' })
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
  if (req.method === 'POST' && req.url === '/api/preview') return void handlePreview(req, res)
  if (req.method === 'POST' && req.url === '/api/clean') return void handleClean(req, res)
  if (req.method === 'POST' && req.url === '/api/snapshot') return void handleSnapshot(req, res)
  return void serveStatic(req, res)
}).listen(PORT, HOST, () => {
  console.log(`apple-music-cleaner running at http://${HOST}:${PORT}`)
})
