/* 由 scripts/bundle-core.mjs 自动生成，请勿手改。源码：packages/core */
/* 本文件不含任何宿主专有 API，可在 Vela 的 JS 引擎中直接运行。 */
/* SCAN-BELOW-ONLY */
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// packages/core/dist/util/utf8.js
function utf8Encode(text) {
  const out = [];
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 55296 && code <= 56319) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 56320 && next <= 57343) {
        const cp = 65536 + (code - 55296 << 10) + (next - 56320);
        out.push(240 | cp >>> 18, 128 | cp >>> 12 & 63, 128 | cp >>> 6 & 63, 128 | cp & 63);
        i += 1;
        continue;
      }
      out.push(239, 191, 189);
      continue;
    }
    if (code >= 56320 && code <= 57343) {
      out.push(239, 191, 189);
      continue;
    }
    if (code < 128) {
      out.push(code);
    } else if (code < 2048) {
      out.push(192 | code >>> 6, 128 | code & 63);
    } else {
      out.push(224 | code >>> 12, 128 | code >>> 6 & 63, 128 | code & 63);
    }
  }
  return out;
}
function utf8Decode(bytes) {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i] & 255;
    i += 1;
    let cp;
    let extra;
    if (b0 < 128) {
      cp = b0;
      extra = 0;
    } else if (b0 >= 194 && b0 <= 223) {
      cp = b0 & 31;
      extra = 1;
    } else if (b0 >= 224 && b0 <= 239) {
      cp = b0 & 15;
      extra = 2;
    } else if (b0 >= 240 && b0 <= 244) {
      cp = b0 & 7;
      extra = 3;
    } else {
      out += "\uFFFD";
      continue;
    }
    let valid = true;
    for (let k = 0; k < extra; k += 1) {
      if (i >= bytes.length) {
        valid = false;
        break;
      }
      const b = bytes[i] & 255;
      if ((b & 192) !== 128) {
        valid = false;
        break;
      }
      cp = cp << 6 | b & 63;
      i += 1;
    }
    if (!valid) {
      out += "\uFFFD";
      continue;
    }
    const overlong = extra === 1 && cp < 128 || extra === 2 && cp < 2048 || extra === 3 && cp < 65536;
    if (overlong || cp > 1114111 || cp >= 55296 && cp <= 57343) {
      out += "\uFFFD";
      continue;
    }
    if (cp <= 65535) {
      out += String.fromCharCode(cp);
    } else {
      const v = cp - 65536;
      out += String.fromCharCode(55296 + (v >>> 10), 56320 + (v & 1023));
    }
  }
  return out;
}
function hexToBytes(hex) {
  if (hex.length === 0 || hex.length % 2 !== 0)
    return null;
  const out = new Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isFinite(byte))
      return null;
    out[i] = byte;
  }
  return out;
}
function bytesToHex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += (bytes[i] & 255).toString(16).padStart(2, "0");
  }
  return out;
}
function decodeHexUtf8(hex) {
  const bytes = hexToBytes(hex);
  if (bytes === null)
    return null;
  const text = utf8Decode(bytes);
  return text.includes("\uFFFD") ? null : text;
}

// packages/core/dist/lxns/types.js
var MAIMAI_ASSET_BASE = "https://assets2.lxns.net/maimai";

// packages/core/dist/lxns/endpoints.js
var LXNS_API_BASE = "https://maimai.lxns.net/api/v0";
function withQuery(path, params) {
  const parts = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === void 0 || value === null || value === "")
      continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length > 0 ? `${path}?${parts.join("&")}` : path;
}
var maimaiEndpoints = {
  player: (friendCode) => `/maimai/player/${friendCode}`,
  playerByQq: (qq) => `/maimai/player/qq/${qq}`,
  /** 玩家信息（当前密钥对应的玩家，个人 API）。 */
  selfPlayer: () => "/user/maimai/player",
  /** Best 50。 */
  bests: (friendCode) => `/maimai/player/${friendCode}/bests`,
  /** All Perfect 50。 */
  bestsAp: (friendCode) => `/maimai/player/${friendCode}/bests/ap`,
  /** 单曲最佳成绩。 */
  best: (friendCode, query) => withQuery(`/maimai/player/${friendCode}/best`, query),
  /** 单曲全部难度成绩。 */
  songScores: (friendCode, query) => withQuery(`/maimai/player/${friendCode}/bests`, query),
  /** Recent 50。 */
  recents: (friendCode) => `/maimai/player/${friendCode}/recents`,
  /** 全部最佳成绩（简化）。 */
  scores: (friendCode) => `/maimai/player/${friendCode}/scores`,
  /** 上传热力图。 */
  heatmap: (friendCode) => `/maimai/player/${friendCode}/heatmap`,
  /** DX Rating 趋势。 */
  trend: (friendCode, version) => withQuery(`/maimai/player/${friendCode}/trend`, { version }),
  /** 成绩上传历史。 */
  scoreHistory: (friendCode, query) => withQuery(`/maimai/player/${friendCode}/score/history`, query),
  /** 曲目列表（公共接口，无需鉴权）。 */
  songList: (query = {}) => withQuery("/maimai/song/list", { version: query.version, notes: query.notes }),
  /** 单曲信息（公共接口）。 */
  song: (songId, version) => withQuery(`/maimai/song/${songId}`, { version }),
  /** 曲目别名列表（公共接口）。 */
  aliasList: () => "/maimai/alias/list",
  /** 收藏品列表（公共接口）。 */
  collectionList: (type, query = {}) => withQuery(`/maimai/${type}/list`, { version: query.version, required: query.required }),
  /** 玩家收藏品进度。 */
  playerCollection: (friendCode, type, id) => `/maimai/player/${friendCode}/${type}/${id}`
};

