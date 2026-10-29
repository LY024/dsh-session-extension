/**
 * dsh-session-extension —— 主机侧。
 *
 * 只做三件只读的事，全部通过 /api/dsh-session-extension 桥接给网页端：
 *
 *   GET  /status       插件版本与配置
 *   POST /sessions     会话目录（轻量：只读 header，不打开正文）
 *   POST /last-prompt  某个会话的「上一次提问」：文本 + seq + fork 边界
 *
 * 真正的「重发」由浏览器端调用 DSH 自己的两个公开接口完成：
 *   ctx.sessions.fork({ sessionId, atSeq })   —— 从那条提问之前分叉；
 *   ctx.uiWorkspace.openSession(childId)      —— 打开新分支；
 *   inputActions.setDraft(text) / submit()    —— 把改好的文字放进输入框。
 * 所以本插件**不改会话日志、不搬文件**，失败了最多是什么都没发生。
 *
 * 刻意不 import 任何 @deepseek-ai/* 包：需要的能力全部从 cordis ctx 上取
 * （sessionQuery / webServer），这样 profile 的 node_modules 布局变了也照样能加载。
 *
 * @module dsh-session-extension
 */
import { createRequire } from 'node:module';
import { isIP } from 'node:net';
import { findLastPrompt, hasReplyAfter } from './last-prompt.js';

/** 插件名（必须与 package.json 的 name 一致）。 */
export const name = 'dsh-session-extension';

/** 会话查询服务是唯一的硬依赖；Web 路由在它可用之后再挂。 */
export const inject = ['sessionQuery'];

/** 桥接默认前缀。 */
const DEFAULT_PREFIX = '/api/dsh-session-extension';
/** 插件版本：唯一来源是 package.json，读不到才退化成显眼的 unknown。 */
const PLUGIN_VERSION = (() => {
  try {
    return createRequire(import.meta.url)('../package.json').version;
  } catch {
    return '0.0.0-unknown';
  }
})();
/** 引导全局：客户端从它读 bridgePrefix / version。 */
const BOOT_GLOBAL = '__DSH_SESSION_EXTENSION__';
/** 请求体上限。 */
const MAX_BODY_BYTES = 64 * 1024;
/** sessionId 长度上限。 */
const MAX_SESSION_ID_LENGTH = 256;
/** /sessions 一次最多返回多少条。 */
const MAX_SESSIONS = 200;
/** withTitles 生效的最大条数（读标题要逐个折叠日志，别一次读太多）。 */
const MAX_TITLES = 20;

/** 带 HTTP 状态码的请求错误。 */
class HttpError extends Error {
  /**
   * @param status - HTTP 状态码。
   * @param code - 机器可读错误码。
   * @param message - 面向调用方的说明。
   */
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

/** 把主机名规范成小写、去掉 IPv6 方括号。 */
function normalizeHostname(value) {
  if (typeof value !== 'string') return '';
  let host = value.trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  return host;
}

/** 回环主机名：localhost、127.0.0.0/8、::1。 */
function isLoopbackHostname(hostname) {
  if (hostname === 'localhost') return true;
  if (hostname === '::1' || hostname === '0:0:0:0:0:0:0:1') return true;
  if (isIP(hostname) === 4) return hostname.startsWith('127.');
  return false;
}

/**
 * 解析 Host 头（`name`、`name:port`、`[v6]`、`[v6]:port`）。
 *
 * @param value - 原始 Host 头。
 * @returns `{ hostname, port }`，非法时 undefined。
 */
function parseAuthority(value) {
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (raw.length === 0 || raw.length > 512) return undefined;
  if (raw.includes('/') || raw.includes('?') || raw.includes('#')) return undefined;
  try {
    const url = new URL('http://' + raw);
    return { hostname: normalizeHostname(url.hostname), port: url.port };
  } catch {
    return undefined;
  }
}

/**
 * 解析 Origin 头。
 *
 * @param value - 原始 Origin。
 * @returns `{ origin, hostname, port }`，非法时 undefined。
 */
function parseOrigin(value) {
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (raw.length === 0 || raw.length > 512) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return {
      origin: url.origin,
      hostname: normalizeHostname(url.hostname),
      port: url.port === '' ? (url.protocol === 'https:' ? '443' : '80') : url.port,
    };
  } catch {
    return undefined;
  }
}

