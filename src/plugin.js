/**
 * dsh-session-extension —— 主机侧。
 *
 * 提供 /api/dsh-session-extension/{describe,move,status} 桥接给网页端，并在启动时补完
 * 上次没做完的迁移。
 *
 * 刻意**不 import 任何 @deepseek-ai/* 包**：
 *   - 需要的服务全部从 cordis ctx 上取（workspaceRegistry / sessionPersistence / sessions）；
 *   - dsh home 自己按 DSH_HOME > ~/.dsh 的顺序解析。
 * 这样即使 profile 的 node_modules 布局和预期不同，插件也能加载。
 *
 * @module dsh-session-extension
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { mkdir, readdir, realpath, rename, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { encodeSegment, sessionDir } from './paths.js';
import { commitMoves, createMoveStore, isPathWithin, MAX_SESSION_ID_LENGTH, MoveError, newOpId, recoverPendingMoves, relocateSession, samePath } from './relocate.js';
import { findLastPrompt, hasReplyAfter } from './last-prompt.js';

/** 插件名（必须与 package.json 的 name 一致）。 */
export const name = 'dsh-session-extension';

/**
 * 需要的工作区注册表、会话持久层（搬迁用）与会话查询（读「上一次提问」用）。
 * 三者都是 web 组合里的常规成员；缺任一个就说明这个部署不完整，插件不应该加载。
 */
export const inject = ['workspaceRegistry', 'sessionPersistence', 'sessionQuery'];

/** 桥接默认前缀。 */
const DEFAULT_PREFIX = '/api/dsh-session-extension';
/**
 * 插件版本：**唯一来源是 package.json**（发布规程 §1.1：版本号只能写一处，
 * 写两处就会漂移 —— 这个常量曾经是硬编码的 '0.4.0'，package.json 升到 0.5.0 后
 * 运行时自报的版本就骗人了）。读不到才退化成显眼的 unknown。
 */
const PLUGIN_VERSION = (() => {
  try {
    return createRequire(import.meta.url)('../package.json').version;
  } catch {
    return '0.0.0-unknown';
  }
})();
/** 允许挂在 window 上的引导全局名，供客户端读前缀。 */
const BOOT_GLOBAL = '__DSH_SESSION_EXTENSION__';
/** 改名前的引导全局名。dsh-delete-session 等外部插件仍读它，继续注入。 */
const LEGACY_BOOT_GLOBAL = '__DSH_SESSION_RELOCATE__';
/** 请求体上限。 */
const MAX_BODY_BYTES = 64 * 1024;
/** 一次批量结算最多接受多少条会话。 */
const MAX_BATCH_SESSIONS = 500;
/** /sessions 一次最多返回多少条。 */
const MAX_SESSIONS = 200;
/** /sessions 里 withTitles 生效的最大条数（读标题要逐个折叠日志）。 */
const MAX_TITLES = 20;

/** 解析 DSH home：显式配置 > $DSH_HOME > ~/.dsh（与 dsh-home-paths 的优先级一致）。 */
function resolveHome(settings) {
  if (typeof settings.home === 'string' && settings.home.trim().length > 0) return settings.home.trim();
  const env = process.env.DSH_HOME;
  if (typeof env === 'string' && env.trim().length > 0) return env.trim();
  return join(homedir(), '.dsh');
}

/** 带 HTTP 状态码的请求错误：桥接层据此回 403/405/413/415，而不是一律 400。 */
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

/** 请求体解析失败。保留类型名，code 与旧版一致。 */
class BadRequestBodyError extends HttpError {
  constructor(message, code = 'bad-request', status = 400) {
    super(status, code, message);
    this.name = 'BadRequestBodyError';
  }
}

/**
 * 读一个 JSON 请求体。
 *
 * 只接受 JSON 对象；空体视为 `{}`。超过上限时不再销毁连接（那会让调用方只看到
 * 网络错误），而是丢弃剩余数据并回 413。
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const declared = req.headers !== undefined ? req.headers['content-length'] : undefined;
    if (typeof declared === 'string' && /^[0-9]+$/.test(declared) && Number(declared) > MAX_BODY_BYTES) {
      if (typeof req.resume === 'function') req.resume();
      reject(new BadRequestBodyError('请求体过大（上限 ' + String(MAX_BODY_BYTES) + ' 字节）', 'payload-too-large', 413));
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
        fail(new BadRequestBodyError('请求体过大（上限 ' + String(MAX_BODY_BYTES) + ' 字节）', 'payload-too-large', 413));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (size === 0) {
        resolve({});
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
      } catch {
        reject(new BadRequestBodyError('请求体不是合法 JSON'));
        return;
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        reject(new BadRequestBodyError('请求体必须是 JSON 对象'));
        return;
      }
      resolve(parsed);
    });
    req.on('aborted', () => fail(new BadRequestBodyError('请求被中断')));
    req.on('error', (error) => fail(error));
  });
}

/** 写一个 JSON 响应。 */
function writeJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', String(body.length));
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('cross-origin-resource-policy', 'same-origin');
  res.end(body);
}

/** 把内部错误转成稳定的失败载荷。 */
function failure(error) {
  if (error instanceof MoveError) {
    return { ok: false, code: error.code, message: error.message, details: error.details };
  }
  if (error instanceof HttpError) {
    return { ok: false, code: error.code, message: error.message };
  }
  return { ok: false, code: 'internal', message: String(error && error.message ? error.message : error) };
}

/** 错误对应的 HTTP 状态码：业务失败仍旧 400，未预期异常 500。 */
function statusForError(error) {
  if (error instanceof HttpError) return error.status;
  if (error instanceof MoveError) return 400;
  return 500;
}