// packages/core/dist/lxns/errors.js
var LxnsError = class extends Error {
  constructor(kind, message, options = {}) {
    var _a, _b, _c, _d;
    super(message, options.cause === void 0 ? void 0 : { cause: options.cause });
    __publicField(this, "kind");
    /** HTTP 状态码；网络层错误时为 0。 */
    __publicField(this, "status");
    /** 落雪返回的原始 message；无则为空字符串。 */
    __publicField(this, "detail");
    /** 触发错误的接口路径。 */
    __publicField(this, "endpoint");
    /** 本实例专用的友好文案；为空时回退到 `kind` 的默认文案。 */
    __publicField(this, "friendly");
    this.name = "LxnsError";
    this.kind = kind;
    this.status = (_a = options.status) != null ? _a : 0;
    this.detail = (_b = options.detail) != null ? _b : "";
    this.endpoint = (_c = options.endpoint) != null ? _c : "";
    this.friendly = (_d = options.friendly) != null ? _d : "";
  }
  /** 可直接展示给玩家的中文说明。 */
  get friendlyMessage() {
    return this.friendly || FRIENDLY_MESSAGES[this.kind];
  }
};
var FRIENDLY_MESSAGES = {
  unauthorized: "\u5F00\u53D1\u8005\u5BC6\u94A5\u65E0\u6548\u6216\u5DF2\u5931\u6548\uFF0C\u8BF7\u5230\u843D\u96EA\u5F00\u53D1\u8005\u9762\u677F\u786E\u8BA4\u540E\u91CD\u65B0\u586B\u5199\u3002",
  forbidden: "\u5BC6\u94A5\u6743\u9650\u4E0D\u8DB3\uFF1A\u8BE5\u5BC6\u94A5\u672A\u88AB\u6388\u4E88\u300C\u8BFB\u53D6\u73A9\u5BB6\u6210\u7EE9\u300D\u7B49\u6240\u9700\u6743\u9650\u3002",
  "not-found": "\u67E5\u4E0D\u5230\u8FD9\u4E2A\u597D\u53CB\u7801\u5BF9\u5E94\u7684\u73A9\u5BB6\uFF0C\u53EF\u80FD\u5C1A\u672A\u5728\u843D\u96EA\u540C\u6B65\u8FC7\u6570\u636E\u3002",
  "rate-limited": "\u8BF7\u6C42\u592A\u9891\u7E41\uFF0C\u88AB\u843D\u96EA\u9650\u6D41\u4E86\uFF0C\u8BF7\u7A0D\u7B49\u51E0\u79D2\u518D\u8BD5\u3002",
  "bad-request": "\u8BF7\u6C42\u53C2\u6570\u4E0D\u5BF9\u3002\u597D\u53CB\u7801\u5E94\u4E3A 15 \u4F4D\u6570\u5B57\uFF08\u6E38\u620F\u5185\u300C\u597D\u53CB\u300D\u754C\u9762\u53EF\u89C1\uFF09\uFF0CQQ \u53F7\u8BF7\u586B\u7EAF\u6570\u5B57\u3002",
  server: "\u843D\u96EA\u670D\u52A1\u7AEF\u51FA\u9519\u4E86\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002",
  network: "\u8FDE\u4E0D\u4E0A\u843D\u96EA\u670D\u52A1\u5668\uFF0C\u8BF7\u68C0\u67E5\u672C\u673A\u7F51\u7EDC\u6216\u4EE3\u7406\u8BBE\u7F6E\u3002",
  timeout: "\u8BF7\u6C42\u843D\u96EA\u8D85\u65F6\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002",
  malformed: "\u843D\u96EA\u8FD4\u56DE\u7684\u6570\u636E\u65E0\u6CD5\u89E3\u6790\uFF0C\u63A5\u53E3\u53EF\u80FD\u5DF2\u53D8\u66F4\u3002"
};
function kindFromStatus(status) {
  switch (status) {
    case 400:
      return "bad-request";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not-found";
    case 429:
      return "rate-limited";
    default:
      return status >= 500 ? "server" : "malformed";
  }
}
function serializeLxnsError(error, endpoint = "") {
  if (error instanceof LxnsError) {
    return {
      kind: error.kind,
      message: error.message,
      friendlyMessage: error.friendlyMessage,
      detail: error.detail,
      status: error.status,
      endpoint: error.endpoint || endpoint
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    kind: "malformed",
    message,
    friendlyMessage: FRIENDLY_MESSAGES.malformed,
    detail: message,
    status: 0,
    endpoint
  };
}

// packages/core/dist/lxns/client.js
function unwrapEnvelope(payload, endpoint = "") {
  var _a, _b, _c;
  if (payload === null || typeof payload !== "object") {
    throw new LxnsError("malformed", `\u54CD\u5E94\u4E0D\u662F JSON \u5BF9\u8C61\uFF1A${endpoint}`, { endpoint });
  }
  if ("success" in payload && "data" in payload) {
    const envelope = payload;
    if (!envelope.success) {
      const detail = (_a = envelope.message) != null ? _a : "";
      const kind = kindFromStatus((_b = envelope.code) != null ? _b : 0);
      throw new LxnsError(kind, detail || `\u843D\u96EA\u8FD4\u56DE\u5931\u8D25\uFF1A${endpoint}`, {
        status: (_c = envelope.code) != null ? _c : 0,
        detail,
        endpoint
      });
    }
    if (envelope.data === null || envelope.data === void 0) {
      throw new LxnsError("malformed", `\u54CD\u5E94 data \u4E3A\u7A7A\uFF1A${endpoint}`, { endpoint });
    }
    return envelope.data;
  }
  return payload;
}
function defaultFetch() {
  const impl = globalThis.fetch;
  if (typeof impl !== "function") {
    throw new LxnsError("network", "\u5F53\u524D\u8FD0\u884C\u73AF\u5883\u6CA1\u6709\u53EF\u7528\u7684 fetch \u5B9E\u73B0\uFF0C\u8BF7\u4F20\u5165 fetchImpl\u3002");
  }
  return impl.bind(globalThis);
}
var LxnsClient = class {
  constructor(options = {}) {
    __publicField(this, "baseUrl");
    __publicField(this, "developerKey");
    __publicField(this, "userToken");
    __publicField(this, "fetchImpl");
    __publicField(this, "timeoutMs");
    __publicField(this, "extraHeaders");
    var _a, _b, _c, _d, _e, _f;
    this.baseUrl = ((_a = options.baseUrl) != null ? _a : LXNS_API_BASE).replace(/\/+$/, "");
    this.developerKey = ((_b = options.developerKey) == null ? void 0 : _b.trim()) || void 0;
    this.userToken = ((_c = options.userToken) == null ? void 0 : _c.trim()) || void 0;
    this.fetchImpl = (_d = options.fetchImpl) != null ? _d : defaultFetch();
    this.timeoutMs = (_e = options.timeoutMs) != null ? _e : 15e3;
    this.extraHeaders = (_f = options.extraHeaders) != null ? _f : {};
  }
  /** 是否已具备开发者密钥。 */
  get hasDeveloperKey() {
    return this.developerKey !== void 0;
  }
  /** 是否已具备个人密钥。 */
  get hasUserToken() {
    return this.userToken !== void 0;
  }
  /** 发起 GET 请求并解包。 */
  async request(path, init = {}) {
    var _a, _b;
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const headers = { accept: "application/json" };
    if (this.developerKey)
      headers.authorization = this.developerKey;
    if (this.userToken)
      headers["x-user-token"] = this.userToken;
    for (const [key, value] of Object.entries(this.extraHeaders)) {
      headers[key.toLowerCase()] = value;
    }
    const controller = typeof AbortController === "function" ? new AbortController() : void 0;
    const timer = controller && this.timeoutMs > 0 ? setTimeout(() => controller.abort(), this.timeoutMs) : void 0;
    let response;
    try {
      response = await this.fetchImpl(url, __spreadValues({
        method: (_a = init.method) != null ? _a : "GET",
        headers
      }, controller ? { signal: controller.signal } : {}));
    } catch (error) {
      if (error instanceof LxnsError)
        throw error;
      const aborted = isAbortError(error);
      throw new LxnsError(aborted ? "timeout" : "network", `${aborted ? "\u8BF7\u6C42\u8D85\u65F6" : "\u7F51\u7EDC\u8BF7\u6C42\u5931\u8D25"}\uFF1A${path}`, {
        endpoint: path,
        cause: error
      });
    } finally {
      if (timer !== void 0)
        clearTimeout(timer);
    }
    const text = await response.text();
    let parsed;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : null;
    } catch (error) {
      throw new LxnsError("malformed", `\u54CD\u5E94\u4E0D\u662F\u5408\u6CD5 JSON\uFF1A${path}`, {
        status: response.status,
        detail: text.slice(0, 200),
        endpoint: path,
        cause: error
      });
    }
    if (!response.ok) {
      const detail = parsed && typeof parsed === "object" && "message" in parsed ? String((_b = parsed.message) != null ? _b : "") : "";
      const kind = kindFromStatus(response.status);
      throw new LxnsError(kind, detail || `HTTP ${response.status}\uFF1A${path}`, {
        status: response.status,
        detail,
        endpoint: path
      });
    }
    return unwrapEnvelope(parsed, path);
  }
  // ── 具体接口 ──────────────────────────────────────────────────────────
  getPlayer(friendCode) {
    return this.request(maimaiEndpoints.player(friendCode));
  }
  getPlayerByQq(qq) {
    return this.request(maimaiEndpoints.playerByQq(qq));
  }
  /** 获取玩家缓存的 Best 50。 */
  getBests(friendCode) {
    return this.request(maimaiEndpoints.bests(friendCode));
  }
  /** 获取玩家缓存的 All Perfect 50。 */
  getBestsAp(friendCode) {
    return this.request(maimaiEndpoints.bestsAp(friendCode));
  }
  /** 单曲全部难度成绩。 */
  getSongScores(friendCode, query) {
    return this.request(maimaiEndpoints.songScores(friendCode, query));
  }
  /** Recent 50。 */
  getRecents(friendCode) {
    return this.request(maimaiEndpoints.recents(friendCode));
  }
  /** 全部最佳成绩（简化）。 */
  getScores(friendCode) {
    return this.request(maimaiEndpoints.scores(friendCode));
  }
  /** DX Rating 趋势。 */
  getTrend(friendCode, version) {
    return this.request(maimaiEndpoints.trend(friendCode, version));
  }
  /** 成绩上传热力图：日期 → 数量。 */
  getHeatmap(friendCode) {
    return this.request(maimaiEndpoints.heatmap(friendCode));
  }
  /** 曲目列表（公共接口，无需鉴权）。 */
  getSongList(query = {}) {
    return this.request(maimaiEndpoints.songList(query));
  }
  /** 单曲信息（公共接口）。 */
  getSong(songId, version) {
    return this.request(maimaiEndpoints.song(songId, version));
  }
  /** 曲目别名列表（公共接口）。 */
  getAliasList() {
    return this.request(maimaiEndpoints.aliasList());
  }
};
function isAbortError(error) {
  if (error === null || typeof error !== "object")
    return false;
  const name = error.name;
  return name === "AbortError" || name === "TimeoutError";
}

// packages/core/dist/maimai/constants.js
var DIFFICULTY_NAMES = ["BASIC", "ADVANCED", "EXPERT", "MASTER", "Re:MASTER"];
var DIFFICULTY_SHORT_NAMES = ["BAS", "ADV", "EXP", "MAS", "ReM"];
var DIFFICULTY_COLORS = ["#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#e5e7eb"];
var LEVEL_INDEXES = [0, 1, 2, 3, 4];
function difficultyName(index) {
  var _a;
  return (_a = DIFFICULTY_NAMES[index]) != null ? _a : `\u672A\u77E5(${index})`;
}
function difficultyShortName(index) {
  var _a;
  return (_a = DIFFICULTY_SHORT_NAMES[index]) != null ? _a : `?${index}`;
}
function difficultyColor(index) {
  var _a;
  return (_a = DIFFICULTY_COLORS[index]) != null ? _a : "#94a3b8";
}
var SONG_TYPE_LABELS = {
  standard: "\u6807\u51C6",
  dx: "DX",
  utage: "\u5BB4\u4F1A\u573A"
};
var RATE_LABELS = {
  sssp: "SSS+",
  sss: "SSS",
  ssp: "SS+",
  ss: "SS",
  sp: "S+",
  s: "S",
  aaa: "AAA",
  aa: "AA",
  a: "A",
  bbb: "BBB",
  bb: "BB",
  b: "B",
  c: "C",
  d: "D"
};
var RATE_COLORS = {
  sssp: "#f7d34e",
  sss: "#f7d34e",
  ssp: "#f2a33c",
  ss: "#f2a33c",
  sp: "#7fd1ff",
  s: "#7fd1ff",
  aaa: "#ff7a7a",
  aa: "#ff7a7a",
  a: "#c084fc",
  bbb: "#8ab4f8",
  bb: "#8ab4f8",
  b: "#86efac",
  c: "#86efac",
  d: "#94a3b8"
};
var FC_LABELS = {
  app: "AP+",
  ap: "AP",
  fcp: "FC+",
  fc: "FC"
};
var FS_LABELS = {
  fsdp: "FDX+",
  fsd: "FDX",
  fsp: "FS+",
  fs: "FS",
  sync: "SYNC"
};
var TROPHY_COLOR_LABELS = {
  normal: "\u666E\u901A",
  bronze: "\u94DC",
  silver: "\u94F6",
  gold: "\u91D1",
  rainbow: "\u8679"
};
var TROPHY_COLOR_CSS = {
  normal: "#e2e8f0",
  bronze: "#d08a56",
  silver: "#cbd5e1",
  gold: "#f5c542",
  rainbow: "linear-gradient(90deg,#ff5f6d,#ffc371,#7ee8a2,#5bc0eb,#a06bff)"
};
var RATING_TIERS = [
  { minimum: 16e3, label: "\u8679\u6975", color: "#a06bff" },
  { minimum: 15e3, label: "\u8679", color: "#f7d34e" },
  { minimum: 14e3, label: "\u91D1", color: "#f5c542" },
  { minimum: 13e3, label: "\u9280", color: "#cbd5e1" },
  { minimum: 12e3, label: "\u9285", color: "#d08a56" },
  { minimum: 1e4, label: "\u7D2B", color: "#c084fc" },
  { minimum: 8e3, label: "\u8D64", color: "#ff7a7a" },
  { minimum: 6e3, label: "\u9752", color: "#7fd1ff" },
  { minimum: 4e3, label: "\u7DD1", color: "#86efac" },
  { minimum: 2e3, label: "\u767D", color: "#e2e8f0" },
  { minimum: 0, label: "\u7070", color: "#94a3b8" }
];
function ratingTier(rating) {
  var _a;
  return (_a = RATING_TIERS.find((tier) => rating >= tier.minimum)) != null ? _a : RATING_TIERS[RATING_TIERS.length - 1];
}