/** 是不是 JSON 媒体类型（允许带 charset / 其它参数）。 */
function isJsonMediaType(value) {
  if (typeof value !== 'string') return false;
  const media = value.split(';', 1)[0].trim().toLowerCase();
  return media === 'application/json';
}

/**
 * 读一个 JSON 请求体：只接受对象，空体视为 `{}`；超限回 413。
 *
 * @param req - node:http 请求。
 * @returns 解析后的对象。
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const declared = req.headers !== undefined ? req.headers['content-length'] : undefined;
    if (typeof declared === 'string' && /^[0-9]+$/.test(declared) && Number(declared) > MAX_BODY_BYTES) {
      if (typeof req.resume === 'function') req.resume();
      reject(new HttpError(413, 'payload-too-large', '请求体过大（上限 ' + String(MAX_BODY_BYTES) + ' 字节）'));
      return;
    }
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      if (typeof req.resume === 'function') req.resume();
      reject(error);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(new HttpError(413, 'payload-too-large', '请求体过大（上限 ' + String(MAX_BODY_BYTES) + ' 字节）'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', (error) => {
      fail(new HttpError(400, 'bad-request', String(error && error.message ? error.message : error)));
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (text.length === 0) {
        resolve({});
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        reject(new HttpError(400, 'bad-json', '请求体不是合法 JSON'));
        return;
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        reject(new HttpError(400, 'bad-json', '请求体必须是 JSON 对象'));
        return;
      }
      resolve(parsed);
    });
  });
}

/** 写一个 JSON 响应。 */
function writeJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  });
  res.end(body);
}

/** 统一失败回执。 */
function failure(error) {
  return {
    ok: false,
    code: typeof error.code === 'string' && error.code.length > 0 ? error.code : 'internal-error',
    message: error instanceof Error ? error.message : String(error),
  };
}

/** 错误对应的 HTTP 状态码。 */
function statusForError(error) {
  return error instanceof HttpError ? error.status : 500;
}

/** 取一个合法的 sessionId；非法就抛 400。 */
function requireSessionId(body) {
  const value = body !== null && typeof body === 'object' ? body.sessionId : undefined;
  if (typeof value !== 'string') throw new HttpError(400, 'bad-request', '需要 sessionId');
  const sessionId = value.trim();
  if (sessionId.length === 0) throw new HttpError(400, 'bad-request', 'sessionId 不能为空');
  if (sessionId.length > MAX_SESSION_ID_LENGTH) throw new HttpError(400, 'bad-request', 'sessionId 过长');
  return sessionId;
}

/** 取一个 1..MAX_SESSIONS 的整数。 */
function readLimit(body, fallback) {
  const value = body !== null && typeof body === 'object' ? body.limit : undefined;
  if (!Number.isSafeInteger(value) || value <= 0) return fallback;
  return Math.min(value, MAX_SESSIONS);
}

/**
 * 挂载插件。
 *
 * @param ctx - cordis 上下文。
 * @param config - profile 里这一行的 config。
 */
