# WeChat binding protocol audit: 3.0.0-beta-0

## Provenance and scope

- Fork base: `corespeed-io/wechatbot` Git tag `node-v2.2.0` (`a632b633f5658c7054546ee3209e359f05e3c934`), MIT.
- Protocol reference: Tencent [`openclaw-weixin` 3.0.0-beta-0 release notes](https://github.com/Tencent/openclaw-weixin/blob/v3.0.0-beta-0/docs/release-notes-bot-realname-auth_zh_CN.md), [`login-qr.ts`](https://github.com/Tencent/openclaw-weixin/blob/v3.0.0-beta-0/src/auth/login-qr.ts), and [`bot-spam-ticket.ts`](https://github.com/Tencent/openclaw-weixin/blob/v3.0.0-beta-0/src/auth/bot-spam-ticket.ts). This audit describes the observed beta implementation, not a stable public protocol guarantee.
- This fork adapts the **Node.js binding SDK only**. It does not embed OpenClaw, copy its installer, enable its message coalescing, or change a running Weixin Link deployment.

## Binding differences and adaptation

| Area | 2.2.0 behavior | Beta behavior | Fork behavior |
| --- | --- | --- | --- |
| Owner choice | Assumes direct Bot scan | `self` skips authorization; `other` requests real-name authorization first | Explicit `bindOwner`, default `self` |
| Authorization | None | `get_auth_url` returns a 32-hex ticket, URL, expiry; `query_auth_result` reports pending/approved/rejected/invalid | `HttpRealnameClient`, approval gate, one invalid-ticket refresh; QR callback required |
| Bot QR body | `local_token_list` | Optional `bot_spam_ticket`; optional base64 JSON `bot_spam_business_data` with `verify_pin:1` | Optional fields only when selected; default body unchanged |
| PIN | `need_verifycode` | Also `confirmed_but_need_verifycode`; server may require PIN even with proactive flag off | Handles both states; `verifyPin` is opt-in |
| Expiry | Three Bot QR attempts | Other-owner ticket must have >60 seconds left when refreshing Bot QR | Stops before QR request/refresh within 60 seconds of expiry |
| Re-login | Stored credentials or new scan | New authorization may be needed when pairing again | Retains owner mode in process and accepts constructor defaults after restart |

The real-name CGI uses HTTPS GET at `https://weixin110.qq.com/security/acct/botrealnameverifycgi` with `step=get_auth_url&plugin_version=<package version>` or `step=query_auth_result&bot_spam_ticket=<ticket>`. The SDK accepts the response fields at top level or inside `data`, as in the beta implementation. Ticket and authorization URL are never logged by the SDK's real-name transport. The URL must be HTTPS with no embedded credentials. The `plugin_version` sent by this fork is its own package version; whether the live service accepts that version must be confirmed by a real pairing test.

## Compatibility boundaries and risks

1. **Live server acceptance is unverified.** Unit tests assert wire shape and state transitions; they cannot prove that the beta server accepts an independently named package or a given account's authorization. No credentials or production binding were used for this audit.
2. **OpenClaw-only behavior stays upstream.** The beta's prompt policy, account config, proxy/route tag, media timeouts, coalescing, and interrupted-message recovery belong to its host application. They are not generic SDK binding protocol fields and are not claimed here.
3. **Authorization errors fail closed.** A rejected, expired, invalid, or failed real-name request stops the binding flow. A transient query failure currently stops the flow; callers may restart it. The beta plugin instead treats query exceptions as pending until its deadline.
4. **Noninteractive consumers need callbacks.** `onRealnameQrUrl` is mandatory for `other` mode; `onVerifyCode` should be supplied when stdin is unavailable. Callbacks must route QR/PIN only to the correct operator and must not persist the ticket or PIN in logs.
5. **Stored credentials bypass a new pairing flow.** Existing `login()` semantics load stored credentials unless `force: true`; an owner change requires `force: true` or credential clearing. Running sessions are not migrated by merely installing this package.

## Verification

Run from `nodejs/`: `npm ci`, `npm run lint`, `npm test`, `npm run build`, and `npm pack --dry-run`. Before integrating Weixin Link, verify package publication/installation, both owner flows on a test account, PIN challenge, cancellation, QR expiry, and credential recovery using the real service.

`npm run test:binding-contract` is the isolated first-stage acceptance command. It uses the public `WeChatBot.login()` entry, real HTTP request builders, and an in-process mock of the two Tencent endpoints. It checks self binding, proactive PIN and challenge submission, other-owner authorization ordering and ticket transfer, rejection, invalid-ticket refresh, QR expiry, and cancellation. It never opens a socket or starts message polling. It does **not** establish live server acceptance, operator QR rendering, real PIN delivery, or WeChat client message delivery.