// packages/core/dist/maimai/rating.js
var ACHIEVEMENT_CAP = 100.5;
var ACHIEVEMENT_MAX = 101;
var DX_RATING_COEFFICIENTS = [
  { minimum: 100.5, coefficient: 22.4, note: "SSS+" },
  { minimum: 100.4999, coefficient: 22.2, note: "SSS \u9876\u683C" },
  { minimum: 100, coefficient: 21.6, note: "SSS" },
  { minimum: 99.9999, coefficient: 21.4, note: "SS+ \u9876\u683C" },
  { minimum: 99.5, coefficient: 21.1, note: "SS+" },
  { minimum: 99, coefficient: 20.8, note: "SS" },
  { minimum: 98.9999, coefficient: 20.6, note: "S+ \u9876\u683C" },
  { minimum: 98, coefficient: 20.3, note: "S+" },
  { minimum: 97, coefficient: 20, note: "S" },
  { minimum: 96.9999, coefficient: 17.6, note: "AAA \u9876\u683C" },
  { minimum: 94, coefficient: 16.8, note: "AAA" },
  { minimum: 90, coefficient: 15.2, note: "AA" },
  { minimum: 80, coefficient: 13.6, note: "A" },
  { minimum: 79.9999, coefficient: 12.8, note: "BBB \u9876\u683C" },
  { minimum: 75, coefficient: 12, note: "BBB" },
  { minimum: 70, coefficient: 11.2, note: "BB" },
  { minimum: 60, coefficient: 9.6, note: "B" },
  { minimum: 50, coefficient: 8, note: "C" },
  { minimum: 40, coefficient: 6.4, note: "D" },
  { minimum: 30, coefficient: 4.8, note: "D" },
  { minimum: 20, coefficient: 3.2, note: "D" },
  { minimum: 10, coefficient: 1.6, note: "D" },
  { minimum: 0, coefficient: 0, note: "\u4F4E\u4E8E 10% \u4E0D\u8BA1\u5206" }
];
var RATE_THRESHOLDS = [
  { rate: "sssp", minimum: 100.5 },
  { rate: "sss", minimum: 100 },
  { rate: "ssp", minimum: 99.5 },
  { rate: "ss", minimum: 99 },
  { rate: "sp", minimum: 98 },
  { rate: "s", minimum: 97 },
  { rate: "aaa", minimum: 94 },
  { rate: "aa", minimum: 90 },
  { rate: "a", minimum: 80 },
  { rate: "bbb", minimum: 75 },
  { rate: "bb", minimum: 70 },
  { rate: "b", minimum: 60 },
  { rate: "c", minimum: 50 },
  { rate: "d", minimum: 0 }
];
function normalizeAchievement(achievement) {
  if (!Number.isFinite(achievement))
    return 0;
  const percent = achievement > ACHIEVEMENT_MAX && achievement <= ACHIEVEMENT_MAX * 1e4 ? achievement / 1e4 : achievement;
  return Math.min(Math.max(percent, 0), ACHIEVEMENT_MAX);
}
function dxRatingCoefficient(achievement) {
  const percent = normalizeAchievement(achievement);
  for (const step of DX_RATING_COEFFICIENTS) {
    if (percent >= step.minimum)
      return step.coefficient;
  }
  return 0;
}
function dxRatingCoefficientStep(achievement) {
  var _a;
  const percent = normalizeAchievement(achievement);
  return (_a = DX_RATING_COEFFICIENTS.find((step) => percent >= step.minimum)) != null ? _a : DX_RATING_COEFFICIENTS[DX_RATING_COEFFICIENTS.length - 1];
}
function isAllPerfect(fc) {
  return fc === "ap" || fc === "app";
}
function calculateDxRating(levelValue, achievement, options = {}) {
  if (!Number.isFinite(levelValue) || levelValue < 0)
    return 0;
  const percent = Math.min(normalizeAchievement(achievement), ACHIEVEMENT_CAP);
  const coefficient = dxRatingCoefficient(percent);
  const base = levelValue * (percent / 100) * coefficient;
  const bonus = options.allPerfect ? 1 : 0;
  return Math.floor(base + bonus + 1e-9);
}
function maxRatingForLevel(levelValue) {
  return calculateDxRating(levelValue, ACHIEVEMENT_CAP, { allPerfect: true });
}
function rateFromAchievement(achievement) {
  var _a, _b;
  const percent = normalizeAchievement(achievement);
  return (_b = (_a = RATE_THRESHOLDS.find((threshold) => percent >= threshold.minimum)) == null ? void 0 : _a.rate) != null ? _b : "d";
}
function minimumAchievementForRate(rate) {
  var _a, _b;
  return (_b = (_a = RATE_THRESHOLDS.find((threshold) => threshold.rate === rate)) == null ? void 0 : _a.minimum) != null ? _b : 0;
}
function requiredLevelValue(targetRating, achievement) {
  if (!Number.isFinite(targetRating) || targetRating <= 0)
    return 0;
  const percent = Math.min(normalizeAchievement(achievement), ACHIEVEMENT_CAP);
  const perLevel = dxRatingCoefficient(percent) * (percent / 100);
  if (perLevel <= 0)
    return void 0;
  return Math.ceil(targetRating / perLevel * 10) / 10;
}
function verifyScoreRating(score, levelValue) {
  const allPerfect = isAllPerfect(score.fc);
  const computed = calculateDxRating(levelValue, score.achievements, { allPerfect });
  const computedWithoutApBonus = calculateDxRating(levelValue, score.achievements, { allPerfect: false });
  const apiRaw = typeof score.dx_rating === "number" && Number.isFinite(score.dx_rating) ? score.dx_rating : null;
  const api = apiRaw === null ? null : Math.floor(apiRaw + 1e-9);
  return {
    computed,
    computedWithoutApBonus,
    api,
    apiRaw,
    matches: api === null ? null : api === computed,
    matchesWithoutApBonus: api === null ? null : api === computedWithoutApBonus,
    levelValue,
    achievement: Math.min(normalizeAchievement(score.achievements), ACHIEVEMENT_CAP),
    step: dxRatingCoefficientStep(score.achievements),
    apBonus: allPerfect ? 1 : 0
  };
}

