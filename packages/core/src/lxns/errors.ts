/**
 * 落雪 API 错误类型与友好文案。
 *
 * 错误码表见 https://maimai.lxns.net/docs/developer-guide#错误码说明
 */

export type LxnsErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'rate-limited'
  | 'bad-request'
  | 'server'
  | 'network'
  | 'timeout'
  | 'malformed';

export class LxnsError extends Error {
  readonly kind: LxnsErrorKind;
  /** HTTP 状态码；网络层错误时为 0。 */
  readonly status: number;
  /** 落雪返回的原始 message；无则为空字符串。 */
  readonly detail: string;
  /** 触发错误的接口路径。 */
  readonly endpoint: string;
  /** 本实例专用的友好文案；为空时回退到 `kind` 的默认文案。 */
  readonly friendly: string;

  constructor(
    kind: LxnsErrorKind,
    message: string,
    options: {
      status?: number;
      detail?: string;
      endpoint?: string;
      cause?: unknown;
      /**
       * 覆盖默认友好文案。
       *
       * 用途：同样是 `rate-limited`，「落雪把我们限流了」和
       * 「我们自己设的上游预算用完了」对玩家是两件事，说法应当不同。
       */
      friendly?: string;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'LxnsError';
    this.kind = kind;
    this.status = options.status ?? 0;
    this.detail = options.detail ?? '';
    this.endpoint = options.endpoint ?? '';
    this.friendly = options.friendly ?? '';
  }

  /** 可直接展示给玩家的中文说明。 */
  get friendlyMessage(): string {
    return this.friendly || FRIENDLY_MESSAGES[this.kind];
  }
}

const FRIENDLY_MESSAGES: Record<LxnsErrorKind, string> = {
  unauthorized: '开发者密钥无效或已失效，请到落雪开发者面板确认后重新填写。',
  forbidden: '密钥权限不足：该密钥未被授予「读取玩家成绩」等所需权限。',
  'not-found': '查不到这个好友码对应的玩家，可能尚未在落雪同步过数据。',
  'rate-limited': '请求太频繁，被落雪限流了，请稍等几秒再试。',
  'bad-request': '请求参数不对。好友码应为 15 位数字（游戏内「好友」界面可见），QQ 号请填纯数字。',
  server: '落雪服务端出错了，请稍后再试。',
  network: '连不上落雪服务器，请检查本机网络或代理设置。',
  timeout: '请求落雪超时，请稍后重试。',
  malformed: '落雪返回的数据无法解析，接口可能已变更。',
};

/** 由 HTTP 状态码推导错误类别。 */
export function kindFromStatus(status: number): LxnsErrorKind {
  switch (status) {
    case 400:
      return 'bad-request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not-found';
    case 429:
      return 'rate-limited';
    default:
      return status >= 500 ? 'server' : 'malformed';
  }
}

/** 序列化错误，便于在服务端 → 浏览器之间传递。 */
export interface SerializedLxnsError {
  kind: LxnsErrorKind;
  message: string;
  friendlyMessage: string;
  detail: string;
  status: number;
  endpoint: string;
}

export function serializeLxnsError(error: unknown, endpoint = ''): SerializedLxnsError {
  if (error instanceof LxnsError) {
    return {
      kind: error.kind,
      message: error.message,
      friendlyMessage: error.friendlyMessage,
      detail: error.detail,
      status: error.status,
      endpoint: error.endpoint || endpoint,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    kind: 'malformed',
    message,
    friendlyMessage: FRIENDLY_MESSAGES.malformed,
    detail: message,
    status: 0,
    endpoint,
  };
}
