export interface TokenInfo {
  valid: boolean
  expiresAt?: Date
  expired: boolean
  message: string
}

/** Decode JWT expiry from the web-player dev token (no signature verification). */
export function inspectDevToken(token: string): TokenInfo {
  const raw = token.startsWith('Bearer ') ? token.slice(7) : token
  const parts = raw.split('.')
  if (parts.length !== 3 || !raw.startsWith('eyJ')) {
    return { valid: false, expired: true, message: 'Not a JWT (expected eyJ… three-part token)' }
  }
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
    if (typeof payload.exp !== 'number') {
      return { valid: true, expired: false, message: 'JWT decoded but has no exp claim' }
    }
    const expiresAt = new Date(payload.exp * 1000)
    const expired = expiresAt.getTime() < Date.now()
    return {
      valid: true,
      expiresAt,
      expired,
      message: expired
        ? `Expired on ${expiresAt.toISOString().slice(0, 10)} — grab fresh tokens from music.apple.com`
        : `Valid until ${expiresAt.toISOString().slice(0, 10)}`,
    }
  } catch {
    return { valid: false, expired: true, message: 'Could not decode JWT payload' }
  }
}