// packages/core/dist/maimai/format.js
function formatInt(value) {
  if (value === null || value === void 0 || !Number.isFinite(value))
    return "--";
  return Math.round(value).toLocaleString("en-US");
}
function formatAchievement(achievement) {
  if (achievement === null || achievement === void 0 || !Number.isFinite(achievement))
    return "--";
  return `${achievement.toFixed(4)}%`;
}
function formatAchievementShort(achievement) {
  if (achievement === null || achievement === void 0 || !Number.isFinite(achievement))
    return "--";
  return `${achievement.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}%`;
}
function formatLevelValue(value) {
  if (value === null || value === void 0 || !Number.isFinite(value))
    return "--";
  return value.toFixed(1);
}
function formatFixed(value, digits = 2) {
  if (value === null || value === void 0 || !Number.isFinite(value))
    return "--";
  return value.toFixed(digits);
}
function formatDxScore(dxScore, max) {
  if (dxScore === null || dxScore === void 0 || !Number.isFinite(dxScore))
    return "--";
  if (max === null || max === void 0 || !Number.isFinite(max))
    return formatInt(dxScore);
  return `${formatInt(dxScore)} / ${formatInt(max)}`;
}
function formatUtcToLocal(iso, options = {}) {
  if (!iso)
    return "--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()))
    return iso;
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (options.withTime === false)
    return ymd;
  return `${ymd} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function formatRelative(iso, now = /* @__PURE__ */ new Date()) {
  if (!iso)
    return "--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()))
    return iso;
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0)
    return "\u521A\u521A";
  const minutes = Math.floor(diffMs / 6e4);
  if (minutes < 1)
    return "\u521A\u521A";
  if (minutes < 60)
    return `${minutes} \u5206\u949F\u524D`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return `${hours} \u5C0F\u65F6\u524D`;
  const days = Math.floor(hours / 24);
  if (days < 30)
    return `${days} \u5929\u524D`;
  const months = Math.floor(days / 30);
  if (months < 12)
    return `${months} \u4E2A\u6708\u524D`;
  return `${Math.floor(months / 12)} \u5E74\u524D`;
}
function formatDelta(value) {
  if (value === null || value === void 0 || !Number.isFinite(value))
    return "--";
  const rounded = Math.round(value);
  return rounded > 0 ? `+${formatInt(rounded)}` : formatInt(rounded);
}
function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text;
}
function maxDxScoreFromNotes(notes) {
  if (!notes || !Number.isFinite(notes.total))
    return null;
  return notes.total * 3 + notes.break * 2;
}
function dxScoreRatio(dxScore, max) {
  if (dxScore === null || dxScore === void 0 || !max)
    return null;
  return dxScore / max;
}

// packages/core/dist/maimai/b50.js
function buildSongIndex(songList, aliasList) {
  var _a, _b, _c, _d, _e;
  const songs = /* @__PURE__ */ new Map();
  for (const song of (_a = songList.songs) != null ? _a : [])
    songs.set(song.id, song);
  const aliases = /* @__PURE__ */ new Map();
  for (const entry of (_b = aliasList == null ? void 0 : aliasList.aliases) != null ? _b : []) {
    if ((_c = entry.aliases) == null ? void 0 : _c.length)
      aliases.set(entry.song_id, entry.aliases);
  }
  return {
    songs,
    aliases,
    versions: (_d = songList.versions) != null ? _d : [],
    genres: (_e = songList.genres) != null ? _e : []
  };
}
function jacketUrl(songId) {
  return `${MAIMAI_ASSET_BASE}/jacket/${songId}.png`;
}
function musicUrl(songId) {
  return `${MAIMAI_ASSET_BASE}/music/${songId}.mp3`;
}
function findDifficulty(song, type, levelIndex, levelLabel) {
  var _a, _b, _c, _d, _e;
  if (type === "utage") {
    const utage = (_a = song.difficulties.utage) != null ? _a : [];
    const byLevel = levelLabel ? utage.find((chart) => chart.level === levelLabel) : void 0;
    if (byLevel)
      return byLevel;
    return (_b = utage.find((chart) => chart.difficulty === levelIndex)) != null ? _b : utage[0];
  }
  const list = type === "dx" ? (_c = song.difficulties.dx) != null ? _c : [] : (_d = song.difficulties.standard) != null ? _d : [];
  return (_e = list.find((chart) => chart.difficulty === levelIndex)) != null ? _e : list[0];
}
function buildB50View(input) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u;
  const { player, bests, index } = input;
  const warnings = /* @__PURE__ */ new Set();
  const standard = buildEntries((_a = bests.standard) != null ? _a : [], index, warnings);
  const dx = buildEntries((_b = bests.dx) != null ? _b : [], index, warnings);
  const standardSelections = buildEntries((_c = bests.standard_selections) != null ? _c : [], index, warnings);
  const dxSelections = buildEntries((_d = bests.dx_selections) != null ? _d : [], index, warnings);
  const main = [...standard, ...dx];
  const stats = computeStats(standard, dx, bests);
  const selfCheck = computeSelfCheck(main);
  const playerView = {
    name: (_e = player.name) != null ? _e : "\u672A\u77E5\u73A9\u5BB6",
    rating: (_f = player.rating) != null ? _f : 0,
    friendCode: (_h = (_g = input.friendCode) != null ? _g : player.friend_code) != null ? _h : null,
    courseRank: (_i = player.course_rank) != null ? _i : 0,
    classRank: (_j = player.class_rank) != null ? _j : 0,
    star: (_k = player.star) != null ? _k : 0,
    tier: ratingTier((_l = player.rating) != null ? _l : 0),
    trophyName: (_n = (_m = player.trophy) == null ? void 0 : _m.name) != null ? _n : null,
    trophyColor: (_p = (_o = player.trophy) == null ? void 0 : _o.color) != null ? _p : null,
    iconUrl: ((_q = player.icon) == null ? void 0 : _q.id) ? `${MAIMAI_ASSET_BASE}/icon/${player.icon.id}.png` : null,
    plateUrl: ((_r = player.name_plate) == null ? void 0 : _r.id) ? `${MAIMAI_ASSET_BASE}/plate/${player.name_plate.id}.png` : null,
    frameUrl: ((_s = player.frame) == null ? void 0 : _s.id) ? `${MAIMAI_ASSET_BASE}/frame/${player.frame.id}.png` : null,
    uploadTime: (_t = player.upload_time) != null ? _t : null
  };
  return {
    player: playerView,
    standard,
    dx,
    standardSelections,
    dxSelections,
    stats,
    selfCheck,
    warnings: [...warnings],
    generatedAt: ((_u = input.now) != null ? _u : /* @__PURE__ */ new Date()).toISOString()
  };
}
function buildEntries(scores, index, warnings) {
  return scores.map((score) => buildEntry(score, index, warnings));
}
function buildEntry(score, index, warnings) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r;
  const song = (_a = index.songs.get(score.id)) != null ? _a : null;
  if (!song) {
    warnings.add(`\u66F2\u76EE ${score.id} \u4E0D\u5728\u66F2\u5E93\u4E2D\uFF08\u53EF\u80FD\u662F\u7248\u672C\u4E0D\u4E00\u81F4\u6216\u66F2\u5E93\u672A\u5305\u542B\uFF09\uFF0C\u8BE5\u6761\u6309\u6210\u7EE9\u539F\u59CB\u6570\u636E\u5C55\u793A\u3002`);
  }
  const chart = song ? findDifficulty(song, score.type, score.level_index, score.level) : void 0;
  const levelValue = chart && Number.isFinite(chart.level_value) ? chart.level_value : null;
  if (song && !chart) {
    warnings.add(`\u66F2\u76EE\u300C${song.title}\u300D\u627E\u4E0D\u5230 ${score.type} / \u96BE\u5EA6 ${score.level_index} \u7684\u8C31\u9762\u6570\u636E\u3002`);
  }
  if (song && chart && levelValue === null) {
    warnings.add(`\u66F2\u76EE\u300C${song.title}\u300D\u7684\u8C31\u9762\u7F3A\u5C11\u5B9A\u6570\uFF08level_value\uFF09\u3002`);
  }
  const notes = normalizeNotes(chart == null ? void 0 : chart.notes);
  const achievements = normalizeAchievement(score.achievements);
  const verification = levelValue === null ? null : verifyScoreRating(__spreadProps(__spreadValues({}, score), { achievements }), levelValue);
  const rating = typeof score.dx_rating === "number" && Number.isFinite(score.dx_rating) ? Math.floor(score.dx_rating + 1e-9) : null;
  const computedRating = verification ? verification.computed : null;
  const maxRating = levelValue === null ? null : maxRatingForLevel(levelValue);
  return {
    score,
    songId: score.id,
    title: (_c = (_b = song == null ? void 0 : song.title) != null ? _b : score.song_name) != null ? _c : `#${score.id}`,
    artist: (_d = song == null ? void 0 : song.artist) != null ? _d : "",
    genre: (_e = song == null ? void 0 : song.genre) != null ? _e : "",
    bpm: (_f = song == null ? void 0 : song.bpm) != null ? _f : null,
    songVersion: (_g = song == null ? void 0 : song.version) != null ? _g : null,
    jacketUrl: jacketUrl(score.id),
    aliases: (_h = index.aliases.get(score.id)) != null ? _h : [],
    type: score.type,
    levelIndex: score.level_index,
    difficulty: difficultyName(score.level_index),
    difficultyShort: difficultyShortName(score.level_index),
    difficultyColor: difficultyColor(score.level_index),
    level: (_j = (_i = chart == null ? void 0 : chart.level) != null ? _i : score.level) != null ? _j : "--",
    levelValue,
    noteDesigner: (_k = chart == null ? void 0 : chart.note_designer) != null ? _k : null,
    notes,
    maxDxScore: maxDxScoreFromNotes(notes),
    achievements,
    rate: (_l = score.rate) != null ? _l : rateFromAchievement(achievements),
    dxScore: (_m = score.dx_score) != null ? _m : 0,
    dxStar: (_n = score.dx_star) != null ? _n : 0,
    fc: (_o = score.fc) != null ? _o : null,
    fs: (_p = score.fs) != null ? _p : null,
    rating,
    computedRating,
    maxRating,
    headroom: computedRating !== null && maxRating !== null ? maxRating - computedRating : null,
    verification,
    lastPlayedTime: (_r = (_q = score.last_played_time) != null ? _q : score.play_time) != null ? _r : null
  };
}
function normalizeNotes(notes) {
  if (!notes)
    return null;
  if ("left" in notes || "right" in notes) {
    const left = notes.left;
    const right = notes.right;
    return sumNotes([left, right]);
  }
  return notes;
}
function sumNotes(list) {
  const present = list.filter((n) => Boolean(n));
  if (present.length === 0)
    return null;
  return present.reduce((acc, n) => ({
    total: acc.total + n.total,
    tap: acc.tap + n.tap,
    hold: acc.hold + n.hold,
    slide: acc.slide + n.slide,
    touch: acc.touch + n.touch,
    break: acc.break + n.break
  }), { total: 0, tap: 0, hold: 0, slide: 0, touch: 0, break: 0 });
}
function computeStats(standard, dx, bests) {
  var _a, _b, _c;
  const entries = [...standard, ...dx];
  const withLevel = entries.filter((e) => e.levelValue !== null);
  const sum2 = (list) => list.reduce((a, b) => a + b, 0);
  const avg = (list) => list.length === 0 ? 0 : sum2(list) / list.length;
  const ratingsOf = (list) => list.filter((e) => e.computedRating !== null).map((e) => e.computedRating);
  const computedStandardTotal = sum2(ratingsOf(standard));
  const computedDxTotal = sum2(ratingsOf(dx));
  const standardTotal = (_a = bests.standard_total) != null ? _a : 0;
  const dxTotal = (_b = bests.dx_total) != null ? _b : 0;
  const total = standardTotal + dxTotal;
  const computedTotal = computedStandardTotal + computedDxTotal;
  const levelValues = withLevel.map((e) => e.levelValue);
  const achievements = entries.map((e) => e.achievements);
  const bucketMap = /* @__PURE__ */ new Map();
  for (const entry of withLevel) {
    const key = entry.levelValue;
    const list = bucketMap.get(key);
    if (list)
      list.push(entry.achievements);
    else
      bucketMap.set(key, [entry.achievements]);
  }
  const levelBuckets = [...bucketMap.entries()].map(([levelValue, list]) => ({ levelValue, count: list.length, averageAchievement: avg(list) })).sort((a, b) => b.levelValue - a.levelValue);
  const rateMap = /* @__PURE__ */ new Map();
  for (const entry of entries)
    rateMap.set(entry.rate, ((_c = rateMap.get(entry.rate)) != null ? _c : 0) + 1);
  const rateCounts = [...rateMap.entries()].map(([rate, count]) => ({ rate, count })).sort((a, b) => b.count - a.count);
  const theoreticalMaxTotal = sum2(entries.filter((e) => e.maxRating !== null).map((e) => e.maxRating));
  return {
    total,
    standardTotal,
    dxTotal,
    computedTotal,
    computedStandardTotal,
    computedDxTotal,
    computedDelta: computedTotal - total,
    computedStandardDelta: computedStandardTotal - standardTotal,
    computedDxDelta: computedDxTotal - dxTotal,
    chartCount: entries.length,
    standardCount: standard.length,
    dxCount: dx.length,
    averageLevelValue: avg(levelValues),
    maxLevelValue: levelValues.length ? Math.max(...levelValues) : 0,
    averageAchievement: avg(achievements),
    maxAchievement: achievements.length ? Math.max(...achievements) : 0,
    minAchievement: achievements.length ? Math.min(...achievements) : 0,
    allPerfectCount: entries.filter((e) => isAllPerfect(e.fc)).length,
    fullComboCount: entries.filter((e) => e.fc !== null).length,
    fullSyncCount: entries.filter((e) => e.fs !== null).length,
    levelBuckets,
    rateCounts,
    theoreticalMaxTotal,
    gapToTheoretical: theoreticalMaxTotal - computedTotal
  };
}
function computeSelfCheck(entries) {
  let matched = 0;
  let mismatched = 0;
  let missingApiRating = 0;
  let matchedWithoutApBonus = 0;
  const samples = [];
  for (const entry of entries) {
    const verification = entry.verification;
    if (!verification)
      continue;
    if (verification.api === null) {
      missingApiRating += 1;
      continue;
    }
    if (verification.matches)
      matched += 1;
    else
      mismatched += 1;
    if (verification.matchesWithoutApBonus)
      matchedWithoutApBonus += 1;
    if (!verification.matches && samples.length < 12) {
      samples.push({
        songId: entry.songId,
        title: entry.title,
        difficulty: entry.difficulty,
        levelValue: verification.levelValue,
        achievements: verification.achievement,
        fc: entry.fc,
        computed: verification.computed,
        computedWithoutApBonus: verification.computedWithoutApBonus,
        api: verification.api
      });
    }
  }
  const checked = matched + mismatched;
  let includesApBonus = null;
  if (checked > 0 && matched !== matchedWithoutApBonus) {
    includesApBonus = matched > matchedWithoutApBonus;
  }
  return {
    checked,
    matched,
    mismatched,
    missingApiRating,
    matchedWithoutApBonus,
    includesApBonus,
    samples
  };
}
function projectRating(entry, targetAchievement) {
  if (entry.levelValue === null)
    return null;
  const allPerfect = targetAchievement >= ACHIEVEMENT_CAP;
  return calculateDxRating(entry.levelValue, Math.min(targetAchievement, ACHIEVEMENT_CAP), { allPerfect });
}