/** 规范化 Host/Origin 里的主机名（去方括号、小写、去尾点）。 */
function normalizeHostname(value) {
  if (typeof value !== 'string') return '';
  let host = value.trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

/** 是否是回环主机名/IP（localhost、127/8、::1 及其 IPv4 映射形式）。 */
function isLoopbackHostname(hostname) {
  const host = normalizeHostname(hostname);
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (host.startsWith('::ffff:')) return isLoopbackHostname(host.slice('::ffff:'.length));
  if (isIP(host) === 4) return host.startsWith('127.');
  return false;
}

/**
 * 解析 Host/Authority 头。只接受 `host[:port]`，带路径、用户信息、空白的都判非法。
 * @returns {{ hostname: string, port: string } | undefined}
 */
function parseAuthority(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255) return undefined;
  if (/[\s/\\?#@]/.test(value)) return undefined;
  let url;
  try {
    url = new URL('http://' + value);
  } catch {
    return undefined;
  }
  if (url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') return undefined;
  return { hostname: normalizeHostname(url.hostname), port: url.port };
}

/** 解析 Origin 头；只接受 http/https 的规范 origin。 */
function parseOrigin(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return undefined;
  let url;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.username !== '' || url.password !== '') return undefined;
  return { origin: url.origin, hostname: normalizeHostname(url.hostname), port: url.port };
}

/** POST 只接受 application/json（可带 charset 等参数）。 */
function isJsonMediaType(value) {
  if (typeof value !== 'string') return false;
  const media = value.split(';', 1)[0].trim().toLowerCase();
  return media === 'application/json';
}

/**
 * 从全部会话快照里找出 rootId 的**所有后代**（按 header.parentSession 递归）。
 * 子代理会话在侧边栏是隐藏的，只能靠 header 关系找；孤儿（父不存在）自然找不到。
 *
 * @param snapshots - `sessionPersistence.list()` 的返回（每项至少带 `header`）。
 * @param rootId - 父会话 id。
 * @returns 后代 id（不含 root），按层序。
 */
export function descendantIdsOf(snapshots, rootId) {
  const out = [];
  const seen = new Set([rootId]);
  let frontier = [rootId];
  const all = Array.isArray(snapshots) ? snapshots : [];
  while (frontier.length > 0) {
    const next = [];
    for (const snapshot of all) {
      const header = snapshot !== null && typeof snapshot === 'object' ? snapshot.header : null;
      if (header === null || header === undefined || typeof header !== 'object') continue;
      if (typeof header.parentSession !== 'string' || frontier.indexOf(header.parentSession) < 0) continue;
      // 只认子代理会话（与 DSH 自己 sessionVisible 的过滤一致）；分支/分叉是可见会话，不跟着搬。
      if (header.origin !== 'subagent') continue;
      if (typeof header.id !== 'string' || seen.has(header.id)) continue;
      seen.add(header.id);
      out.push(header.id);
      next.push(header.id);
    }
    frontier = next;
  }
  return out;
}

/**
 * 挂载插件。
 *
 * @param ctx - cordis 上下文。
 * @param config - profile 里这一行的 config。
 */
export function apply(ctx, config) {
  const settings = config !== null && typeof config === 'object' ? config : {};
  const home = resolveHome(settings);
  const prefix = typeof settings.bridgePrefix === 'string' && settings.bridgePrefix.trim().length > 0
    ? settings.bridgePrefix.trim().replace(/\/+$/, '')
    : DEFAULT_PREFIX;
  const journalsDir = typeof settings.journalsDir === 'string' && settings.journalsDir.trim().length > 0
    ? settings.journalsDir.trim()
    : join(home, 'session-move');
  // 默认会自动释放「打开中但空闲」的会话，好让它能被搬走。releaseLive=false 恢复旧行为。
  const releaseLive = settings.releaseLive !== false;
  // 「就地接管」：打开中且**还在跑活**的会话也能搬 —— 换掉 live 写句柄的 header，
  // 在持有写链的情况下搬文件，正在跑的 turn 不中断。默认开；关掉就退回「正在跑活的拒绝」。
  const moveLive = settings.moveLive !== false;
  // 侧边栏拖动搬移（客户端读引导全局里的 drag 开关）。DSH 改了 DOM 约定时可以一键关掉。
  const dragMove = settings.dragMove !== false;
  /** 每次就地接管的窗口，供自测断言「搬迁期间没有写入插进来」。 */
  const handoffLog = [];
  const releaseRetries = Number.isSafeInteger(settings.releaseRetries) && settings.releaseRetries >= 0
    ? settings.releaseRetries
    : 24;
  const releaseRetryDelayMs = Number.isFinite(settings.releaseRetryDelayMs) && settings.releaseRetryDelayMs > 0
    ? settings.releaseRetryDelayMs
    : 150;
  // 自测接口默认关闭；打开后会多出 __selftest/* 路由（用来造一个 live 会话做验证）。
  const selftest = settings.selftest === true;
  const selftestLeases = new Map();
  /** 自测用的「写入压力」循环状态。 */
  const selftestPressure = { timer: null, sessionId: null, marks: [] };

  // ---- 请求来源校验 -------------------------------------------------------
  //
  // 这些路由直接挂在 DSH 的 node:http 上，**不经过任何 API 网关**：没有 cookie、
  // 没有 token，浏览器只要能把 POST 发到 127.0.0.1:<port> 就能触发文件搬移。
  // 因此必须自己挡住两类浏览器攻击：
  //   1. CSRF：任意网页用「简单请求」（text/plain）打本地端口 → 强制 JSON
  //      Content-Type（跨源 JSON 必预检，而本服务不答 CORS 预检）+ Sec-Fetch-Site；
  //   2. DNS rebinding：攻击者域名解析到 127.0.0.1，页面同源 → Host 校验。
  // 回环主机名默认允许；绑定到具体网卡时 `webServer.host` 也允许。反向代理/自定义
  // 域名用 allowedHosts，开发服务器（Vite 代理）用 allowedOrigins 显式放开。
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
   * 校验一次请求的来源。任何一项不过就抛 403，绝不进入业务处理。
   *
   * @param req - node:http 请求。
   * @param server - webServer 服务（可能还没 listen）。
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
        // 同源 = Host 与 Origin 的主机、端口都一致；不一致就拒绝（开发代理请配 allowedOrigins）。
        if (parsed.hostname !== authority.hostname || parsed.port !== authority.port) {
          throw new HttpError(403, 'forbidden', '拒绝跨源请求：' + parsed.origin);
        }
      }
    }
  }

  /** 等一小会儿（释放租约是异步的，靠重试确认）。 */
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * 找到某个会话的 live 写句柄。
   *
   * 它在后端的 **tracker** 上（JsonlBackendTracker.writers），不在持久化服务本身；
   * 顺手也认直接挂在服务上的写法，免得换个 rc 版本就静默失效。
   * writers 里可能是 null（已创建但未物化的占位），那也当成「没有句柄」。
   */
  function findWriteHandle(sessionId) {
    const persistence = ctx.sessionPersistence;
    const maps = [
      persistence.writers,
      persistence.tracker !== undefined ? persistence.tracker.writers : undefined,
    ];
    for (const map of maps) {
      if (map === undefined || map === null || typeof map.get !== 'function') continue;
      const handle = map.get(sessionId);
      if (handle !== undefined && handle !== null && typeof handle.enqueueChain === 'function') return handle;
    }
    return undefined;
  }

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

  /** 会话存储根目录。后端把 root 作为私有字段持有，取不到就按 home 惯例回退。 */
  function sessionsRoot() {
    if (typeof settings.sessionsRoot === 'string' && settings.sessionsRoot.trim().length > 0) {
      return settings.sessionsRoot.trim();
    }
    const root = ctx.sessionPersistence.root;
    if (typeof root === 'string' && root.length > 0) return root;
    return join(home, 'sessions');
  }

  /**
   * 一个会话在某个 cwd 下的目录。优先问后端自己（locate 返回的是当前 generation
   * 的路径，取父目录即会话目录），这样 projectKey 的细节永远与后端保持一致。
   */
  function sessionDirFor(sessionId, cwd) {
    const persistence = ctx.sessionPersistence;
    if (typeof persistence.locate === 'function') {
      try {
        const located = persistence.locate({ id: sessionId, cwd });
        if (located !== undefined && typeof located.path === 'string' && located.path.length > 0) {
          return dirname(located.path);
        }
      } catch {
        // 落到回退实现
      }
    }
    return sessionDir(sessionsRoot(), cwd, sessionId);
  }

  const store = createMoveStore({
    sessionsRoot: sessionsRoot(),
    journalsDir,
    sessionDirFor,
    log,
    // 校验强度：auto（小日志全文解码，大日志帧级抽样）或 full（永远全文解码）。
    verify: settings.verify === 'full' ? 'full' : 'auto',
    fullVerifyLimit: Number.isSafeInteger(settings.fullVerifyLimit) && settings.fullVerifyLimit > 0
      ? settings.fullVerifyLimit
      : undefined,
  });

  /** 组装一次迁移需要的 DSH 运行时能力。 */
  function buildHost() {
    const registry = ctx.workspaceRegistry;
    /**
     * 取一个尽量真实的 header 基底（注册表的 header 索引随后会被覆盖 cwd）。
     * 优先 live 会话（内存里的旧 header），其次注册表缓存，最后问持久层；
     * 都取不到才合成一个最小 header。
     */
    async function headerBaseFor(sessionId) {
      const liveSession = ctx.get('sessions')?.get(sessionId);
      if (liveSession !== undefined && liveSession.header !== undefined) return liveSession.header;
      if (registry.headers instanceof Map) {
        const existing = registry.headers.get(sessionId);
        if (existing !== undefined) return existing;
      }
      try {
        const snapshot = await ctx.sessionPersistence.stat(sessionId);
        if (snapshot !== undefined && snapshot !== null && snapshot.header !== undefined) return snapshot.header;
      } catch {
        // 读不到就落到合成 header
      }
      return { version: 4, id: sessionId, createdAt: Date.now(), isSeeded: false };
    }
    return {
      async statSession(sessionId) {
        return await ctx.sessionPersistence.stat(sessionId);
      },
      /**
       * 全部会话快照（含隐藏的子代理会话）—— 用来找 `parentSession` 后代。
       * 后端不支持或读失败时返回空数组：父会话照常搬，只是不带子。
       */
      async listSessions() {
        const persistence = ctx.sessionPersistence;
        if (persistence === undefined || persistence === null || typeof persistence.list !== 'function') return [];
        try {
          const snapshots = await persistence.list();
          return Array.isArray(snapshots) ? snapshots : [];
        } catch (error) {
          log('warn', '列会话失败，按没有子对话继续：' + String(error && error.message));
          return [];
        }
      },
      getWorkspace(workspaceId) {
        return registry.get(workspaceId);
      },
      async createWorkspace(path) {
        // 注册表内部会先 realpath 目标路径，所以「目录不存在会被创建」这条承诺
        // 必须由我们先把目录建出来，否则 realpath 会直接 ENOENT。
        await mkdir(path, { recursive: true });
        const entity = await registry.create(path);
        // 符号链接可能让「词法上在根外」的路径 realpath 到会话存储根里；注册后再按
        // 规范路径复核一次，命中就撤销这条注册（目录本身不动）。
        if (isPathWithin(store.sessionsRoot, entity.path) || isPathWithin(store.journalsDir, entity.path)) {
          try {
            await registry.delete(entity.id);
          } catch (error) {
            log('warn', '撤销非法目标工作区注册失败：' + String(error && error.message));
          }
          throw new MoveError('target-inside-sessions', '目标目录解析后位于会话存储根目录内，拒绝迁移：' + entity.path);
        }
        return entity;
      },
      findWorkspaceByPath(canonicalPath) {
        for (const entity of registry.list()) {
          if (samePath(entity.path, canonicalPath)) return entity;
        }
        return undefined;
      },
      isSessionLive(sessionId) {
        const sessions = ctx.get('sessions');
        if (sessions === undefined || typeof sessions.get !== 'function') return false;
        try {
          return sessions.get(sessionId) !== undefined;
        } catch {
          return false;
        }
      },
      async listActivity(sessionId) {
        if (typeof ctx.waterfall !== 'function') return [];
        try {
          const activity = await ctx.waterfall(
            'workspace/session-activity',
            { sessionId },
            () => Promise.resolve([]),
          );
          return Array.isArray(activity) ? activity : [];
        } catch (error) {
          log('warn', '查询会话活动失败，按「无活动」继续：' + String(error && error.message));
          return [];
        }
      },
      describeActivity(activity) {
        return activity.map((entry) => (entry !== null && typeof entry === 'object' ? entry.kind : '?')).join('、');
      },
      /**
       * 释放一个「活着」的会话：flush → 摘掉 entered 记录 → 用写打开探针确认写租约真的没了。
       *
       * 为什么需要它：会话日志是**单写者**的，写所有权由 agent-loop 的写句柄持有
       * （它调 persistence.open(id,'write')），只在 DSH 进程退出时才释放。不释放就搬文件，
       * 那个句柄会继续往旧路径写、并在旧位置重建一个空壳目录。
       *
       * 摘除走的是 SessionStore 的私有缝 sessions.store.get(id).detach() —— 同一版本里
       * dsh-delete-session 也在生产里用它。它会派发 session/disposed，持久层据此
       * close 写句柄、释放 session.lock 租约；释放是异步的（fire-and-forget），
       * 所以这里用「写打开探针 + 重试」来确认。
       */
      /**
       * 就地接管一个正在运行的会话：**不释放它**，而是换掉它的 live 写句柄的 header，
       * 并在持有该句柄写链的情况下跑文件事务 —— 这样搬迁期间任何写入都排在我们后面，
       * 落地时已经指向新路径，正在跑的 turn 不会断。
       *
       * 依据（都在源码里核过）：
       *  - JsonlSessionHandle 的写入路径是每次从 this.header 现算的：
       *    persistContiguous → storage.persistBatch(header) → logPath(root, header.cwd, …)；
       *  - this.header 是**可写槽位**（deepFreeze 冻的是那个对象，不是这个属性）；
       *  - 内核写锁 this.lease 懒获取（ensureLease 用 ??=）：先释放再置空，
       *    下一次写入就会在新路径重新获取；
       *  - enqueueChain 是该句柄唯一的串行点，append/flush/drain 都走它；
       *  - drainLive 自己会往 chain 上排队，所以必须在进入临界区**之前**调用，否则死锁。
       */
      /** 现在能不能就地接管：有 live 写句柄才算能（没句柄就走释放路径）。 */
      canHandoff(sessionId) {
        return findWriteHandle(sessionId) !== undefined;
      },
      async handoffLive(sessionId, targetCwd, runTransaction) {
        const handle = findWriteHandle(sessionId);
        if (handle === undefined) {
          // 探测不到写句柄就**绝不静默搬** —— 那会留下「文件已搬、句柄还指着旧路径」
          // 的坏状态（下一次写入就把旧目录重建出来）。整体放弃，让调用方改走释放路径。
          return { ok: false, code: 'no-writer', detail: '找不到这个会话的 live 写句柄' };
        }
        if (typeof handle.drainLive === 'function') await handle.drainLive();
        if (typeof handle.flush === 'function') await handle.flush();

        const start = Date.now();
        let detail = '';
        const transaction = await handle.enqueueChain(async () => {
          if (typeof handle.ensureLease === 'function') await handle.ensureLease();
          const originalHeader = handle.header;
          let retargeted = false;
          try {
            if (handle.lease !== undefined && handle.lease !== null && typeof handle.lease.release === 'function') {
              await handle.lease.release();
            }
            handle.lease = null;
            // header 的切换由事务在 rename 之前回调 —— 不能提前切：staging 复制大日志
            // 期间 header 若已指向新 cwd，DSH 的 stat/list 会看到「cwd 与路径不一致」
            // 并把会话判成 corrupt log。
            const result = await runTransaction(async () => {
              handle.header = { ...originalHeader, cwd: targetCwd };
              retargeted = true;
            });
            detail = retargeted
              ? '写链已接管：header.cwd -> ' + targetCwd
              : '写链已接管（文件事务未走到 rename）';
            result.writerRetargeted = retargeted;
            return result;
          } catch (error) {
            // 回滚：恢复 header 与锁状态，让后续写入继续落在原路径。
            handle.header = originalHeader;
            handle.lease = null;
            throw error;
          }
        });
        const end = Date.now();
        handoffLog.push({ sessionId, start, end });
        return { ok: true, detail, transaction, window: { start, end } };
      },
      /**
       * 就地接管后的归属写入：**绕开 attachSession 的 cwd 校验**，直接走注册表自己的
       * 写路径（entity.mutate → table.update），并同步它的路径/header 索引。
       *
       * 为什么要绕：注册表校验归属时会 readSessionHeader(id)，而它优先取内存里的
       * live Session —— 那个 header 是 deep-frozen 的旧 cwd，改不了，所以校验必然失败。
       *
       * 顺序很关键：entity.mutate 内部会用 host.sessionPath(id) 过滤 sessionIds，
       * 所以必须**先**把 sessionPaths 指到新 cwd，否则刚加进去的 id 会被它自己滤掉。
       */
      async adoptSession(sessionId, targetEntity, sourceEntity, targetCwd) {
        const registry = ctx.workspaceRegistry;
        try {
          const base = await headerBaseFor(sessionId);
          if (registry.sessionPaths instanceof Map) registry.sessionPaths.set(sessionId, targetCwd);
          if (registry.invalidSessionPaths instanceof Map) registry.invalidSessionPaths.delete(sessionId);
          // candidateMatches 对 missingSessionPaths 里的 id 是「无条件匹配」；不摘掉它，
          // 源工作区的 detach 会把它当成仍然有效而留下冗余归属。
          if (registry.missingSessionPaths instanceof Set) registry.missingSessionPaths.delete(sessionId);
          if (registry.headers instanceof Map) registry.headers.set(sessionId, { ...base, cwd: targetCwd });
          if (typeof targetEntity.mutate !== 'function') {
            return { applied: false, refreshed: false, reason: '目标工作区实体没有 mutate 接口（DSH 版本变了）' };
          }
          await targetEntity.mutate((record) => (record.sessionIds.includes(sessionId)
            ? record
            : { ...record, sessionIds: [sessionId, ...record.sessionIds] }));
          if (sourceEntity !== undefined && sourceEntity.id !== targetEntity.id && typeof sourceEntity.mutate === 'function') {
            await sourceEntity.mutate((record) => (record.sessionIds.includes(sessionId)
              ? { ...record, sessionIds: record.sessionIds.filter((entry) => entry !== sessionId) }
              : record));
          }
          return { applied: true, refreshed: false };
        } catch (error) {
          return { applied: false, refreshed: false, reason: '直接写注册表归属失败：' + String(error && error.message) };
        }
      },
      /**
       * 批量归属写入（commitMoves 用）：先把这批会话的 header 缓存/路径索引一次性指到
       * 目标 cwd，再**一次 mutate** 把整批加进目标工作区 —— 注册表只落盘一次。
       * 和 adoptSession 同一条旁路，区别只是按批做。
       */
      async adoptSessions(sessionIds, targetEntity, targetCwd) {
        const registry = ctx.workspaceRegistry;
        try {
          if (typeof targetEntity.mutate !== 'function') {
            return { applied: false, refreshed: false, reason: '目标工作区实体没有 mutate 接口（DSH 版本变了）' };
          }
          for (const sessionId of sessionIds) {
            const base = await headerBaseFor(sessionId);
            if (registry.sessionPaths instanceof Map) registry.sessionPaths.set(sessionId, targetCwd);
            if (registry.invalidSessionPaths instanceof Map) registry.invalidSessionPaths.delete(sessionId);
            if (registry.missingSessionPaths instanceof Set) registry.missingSessionPaths.delete(sessionId);
            if (registry.headers instanceof Map) registry.headers.set(sessionId, { ...base, cwd: targetCwd });
          }
          await targetEntity.mutate((record) => {
            const add = sessionIds.filter((id) => !record.sessionIds.includes(id));
            return add.length === 0 ? record : { ...record, sessionIds: [...add, ...record.sessionIds] };
          });
          return { applied: true, refreshed: false };
        } catch (error) {
          return { applied: false, refreshed: false, reason: '批量写目标归属失败：' + String(error && error.message) };
        }
      },
      /** 批量摘除（commitMoves 用）：一次 mutate 把整批从源工作区拿掉。 */
      async detachSessions(sessionIds, sourceEntity) {
        if (sourceEntity === undefined || sourceEntity === null || typeof sourceEntity.mutate !== 'function') {
          return { applied: true };
        }
        try {
          const drop = new Set(sessionIds);
          await sourceEntity.mutate((record) => {
            const keep = record.sessionIds.filter((id) => !drop.has(id));
            return keep.length === record.sessionIds.length ? record : { ...record, sessionIds: keep };
          });
          return { applied: true };
        } catch (error) {
          return { applied: false, reason: '批量摘除源归属失败：' + String(error && error.message) };
        }
      },
      async releaseSession(sessionId) {
        const sessions = ctx.get('sessions');
        if (sessions === undefined || typeof sessions.get !== 'function') {
          return { released: true, attempts: 0, detail: '没有 sessions 服务，视为无需释放' };
        }
        const live = sessions.get(sessionId);
        if (live === undefined) return { released: true, attempts: 0, detail: '本来就不在内存里' };

        if (typeof sessions.flush === 'function') {
          try {
            await sessions.flush(live);
          } catch (error) {
            log('warn', '释放前 flush 失败（继续释放）：' + String(error && error.message));
          }
        }

        const entries = sessions.store;
        const entered = entries !== undefined && typeof entries.get === 'function' ? entries.get(sessionId) : undefined;
        if (entered === undefined || typeof entered.detach !== 'function') {
          return { released: false, attempts: 0, detail: '拿不到可释放的 entered 记录（DSH 版本可能变了）' };
        }
        entered.detach();

        const persistence = ctx.sessionPersistence;
        if (typeof persistence.open !== 'function') return { released: true, attempts: 0, detail: '已从内存摘除（没有 open 可探测）' };
        // 前几次探得很快（正常情况 detach 完立刻就能拿到租约），之后退回常规间隔。
        // 这样"正常情况"几乎零等待，"被 GUI 抢着"时也仍然能等到，且总时长不变。
        const quickDelays = [0, 10, 25, 50, 100];
        let last = 'unknown';
        for (let attempt = 0; attempt <= releaseRetries; attempt++) {
          let handle;
          try {
            handle = await persistence.open(sessionId, 'write');
          } catch (error) {
            last = String(error && error.message !== undefined ? error.message : error);
            if (attempt === releaseRetries) break;
            const delay = attempt < quickDelays.length ? quickDelays[attempt] : releaseRetryDelayMs;
            if (delay > 0) await sleep(delay);
            continue;
          }
          try {
            await handle.close();
          } catch (error) {
            log('warn', '探针句柄关闭失败（不影响结论）：' + String(error && error.message));
          }
          return { released: true, attempts: attempt + 1, detail: '写租约已释放（第 ' + String(attempt + 1) + ' 次探测拿到写所有权）' };
        }
        return { released: false, attempts: releaseRetries + 1, detail: '写所有权仍被占用（试了 ' + String(releaseRetries + 1) + ' 次）：' + last };
      },
      /**
       * 重建注册表的 header 缓存。
       *
       * 这是**必需**的一步：注册表的 header 索引是启动时建的，磁盘上的 cwd 被我们改
       * 了以后它并不知道，不刷新的话 attachSession 会拿旧 cwd 去比目标路径然后拒掉。
       * 这两个成员是包私有实现，所以此处 feature-detect；取不到就返回 false，
       * 迁移会在下次启动时自动补齐归属。
       */
      async refreshHeaderIndex() {
        const listStored = registry.listStoredHeaders;
        const replace = registry.replaceHeaderIndex;
        if (typeof listStored !== 'function' || typeof replace !== 'function') return false;
        const rebuild = async () => {
          await replace.call(registry, await listStored.call(registry));
        };
        if (typeof registry.enqueueOperation === 'function') await registry.enqueueOperation(rebuild);
        else await rebuild();
        return true;
      },
      async invalidateProjection(sessionId) {
        // 投影缓存的后端（dsh-storage-json）只接受 [A-Za-z0-9_-]+ 的键；DSH 的
        // SessionId 本身是未校验字符串，所以这里必须自己挡路径穿越：否则一个
        // 形如 ../../../x 的 id 会让 rm 删掉会话存储目录之外的 .json 文件。
        if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(sessionId)) {
          log('warn', '跳过投影缓存清理：session id 不是 path-safe 键');
          return;
        }
        const dir = join(home, 'storages', 'session_projcache', 'sessions');
        const file = join(dir, sessionId + '.json');
        if (!isPathWithin(dir, file)) return;
        await rm(file, { force: true }).catch((error) => {
          log('warn', '清理投影缓存失败（不影响迁移）：' + String(error && error.message));
        });
      },
      log,
    };
  }

  // ---- 未完成迁移的恢复 ----------------------------------------------------

  let recovery = null;

  /**
   * 单飞地补完未完成的迁移。启动时调用一次；`/status` 也会再兜一次。
   *
   * 注意：**不要**在 `/move` 开头调用它。deferRegistry 留下的日志是等 `/move-commit`
   * 结算的，提前恢复会把它们逐条提交掉，随后 commit 找不到日志而把已搬的条目误报为失败。
   */
  function kickRecovery() {
    if (recovery !== null) return recovery;
    recovery = (async () => {
      try {
        const results = await recoverPendingMoves(buildHost(), store);
        for (const result of results) {
          log(result.status === 'failed' || result.status === 'lost' ? 'warn' : 'info',
            '恢复未完成的迁移 ' + result.opId + '：' + result.status
            + (result.message !== undefined ? '（' + result.message + '）' : '')
            + (result.to !== undefined ? ' -> ' + result.to : ''));
        }
        return results;
      } catch (error) {
        log('warn', '恢复未完成的迁移失败：' + String(error && error.message));
        return [];
      } finally {
        recovery = null;
      }
    })();
    return recovery;
  }

  // 启动后跑一次（不阻塞启动）。
  setTimeout(() => { void kickRecovery(); }, 0);

  // ---- HTTP 桥接 ----------------------------------------------------------

  /** 描述当前状态：可选带一个 sessionId，用来告诉界面「能不能搬、为什么不能」。 */
  async function describe(body) {
    const registry = ctx.workspaceRegistry;
    const entities = registry.list();
    const workspaces = entities.map((entity) => ({ id: entity.id, title: entity.title, path: entity.path }));
    const payload = {
      ok: true,
      version: PLUGIN_VERSION,
      prefix,
      home,
      releaseLive,
      workspaces,
      session: null,
    };
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    if (sessionId.length > MAX_SESSION_ID_LENGTH) throw new HttpError(400, 'bad-request', 'sessionId 过长');
    if (sessionId.length === 0) return payload;

    const host = buildHost();
    let snapshot;
    try {
      snapshot = await ctx.sessionPersistence.stat(sessionId);
    } catch (error) {
      payload.session = { id: sessionId, unreadable: true, message: String(error && error.message) };
      return payload;
    }
    if (snapshot === undefined) {
      payload.session = { id: sessionId, missing: true };
      return payload;
    }
    const cwd = snapshot.header.cwd;
    let canonical;
    if (typeof cwd === 'string' && cwd.length > 0) {
      try {
        canonical = await realpath(cwd);
      } catch {
        canonical = undefined;
      }
    }
    // 「当前工作区」只认注册表归属；cwd 相同但没归属的孤儿，必须留在目标列表里（补归属入口）。
    const member = entities.find((entity) => Array.isArray(entity.sessionIds) && entity.sessionIds.indexOf(sessionId) >= 0);
    const cwdMatch = canonical === undefined ? undefined : entities.find((entity) => samePath(entity.path, canonical));
    const memberId = member === undefined ? null : member.id;
    const cwdMatchId = cwdMatch === undefined ? null : cwdMatch.id;
    const currentId = memberId;
    const activity = await host.listActivity(sessionId);
    const live = host.isSessionLive(sessionId);
    // 就地接管可用时，连「正在跑活」都能搬（换掉 live 写句柄的 header，turn 不断）。
    // 必须同时能真的找到写句柄：只有 live 会话、没有写句柄时会退回「先释放再搬」。
    const handoffAvailable = live
      && moveLive
      && typeof host.canHandoff === 'function'
      && host.canHandoff(sessionId) === true;
    const reason = canonical === undefined
      ? '这个对话记录的目录已不存在，无法安全迁移'
      : (activity.length > 0 && !handoffAvailable
        ? '这个对话还有正在运行的工作，请先停止'
        : (live && !handoffAvailable && !releaseLive
          ? '这个对话正打开着，而 releaseLive=false 禁止自动释放它；请重启 DSH 后再移动'
          : null));
    payload.session = {
      id: sessionId,
      cwd: cwd ?? null,
      canonicalCwd: canonical ?? null,
      currentWorkspaceId: currentId,
      memberOfWorkspaceId: memberId,
      cwdMatchesWorkspaceId: cwdMatchId,
      currentWorkspaceBy: member !== undefined ? 'membership' : null,
      live,
      willHandoff: handoffAvailable && reason === null,
      willRelease: live && !handoffAvailable && reason === null,
      activity,
      activityText: host.describeActivity(activity),
      canMove: reason === null,
      reason,
    };
    payload.workspaces = workspaces.map((workspace) => ({
      ...workspace,
      current: workspace.id === currentId,
      member: workspace.id === memberId,
      cwdMatches: workspace.id === cwdMatchId,
    }));
    return payload;
  }

  /** 执行一次迁移。 */
  async function move(body) {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    if (sessionId.length === 0) return { ok: false, code: 'bad-request', message: '缺少 sessionId' };
    if (sessionId.length > MAX_SESSION_ID_LENGTH) return { ok: false, code: 'bad-request', message: 'sessionId 过长' };
    const targetWorkspaceId = typeof body.targetWorkspaceId === 'string' ? body.targetWorkspaceId.trim() : '';
    if (targetWorkspaceId.length > MAX_SESSION_ID_LENGTH) {
      return { ok: false, code: 'bad-request', message: 'targetWorkspaceId 过长' };
    }
    const targetPath = typeof body.targetPath === 'string' ? body.targetPath.trim() : '';
    // 先把上次没做完的迁移推完，避免它与这次搬移交叉改注册表/文件。
    if (targetPath.length > 0) {
      try {
        store.validateTargetPath(targetPath);
      } catch (error) {
        return failure(error);
      }
    }
    try {
      const host = buildHost();
      const receipt = await relocateSession(host, store, {
        sessionId,
        targetWorkspaceId,
        targetPath,
        releaseLive,
        moveLive,
        // 批量搬移时客户端逐条 defer：文件事务各自做完，注册表最后一次性写。
        deferRegistry: body.deferRegistry === true,
      });
      // 「连同子对话」默认开；客户端在用户关掉开关时会显式传 false。
      // 子会话走**完整**事务（文件 + 归属），每条失败按条隔离，不拖累父回执。
      let children;
      if (body.includeChildren !== false) {
        const snapshots = await host.listSessions();
        const childIds = descendantIdsOf(snapshots, sessionId);
        if (childIds.length > 0) children = await moveChildren(host, childIds, body);
      }
      return children === undefined ? { ok: true, ...receipt } : { ok: true, ...receipt, children };
    } catch (error) {
      log('warn', '迁移失败：' + String(error && error.message));
      return failure(error);
    }
  }

  /**
   * 把父会话的全部后代（子代理会话）搬到同一个目标。
   * 每个子会话走完整事务（文件 + 归属）；失败按条隔离，父会话的成功回执不受影响。
   */
  async function moveChildren(host, ids, body) {
    const results = [];
    let moved = 0;
    let failed = 0;
    let skipped = 0;
    for (const id of ids) {
      try {
        await relocateSession(host, store, {
          sessionId: id,
          targetWorkspaceId: body.targetWorkspaceId,
          targetPath: body.targetPath,
          releaseLive,
          moveLive,
          // 子会话不参与两段式：条数少，直接落归属，避免 commit 回执里混进子 id。
          deferRegistry: false,
        });
        moved += 1;
        results.push({ sessionId: id, status: 'moved' });
      } catch (error) {
        if (error !== null && typeof error === 'object' && error.code === 'already-there') {
          skipped += 1;
          results.push({ sessionId: id, status: 'skipped', message: String(error.message) });
        } else {
          failed += 1;
          results.push({
            sessionId: id,
            status: 'failed',
            code: error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : 'failed',
            message: String(error !== null && typeof error === 'object' && typeof error.message === 'string'
              ? error.message
              : error),
          });
        }
      }
    }
    return { total: ids.length, moved, failed, skipped, results };
  }

  /** 批量收尾：把一串 defer 过的迁移的归属一次性写进注册表。 */
  async function moveCommit(body) {
    const raw = Array.isArray(body.sessionIds) ? body.sessionIds : [];
    if (raw.length > MAX_BATCH_SESSIONS) {
      return { ok: false, code: 'bad-request', message: '一次最多结算 ' + String(MAX_BATCH_SESSIONS) + ' 条会话' };
    }
    const ids = [];
    const seen = new Set();
    for (const entry of raw) {
      if (typeof entry !== 'string') continue;
      const id = entry.trim();
      if (id.length === 0 || id.length > MAX_SESSION_ID_LENGTH || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    if (ids.length === 0) return { ok: false, code: 'bad-request', message: '缺少 sessionIds' };
    try {
      const result = await commitMoves(buildHost(), store, ids);
      return { ok: result.ok !== false, ...result };
    } catch (error) {
      log('warn', '批量结算失败：' + String(error && error.message));
      return failure(error);
    }
  }

  // ---- 只读会话数据（「编辑上一次提问」用）----------------------------------
  //
  // 这两个接口不参与搬迁，也不会改任何东西：前者给会话列表（备用入口），
  // 后者给出某会话最后一条用户亲手发的提问 + 它的 fork 边界。

  /** 取一个 1..MAX_SESSIONS 的整数。 */
  function readLimit(body, fallback) {
    const value = body !== null && typeof body === 'object' ? body.limit : undefined;
    if (!Number.isSafeInteger(value) || value <= 0) return fallback;
    return Math.min(value, MAX_SESSIONS);
  }

  /** 读会话目录（只读 header，不打开正文）。 */
  async function listSessions(body) {
    const limit = readLimit(body, 40);
    const withTitles = body !== null && typeof body === 'object' && body.withTitles === true;
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
          if (result === undefined || result === null || result.status === 'rejected') continue;
          const value = result.value;
          const title = value !== null && typeof value === 'object' ? value.title : undefined;
          if (typeof title === 'string' && title.length > 0) page[index].title = title;
        }
      } catch (error) {
        log('warn', '读标题失败，只回 header：' + String(error && error.message));
      }
    }
    return { ok: true, total: rows.length, sessions: page };
  }

  /** 读某个会话的「上一次提问」（叙事上的最后一条用户亲手发的消息）。 */
  async function lastPrompt(body) {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    if (sessionId.length === 0) return { ok: false, code: 'bad-request', message: '需要 sessionId' };
    if (sessionId.length > MAX_SESSION_ID_LENGTH) return { ok: false, code: 'bad-request', message: 'sessionId 过长' };
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

  // ---- 删除会话（危险操作）--------------------------------------------------
  //
  // 删除 = 释放 live 写者 → 把会话目录原子挪进 `<sessionsRoot>/_session-delete-trash/<opId>/`
  //      → 摘掉工作区归属 → 失效投影缓存 → 删掉暂存目录。
  // 暂存目录比 DSH 认的会话目录深一层，扫描器看不到；中途失败会把已挪走的目录挪回原位。

  /** 读请求里的会话 id 列表（兼容单个 sessionId 与批量 sessionIds）。 */
  function readDeleteIds(body) {
    const out = [];
    const push = (value) => {
      if (typeof value !== 'string') return;
      const id = value.trim();
      if (id.length === 0 || id.length > MAX_SESSION_ID_LENGTH) return;
      if (out.indexOf(id) < 0) out.push(id);
    };
    if (body !== null && typeof body === 'object' && Array.isArray(body.sessionIds)) {
      for (const value of body.sessionIds.slice(0, MAX_BATCH_SESSIONS)) push(value);
      return out;
    }
    push(body !== null && typeof body === 'object' ? body.sessionId : undefined);
    return out;
  }

  /** 找出这个会话在存储根下的所有目录（正常情况下只有一个）。 */
  async function sessionDirsOf(sessionId) {
    const root = store.sessionsRoot;
    const encoded = encodeSegment(sessionId);
    const dirs = [];
    let projects = [];
    try {
      projects = await readdir(root, { withFileTypes: true });
    } catch (error) {
      return dirs;
    }
    for (const project of projects) {
      if (!project.isDirectory()) continue;
      if (project.name === '_session-move-staging' || project.name === '_session-delete-trash') continue;
      const dir = join(root, project.name, encoded);
      if (existsSync(dir)) dirs.push(dir);
    }
    return dirs;
  }

  /** 删除一批会话；逐条隔离，返回每一条的结果。 */
  async function deleteSessions(body) {
    const ids = readDeleteIds(body);
    if (ids.length === 0) return { ok: false, code: 'bad-request', message: '需要 sessionId 或 sessionIds' };
    const includeChildren = body === null || typeof body !== 'object' || body.includeChildren !== false;
    const host = buildHost();
    const results = [];
    for (const sessionId of ids) {
      try {
        results.push({ sessionId, status: 'deleted', removed: await deleteOne(host, sessionId, includeChildren) });
      } catch (error) {
        results.push({ sessionId, status: 'failed', message: String(error && error.message ? error.message : error) });
      }
    }
    const deleted = results.filter((row) => row.status === 'deleted').length;
    log('info', '删除会话：成功 ' + String(deleted) + '，失败 ' + String(results.length - deleted));
    return { ok: true, deleted, failed: results.length - deleted, results };
  }

  /** 删一个会话（父会话 + 可选的子代理会话）：要么全删，要么一个都不动。 */
  async function deleteOne(host, sessionId, includeChildren) {
    // 先确认会话真的存在（目录或持久层登记），否则报 not-found 而不是静默成功。
    const parentDirs = await sessionDirsOf(sessionId);
    if (parentDirs.length === 0) {
      let known = false;
      try {
        known = (await host.statSession(sessionId)) !== undefined && (await host.statSession(sessionId)) !== null;
      } catch (error) {
        known = false;
      }
      if (!known) throw new MoveError('session-not-found', '找不到会话 ' + sessionId);
    }
    const targets = [sessionId];
    if (includeChildren) {
      try {
        const snapshots = await host.listSessions();
        for (const childId of descendantIdsOf(snapshots, sessionId)) {
          if (targets.indexOf(childId) < 0) targets.push(childId);
        }
      } catch (error) {
        log('warn', '列子会话失败，只删父会话：' + String(error && error.message));
      }
    }

    const trash = join(store.sessionsRoot, '_session-delete-trash', newOpId());
    const moved = [];
    try {
      await mkdir(trash, { recursive: true });
      for (const id of targets) {
        const release = await host.releaseSession(id).catch((error) => ({ released: false, detail: String(error && error.message) }));
        if (release !== null && release !== undefined && release.released === false) {
          throw new MoveError('session-live', '这个会话正在运行，先停止它再删除：' + String(release.detail || ''));
        }
        const dirs = await sessionDirsOf(id);
        for (const dir of dirs) {
          const dest = join(trash, encodeSegment(basename(dirname(dir))) + '__' + basename(dir));
          await rename(dir, dest);
          moved.push({ from: dir, to: dest, sessionId: id });
        }
      }
      for (const id of targets) {
        for (const entity of ctx.workspaceRegistry.list()) {
          if (Array.isArray(entity.sessionIds) && entity.sessionIds.includes(id)) {
            await entity.detachSession(id).catch(() => {});
          }
        }
        await host.invalidateProjection(id).catch(() => {});
      }
      await rm(trash, { recursive: true, force: true });
      return moved.map((entry) => entry.from);
    } catch (error) {
      for (let index = moved.length - 1; index >= 0; index -= 1) {
        await rename(moved[index].to, moved[index].from).catch(() => {});
      }
      await rm(trash, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  /** 报告还有哪些迁移没收尾。 */
  async function status() {
    await kickRecovery();
    const journals = await store.readJournals();
    return {
      ok: true,
      version: PLUGIN_VERSION,
      prefix,
      home,
      releaseLive,
      moveLive,
      dragMove,
      selftest,
      capabilities: { move: true, delete: true, lastPrompt: true, sessions: true, fork: 'client' },
      // 批量搬移的两段式（defer 文件事务 + 一次 commit 写注册表）由客户端按这个能力位决定是否启用。
      bulkDefer: true,
      verify: settings.verify === 'full' ? 'full' : 'auto',
      sessionsRoot: store.sessionsRoot,
      journalsDir: store.journalsDir,
      pending: journals.map((journal) => ({
        opId: journal.opId,
        sessionId: journal.sessionId,
        from: journal.fromCwd,
        to: journal.toCwd,
        phase: journal.phase,
        startedAt: journal.startedAt,
      })),
    };
  }

  // ---- 自测辅助（默认关闭，config.selftest=true 才挂路由）------------------------
  // 用来在**真实进程**里造一个「已打开（live）且持有写租约」的会话，验证「释放后再搬」，
  // 而不必碰任何真实对话。

  /** 造一个 live 会话；lease=true 时同时持有写租约（等价于被 DSH 打开）。 */
  async function selftestCreateLive(body) {
    const sessions = ctx.get('sessions');
    if (sessions === undefined || typeof sessions.create !== 'function') {
      return { ok: false, code: 'no-sessions', message: '这个组合没有 sessions 服务' };
    }
    if (typeof body.sessionId === 'string' && body.sessionId.length > MAX_SESSION_ID_LENGTH) {
      return { ok: false, code: 'bad-request', message: 'sessionId 过长' };
    }
    const workspacePath = typeof body.workspacePath === 'string' && body.workspacePath.trim().length > 0
      ? store.validateTargetPath(body.workspacePath)
      : join(home, 'session-move-selftest');
    await mkdir(workspacePath, { recursive: true });
    const workspace = await ctx.workspaceRegistry.create(workspacePath);
    // 与 createWorkspace 同一条复核：符号链接可能把它 realpath 到会话存储根里。
    if (isPathWithin(store.sessionsRoot, workspace.path) || isPathWithin(store.journalsDir, workspace.path)) {
      try {
        await ctx.workspaceRegistry.delete(workspace.id);
      } catch { /* 撤不掉也不影响拒绝 */ }
      return { ok: false, code: 'target-inside-sessions', message: '自测工作区不能位于会话存储根内：' + workspace.path };
    }
    const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim().length > 0
      ? body.sessionId.trim()
      : 'session-' + randomBytes(4).toString('hex') + '-0000-4000-8000-' + randomBytes(6).toString('hex');
    // 按 agent-loop 的真实顺序：先取得持久化写所有权（= 物化日志 + 持有 session.lock
    // 租约），再把它发布成 live 会话。这样自测出来的状态与「DSH 真的打开了这个会话」一致。
    let leaseHeld = false;
    let leaseError = null;
    if (body.lease !== false) {
      try {
        selftestLeases.set(sessionId, await ctx.sessionPersistence.create({
          version: 4,
          id: sessionId,
          createdAt: Date.now(),
          cwd: workspace.path,
          isSeeded: false,
          delegationDepth: 0,
          agentPreset: 'standard',
        }));
        leaseHeld = true;
      } catch (error) {
        leaseError = String(error && error.message !== undefined ? error.message : error);
      }
    }
    const session = sessions.create(sessionId, { meta: { cwd: workspace.path } });
    if (typeof sessions.flush === 'function') await sessions.flush(session);
    await workspace.attachSession(sessionId);

    // pressure=true：起一个循环，持续往这个会话的**写链**上排队 —— 等价于「正在跑的
    // turn 不断产生写入」。搬迁期间如果有任何一次插进来，就会被自测断言抓到。
    let pressure = false;
    if (body.pressure === true && leaseHeld) {
      const handle = selftestLeases.get(sessionId);
      selftestPressure.sessionId = sessionId;
      selftestPressure.marks = [];
      if (selftestPressure.timer !== null) clearInterval(selftestPressure.timer);
      selftestPressure.timer = setInterval(() => {
        try {
          void Promise.resolve(handle.enqueueChain(async () => {
            selftestPressure.marks.push(Date.now());
          })).catch(() => {});
        } catch {
          // 句柄关了就算了
        }
      }, 4);
      pressure = true;
    }

    return {
      ok: true,
      sessionId,
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      live: sessions.get(sessionId) !== undefined,
      leaseHeld,
      leaseError,
      pressure,
    };
  }

  /** 自测观察窗：压力循环记录的时间戳 + 每次就地接管的窗口。 */
  async function selftestState() {
    const handle = selftestPressure.sessionId !== null ? selftestLeases.get(selftestPressure.sessionId) : undefined;
    return {
      ok: true,
      pressure: {
        sessionId: selftestPressure.sessionId,
        running: selftestPressure.timer !== null,
        marks: selftestPressure.marks,
      },
      handoffs: handoffLog,
      writer: handle === undefined ? null : {
        headerCwd: handle.header !== undefined ? handle.header.cwd : null,
        leaseHeld: handle.lease !== undefined && handle.lease !== null,
      },
    };
  }

  /**
   * 强制自测句柄重新获取内核锁 —— 用来**证明**它现在把路径算到新目录去了。
   *
   * 注意：写锁在 Windows 上是**由路径派生的命名内核信号量**（没有锁文件）；
   * 只在 POSIX 上才有一个 <sessionDir>/session.lock。所以这里的判据是
   * sessionDir/headerCwd，而不是文件是否存在。
   */
  async function selftestEnsureLease() {
    const id = selftestPressure.sessionId;
    const handle = id !== null ? selftestLeases.get(id) : undefined;
    if (handle === undefined) return { ok: false, code: 'no-handle', message: '没有可用的自测句柄' };
    await handle.ensureLease();
    const dir = sessionDirFor(id, handle.header.cwd);
    return {
      ok: true,
      headerCwd: handle.header.cwd,
      sessionDir: dir,
      platform: process.platform,
      // 只有 POSIX 才有锁文件；Windows 是路径派生的命名信号量。
      lockFile: process.platform === 'win32' ? null : join(dir, 'session.lock'),
      lockFileExists: process.platform === 'win32' ? null : existsSync(join(dir, 'session.lock')),
      leaseHeld: handle.lease !== undefined && handle.lease !== null,
    };
  }

  /** 停掉压力循环（清理用）。 */
  async function selftestStopPressure() {
    if (selftestPressure.timer !== null) {
      clearInterval(selftestPressure.timer);
      selftestPressure.timer = null;
    }
    return { ok: true, stopped: true };
  }

  /** 清掉自测造出来的会话：释放 + 摘归属 + 删目录 + 清投影缓存。 */
  async function selftestDrop(body) {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    if (sessionId.length === 0) return { ok: false, code: 'bad-request', message: '需要 sessionId' };
    if (sessionId.length > MAX_SESSION_ID_LENGTH) return { ok: false, code: 'bad-request', message: 'sessionId 过长' };
    const host = buildHost();
    const release = await host.releaseSession(sessionId).catch((error) => ({
      released: false,
      detail: String(error && error.message),
    }));
    for (const entity of ctx.workspaceRegistry.list()) {
      if (Array.isArray(entity.sessionIds) && entity.sessionIds.includes(sessionId)) {
        await entity.detachSession(sessionId).catch(() => {});
      }
    }
    const enc = encodeSegment(sessionId);
    const removed = [];
    const root = store.sessionsRoot;
    const projects = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const project of projects) {
      if (!project.isDirectory()) continue;
      const dir = join(root, project.name, enc);
      if (!existsSync(dir)) continue;
      await rm(dir, { recursive: true, force: true });
      removed.push(dir);
    }
    await host.invalidateProjection(sessionId);
    selftestLeases.delete(sessionId);
    const deletedWorkspaces = [];
    const paths = Array.isArray(body.deleteWorkspacePaths)
      ? body.deleteWorkspacePaths.filter((path) => typeof path === 'string').slice(0, MAX_BATCH_SESSIONS)
      : [];
    for (const entity of ctx.workspaceRegistry.list()) {
      if (!paths.some((path) => samePath(entity.path, path))) continue;
      await ctx.workspaceRegistry.delete(entity.id).catch(() => {});
      deletedWorkspaces.push(entity.path);
    }
    return { ok: true, sessionId, release, removed, deletedWorkspaces };
  }

  /**
   * 造一条桥接路由。
   *
   * @param path - 精确路径。
   * @param methods - 允许的方法。
   * @param handler - (body) => payload。
   * @param server - webServer 服务（用于来源校验里识别绑定的网卡地址）。
   */
  function route(path, methods, handler, server) {
    return {
      kind: 'exact',
      path,
      handler: async (req, res) => {
        try {
          // 来源校验必须在读 body / 碰任何业务状态之前。
          assertRequestAllowed(req, server);
          const method = String(req.method ?? 'GET').toUpperCase();
          if (!methods.includes(method)) {
            throw new HttpError(405, 'method-not-allowed', '只接受 ' + methods.join('/'));
          }
          let body = {};
          if (method === 'POST') {
            // 跨源「简单请求」只能发 text/plain 等安全类型；强制 JSON 就把 CSRF 挡在预检上。
            if (!isJsonMediaType(req.headers !== undefined ? req.headers['content-type'] : undefined)) {
              throw new HttpError(415, 'unsupported-media-type', 'POST 请求必须使用 application/json');
            }
            body = await readJsonBody(req);
          }
          writeJson(res, 200, await handler(body));
        } catch (error) {
          // 拒绝时也要把请求体读掉，否则 keep-alive 连接可能卡在半截 body 上。
          if (typeof req.resume === 'function') {
            try { req.resume(); } catch { /* 已结束/已销毁 */ }
          }
          writeJson(res, statusForError(error), failure(error instanceof Error ? error : new Error(String(error))));
        }
      },
    };
  }

  ctx.inject(['webServer'], (sctx) => {
    sctx.effect(() => {
      const routes = [
        route(prefix + '/describe', ['POST'], describe, sctx.webServer),
        route(prefix + '/move', ['POST'], move, sctx.webServer),
        route(prefix + '/move-commit', ['POST'], moveCommit, sctx.webServer),
        route(prefix + '/sessions', ['POST'], listSessions, sctx.webServer),
        route(prefix + '/last-prompt', ['POST'], lastPrompt, sctx.webServer),
        route(prefix + '/delete', ['POST'], deleteSessions, sctx.webServer),
        route(prefix + '/status', ['GET', 'POST'], status, sctx.webServer),
      ];
      if (selftest) {
        routes.push(route(prefix + '/__selftest/create-live', ['POST'], selftestCreateLive, sctx.webServer));
        routes.push(route(prefix + '/__selftest/drop', ['POST'], selftestDrop, sctx.webServer));
        routes.push(route(prefix + '/__selftest/state', ['GET', 'POST'], selftestState, sctx.webServer));
        routes.push(route(prefix + '/__selftest/ensure-lease', ['POST'], selftestEnsureLease, sctx.webServer));
        routes.push(route(prefix + '/__selftest/stop-pressure', ['POST'], selftestStopPressure, sctx.webServer));
      }
      const disposers = routes.map((entry) => sctx.webServer.register(entry));
      const offInject = sctx.on('webserver/index-inject', (table) => {
        const value = { prefix, version: PLUGIN_VERSION, drag: dragMove };
        table.push({ kind: 'global', name: BOOT_GLOBAL, value });
        // 兼容旧客户端与 dsh-delete-session 的旧全局名。
        table.push({ kind: 'global', name: LEGACY_BOOT_GLOBAL, value });
      });
      return () => {
        for (const dispose of disposers) dispose();
        offInject();
      };
    }, 'dsh-session-extension: bridge');
  });

  log('info', '就绪：' + prefix + '（会话存储 ' + store.sessionsRoot + '，迁移日志 ' + store.journalsDir + '）');
}