export function apply(ctx, config) {
  const settings = config !== null && typeof config === 'object' ? config : {};
  const prefix = typeof settings.bridgePrefix === 'string' && settings.bridgePrefix.trim().length > 0
    ? settings.bridgePrefix.trim().replace(/\/+$/, '')
    : DEFAULT_PREFIX;
  const defaultLimit = Number.isSafeInteger(settings.maxSessions) && settings.maxSessions > 0
    ? Math.min(settings.maxSessions, MAX_SESSIONS)
    : 40;
  const withTitlesDefault = settings.withTitles === true;

  const logger = ctx.logger;
  const log = (level, message) => {
    const sink = logger !== undefined && typeof logger[level] === 'function' ? logger[level].bind(logger) : undefined;
    if (sink !== undefined) {
      sink('[dsh-session-extension] ' + message);
      return;
    }
    if (level === 'warn') console.warn('[dsh-session-extension] ' + message);
    else console.log('[dsh-session-extension] ' + message);
  };

  // ---- 请求来源校验 -------------------------------------------------------
  //
  // 桥接直接挂在 DSH 的 node:http 上，没有 cookie、没有 token；虽然这里只有
  // 只读接口，也不该让任意网页能读本机会话内容。四层防护与 dsh-session-relocate
  // 保持一致：
  //   1. Host 校验，挡住 DNS rebinding（攻击者域名解析到 127.0.0.1）；
  //   2. Origin / Sec-Fetch-Site 校验，挡住跨站请求；
  //   3. 强制 JSON Content-Type，把普通 CSRF 挡在 CORS 预检上（本服务不答预检）；
  //   4. 请求体上限，避免拿大 body 打内存。
  const allowedHosts = new Set();
  const allowedOrigins = new Set();
  if (Array.isArray(settings.allowedHosts)) {
    for (const entry of settings.allowedHosts) {
      const parsed = parseAuthority(entry);
      if (parsed !== undefined) allowedHosts.add(parsed.hostname);
    }
  }
  if (Array.isArray(settings.allowedOrigins)) {
    for (const entry of settings.allowedOrigins) {
      const parsed = parseOrigin(entry);
      if (parsed !== undefined) allowedOrigins.add(parsed.origin);
    }
  }

  /**
   * 校验一次请求的来源；任何一项不过就 403。
   *
   * @param req - node:http 请求。
   * @param server - webServer 服务。
   */
  function assertRequestAllowed(req, server) {
    const headers = req.headers !== undefined && req.headers !== null ? req.headers : {};
    const authority = parseAuthority(headers.host);
    if (authority === undefined) throw new HttpError(403, 'forbidden', '请求缺少合法的 Host 头');
    let bindHost = '';
    try {
      bindHost = server !== undefined && server !== null && typeof server.host === 'string'
        ? normalizeHostname(server.host)
        : '';
    } catch {
      bindHost = '';
    }
    const hostAllowed = isLoopbackHostname(authority.hostname)
      || allowedHosts.has(authority.hostname)
      || (bindHost.length > 0 && authority.hostname === bindHost);
    if (!hostAllowed) {
      throw new HttpError(403, 'forbidden', '拒绝来自未知 Host 的请求：' + authority.hostname);
    }
    const site = headers['sec-fetch-site'];
    if (typeof site === 'string' && site.trim().toLowerCase() === 'cross-site') {
      throw new HttpError(403, 'forbidden', '拒绝跨站请求');
    }
    const origin = headers.origin;
    if (origin !== undefined) {
      const parsed = parseOrigin(origin);
      if (parsed === undefined) throw new HttpError(403, 'forbidden', 'Origin 头非法');
      if (!allowedOrigins.has(parsed.origin)) {
        const requestPort = authority.port === '' ? '80' : authority.port;
        if (parsed.hostname !== authority.hostname || parsed.port !== requestPort) {
          throw new HttpError(403, 'forbidden', '拒绝跨源请求：' + parsed.origin);
        }
      }
    }
  }

  /** 读会话目录（只读 header，不打开正文）。 */
  async function listSessions(body) {
    const limit = readLimit(body, defaultLimit);
    const withTitles = body !== null && typeof body === 'object' && typeof body.withTitles === 'boolean'
      ? body.withTitles
      : withTitlesDefault;
    const records = await ctx.sessionQuery.listSessions();
    const rows = [];
    for (const record of records) {
      const header = record !== null && typeof record === 'object' ? record.header : undefined;
      if (header === null || typeof header !== 'object') continue;
      if (typeof header.id !== 'string' || header.id.length === 0) continue;
      rows.push({
        sessionId: header.id,
        createdAt: typeof header.createdAt === 'number' ? header.createdAt : 0,
        cwd: typeof header.cwd === 'string' ? header.cwd : undefined,
        origin: typeof header.origin === 'string' ? header.origin : undefined,
        parentSession: typeof header.parentSession === 'string' ? header.parentSession : undefined,
        live: record.live === true,
        persisted: record.persisted === true,
      });
    }
    rows.sort((a, b) => b.createdAt - a.createdAt);
    const page = rows.slice(0, limit);
    if (withTitles && page.length > 0 && page.length <= MAX_TITLES) {
      const ids = page.map((row) => row.sessionId);
      try {
        const titles = await ctx.sessionQuery.readTitleSnapshots(ids);
        for (let index = 0; index < page.length; index += 1) {
          const result = titles[index];
          if (result === undefined || result === null) continue;
          if (result.status === 'rejected') continue;
          const value = result.status === 'fulfilled' ? result.value : result.value;
          const title = value !== null && typeof value === 'object' ? value.title : undefined;
          if (typeof title === 'string' && title.length > 0) page[index].title = title;
        }
      } catch (error) {
        log('warn', '读标题失败，只回 header：' + String(error && error.message));
      }
    }
    return { ok: true, total: rows.length, sessions: page };
  }

  /** 读某个会话的「上一次提问」。 */
  async function lastPrompt(body) {
    const sessionId = requireSessionId(body);
    let snapshot;
    try {
      snapshot = await ctx.sessionQuery.readSession(sessionId);
    } catch (error) {
      return {
        ok: false,
        code: 'session-unreadable',
        message: '读不到这个会话的日志：' + String(error && error.message ? error.message : error),
      };
    }
    const events = snapshot !== null && typeof snapshot === 'object' && Array.isArray(snapshot.events)
      ? snapshot.events
      : [];
    const found = findLastPrompt(events);
    if (found === null) {
      return { ok: false, code: 'no-prompt', message: '这个会话里还没有可以编辑的提问' };
    }
    const header = snapshot.session !== null && typeof snapshot.session === 'object' ? snapshot.session : {};
    return {
      ok: true,
      sessionId,
      seq: found.seq,
      // null 表示这条提问就是第一件事，没有「之前」可 fork；客户端会退回“只载入输入框”。
      prevSeq: found.prevSeq,
      text: found.text,
      time: found.time,
      images: found.images,
      files: found.files,
      replied: hasReplyAfter(events, found.index),
      header: {
        cwd: typeof header.cwd === 'string' ? header.cwd : undefined,
        origin: typeof header.origin === 'string' ? header.origin : undefined,
        parentSession: typeof header.parentSession === 'string' ? header.parentSession : undefined,
      },
    };
  }

  /**
   * 造一条桥接路由。
   *
   * @param path - 精确路径。
   * @param methods - 允许的方法。
   * @param handler - (body) => payload。
   * @param server - webServer 服务（来源校验里识别绑定地址）。
   */
  function route(path, methods, handler, server) {
    return {
      kind: 'exact',
      path,
      handler: async (req, res) => {
        try {
          assertRequestAllowed(req, server);
          const method = String(req.method !== undefined ? req.method : 'GET').toUpperCase();
          if (!methods.includes(method)) {
            throw new HttpError(405, 'method-not-allowed', '只接受 ' + methods.join('/'));
          }
          let body = {};
          if (method === 'POST') {
            if (!isJsonMediaType(req.headers !== undefined ? req.headers['content-type'] : undefined)) {
              throw new HttpError(415, 'unsupported-media-type', 'POST 请求必须使用 application/json');
            }
            body = await readJsonBody(req);
          }
          writeJson(res, 200, await handler(body));
        } catch (error) {
          if (typeof req.resume === 'function') {
            try { req.resume(); } catch { /* 已结束/已销毁 */ }
          }
          writeJson(res, statusForError(error), failure(error instanceof Error ? error : new Error(String(error))));
        }
      },
    };
  }

  const status = () => ({
    ok: true,
    version: PLUGIN_VERSION,
    prefix,
    capabilities: { lastPrompt: true, sessions: true, fork: 'client' },
  });

  ctx.inject(['webServer'], (sctx) => {
    sctx.effect(() => {
      const routes = [
        route(prefix + '/status', ['GET', 'POST'], status, sctx.webServer),
        route(prefix + '/sessions', ['POST'], listSessions, sctx.webServer),
        route(prefix + '/last-prompt', ['POST'], lastPrompt, sctx.webServer),
      ];
      const disposers = routes.map((entry) => sctx.webServer.register(entry));
      const offInject = sctx.on('webserver/index-inject', (table) => {
        table.push({
          kind: 'global',
          name: BOOT_GLOBAL,
          value: { prefix, version: PLUGIN_VERSION },
        });
      });
      return () => {
        for (const dispose of disposers) dispose();
        offInject();
      };
    }, 'dsh-session-extension: bridge');
  });

  log('info', '就绪：' + prefix + '（v' + PLUGIN_VERSION + '，只读桥接）');
}