// packages/core/dist/maimai/qr-payload.js
var WAHLAP_QR_CONTENT_PREFIX = "SGWC";
var WAHLAP_HOST_PATTERN = /(^|\.)wahlap\.(net|com)$/i;
var ID_PATTERN = /^([A-Z]{2,8})(\d{12})([0-9A-Fa-f]+)$/;
var CONTENT_PATTERN = /^(SGWC)?([A-Z]{2,8}\d{12}[0-9A-Fa-f]+)$/;
var HTML_PATH_PATTERN = /\/qrcode\/req\/([A-Za-z0-9]+)\.html$/i;
var PNG_PATH_PATTERN = /\/qrcode\/img\/([A-Za-z0-9]+)\.png$/i;
function parseWahlapQrPayload(input) {
  var _a;
  const raw = input.trim();
  if (raw.length === 0)
    return null;
  if (/^https?:\/\//i.test(raw))
    return fromUrl(raw);
  const match = CONTENT_PATTERN.exec(raw.toUpperCase());
  if (match) {
    return build({
      raw,
      source: "content",
      host: null,
      id: (_a = match[2]) != null ? _a : null,
      contentPrefix: WAHLAP_QR_CONTENT_PREFIX,
      params: /* @__PURE__ */ new Map()
    });
  }
  return null;
}
function wahlapQrContentOf(input) {
  var _a, _b;
  return (_b = (_a = parseWahlapQrPayload(input)) == null ? void 0 : _a.content) != null ? _b : null;
}
function fromUrl(raw) {
  var _a, _b, _c, _d, _e;
  const match = /^https?:\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?/i.exec(raw);
  if (!match)
    return null;
  const host = (_a = match[1]) != null ? _a : "";
  const path = (_b = match[2]) != null ? _b : "";
  const params = parseQuery((_c = match[3]) != null ? _c : "");
  const htmlMatch = HTML_PATH_PATTERN.exec(path);
  const pngMatch = PNG_PATH_PATTERN.exec(path);
  const fileName = (_e = (_d = htmlMatch == null ? void 0 : htmlMatch[1]) != null ? _d : pngMatch == null ? void 0 : pngMatch[1]) != null ? _e : null;
  return build({
    raw,
    source: htmlMatch ? "html-url" : pngMatch ? "png-url" : "unknown-url",
    host,
    id: fileName,
    contentPrefix: fileName ? WAHLAP_QR_CONTENT_PREFIX : null,
    params
  });
}
function build(input) {
  var _a, _b, _c;
  const { raw, source, host, id, contentPrefix, params } = input;
  const idMatch = id ? ID_PATTERN.exec(id) : null;
  const machinePrefix = (_a = idMatch == null ? void 0 : idMatch[1]) != null ? _a : null;
  const stamp = (_b = idMatch == null ? void 0 : idMatch[2]) != null ? _b : null;
  const token = (_c = idMatch == null ? void 0 : idMatch[3]) != null ? _c : null;
  const generatedAt = stamp ? parseCompactTimestamp(stamp) : null;
  const expiresAt = parseUnixSeconds(params.get("l"));
  const recognized = idMatch !== null && (source === "content" || host !== null && WAHLAP_HOST_PATTERN.test(host));
  return {
    raw,
    source,
    recognized,
    content: contentPrefix && id ? `${contentPrefix}${id}` : null,
    id,
    machinePrefix,
    contentPrefix,
    host,
    generatedAt,
    expiresAt,
    validForMs: generatedAt && expiresAt ? expiresAt.getTime() - generatedAt.getTime() : null,
    title: decodeHexParam(params.get("t")),
    description: decodeHexParam(params.get("d")),
    tokenPreview: token ? `${token.slice(0, 6)}\u2026${token.slice(-4)}(${token.length})` : null
  };
}
function describeValidity(payload, now = /* @__PURE__ */ new Date()) {
  if (!payload.expiresAt) {
    return {
      state: "unknown",
      remainingMs: null,
      text: payload.generatedAt ? "\u65E0\u6CD5\u5224\u65AD\u6709\u6548\u671F\uFF08\u7C98\u8D34\u5E26 l \u53C2\u6570\u7684 .html \u94FE\u63A5\u624D\u6709\u65F6\u6548\u4FE1\u606F\uFF09" : "\u65E0\u6CD5\u5224\u65AD\u6709\u6548\u671F"
    };
  }
  const remainingMs = payload.expiresAt.getTime() - now.getTime();
  if (remainingMs <= 0) {
    return { state: "expired", remainingMs: 0, text: "\u4E8C\u7EF4\u7801\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u5728\u5FAE\u4FE1\u5C0F\u7A0B\u5E8F\u91CC\u91CD\u65B0\u751F\u6210" };
  }
  return { state: "valid", remainingMs, text: `\u5269\u4F59\u6709\u6548\u65F6\u95F4 ${formatDuration(remainingMs)}` };
}
function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1e3));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0)
    return `${seconds} \u79D2`;
  return `${minutes} \u5206 ${seconds} \u79D2`;
}
function parseQuery(query) {
  const map = /* @__PURE__ */ new Map();
  if (!query)
    return map;
  for (const pair of query.split("&")) {
    if (!pair)
      continue;
    const eq = pair.indexOf("=");
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? "" : pair.slice(eq + 1);
    map.set(safeDecode(key), safeDecode(value));
  }
  return map;
}
function safeDecode(value) {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch (e) {
    return value;
  }
}
function parseCompactTimestamp(stamp) {
  if (stamp.length !== 12)
    return null;
  const year = 2e3 + Number(stamp.slice(0, 2));
  const month = Number(stamp.slice(2, 4));
  const day = Number(stamp.slice(4, 6));
  const hour = Number(stamp.slice(6, 8));
  const minute = Number(stamp.slice(8, 10));
  const second = Number(stamp.slice(10, 12));
  if ([year, month, day, hour, minute, second].some((n) => !Number.isFinite(n)))
    return null;
  if (month < 1 || month > 12 || day < 1 || day > 31)
    return null;
  if (hour > 23 || minute > 59 || second > 59)
    return null;
  const CHINA_OFFSET_MS = 8 * 60 * 60 * 1e3;
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - CHINA_OFFSET_MS);
}
function parseUnixSeconds(value) {
  if (!value || !/^\d{9,11}$/.test(value))
    return null;
  return new Date(Number(value) * 1e3);
}
function decodeHexParam(value) {
  if (!value || value.length % 2 !== 0)
    return null;
  return decodeHexUtf8(value);
}

// packages/core/dist/qr/tables.js
var EC_LEVELS = ["L", "M", "Q", "H"];
var EC_LEVEL_FORMAT_BITS = {
  L: 1,
  M: 0,
  Q: 3,
  H: 2
};
var ECC_CODEWORDS_PER_BLOCK = {
  L: [
    -1,
    7,
    10,
    15,
    20,
    26,
    18,
    20,
    24,
    30,
    18,
    20,
    24,
    26,
    30,
    22,
    24,
    28,
    30,
    28,
    28,
    28,
    28,
    30,
    30,
    26,
    28,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30
  ],
  M: [
    -1,
    10,
    16,
    26,
    18,
    24,
    16,
    18,
    22,
    22,
    26,
    30,
    22,
    22,
    24,
    24,
    28,
    28,
    26,
    26,
    26,
    26,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28
  ],
  Q: [
    -1,
    13,
    22,
    18,
    26,
    18,
    24,
    18,
    22,
    20,
    24,
    28,
    26,
    24,
    20,
    30,
    24,
    28,
    28,
    26,
    30,
    28,
    30,
    30,
    30,
    30,
    28,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30
  ],
  H: [
    -1,
    17,
    28,
    22,
    16,
    22,
    28,
    26,
    26,
    24,
    28,
    24,
    28,
    22,
    24,
    24,
    30,
    28,
    28,
    26,
    28,
    30,
    24,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30
  ]
};
var NUM_EC_BLOCKS = {
  L: [
    -1,
    1,
    1,
    1,
    1,
    1,
    2,
    2,
    2,
    2,
    4,
    4,
    4,
    4,
    4,
    6,
    6,
    6,
    6,
    7,
    8,
    8,
    9,
    9,
    10,
    12,
    12,
    12,
    13,
    14,
    15,
    16,
    17,
    18,
    19,
    19,
    20,
    21,
    22,
    24,
    25
  ],
  M: [
    -1,
    1,
    1,
    1,
    2,
    2,
    4,
    4,
    4,
    5,
    5,
    5,
    8,
    9,
    9,
    10,
    10,
    11,
    13,
    14,
    16,
    17,
    17,
    18,
    20,
    21,
    23,
    25,
    26,
    28,
    29,
    31,
    33,
    35,
    37,
    38,
    40,
    43,
    45,
    47,
    49
  ],
  Q: [
    -1,
    1,
    1,
    2,
    2,
    4,
    4,
    6,
    6,
    8,
    8,
    8,
    10,
    12,
    16,
    12,
    17,
    16,
    18,
    21,
    20,
    23,
    23,
    25,
    27,
    29,
    34,
    34,
    35,
    38,
    40,
    43,
    45,
    48,
    51,
    53,
    56,
    59,
    62,
    65,
    68
  ],
  H: [
    -1,
    1,
    1,
    2,
    4,
    4,
    4,
    5,
    6,
    8,
    8,
    11,
    11,
    16,
    16,
    18,
    16,
    19,
    21,
    25,
    25,
    25,
    34,
    30,
    32,
    35,
    37,
    40,
    42,
    45,
    48,
    51,
    54,
    57,
    60,
    63,
    66,
    70,
    74,
    77,
    81
  ]
};
var MODE_BYTE = 4;
function byteModeCharCountBits(version) {
  return version <= 9 ? 8 : 16;
}
var MIN_VERSION = 1;
var MAX_VERSION = 40;

