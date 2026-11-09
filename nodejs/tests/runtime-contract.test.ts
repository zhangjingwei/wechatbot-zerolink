import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLogger } from '../src/logger/index.js'
import { MessagePoller } from '../src/messaging/poller.js'
import { MessageSender } from '../src/messaging/sender.js'
import { FileStorage } from '../src/storage/file.js'
import { MemoryStorage } from '../src/storage/memory.js'
import { STORAGE_KEYS } from '../src/storage/interface.js'
import { HttpClient } from '../src/transport/http.js'
import { MediaUploader } from '../src/media/uploader.js'
import { MessageParser } from '../src/message/parser.js'
import { ApiError } from '../src/core/errors.js'
import { MediaType, MessageItemType, MessageState, MessageType } from '../src/protocol/types.js'
import type { ILinkApi } from '../src/protocol/api.js'
import type { ContextStore } from '../src/messaging/context.js'

const logger = createLogger({ level: 'silent' })
afterEach(() => vi.restoreAllMocks())

describe('durable incoming checkpoint', () => {
  it('awaits intake and storage before dispatching, and replays after intake failure', async () => {
    const order: string[] = []
    const storage = new MemoryStorage()
    const originalSet = storage.set.bind(storage)
    storage.set = async (key, value) => { order.push('cursor'); await originalSet(key, value) }
    const api = {
      getUpdates: vi.fn(async (_base, _token, cursor) => {
        if (cursor) return new Promise(() => {})
        order.push('fetch')
        return { msgs: [{ client_id: 'one' }], get_updates_buf: 'next' }
      }),
    } as unknown as ILinkApi
    const poller = new MessagePoller(api, storage, logger)
    let attempts = 0
    poller.beforeCheckpoint = async () => {
      order.push('intake')
      if (++attempts === 1) throw new Error('database unavailable')
    }
    poller.on('messages', () => { order.push('dispatch'); poller.stop() })
    const run = poller.start('https://example.com', 'token')
    await vi.waitFor(() => expect(order).toContain('dispatch'), { timeout: 3000 })
    await run
    expect(api.getUpdates).toHaveBeenCalledTimes(2)
    expect(order).toEqual(['fetch', 'intake', 'fetch', 'intake', 'cursor', 'dispatch'])
    expect(await storage.get(STORAGE_KEYS.CURSOR)).toBe('next')
  })

  it('does not advance the in-memory cursor when storage fails', async () => {
    const cursors: string[] = []
    const storage = new MemoryStorage()
    storage.set = async () => { throw new Error('disk full') }
    const api = { getUpdates: vi.fn(async (_base, _token, cursor) => {
      cursors.push(cursor)
      return { msgs: [], get_updates_buf: 'next' }
    }) } as unknown as ILinkApi
    const poller = new MessagePoller(api, storage, logger)
    poller.on('error', () => { if (cursors.length === 2) poller.stop() })
    await poller.start('https://example.com', 'token')
    expect(cursors).toEqual(['', ''])
  })

  it('awaits session-expired listeners before polling again', async () => {
    const order: string[] = []
    let poller: MessagePoller
    const api = { getUpdates: vi.fn(async () => {
      order.push('poll')
      if (order.filter((item) => item === 'poll').length > 1) {
        poller.stop()
        return { msgs: [] }
      }
      throw new ApiError('expired', { httpStatus: 200, errcode: -14 })
    }) } as unknown as ILinkApi
    poller = new MessagePoller(api, new MemoryStorage(), logger)
    poller.on('session:expired', async () => {
      order.push('login-start')
      await new Promise((resolve) => setTimeout(resolve, 20))
      order.push('login-done')
    })
    await poller.start('https://example.com', 'token')
    expect(order).toEqual(['poll', 'login-start', 'login-done', 'poll'])
  })
})

describe('HTTP and send results', () => {
  it('preserves uint64 message identifiers as strings', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"ret":0,"message_id":18446744073709551615,"msg_id":123,"nested":{"svr_id":9876543210987654321}}'))
    const result = await new HttpClient({ logger }).request<Record<string, unknown>>({ method: 'GET', url: 'https://example.com/test' })
    expect(result.data).toMatchObject({ message_id: '18446744073709551615', msg_id: '123', nested: { svr_id: '9876543210987654321' } })
  })

  it('does not retry an uncertain sendmessage submission', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))
    await expect(new HttpClient({ logger, retryPolicy: { baseDelayMs: 0 } }).request({ method: 'POST', url: 'https://example.com/ilink/bot/sendmessage' })).rejects.toThrow('timeout')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('returns the response of every text chunk and raw message', async () => {
    const sendMessage = vi.fn(async () => ({ ret: 0, message_id: String(sendMessage.mock.calls.length) }))
    const api = { sendMessage, buildTextMessagePayload: (_user, _ctx, text) => ({ to_user_id: 'user', text }) } as unknown as ILinkApi
    const context = { get: () => 'ctx' } as unknown as ContextStore
    const sender = new MessageSender(api, context, logger)
    expect(await sender.sendText('base', 'token', 'user', 'x'.repeat(4001))).toEqual([{ ret: 0, message_id: '1' }, { ret: 0, message_id: '2' }])
    expect(await sender.sendRaw('base', 'token', { to_user_id: 'user' } as Parameters<typeof sender.sendRaw>[2])).toEqual({ ret: 0, message_id: '3' })
  })
})

describe('file storage', () => {
  it('replaces a JSON value atomically and leaves no temporary file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'wechatbot-storage-'))
    try {
      const storage = new FileStorage(directory)
      await storage.set('cursor', 'first')
      await storage.set('cursor', 'second')
      expect(await storage.get('cursor')).toBe('second')
      expect(await readFile(join(directory, 'cursor.json'), 'utf8')).toBe('"second"\n')
      expect(await readdir(directory)).toEqual(['cursor.json'])
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})

describe('media and quote compatibility', () => {
  it('exposes the quoted server ID and partial selection', () => {
    const result = new MessageParser().parse({
      from_user_id: 'user', to_user_id: 'bot', client_id: 'client', create_time_ms: 1,
      message_type: MessageType.USER, message_state: MessageState.FINISH,
      context_token: 'ctx', item_list: [{ type: MessageItemType.TEXT, text_item: { text: 'reply' },
        ref_msg: { svr_id: '18446744073709551615', title: 'quote', partial_text: { startindex: 2 } } }],
    })
    expect(result?.quotedMessage).toMatchObject({ messageId: '18446744073709551615', partialText: { startindex: 2 } })
  })

  it('uses the configured CDN upload timeout', async () => {
    const api = { getUploadUrl: vi.fn(async () => ({ upload_full_url: 'https://example.com/upload' })) } as unknown as ILinkApi
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { headers: { 'x-encrypted-param': 'encrypted' } }))
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const uploader = new MediaUploader(api, undefined, logger, 300_000)
    await uploader.upload('https://example.com', 'token', { data: Buffer.from('hello'), userId: 'user', mediaType: MediaType.FILE })
    expect(fetch).toHaveBeenCalledOnce()
    expect(timeout).toHaveBeenCalledWith(300_000)
    expect(fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    expect(() => new MediaUploader(api, undefined, logger, 300_000)).not.toThrow()
    await expect(uploader.upload('https://example.com', 'token', { data: Buffer.from('x'), userId: 'user', mediaType: MediaType.FILE, timeoutMs: 999 })).rejects.toThrow(RangeError)
  })
})
