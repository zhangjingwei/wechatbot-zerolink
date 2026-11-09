# wechatbot-zerolink — Node.js SDK

An independent Node.js fork of `@wechatbot/wechatbot` 2.2.0, adding the binding protocol observed in `@tencent-weixin/openclaw-weixin` 3.0.0-beta-0. The fork retains the upstream MIT license and attribution. It is not an official Tencent package.

## Install

The package has not been published to npm. Install a pinned Git commit with `npm install 'git+https://github.com/zhangjingwei/wechatbot-zerolink.git#<commit>'`, or use a generated `.tgz` artifact. The repository root packages the Node.js SDK from `nodejs/` for Git installation.

Requires Node.js >= 22 (for native fetch). Zero runtime dependencies.

## Quick Start

```typescript
import { WeChatBot } from 'wechatbot-zerolink'

const bot = new WeChatBot()
await bot.login()

bot.onMessage(async (msg) => {
  await bot.sendTyping(msg.userId)
  await bot.reply(msg, `Echo: ${msg.text}`)
})

await bot.start()
```

## 3.0.0-beta-0 binding support

Existing `bot.login()` keeps the 2.2.0 wire request. For a Bot owned by someone else, supply an authorization QR callback; the SDK waits for approval before requesting the Bot QR:

```typescript
const bot = new WeChatBot({
  storage: 'file',
  loginOptions: { bindOwner: 'other', verifyPin: true },
  loginCallbacks: {
    onRealnameQrUrl: (url) => showQr(url),
    onRealnameStatus: (status) => showStatus(status),
    onQrUrl: (url) => showQr(url),
    onVerifyCode: async (isRetry) => await askForPin(isRetry),
  },
})
await bot.login()
```

`bindOwner: 'self'` is the default. `verifyPin: false` omits the proactive PIN field, but a server PIN challenge is still handled. Both `need_verifycode` and `confirmed_but_need_verifycode` invoke `onVerifyCode`. `onRealnameQrUrl` is required in `other` mode so authorization does not proceed invisibly. For noninteractive services, provide `onVerifyCode` as well; otherwise the SDK reads stdin. `loginOptions` also supplies the owner mode after a process restart. A canceled login can use `bot.login({ signal })`.

