import { afterEach, describe, expect, it, vi } from 'vitest'
import { WeChatBot } from '../src/index.js'
import { CHANNEL_VERSION } from '../src/protocol/types.js'

const authUrl = 'https://weixin110.qq.com/authorize-test'
const ticket = '0123456789abcdef0123456789abcdef'
const replacementTicket = 'fedcba9876543210fedcba9876543210'
const credentials = { status: 'confirmed', bot_token: 'test-token', ilink_bot_id: 'test-bot', ilink_user_id: 'test-user' }
type Exchange = { method: string; url: URL; body?: Record<string, unknown> }

/** Exercise the public client and its real HTTP wrappers without opening a socket. */
function mockProtocol(respond: (exchange: Exchange) => unknown): Exchange[] {
  const exchanges: Exchange[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const exchange: Exchange = {
      method: init?.method ?? 'GET',
      url: new URL(String(input)),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined,
    }
    exchanges.push(exchange)
    return Response.json(respond(exchange))
  }))
  return exchanges
}

afterEach(() => vi.unstubAllGlobals())

describe('binding contract through WeChatBot.login', () => {
  it('preserves the 2.2.0 self-binding wire request when options are omitted', async () => {
    const exchanges = mockProtocol(({ url }) => {
      if (url.pathname === '/ilink/bot/get_bot_qrcode') {
        return { qrcode: 'qr-self', qrcode_img_content: 'https://example.test/bot-qr' }
      }
      if (url.pathname === '/ilink/bot/get_qrcode_status') return credentials
      throw new Error(`Unexpected request: ${url.pathname}`)
    })
    const onQrUrl = vi.fn()
    const bot = new WeChatBot({ storage: 'memory', logLevel: 'silent', loginCallbacks: { onQrUrl } })

    expect((await bot.login()).token).toBe('test-token')
    expect(exchanges.map(({ url }) => url.pathname)).toEqual([
      '/ilink/bot/get_bot_qrcode', '/ilink/bot/get_qrcode_status',
    ])
    expect(exchanges[0].method).toBe('POST')
    expect(exchanges[0].url.origin).toBe('https://ilinkai.weixin.qq.com')
    expect(exchanges[0].body).toEqual({ local_token_list: [] })
    expect(exchanges[1].url.searchParams.get('qrcode')).toBe('qr-self')
    expect(onQrUrl).toHaveBeenCalledWith('https://example.test/bot-qr')
  })

  it('submits the PIN for confirmed_but_need_verifycode before storing credentials', async () => {
    let pollCount = 0
    const exchanges = mockProtocol(({ url }) => {
      if (url.pathname === '/ilink/bot/get_bot_qrcode') {
        return { qrcode: 'qr-pin', qrcode_img_content: 'https://example.test/pin-qr' }
      }
      if (url.pathname === '/ilink/bot/get_qrcode_status') {
        return pollCount++ === 0 ? { status: 'confirmed_but_need_verifycode' } : credentials
      }
      throw new Error(`Unexpected request: ${url.pathname}`)
    })
    const onVerifyCode = vi.fn().mockResolvedValue('123456')
    const bot = new WeChatBot({ storage: 'memory', logLevel: 'silent', loginCallbacks: { onVerifyCode } })

    await bot.login({ verifyPin: true })
    expect(exchanges[0].body).toEqual({
      local_token_list: [],
      bot_spam_business_data: Buffer.from('{"verify_pin":1}').toString('base64'),
    })
    expect(exchanges[1].url.searchParams.has('verify_code')).toBe(false)
    expect(exchanges[2].url.searchParams.get('verify_code')).toBe('123456')
    expect(onVerifyCode).toHaveBeenCalledOnce()
    expect(bot.getCredentials()?.token).toBe('test-token')
  })

  it('handles a server PIN challenge even when proactive PIN is off, including retry', async () => {
    let pollCount = 0
    const exchanges = mockProtocol(({ url }) => {
      if (url.pathname === '/ilink/bot/get_bot_qrcode') {
        return { qrcode: 'qr-server-pin', qrcode_img_content: 'https://example.test/server-pin-qr' }
      }
      if (url.pathname === '/ilink/bot/get_qrcode_status') {
        return pollCount++ < 2 ? { status: 'need_verifycode' } : credentials
      }
      throw new Error(`Unexpected request: ${url.pathname}`)
    })
    const onVerifyCode = vi.fn()
      .mockResolvedValueOnce('111111')
      .mockResolvedValueOnce('222222')
    const bot = new WeChatBot({ storage: 'memory', logLevel: 'silent', loginCallbacks: { onVerifyCode } })

    await bot.login()
    expect(exchanges[0].body).toEqual({ local_token_list: [] })
    expect(exchanges[2].url.searchParams.get('verify_code')).toBe('111111')
    expect(exchanges[3].url.searchParams.get('verify_code')).toBe('222222')
    expect(onVerifyCode.mock.calls).toEqual([[false], [true]])
  })

  it('gates other-owner Bot QR on approval and sends the authorized ticket', async () => {
    const exchanges = mockProtocol(({ url }) => {
      if (url.pathname === '/security/acct/botrealnameverifycgi') {
        if (url.searchParams.get('step') === 'get_auth_url') {
          return { ret: 0, data: { bot_spam_ticket: ticket, auth_url: authUrl, expire_time: Math.floor(Date.now() / 1000) + 600 } }
        }
        if (url.searchParams.get('step') === 'query_auth_result') return { ret: 0, data: { auth_status: 1 } }
      }
      if (url.pathname === '/ilink/bot/get_bot_qrcode') {
        return { qrcode: 'qr-other', qrcode_img_content: 'https://example.test/other-qr' }
      }
      if (url.pathname === '/ilink/bot/get_qrcode_status') return credentials
      throw new Error(`Unexpected request: ${url.pathname}`)
    })
    const onRealnameQrUrl = vi.fn()
    const bot = new WeChatBot({
      storage: 'memory', logLevel: 'silent',
      loginOptions: { bindOwner: 'other', verifyPin: true },
      loginCallbacks: { onRealnameQrUrl },
    })

    await bot.login()
    expect(exchanges.map(({ url }) => url.pathname)).toEqual([
      '/security/acct/botrealnameverifycgi',
      '/security/acct/botrealnameverifycgi',
      '/ilink/bot/get_bot_qrcode',
      '/ilink/bot/get_qrcode_status',
    ])
    expect(exchanges[0].method).toBe('GET')
    expect(exchanges[0].url.origin).toBe('https://weixin110.qq.com')
    expect(exchanges[0].url.searchParams.get('plugin_version')).toBe(CHANNEL_VERSION)
    expect(exchanges[1].url.searchParams.get('bot_spam_ticket')).toBe(ticket)
    expect(exchanges[2].body).toEqual({
      local_token_list: [],
      bot_spam_business_data: Buffer.from('{"verify_pin":1}').toString('base64'),
      bot_spam_ticket: ticket,
    })
    expect(onRealnameQrUrl).toHaveBeenCalledWith(authUrl)
  })

  it('never requests a Bot QR after real-name rejection', async () => {
    const exchanges = mockProtocol(({ url }) => {
      if (url.searchParams.get('step') === 'get_auth_url') {
        return { ret: 0, data: { bot_spam_ticket: ticket, auth_url: authUrl, expire_time: Math.floor(Date.now() / 1000) + 600 } }
      }
      if (url.searchParams.get('step') === 'query_auth_result') {
        return { ret: 0, data: { auth_status: 2 } }
      }
      throw new Error(`Unexpected request: ${url.pathname}`)
    })
    const bot = new WeChatBot({
      storage: 'memory', logLevel: 'silent',
      loginCallbacks: { onRealnameQrUrl: () => {} },
    })

    await expect(bot.login({ bindOwner: 'other' })).rejects.toThrow('rejected')
    expect(exchanges).toHaveLength(2)
    expect(bot.getCredentials()).toBeUndefined()
  })

  it('requires a real-name QR callback before making network requests', async () => {
    const exchanges = mockProtocol(() => { throw new Error('No request expected') })
    const bot = new WeChatBot({ storage: 'memory', logLevel: 'silent' })

    await expect(bot.login({ bindOwner: 'other' })).rejects.toThrow('onRealnameQrUrl')
    expect(exchanges).toHaveLength(0)
  })

  it('uses a replacement ticket after an invalid-ticket response', async () => {
    let ticketCount = 0
    const exchanges = mockProtocol(({ url }) => {
      if (url.searchParams.get('step') === 'get_auth_url') {
        return { ret: 0, data: {
          bot_spam_ticket: ticketCount++ === 0 ? ticket : replacementTicket,
          auth_url: authUrl,
          expire_time: Math.floor(Date.now() / 1000) + 600,
        } }
      }
      if (url.searchParams.get('step') === 'query_auth_result') {
        return { ret: 0, data: { auth_status: url.searchParams.get('bot_spam_ticket') === ticket ? 3 : 1 } }
      }
      if (url.pathname === '/ilink/bot/get_bot_qrcode') {
        return { qrcode: 'qr-refresh', qrcode_img_content: 'https://example.test/refresh-qr' }
      }
      if (url.pathname === '/ilink/bot/get_qrcode_status') return credentials
      throw new Error(`Unexpected request: ${url.pathname}`)
    })
    const onRealnameQrUrl = vi.fn()
    const bot = new WeChatBot({ storage: 'memory', logLevel: 'silent', loginCallbacks: { onRealnameQrUrl } })

    await bot.login({ bindOwner: 'other' })
    expect(onRealnameQrUrl).toHaveBeenCalledTimes(2)
    expect(exchanges[4].body?.bot_spam_ticket).toBe(replacementTicket)
  })

  it('stops after the QR refresh limit without saving credentials', async () => {
    let qrCount = 0
    const exchanges = mockProtocol(({ url }) => {
      if (url.pathname === '/ilink/bot/get_bot_qrcode') {
        return { qrcode: `qr-${++qrCount}`, qrcode_img_content: 'https://example.test/expired-qr' }
      }
      if (url.pathname === '/ilink/bot/get_qrcode_status') return { status: 'expired' }
      throw new Error(`Unexpected request: ${url.pathname}`)
    })
    const bot = new WeChatBot({ storage: 'memory', logLevel: 'silent' })

    await expect(bot.login()).rejects.toThrow('QR code expired')
    expect(qrCount).toBe(3)
    expect(exchanges).toHaveLength(6)
    expect(bot.getCredentials()).toBeUndefined()
  })

  it('cancels before QR polling and leaves no credentials', async () => {
    const controller = new AbortController()
    const exchanges = mockProtocol(({ url }) => {
      if (url.pathname === '/ilink/bot/get_bot_qrcode') {
        return { qrcode: 'qr-cancel', qrcode_img_content: 'https://example.test/cancel-qr' }
      }
      throw new Error(`Unexpected request: ${url.pathname}`)
    })
    const bot = new WeChatBot({
      storage: 'memory', logLevel: 'silent',
      loginCallbacks: { onQrUrl: () => controller.abort() },
    })

    await expect(bot.login({ signal: controller.signal })).rejects.toThrow()
    expect(exchanges.map(({ url }) => url.pathname)).toEqual(['/ilink/bot/get_bot_qrcode'])
    expect(bot.getCredentials()).toBeUndefined()
  })
})