// packages/core/dist/qr/galois.js
function gfMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = z << 1 ^ (z >>> 7) * 285;
    z ^= (y >>> i & 1) * x;
  }
  return z & 255;
}
function rsGeneratorPolynomial(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree)
        result[j] = result[j] ^ result[j + 1];
    }
    root = gfMultiply(root, 2);
  }
  return result;
}
function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (let i = 0; i < data.length; i += 1) {
    const factor = (data[i] ^ result.shift()) & 255;
    result.push(0);
    for (let j = 0; j < divisor.length; j += 1) {
      result[j] = result[j] ^ gfMultiply(divisor[j], factor);
    }
  }
  return result;
}

// packages/core/dist/qr/encoder.js
function qrSizeOfVersion(version) {
  return version * 4 + 17;
}
function rawDataModules(version) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7)
      result -= 36;
  }
  return result;
}
function numDataCodewords(version, ecLevel) {
  const ecc = ECC_CODEWORDS_PER_BLOCK[ecLevel][version];
  const blocks = NUM_EC_BLOCKS[ecLevel][version];
  if (ecc === void 0 || blocks === void 0) {
    throw new RangeError(`\u7248\u672C ${version} \u8D85\u51FA 1..40 \u8303\u56F4`);
  }
  return Math.floor(rawDataModules(version) / 8) - ecc * blocks;
}
function alignmentPatternPositions(version) {
  if (version === 1)
    return [];
  const numAlign = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.floor((version * 4 + numAlign * 2 + 1) / (numAlign * 2 - 2)) * 2;
  const result = new Array(numAlign);
  result[0] = 6;
  for (let i = result.length - 1, pos = version * 4 + 10; i >= 1; i -= 1, pos -= step) {
    result[i] = pos;
  }
  return result;
}
function encodeQr(text, options = {}) {
  return encodeQrBytes(utf8Encode(text), options, text);
}
function encodeQrBytes(bytes, options = {}, text = null) {
  var _a, _b, _c, _d;
  const ecLevel = (_a = options.ecLevel) != null ? _a : "M";
  const minVersion = clampVersion((_b = options.minVersion) != null ? _b : MIN_VERSION);
  const maxVersion = clampVersion((_c = options.maxVersion) != null ? _c : MAX_VERSION);
  if (minVersion > maxVersion) {
    throw new RangeError(`minVersion(${minVersion}) \u4E0D\u80FD\u5927\u4E8E maxVersion(${maxVersion})`);
  }
  const version = pickVersion(bytes.length, ecLevel, minVersion, maxVersion);
  const dataCodewords = buildDataCodewords(bytes, version, ecLevel);
  const allCodewords = addEccAndInterleave(dataCodewords, version, ecLevel);
  const size = qrSizeOfVersion(version);
  const modules = new Uint8Array(size * size);
  const isFunction = new Uint8Array(size * size);
  const matrix = { size, modules, isFunction };
  drawFunctionPatterns(matrix, version, ecLevel);
  drawCodewords(matrix, allCodewords);
  const mask = (_d = options.mask) != null ? _d : chooseMask(matrix, ecLevel);
  if (mask < 0 || mask > 7)
    throw new RangeError(`\u63A9\u7801\u5FC5\u987B\u662F 0..7\uFF0C\u6536\u5230 ${mask}`);
  applyMask(matrix, mask);
  drawFormatBits(matrix, ecLevel, mask);
  let darkCount = 0;
  for (let i = 0; i < modules.length; i += 1)
    darkCount += modules[i];
  return {
    text,
    version,
    ecLevel,
    mask,
    size,
    modules,
    darkCount,
    isDark: (row, col) => {
      if (row < 0 || col < 0 || row >= size || col >= size)
        return false;
      return modules[row * size + col] === 1;
    }
  };
}
function clampVersion(version) {
  if (!Number.isInteger(version) || version < MIN_VERSION || version > MAX_VERSION) {
    throw new RangeError(`\u7248\u672C\u5FC5\u987B\u662F ${MIN_VERSION}..${MAX_VERSION} \u7684\u6574\u6570\uFF0C\u6536\u5230 ${version}`);
  }
  return version;
}
function pickVersion(byteLength, ecLevel, minVersion, maxVersion) {
  for (let version = minVersion; version <= maxVersion; version += 1) {
    const capacityBits = numDataCodewords(version, ecLevel) * 8;
    const usedBits = 4 + byteModeCharCountBits(version) + byteLength * 8;
    if (usedBits <= capacityBits)
      return version;
  }
  throw new RangeError(`\u6570\u636E\u592A\u957F\uFF1A${byteLength} \u5B57\u8282\u5728\u7248\u672C ${minVersion}..${maxVersion} / \u7EA0\u9519\u7B49\u7EA7 ${ecLevel} \u4E0B\u653E\u4E0D\u4E0B`);
}
function buildDataCodewords(bytes, version, ecLevel) {
  const capacityBits = numDataCodewords(version, ecLevel) * 8;
  const bits = [];
  const pushBits = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1)
      bits.push(value >>> i & 1);
  };
  pushBits(MODE_BYTE, 4);
  pushBits(bytes.length, byteModeCharCountBits(version));
  for (let i = 0; i < bytes.length; i += 1)
    pushBits(bytes[i] & 255, 8);
  pushBits(0, Math.min(4, capacityBits - bits.length));
  pushBits(0, (8 - bits.length % 8) % 8);
  for (let padByte = 236; bits.length < capacityBits; padByte ^= 236 ^ 17) {
    pushBits(padByte, 8);
  }
  const result = new Uint8Array(capacityBits / 8);
  for (let i = 0; i < bits.length; i += 1) {
    if (bits[i])
      result[i >>> 3] = result[i >>> 3] | 128 >>> (i & 7);
  }
  return result;
}
function addEccAndInterleave(data, version, ecLevel) {
  const numBlocks = NUM_EC_BLOCKS[ecLevel][version];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecLevel][version];
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const numShortBlocks = numBlocks - rawCodewords % numBlocks;
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const divisor = rsGeneratorPolynomial(blockEccLen);
  const blocks = [];
  for (let i = 0, offset = 0; i < numBlocks; i += 1) {
    const dataLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
    const chunk = data.subarray(offset, offset + dataLen);
    offset += dataLen;
    const ecc = rsRemainder(chunk, divisor);
    const block = new Uint8Array(shortBlockLen + 1);
    block.set(chunk, 0);
    block.set(ecc, block.length - blockEccLen);
    blocks.push(block);
  }
  const result = new Uint8Array(rawCodewords);
  let k = 0;
  const blockLength = blocks[0].length;
  for (let i = 0; i < blockLength; i += 1) {
    for (let j = 0; j < blocks.length; j += 1) {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) {
        result[k] = blocks[j][i];
        k += 1;
      }
    }
  }
  if (k !== rawCodewords) {
    throw new Error(`\u4EA4\u9519\u5199\u5165\u4E86 ${k} \u4E2A\u7801\u5B57\uFF0C\u9884\u671F ${rawCodewords}`);
  }
  return result;
}
function setFunctionModule(m, x, y, dark) {
  if (x < 0 || y < 0 || x >= m.size || y >= m.size)
    return;
  const index = y * m.size + x;
  m.modules[index] = dark ? 1 : 0;
  m.isFunction[index] = 1;
}
function drawFunctionPatterns(m, version, ecLevel) {
  const { size } = m;
  for (let i = 0; i < size; i += 1) {
    setFunctionModule(m, 6, i, i % 2 === 0);
    setFunctionModule(m, i, 6, i % 2 === 0);
  }
  drawFinderPattern(m, 3, 3);
  drawFinderPattern(m, size - 4, 3);
  drawFinderPattern(m, 3, size - 4);
  const positions = alignmentPatternPositions(version);
  const n = positions.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const isFinderCorner = i === 0 && j === 0 || i === 0 && j === n - 1 || i === n - 1 && j === 0;
      if (isFinderCorner)
        continue;
      drawAlignmentPattern(m, positions[i], positions[j]);
    }
  }
  drawFormatBits(m, ecLevel, 0);
  drawVersionBits(m, version);
}
function drawFinderPattern(m, x, y) {
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      setFunctionModule(m, x + dx, y + dy, dist !== 2 && dist !== 4);
    }
  }
}
function drawAlignmentPattern(m, x, y) {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      setFunctionModule(m, x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}
function drawFormatBits(m, ecLevel, mask) {
  const { size } = m;
  const data = EC_LEVEL_FORMAT_BITS[ecLevel] << 3 | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1)
    rem = rem << 1 ^ (rem >>> 9) * 1335;
  const bits = (data << 10 | rem) ^ 21522;
  const bit = (i) => (bits >>> i & 1) !== 0;
  for (let i = 0; i <= 5; i += 1)
    setFunctionModule(m, 8, i, bit(i));
  setFunctionModule(m, 8, 7, bit(6));
  setFunctionModule(m, 8, 8, bit(7));
  setFunctionModule(m, 7, 8, bit(8));
  for (let i = 9; i < 15; i += 1)
    setFunctionModule(m, 14 - i, 8, bit(i));
  for (let i = 0; i < 8; i += 1)
    setFunctionModule(m, size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i += 1)
    setFunctionModule(m, 8, size - 15 + i, bit(i));
  setFunctionModule(m, 8, size - 8, true);
}
function drawVersionBits(m, version) {
  if (version < 7)
    return;
  let rem = version;
  for (let i = 0; i < 12; i += 1)
    rem = rem << 1 ^ (rem >>> 11) * 7973;
  const bits = version << 12 | rem;
  for (let i = 0; i < 18; i += 1) {
    const dark = (bits >>> i & 1) !== 0;
    const a = m.size - 11 + i % 3;
    const b = Math.floor(i / 3);
    setFunctionModule(m, a, b, dark);
    setFunctionModule(m, b, a, dark);
  }
}
function drawCodewords(m, codewords) {
  const { size } = m;
  const totalBits = codewords.length * 8;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6)
      right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = (right + 1 & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        const index = y * size + x;
        if (m.isFunction[index] === 0 && i < totalBits) {
          m.modules[index] = codewords[i >>> 3] >>> 7 - (i & 7) & 1;
          i += 1;
        }
      }
    }
  }
}
function maskPredicate(mask, x, y) {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return x * y % 2 + x * y % 3 === 0;
    case 6:
      return (x * y % 2 + x * y % 3) % 2 === 0;
    case 7:
      return ((x + y) % 2 + x * y % 3) % 2 === 0;
    default:
      throw new RangeError(`\u63A9\u7801\u5FC5\u987B\u662F 0..7\uFF0C\u6536\u5230 ${mask}`);
  }
}
function applyMask(m, mask) {
  const { size, modules, isFunction } = m;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      if (isFunction[index] === 0 && maskPredicate(mask, x, y)) {
        modules[index] = modules[index] ^ 1;
      }
    }
  }
}
var PENALTY_N1 = 3;
var PENALTY_N2 = 3;
var PENALTY_N3 = 40;
var PENALTY_N4 = 10;
function chooseMask(m, ecLevel) {
  let bestMask = 0;
  let bestPenalty = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask += 1) {
    applyMask(m, mask);
    drawFormatBits(m, ecLevel, mask);
    const penalty = penaltyScore(m);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
    }
    applyMask(m, mask);
  }
  return bestMask;
}
function penaltyScore(m) {
  return penaltyN1(m) + penaltyN2(m) + penaltyN3(m) + penaltyN4(m);
}
function penaltyN1(m) {
  const { size, modules } = m;
  let points = 0;
  for (let row = 0; row < size; row += 1) {
    let lastHorizontal = -1;
    let horizontalRun = 0;
    let lastVertical = -1;
    let verticalRun = 0;
    for (let col = 0; col < size; col += 1) {
      const horizontal = modules[row * size + col];
      if (horizontal === lastHorizontal) {
        horizontalRun += 1;
      } else {
        if (horizontalRun >= 5)
          points += PENALTY_N1 + (horizontalRun - 5);
        lastHorizontal = horizontal;
        horizontalRun = 1;
      }
      const vertical = modules[col * size + row];
      if (vertical === lastVertical) {
        verticalRun += 1;
      } else {
        if (verticalRun >= 5)
          points += PENALTY_N1 + (verticalRun - 5);
        lastVertical = vertical;
        verticalRun = 1;
      }
    }
    if (horizontalRun >= 5)
      points += PENALTY_N1 + (horizontalRun - 5);
    if (verticalRun >= 5)
      points += PENALTY_N1 + (verticalRun - 5);
  }
  return points;
}
function penaltyN2(m) {
  const { size, modules } = m;
  let blocks = 0;
  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const sum2 = modules[row * size + col] + modules[row * size + col + 1] + modules[(row + 1) * size + col] + modules[(row + 1) * size + col + 1];
      if (sum2 === 4 || sum2 === 0)
        blocks += 1;
    }
  }
  return blocks * PENALTY_N2;
}
function penaltyN3(m) {
  const { size, modules } = m;
  let points = 0;
  for (let row = 0; row < size; row += 1) {
    let windowHorizontal = 0;
    let windowVertical = 0;
    for (let col = 0; col < size; col += 1) {
      windowHorizontal = windowHorizontal << 1 & 2047 | modules[row * size + col];
      if (col >= 10 && (windowHorizontal === 1488 || windowHorizontal === 93))
        points += 1;
      windowVertical = windowVertical << 1 & 2047 | modules[col * size + row];
      if (col >= 10 && (windowVertical === 1488 || windowVertical === 93))
        points += 1;
    }
  }
  return points * PENALTY_N3;
}
function penaltyN4(m) {
  let dark = 0;
  const total = m.modules.length;
  for (let i = 0; i < total; i += 1)
    dark += m.modules[i];
  const k = Math.abs(Math.ceil(dark * 100 / total / 5) - 10);
  return k * PENALTY_N4;
}

