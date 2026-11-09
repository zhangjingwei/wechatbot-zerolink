import { describe, expect, it, vi } from 'vitest'
import { Authenticator } from '../src/auth/authenticator.js'
import { authorizeOtherOwner, HttpRealnameClient } from '../src/auth/realname.js'
import type { RealnameClient } from '../src/auth/types.js'
import { createLogger } from '../src/logger/index.js'
import { ILinkApi } from '../src/protocol/api.js'
import { MemoryStorage } from '../src/storage/memory.js'
import type { HttpClient } from '../src/transport/http.js'

const ticket = '0123456789abcdef0123456789abcdef'
const ticket2 = 'fedcba9876543210fedcba9876543210'
const context = (botSpamTicket = ticket) => ({
  botSpamTicket,
  authUrl: 'https://weixin110.qq.com/authorize',
  expireTimeSec: Math.floor(Date.now() / 1000) + 600,
})

describe('3.0.0-beta-0 QR request compatibility', () => {
  it('keeps the 2.2.0 body by default and adds only explicitly enabled fields', async () => {
    const post = vi.fn().mockResolvedValue({ qrcode: 'q', qrcode_img_content: 'https://example.com/q' })
    const api = new ILinkApi({ apiPost: post } as unknown as HttpClient)
    await api.getQrCode('https://ilinkai.weixin.qq.com', [])
    expect(post.mock.calls[0][2]).toEqual({ local_token_list: [] })
    await api.getQrCode('https://ilinkai.weixin.qq.com', ['token'], {
      verifyPin: true, botSpamTicket: ticket,
    })
    expect(post.mock.calls[1][2]).toEqual({
      local_token_list: ['token'],
      bot_spam_business_data: Buffer.from('{"verify_pin":1}').toString('base64'),
      bot_spam_ticket: ticket,
    })
    await expect(api.getQrCode('x', [], { botSpamTicket: 'bad' })).rejects.toThrow('Invalid')
  })

  it('handles confirmed_but_need_verifycode before persisting credentials', async () => {
    const api = {
      getQrCode: vi.fn().mockResolvedValue({ qrcode: 'q', qrcode_img_content: 'https://example.com/q' }),
      pollQrStatus: vi.fn()
        .mockResolvedValueOnce({ status: 'confirmed_but_need_verifycode' })
        .mockResolvedValueOnce({ status: 'confirmed', bot_token: 't', ilink_bot_id: 'b', ilink_user_id: 'u' }),
    }
    const callback = vi.fn().mockResolvedValue('123456')
    const storage = new MemoryStorage()
    const auth = new Authenticator(api as unknown as ILinkApi, storage, createLogger({ level: 'silent' }))
    const result = await auth.login({ force: true, callbacks: { onVerifyCode: callback } })
    expect(callback).toHaveBeenCalledWith(false)
    expect(api.pollQrStatus.mock.calls[1][2]).toBe('123456')
    expect(result.token).toBe('t')
  })
})

describe('other-owner authorization', () => {
  it('waits for approval and then attaches ticket to QR request', async () => {
    const client: RealnameClient = {
      getTicket: vi.fn().mockResolvedValue(context()),
      queryStatus: vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1),
    }
    const api = {
      getQrCode: vi.fn().mockResolvedValue({ qrcode: 'q', qrcode_img_content: 'https://example.com/q' }),
      pollQrStatus: vi.fn().mockResolvedValue({ status: 'confirmed', bot_token: 't', ilink_bot_id: 'b', ilink_user_id: 'u' }),
    }
    const auth = new Authenticator(api as unknown as ILinkApi, new MemoryStorage(), createLogger({ level: 'silent' }), client)
    const realnameQr = vi.fn()
    await auth.login({ force: true, bindOwner: 'other', verifyPin: true, callbacks: { onRealnameQrUrl: realnameQr } })
    expect(realnameQr).toHaveBeenCalledWith(context().authUrl)
    expect(api.getQrCode.mock.calls[0][2]).toEqual({ botSpamTicket: ticket, verifyPin: true })
  }, 5000)

  it('does not request a bot QR when authorization is rejected', async () => {
    const client: RealnameClient = { getTicket: async () => context(), queryStatus: async () => 2 }
    const api = { getQrCode: vi.fn() }
    const auth = new Authenticator(api as unknown as ILinkApi, new MemoryStorage(), createLogger({ level: 'silent' }), client)
    await expect(auth.login({ force: true, bindOwner: 'other', callbacks: { onRealnameQrUrl: () => {} } })).rejects.toThrow('rejected')
    expect(api.getQrCode).not.toHaveBeenCalled()
  })

  it('refreshes an invalid ticket once and reports the new QR', async () => {
    const client: RealnameClient = {
      getTicket: vi.fn().mockResolvedValueOnce(context()).mockResolvedValueOnce(context(ticket2)),
      queryStatus: vi.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(1),
    }
    const onRealnameQrUrl = vi.fn()
    const approved = await authorizeOtherOwner(client, { onRealnameQrUrl })
    expect(approved.botSpamTicket).toBe(ticket2)
    expect(onRealnameQrUrl).toHaveBeenCalledTimes(2)
  })

  it('rejects an unsafe authorization URL', async () => {
    const client: RealnameClient = {
      getTicket: async () => ({ ...context(), authUrl: 'http://example.com/steal' }),
      queryStatus: async () => 1,
    }
    await expect(authorizeOtherOwner(client, { onRealnameQrUrl: () => {} })).rejects.toThrow('URL')
  })

  it('times out while authorization remains pending', async () => {
    const client: RealnameClient = { getTicket: async () => context(), queryStatus: async () => 0 }
    let current = Date.now()
    await expect(authorizeOtherOwner(client, { onRealnameQrUrl: () => {} }, undefined, {
      now: () => current,
      sleep: async () => { current += 480_000 },
    })).rejects.toThrow('timed out')
  })

  it('cancels before polling the authorization service', async () => {
    const controller = new AbortController()
    controller.abort()
    const client: RealnameClient = {
      getTicket: async () => context(),
      queryStatus: vi.fn(),
    }
    await expect(authorizeOtherOwner(client, { onRealnameQrUrl: () => {} }, controller.signal)).rejects.toThrow()
    expect(client.queryStatus).not.toHaveBeenCalled()
  })
})

describe('real-name wire protocol', () => {
  it('calls get_auth_url and query_auth_result with expected parameters', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ret: 0, data: { bot_spam_ticket: ticket, auth_url: context().authUrl, expire_time: context().expireTimeSec } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ret: 0, data: { auth_status: 1 } }) })
    const client = new HttpRealnameClient(fetchImpl as unknown as typeof fetch)
    expect((await client.getTicket()).botSpamTicket).toBe(ticket)
    expect(await client.queryStatus(ticket)).toBe(1)
    expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.get('step')).toBe('get_auth_url')
    expect(new URL(fetchImpl.mock.calls[1][0]).searchParams.get('bot_spam_ticket')).toBe(ticket)
  })
})
