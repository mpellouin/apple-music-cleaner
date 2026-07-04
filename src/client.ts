import type { Config } from './config.js'

const BASE_URL = 'https://amp-api.music.apple.com'
const MAX_RETRIES = 5

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

export interface ApiResponse<T> {
  status: number
  body: T | null
}

interface Page<T> {
  data?: T[]
  next?: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class AppleMusicClient {
  constructor(private readonly config: Config) {}

  async request<T>(method: 'GET' | 'DELETE', path: string): Promise<ApiResponse<T>> {
    const url = BASE_URL + path
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${this.config.devToken}`,
          'media-user-token': this.config.mediaUserToken,
          origin: 'https://music.apple.com',
        },
      })
      if (res.status === 401 || res.status === 403) {
        throw new ApiError(
          `Authentication failed (HTTP ${res.status}). Your tokens have likely expired — grab fresh ones from music.apple.com (see .env.example).`,
          res.status,
        )
      }
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        await sleep(500 * 2 ** attempt)
        continue
      }
      if (!res.ok && res.status !== 404) {
        throw new ApiError(`${method} ${path} failed with HTTP ${res.status}`, res.status)
      }
      const body = res.status === 204 ? null : await res.json().catch(() => null)
      return { status: res.status, body: body as T | null }
    }
  }

  async *paginate<T>(path: string): AsyncGenerator<T> {
    let next: string | undefined = path
    while (next) {
      const { body }: ApiResponse<Page<T>> = await this.request<Page<T>>('GET', next)
      for (const item of body?.data ?? []) yield item
      next = body?.next
      if (next && !next.includes('limit=')) {
        next += (next.includes('?') ? '&' : '?') + 'limit=100'
      }
    }
  }
}