// packages/core/dist/qr/render.js
function qrToPathData(qr, quietZone = 4) {
  const parts = [];
  for (let y = 0; y < qr.size; y += 1) {
    let x = 0;
    while (x < qr.size) {
      if (!qr.isDark(y, x)) {
        x += 1;
        continue;
      }
      let run = 1;
      while (x + run < qr.size && qr.isDark(y, x + run))
        run += 1;
      parts.push(`M${x + quietZone} ${y + quietZone}h${run}v1h-${run}z`);
      x += run;
    }
  }
  return parts.join("");
}
function qrToSvg(qr, options = {}) {
  var _a, _b, _c, _d;
  const quietZone = (_a = options.quietZone) != null ? _a : 4;
  const moduleSize = (_b = options.moduleSize) != null ? _b : 8;
  const dark = (_c = options.dark) != null ? _c : "#000000";
  const light = (_d = options.light) != null ? _d : "#ffffff";
  const side = (qr.size + quietZone * 2) * moduleSize;
  const background = light === "transparent" ? "" : `<rect width="${side}" height="${side}" fill="${light}"/>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}"`,
    ` role="img" aria-label="QR Code">`,
    background,
    `<path d="${qrToPathData(qr, quietZone)}" fill="${dark}"`,
    options.crispEdges === false ? "" : ' shape-rendering="crispEdges"',
    "/>",
    "</svg>"
  ].join("");
}
function qrToBlockArt(qr, options = {}) {
  var _a, _b, _c;
  const quietZone = (_a = options.quietZone) != null ? _a : 2;
  const dark = (_b = options.dark) != null ? _b : "\u2588\u2588";
  const light = (_c = options.light) != null ? _c : "  ";
  const rows = [];
  const blank = light.repeat(qr.size + quietZone * 2);
  for (let i = 0; i < quietZone; i += 1)
    rows.push(blank);
  for (let y = 0; y < qr.size; y += 1) {
    let line = light.repeat(quietZone);
    for (let x = 0; x < qr.size; x += 1)
      line += qr.isDark(y, x) ? dark : light;
    line += light.repeat(quietZone);
    rows.push(line);
  }
  for (let i = 0; i < quietZone; i += 1)
    rows.push(blank);
  return rows.join("\n");
}
function qrToRgba(qr, scale = 4, options = {}) {
  var _a, _b, _c;
  const quietZone = (_a = options.quietZone) != null ? _a : 4;
  const dark = (_b = options.dark) != null ? _b : [0, 0, 0, 255];
  const light = (_c = options.light) != null ? _c : [255, 255, 255, 255];
  const side = (qr.size + quietZone * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4);
  for (let py = 0; py < side; py += 1) {
    for (let px = 0; px < side; px += 1) {
      const mx = Math.floor(px / scale) - quietZone;
      const my = Math.floor(py / scale) - quietZone;
      const isDark = mx >= 0 && my >= 0 && mx < qr.size && my < qr.size && qr.isDark(my, mx);
      const color = isDark ? dark : light;
      const offset = (py * side + px) * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = color[3];
    }
  }
  return { width: side, height: side, data };
}

