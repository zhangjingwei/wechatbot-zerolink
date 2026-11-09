import { setTimeout as delay } from 'node:timers/promises'
import { AuthError } from '../core/errors.js'
import { CHANNEL_VERSION } from '../protocol/types.js'
import type { QrLoginCallbacks, RealnameClient, RealnameTicket } from './types.js'

const ENDPOINT = 'https://weixin110.qq.com/security/acct/botrealnameverifycgi'
const TICKET_RE = /^[0-9a-fA-F]{32}$/
const AUTH_WAIT_MS = 480_000

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AuthError('Invalid real-name authorization response')
  }
  return value as Record<string, unknown>
}

function body(value: unknown): Record<string, unknown> {
  const raw = record(value)
  if ((typeof raw.ret === 'number' && raw.ret !== 0) ||
      (typeof raw.errcode === 'number' && raw.errcode !== 0)) {
    throw new AuthError('Real-name authorization request rejected')
  }
  return raw.data == null ? raw : record(raw.data)
}

function number(value: unknown): number {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new AuthError('Invalid real-name authorization response')
  }
  return n
}

export function validateTicket(value: RealnameTicket): RealnameTicket {
  if (!TICKET_RE.test(value.botSpamTicket)) throw new AuthError('Invalid real-name authorization ticket')
  let url: URL
  try { url = new URL(value.authUrl) } catch { throw new AuthError('Invalid real-name authorization URL') }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new AuthError('Invalid real-name authorization URL')
  }
  if (!Number.isFinite(value.expireTimeSec) || value.expireTimeSec * 1000 <= Date.now()) {
    throw new AuthError('Real-name authorization ticket expired')
  }
  return value
}

/** The official 3.0.0-beta-0 acctweb GET protocol. No ticket or response body is logged. */
export class HttpRealnameClient implements RealnameClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private async request(params: Record<string, string>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const url = new URL(ENDPOINT)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    const combined = AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])])
    const response = await this.fetchImpl(url, { method: 'GET', signal: combined, redirect: 'error' })
    if (!response.ok) throw new AuthError(`Real-name authorization HTTP ${response.status}`)
    return body(await response.json())
  }

  async getTicket(signal?: AbortSignal): Promise<RealnameTicket> {
    const raw = await this.request({ step: 'get_auth_url', plugin_version: CHANNEL_VERSION }, signal)
    return validateTicket({
      botSpamTicket: String(raw.bot_spam_ticket ?? ''),
      authUrl: String(raw.auth_url ?? ''),
      expireTimeSec: number(raw.expire_time),
    })
  }

  async queryStatus(ticket: string, signal?: AbortSignal): Promise<0 | 1 | 2 | 3> {
    if (!TICKET_RE.test(ticket)) throw new AuthError('Invalid real-name authorization ticket')
    const status = number((await this.request({ step: 'query_auth_result', bot_spam_ticket: ticket }, signal)).auth_status)
    if (status !== 0 && status !== 1 && status !== 2 && status !== 3) {
      throw new AuthError('Invalid real-name authorization status')
    }
    return status
  }
}

/** Wait for approval, refreshing an invalid ticket once and showing the replacement QR. */
export async function authorizeOtherOwner(
  client: RealnameClient,
  callbacks: QrLoginCallbacks | undefined,
  signal?: AbortSignal,
  options: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<RealnameTicket> {
  if (!callbacks?.onRealnameQrUrl) throw new AuthError('onRealnameQrUrl callback is required for other-owner binding')
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => delay(ms, undefined, { signal }))
  const deadline = now() + AUTH_WAIT_MS
  signal?.throwIfAborted()
  let ticket = validateTicket(await client.getTicket(signal))
  await callbacks.onRealnameQrUrl(ticket.authUrl)
  let refreshed = false
  let pendingNotified = false
  for (;;) {
    signal?.throwIfAborted()
    if (now() >= Math.min(deadline, ticket.expireTimeSec * 1000)) {
      throw new AuthError('Real-name authorization timed out')
    }
    const status = await client.queryStatus(ticket.botSpamTicket, signal)
    if (status === 1) {
      callbacks.onRealnameStatus?.('approved')
      return ticket
    }
    if (status === 2) {
      callbacks.onRealnameStatus?.('rejected')
      throw new AuthError('Real-name authorization rejected')
    }
    if (status === 3) {
      if (refreshed) throw new AuthError('Real-name authorization ticket invalid after refresh')
      refreshed = true
      callbacks.onRealnameStatus?.('refreshing')
      ticket = validateTicket(await client.getTicket(signal))
      await callbacks.onRealnameQrUrl(ticket.authUrl)
      pendingNotified = false
      continue
    }
    if (!pendingNotified) {
      callbacks.onRealnameStatus?.('pending')
      pendingNotified = true
    }
    await sleep(Math.min(1_000, Math.max(0, Math.min(deadline, ticket.expireTimeSec * 1000) - now())))
  }
}
