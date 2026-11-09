# wechatbot-zerolink — Node.js SDK

An independent Node.js fork of `@wechatbot/wechatbot` 2.2.0, adding the binding protocol observed in `@tencent-weixin/openclaw-weixin` 3.0.0-beta-0. The fork retains the upstream MIT license and attribution. It is not an official Tencent package.

## Install

The package has been built locally but is not yet published to npm. Install the generated `.tgz` artifact with `npm install /path/to/wechatbot-zerolink-2.2.0-zerolink.1.tgz`. Once published, the command will be `npm install wechatbot-zerolink`.

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

See [protocol compatibility audit](../docs/protocol-compatibility-3.0.0-beta-0.md) for implementation scope and live validation gaps.

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
npm test         # 69 unit tests
npm run lint     # Type check
```

## License

MIT