// packages/core/dist/mock/generate.js
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function createMockPlayer(options = {}) {
  var _a, _b, _c, _d, _e, _f;
  const seed = (_a = options.seed) != null ? _a : 20240101;
  const rand = mulberry32(seed);
  const now = (_b = options.now) != null ? _b : /* @__PURE__ */ new Date();
  const uploadTime = new Date(now.getTime() - 2.5 * 24 * 60 * 60 * 1e3);
  return {
    name: (_c = options.name) != null ? _c : "\uFF21\uFF53\uFF54\uFF52\uFF41",
    rating: (_e = (_d = options.rating) != null ? _d : options.targetRating) != null ? _e : 15e3,
    friend_code: (_f = options.friendCode) != null ? _f : 888888888888888,
    course_rank: Math.floor(rand() * 20),
    class_rank: Math.floor(rand() * 15),
    star: Math.floor(rand() * 300),
    trophy: { id: 300022, name: "\u7406\u8BBA\u503C", genre: "", color: "rainbow" },
    icon: { id: 200201, name: "", genre: "" },
    name_plate: { id: 200201, name: "", genre: "" },
    frame: { id: 300101, name: "", genre: "" },
    upload_time: uploadTime.toISOString()
  };
}
function collectCandidates(songList, minLevel, maxLevel) {
  var _a, _b, _c, _d, _e;
  const out = [];
  for (const song of (_a = songList.songs) != null ? _a : []) {
    if (song.disabled)
      continue;
    if (song.id > 1e5)
      continue;
    for (const chart of (_c = (_b = song.difficulties) == null ? void 0 : _b.standard) != null ? _c : []) {
      if (isPlayable(chart, minLevel, maxLevel))
        out.push({ song, chart, type: "standard" });
    }
    for (const chart of (_e = (_d = song.difficulties) == null ? void 0 : _d.dx) != null ? _e : []) {
      if (isPlayable(chart, minLevel, maxLevel))
        out.push({ song, chart, type: "dx" });
    }
  }
  return out;
}
function isPlayable(chart, minLevel, maxLevel) {
  const value = chart.level_value;
  return Number.isFinite(value) && value >= minLevel && value <= maxLevel && (chart.difficulty === 3 || chart.difficulty === 4);
}
function levelWindow(targetRating) {
  const maxLevel = Math.min(15, Math.max(11, targetRating / 1e3 - 0.5));
  return {
    minLevel: Math.max(9, maxLevel - 1.6),
    maxLevel,
    baseAch: Math.min(100.3, Math.max(97.5, 99 + (targetRating - 15e3) / 2500))
  };
}
function createMockBests(songList, options = {}) {
  var _a, _b, _c, _d, _e;
  const seed = (_a = options.seed) != null ? _a : 20240101;
  const rand = mulberry32(seed ^ 2654435769);
  const targetRating = (_b = options.targetRating) != null ? _b : 15e3;
  const includeApBonus = (_c = options.includeApBonus) != null ? _c : true;
  const { minLevel, maxLevel, baseAch } = levelWindow(targetRating);
  let candidates = collectCandidates(songList, minLevel, maxLevel);
  if (candidates.length < 80)
    candidates = collectCandidates(songList, 9, 15);
  if (candidates.length === 0) {
    throw new Error("\u66F2\u5E93\u4E2D\u6CA1\u6709\u53EF\u7528\u4E8E\u751F\u6210\u6A21\u62DF\u6210\u7EE9\u7684\u8C31\u9762\u3002");
  }
  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const a = shuffled[i];
    const b = shuffled[j];
    shuffled[i] = b;
    shuffled[j] = a;
  }
  const scored = [];
  const midLevel = (minLevel + maxLevel) / 2;
  for (const candidate of shuffled) {
    const score = makeScore(candidate, rand, baseAch, midLevel, includeApBonus);
    if (score === null)
      continue;
    scored.push({ score, rating: Math.floor(((_d = score.dx_rating) != null ? _d : 0) + 1e-9) });
  }
  const standard = [];
  const dx = [];
  const usage = /* @__PURE__ */ new Map();
  scored.sort((a, b) => b.rating - a.rating);
  for (const item of scored) {
    const used = (_e = usage.get(item.score.id)) != null ? _e : 0;
    if (used >= 2)
      continue;
    const bucket = item.score.type === "dx" ? dx : standard;
    const limit = item.score.type === "dx" ? 15 : 35;
    if (bucket.length >= limit)
      continue;
    bucket.push(item);
    usage.set(item.score.id, used + 1);
  }
  const standardScores = standard.map((s) => s.score);
  const dxScores = dx.map((s) => s.score);
  return {
    standard_total: sum(standard.map((s) => s.rating)),
    dx_total: sum(dx.map((s) => s.rating)),
    standard: standardScores,
    dx: dxScores,
    standard_selections: pickSelections(scored, standardScores),
    dx_selections: pickSelections(scored, dxScores)
  };
}
function pickSelections(scored, chosen) {
  const chosenKeys = new Set(chosen.map((s) => `${s.id}-${s.type}-${s.level_index}`));
  return scored.filter((item) => !chosenKeys.has(`${item.score.id}-${item.score.type}-${item.score.level_index}`)).slice(0, 10).map((item) => item.score);
}
function makeScore(candidate, rand, baseAch, midLevel, includeApBonus) {
  const { song, chart, type } = candidate;
  const levelValue = chart.level_value;
  if (!Number.isFinite(levelValue))
    return null;
  const penalty = (levelValue - midLevel) * 0.6;
  const jitter = (rand() - 0.5) * 0.9;
  const excellent = rand() < 0.06 ? 0.9 + rand() * 0.5 : 0;
  let achievements = baseAch - penalty + jitter + excellent;
  achievements = Math.min(101, Math.max(85, achievements));
  achievements = Math.round(achievements * 1e4) / 1e4;
  const allPerfect = achievements >= 100.5;
  const fc = pickFc(achievements, rand);
  const fs = rand() < 0.35 ? pickFs(rand) : null;
  const percent = Math.min(normalizeAchievement(achievements), 100.5);
  const raw = levelValue * (percent / 100) * dxRatingCoefficient(percent);
  const dxRating = includeApBonus && (fc === "ap" || fc === "app") ? raw + 1 : raw;
  const noteCount = chart.notes && "total" in chart.notes ? chart.notes.total : 900;
  const breakCount = chart.notes && "break" in chart.notes ? chart.notes.break : 40;
  const maxDxScore = noteCount * 3 + breakCount * 2;
  const dxScore = Math.round(maxDxScore * (0.9 + rand() * 0.099));
  return {
    id: song.id,
    song_name: song.title,
    level: chart.level,
    level_index: chart.difficulty,
    achievements,
    fc,
    fs,
    dx_score: dxScore,
    dx_star: starFromRatio(dxScore / maxDxScore),
    dx_rating: dxRating,
    rate: rateFromAchievement(achievements),
    type,
    play_time: null,
    upload_time: new Date(Date.UTC(2024, 0, 1)).toISOString(),
    last_played_time: new Date(Date.UTC(2023, 11, 20 + Math.floor(rand() * 10))).toISOString()
  };
}
function pickFc(achievements, rand) {
  if (achievements >= 100.5)
    return achievements >= 101 ? "app" : "ap";
  if (achievements >= 100)
    return "fcp";
  if (achievements >= 98.5)
    return rand() < 0.5 ? "fc" : "fcp";
  if (rand() < 0.4)
    return "fc";
  return null;
}
function pickFs(rand) {
  const roll = rand();
  if (roll < 0.05)
    return "fsdp";
  if (roll < 0.15)
    return "fsd";
  if (roll < 0.4)
    return "fsp";
  if (roll < 0.75)
    return "fs";
  return "sync";
}
function starFromRatio(ratio) {
  if (ratio >= 1)
    return 5;
  if (ratio >= 0.95)
    return 4;
  if (ratio >= 0.9)
    return 3;
  if (ratio >= 0.8)
    return 2;
  if (ratio >= 0.7)
    return 1;
  return 0;
}
function sum(list) {
  return list.reduce((a, b) => a + b, 0);
}
function createSyntheticSongList(count = 60) {
  const genres = [
    { id: 1, title: "\u6D41\u884C&\u52A8\u6F2B", genre: "POPS\uFF06\u30A2\u30CB\u30E1" },
    { id: 2, title: "niconico&VOCALOID", genre: "niconico\uFF06\u30DC\u30FC\u30AB\u30ED\u30A4\u30C9" },
    { id: 3, title: "\u4E1C\u65B9Project", genre: "\u6771\u65B9Project" }
  ];
  const songs = [];
  const titles = [
    "Astra",
    "Nebula",
    "Photon",
    "Quasar",
    "Vertex",
    "Halo",
    "Zenith",
    "Nova",
    "Lumen",
    "Orbit",
    "Pulsar",
    "Cinder",
    "Drift",
    "Ember",
    "Flux",
    "Glacier"
  ];
  for (let i = 0; i < count; i += 1) {
    const id = 1e4 + i;
    const base = 11 + i % 9 * 0.45;
    const levelValue = Math.round(base * 10) / 10;
    const level = levelValue >= 14.7 ? "15" : levelValue >= 13.7 ? "14" : levelValue >= 12.7 ? "13+" : "13";
    songs.push({
      id,
      title: `${titles[i % titles.length]} ${Math.floor(i / titles.length) + 1}`,
      artist: "AstraMai Mock",
      genre: "maimai",
      bpm: 120 + i * 7 % 100,
      version: 23e3 + i % 5 * 500,
      difficulties: {
        standard: [0, 1, 2, 3, 4].map((difficulty) => ({
          type: "standard",
          difficulty,
          level: difficulty === 4 ? level : String(Math.max(1, levelValue - (4 - difficulty) * 1.5)),
          level_value: Math.max(1, Math.round((levelValue - (4 - difficulty) * 1.5) * 10) / 10),
          note_designer: "Mock",
          version: 23e3,
          notes: {
            total: 500 + difficulty * 180,
            tap: 350 + difficulty * 120,
            hold: 60 + difficulty * 15,
            slide: 50 + difficulty * 25,
            touch: 20 + difficulty * 10,
            break: 15 + difficulty * 6
          }
        })),
        dx: [0, 1, 2, 3, 4].map((difficulty) => ({
          type: "dx",
          difficulty,
          level: difficulty === 4 ? level : String(Math.max(1, levelValue - (4 - difficulty) * 1.5)),
          level_value: Math.max(1, Math.round((levelValue - (4 - difficulty) * 1.5) * 10) / 10),
          note_designer: "Mock",
          version: 23e3,
          notes: {
            total: 520 + difficulty * 190,
            tap: 360 + difficulty * 130,
            hold: 55 + difficulty * 14,
            slide: 60 + difficulty * 26,
            touch: 25 + difficulty * 11,
            break: 18 + difficulty * 7
          }
        }))
      }
    });
  }
  return {
    songs,
    genres,
    versions: [{ id: 1, title: "AstraMai Mock Ver.", version: 23e3 }]
  };
}
export {
  ACHIEVEMENT_CAP,
  ACHIEVEMENT_MAX,
  DIFFICULTY_COLORS,
  DIFFICULTY_NAMES,
  DIFFICULTY_SHORT_NAMES,
  DX_RATING_COEFFICIENTS,
  ECC_CODEWORDS_PER_BLOCK,
  EC_LEVELS,
  EC_LEVEL_FORMAT_BITS,
  FC_LABELS,
  FS_LABELS,
  LEVEL_INDEXES,
  LXNS_API_BASE,
  LxnsClient,
  LxnsError,
  MAIMAI_ASSET_BASE,
  MAX_VERSION,
  MIN_VERSION,
  MODE_BYTE,
  NUM_EC_BLOCKS,
  RATE_COLORS,
  RATE_LABELS,
  RATE_THRESHOLDS,
  RATING_TIERS,
  SONG_TYPE_LABELS,
  TROPHY_COLOR_CSS,
  TROPHY_COLOR_LABELS,
  WAHLAP_QR_CONTENT_PREFIX,
  alignmentPatternPositions,
  buildB50View,
  buildSongIndex,
  byteModeCharCountBits,
  bytesToHex,
  calculateDxRating,
  createMockBests,
  createMockPlayer,
  createSyntheticSongList,
  decodeHexUtf8,
  describeValidity,
  difficultyColor,
  difficultyName,
  difficultyShortName,
  dxRatingCoefficient,
  dxRatingCoefficientStep,
  dxScoreRatio,
  encodeQr,
  encodeQrBytes,
  findDifficulty,
  formatAchievement,
  formatAchievementShort,
  formatDelta,
  formatDuration,
  formatDxScore,
  formatFixed,
  formatInt,
  formatLevelValue,
  formatRelative,
  formatUtcToLocal,
  gfMultiply,
  hexToBytes,
  isAllPerfect,
  jacketUrl,
  kindFromStatus,
  maimaiEndpoints,
  maxDxScoreFromNotes,
  maxRatingForLevel,
  minimumAchievementForRate,
  musicUrl,
  normalizeAchievement,
  numDataCodewords,
  parseWahlapQrPayload,
  projectRating,
  qrSizeOfVersion,
  qrToBlockArt,
  qrToPathData,
  qrToRgba,
  qrToSvg,
  rateFromAchievement,
  ratingTier,
  rawDataModules,
  requiredLevelValue,
  rsGeneratorPolynomial,
  rsRemainder,
  serializeLxnsError,
  truncate,
  unwrapEnvelope,
  utf8Decode,
  utf8Encode,
  verifyScoreRating,
  wahlapQrContentOf
};