See the [protocol compatibility audit](https://github.com/zhangjingwei/wechatbot-zerolink/blob/feat/realname-pin-binding/docs/protocol-compatibility-3.0.0-beta-0.md) for implementation scope and live validation gaps.

Run `npm run test:binding-contract` to exercise the complete binding request sequence against an in-process protocol mock. The command does not contact WeChat, scan a QR code, or start message polling.

## Weixin Link runtime contracts

The SDK now preserves numeric message IDs as exact strings, awaits `beforeCheckpoint(messages)` before durably storing the poll cursor, and persists the cursor before updating its in-memory value. A failed intake or cursor write therefore leaves the batch eligible for replay. Session-expired listeners are awaited before the next poll. `sendmessage` is never retried by the HTTP client because a timed-out submission may already have been accepted.

Text send calls return an array of API responses, one per chunk. Raw and media sends return the corresponding API response. File storage writes JSON through an exclusive temporary file, syncs it, renames it, and syncs the directory. The upload deadline is configurable with `new WeChatBot({ uploadTimeoutMs: 300_000 })` or per `bot.upload({ ..., timeoutMs })`; the SDK default remains 60 seconds. The allowed range is 1,000 to 600,000 milliseconds.

These contracts are covered by local tests. Live WeChat delivery, pairing, CDN behavior and restart recovery require separate acceptance testing by the consuming service.

## Architecture

```
src/
├── core/           ← WeChatBot client, typed events, error hierarchy
├── transport/      ← HTTP client with retry & timeout
├── protocol/       ← Raw iLink API calls + wire types
├── auth/           ← QR login + credential persistence
├── messaging/      ← Poller, Sender, Typing, ContextStore
├── media/          ← AES-128-ECB crypto, CDN upload/download
├── middleware/      ← Express-style middleware engine + builtins
├── message/        ← Parser, Builder, friendly types
├── storage/        ← Pluggable storage (file, memory, custom)
├── logger/         ← Structured leveled logging
└── index.ts        ← Public exports
```

## Configuration

```typescript
const bot = new WeChatBot({
  storage: 'file',            // 'file' | 'memory' | custom Storage
  storageDir: '~/.wechatbot',
  logLevel: 'info',           // 'debug' | 'info' | 'warn' | 'error' | 'silent'
  loginCallbacks: {
    onQrUrl: (url) => renderQrCode(url),
    onScanned: () => console.log('Scanned!'),
  },
})
```

## API Reference

### Lifecycle

| Method | Description |
|---|---|
| `new WeChatBot(options?)` | Create a bot instance |
| `bot.login(options?)` | QR login (auto-skips if credentials exist) |
| `bot.start()` | Start long-poll loop |
| `bot.run(options?)` | login() + start() in one call |
| `bot.stop()` | Stop gracefully |
| `bot.isRunning` | Whether the poll loop is active |

### Receiving

| Method | Description |
|---|---|
| `bot.onMessage(handler)` | Register message handler |
| `bot.download(msg)` | Download any media from a message (image/file/video/voice) |

### Sending — `reply(msg, content)` / `send(userId, content)`

Both methods accept the same content types:

```typescript
// Text (string shorthand)
await bot.reply(msg, 'Hello!')

// Text (object)
await bot.reply(msg, { text: 'Hello!' })

// Image with optional caption
await bot.reply(msg, { image: pngBuffer, caption: 'Screenshot' })

// Video with optional caption
await bot.reply(msg, { video: mp4Buffer, caption: 'Check this out' })

// File — auto-routes by extension (.png → image, .mp4 → video, else → file)
await bot.reply(msg, { file: data, fileName: 'report.pdf' })
await bot.reply(msg, { file: data, fileName: 'photo.png' })   // → sent as image

// From URL — auto-download + auto-detect type
await bot.reply(msg, { url: 'https://example.com/photo.jpg' })

// Send to a user by ID (same content options)
await bot.send(userId, { image: buffer, caption: 'Hi!' })
```

### Typing

| Method | Description |
|---|---|
| `bot.sendTyping(userId)` | Show "typing..." indicator |
| `bot.stopTyping(userId)` | Cancel typing indicator |

### Advanced

| Method | Description |
|---|---|
| `bot.sendRaw(payload)` | Send pre-built MessageBuilder payload |
| `bot.upload(options)` | Upload to CDN without sending |
| `bot.downloadRaw(media, aeskey?)` | Download from raw CDN reference |
| `bot.createMessage(userId)` | Fluent MessageBuilder |

### Middleware

```typescript
bot.use(loggingMiddleware(bot.logger))
bot.use(rateLimitMiddleware({ maxMessages: 10, windowMs: 60_000 }))
bot.use(typeFilterMiddleware('text', 'image'))
bot.use(filterMiddleware(/^\/\w+/))

// Custom middleware
bot.use(async (ctx, next) => {
  console.log(`From: ${ctx.message.userId}`)
  await next()
})
```

### Events

```typescript
bot.on('login', (creds) => { })
bot.on('message', (msg) => { })
bot.on('session:expired', () => { })
bot.on('session:restored', (creds) => { })
bot.on('error', (err) => { })
bot.on('poll:start', () => { })
bot.on('poll:stop', () => { })
bot.on('close', () => { })
```

### Message Types

```typescript
interface IncomingMessage {
  userId: string
  text: string
  type: 'text' | 'image' | 'voice' | 'file' | 'video'
  timestamp: Date
  images: ImageContent[]
  voices: VoiceContent[]
  files: FileContent[]
  videos: VideoContent[]
  quotedMessage?: QuotedMessage
  raw: WireMessage
}
```

### Storage Interface

```typescript
interface Storage {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  has(key: string): Promise<boolean>
  clear(): Promise<void>
}
```

## Development

```bash
npm install
npm run build    # TypeScript → dist/
npm test         # unit and runtime contract tests
npm run lint     # Type check
```

## License

MIT
