export interface Credentials {
  token: string
  baseUrl: string
  accountId: string
  userId: string
  savedAt: string
}

export interface QrLoginCallbacks {
  /** Called when a QR URL is available for the user to scan. */
  onQrUrl?: (url: string) => void
  /** Called when the QR code has been scanned (awaiting confirmation). */
  onScanned?: () => void
  /** Called when the QR code has expired and a new one will be requested. */
  onExpired?: () => void
  /**
   * Called when the server requires a pairing code (the digits shown in
   * WeChat on the user's phone). `isRetry` is true when a previously
   * submitted code was rejected. Defaults to a stdin prompt.
   */
  onVerifyCode?: (isRetry: boolean) => string | Promise<string>
  /** Show the authorization QR before binding a bot owned by someone else. */
  onRealnameQrUrl?: (url: string) => void | Promise<void>
  /** Called after real-name authorization changes state. */
  onRealnameStatus?: (status: 'pending' | 'approved' | 'rejected' | 'refreshing') => void
}

export interface LoginOptions {
  force?: boolean
  callbacks?: QrLoginCallbacks
  /** Defaults to self, preserving the 2.2.0 login flow. */
  bindOwner?: 'self' | 'other'
  /** Ask the server to require a PIN. The server may require one even when false. */
  verifyPin?: boolean
  /** Cancel a pending authorization or QR polling flow. */
  signal?: AbortSignal
}

export interface RealnameTicket {
  botSpamTicket: string
  authUrl: string
  expireTimeSec: number
}

/** Injectable boundary for a custom transport or deterministic tests. */
export interface RealnameClient {
  getTicket(signal?: AbortSignal): Promise<RealnameTicket>
  queryStatus(ticket: string, signal?: AbortSignal): Promise<0 | 1 | 2 | 3>
}
