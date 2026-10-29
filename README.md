# dsh-session-extension

**同一个对话里做两件事：把上一次提问改一改再发一次；或者把这个会话整个搬到另一个工作区。**

入口只有一个：助手消息下方那排小图标里（**复制**后面、**分叉**前面）多一个回复箭头。
点开是一个弹窗，两件事都在里面完成，不占左侧栏、不加常驻按钮。

---

## 一、编辑上一次提问并重发

像 Codex 里「改上一条消息再发」那样：

1. 点任意助手消息下方的 **↩** 图标；
2. 弹窗里是这条会话**最后一条用户亲手发的提问**（跳过注入上下文、压缩检查点、
   替换副本和纯图片消息）；
3. 改完点 **重发并发送**，或者只点 **仅载入输入框**。

**重发走 DSH 原生分叉**：在「那条提问之前」`fork` 出一个新会话（带着此刻之前的全部历史），
然后打开它、把文字放进输入框并发送。**原会话一个字节都没动**，还在原位，随时可以点回去对照；
新分支标题带分叉标记，不会和原会话混在一起。

只点「仅载入输入框」时不分叉：文字填进**当前**会话的输入框，发送后作为新消息追加
（Codex 里按 ↑ 召回上一条的效果）。

`Ctrl/Cmd + Enter` 直接重发，`Esc` 取消。

## 二、把会话搬到另一个工作区

同一个弹窗底部有 **移动到工作区…**：

- 列出除当前工作区以外的全部工作区，点一下就搬；
- 也可以填一个**还不存在的绝对路径**，目录会被创建并自动注册成新工作区；
- 搬完这个会话连同全部历史 generation、`cwd`、工作区归属一起换地方，**接着继续聊**。

### 搬的是什么

DSH 把「对话属于哪个工作区」编码在三个互相约束的地方，所以搬移必须同时改三样：

| 事实 | 说明 |
| --- | --- |
| 目录名由 cwd 推导 | 会话在 `~/.dsh/sessions/<cwd 编码的项目目录>/<会话目录>/session.vN.jsonl.zstd`。 |
| cwd 住在日志第一行 | 每个 generation 的第一行是 header，含 `cwd`；与物理位置不一致会被判成 `corrupt session log`。 |
| 归属 = 注册表 + 校验 | 工作区记录在 `~/.dsh/storages/workspace.json` 的 `sessionIds` 里，`attachSession` 还会校验 header 的 cwd 必须等于工作区 path。 |

### 为什么搬不坏

搬移是**可恢复事务**，不是一次 rename：

1. 校验会话、目标工作区、源 ≠ 目标、日志可读；
2. 打开着的会话先安全释放（空闲）或就地接管（正在回答），拿到写所有权；
3. 写迁移日志（`~/.dsh/session-move/<opId>.json`）；
4. 整个会话目录复制到 `<sessionsRoot>/_session-move-staging/<opId>/` ——
   比 DSH 认的会话目录深一层，扫描器永远看不到它；
5. 在暂存区改每个 generation 的 header `cwd`，并**逐字节自校验**（除第一行外明文必须与源完全一致），
   不满足就整体放弃；
6. `rename` 到目标目录（同一存储根，原子操作）→ 删源目录；
7. 刷新注册表 header 索引 → attach 到目标 → 从源 detach；
8. 失效投影缓存、删迁移日志。

**改写发生在暂存区，源目录在改名之前一个字节都没被动过**。任何一步失败都能干净回滚；
进程在改名后被杀死，也只会留下「目标已完整 + 源还在」这一种中间态，由启动时与
`/status` 调用时的 `recoverPendingMoves` 幂等推完。

### 正在回答的对话也能搬

- **打开着但空闲**：先 `sessions.flush` → `store.detach()` → 探针确认写租约已释放，再动文件；
- **正在跑活**：**就地接管** —— 在写句柄的串行链里换掉 header 的 `cwd` 并搬文件，**不打断这一轮回答**。

一句诚实的话：正在跑的那一轮会继续跑完，但它手里的工具工作目录**仍是旧目录**
（会话在内存里的 header 是冻结的）；文件和归属都已经搬走，下次打开才真正在新目录里跑。
想改成「正在跑就拒绝」，把 `moveLive` 设为 `false`。

> 如果你搬的正是屏幕上打开的那个对话，页面需要刷新一次再打开它（客户端手里那份是旧的）；
> 搬别的对话则完全无感。弹窗回执里会提醒这一点。

---

## 安装

~~~bash
# 从 npm 装（发布后）：
dsh plugin --profile web add dsh-session-extension

# 从源码装（把路径换成你 clone 下来的目录）：
dsh plugin --profile web add <你 clone 下来的 dsh-session-extension 目录>
~~~

主机侧是 Node 模块，装完**重启一次 `dsh web`**（或用 Plugins 页面的插件管理器安装，它会尝试热加载）。

自检：

~~~bash
curl http://127.0.0.1:3080/api/dsh-session-extension/status
~~~

返回 `{"ok":true, ...}` 就说明主机侧在线；刷新页面后，助手消息下方的小图标里应多出 **↩**。

---

## 配置

`cordis.patch.yml` 里这一行的 `config`（profile 层可覆盖）：

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `bridgePrefix` | `/api/dsh-session-extension` | 主机桥接前缀。改动后客户端自动跟随（通过引导全局下发）。 |
| `journalsDir` | `<dsh home>/session-move` | 迁移日志目录。 |
| `sessionsRoot` | 后端的 root，退化为 `<dsh home>/sessions` | 会话存储根。一般不用设。 |
| `home` | `$DSH_HOME` 或 `~/.dsh` | DSH home。 |
| `moveLive` | `true` | 正在跑活的对话是否走「就地接管」。设 `false` 则拒绝。 |
| `releaseLive` | `true` | 打开着但空闲的对话，搬之前是否自动释放。设 `false` 则拒绝。 |
| `releaseRetries` / `releaseRetryDelayMs` | `24` / `150` | 释放后探测写租约的重试次数与间隔。 |
| `verify` | `auto` | 改写后的自校验强度：`auto`（小日志全文解码）或 `full`。 |
| `fullVerifyLimit` | `2097152`（2 MB） | `verify: auto` 下的分界点。 |
| `allowedHosts` | `[]` | 额外允许的 `Host`（主机名，不含端口）。默认只认回环 + `webServer.host`。 |
| `allowedOrigins` | `[]` | 额外允许的 `Origin`（完整 origin）。给 Vite/开发代理用。 |
| `selftest` | `false` | 打开后多挂几个 `__selftest/*` 路由，用来在真实进程里造/清测试会话。 |
| `maxSessions` | `40` | `/sessions` 一次最多返回多少条（上限 200）。 |
| `withTitles` | `false` | `/sessions` 是否顺带读标题（只对 ≤ 20 条生效）。 |

## 桥接 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `<prefix>/describe` | `{ sessionId }` → 工作区列表；带 sessionId 时额外给出 `currentWorkspaceId`、`live`、`willHandoff`、`willRelease`、`canMove`、`reason`。 |
| POST | `<prefix>/move` | `{ sessionId, targetWorkspaceId }` 或 `{ sessionId, targetPath }` → 迁移回执（`applied: 'live' \| 'pending' \| 'attached'`、`released`、`handedOff`、`verification`）。 |
| POST | `<prefix>/move-commit` | `{ sessionIds }` → 把一批 defer 过的迁移归属一次性写进注册表。 |
| POST | `<prefix>/last-prompt` | `{ sessionId }` → `{ seq, prevSeq, text, time, images, files, replied }`。`prevSeq` 就是 fork 的闭区右端点；`null` 表示这条提问之前没有历史。 |
| POST | `<prefix>/sessions` | `{ limit?, withTitles? }` → 会话目录（只读 header）。 |
| GET/POST | `<prefix>/status` | 版本、配置、待收尾的迁移列表；调用时会顺带尝试恢复。 |

失败一律是 `{ ok: false, code, message }`。POST 必须带 `Content-Type: application/json`；
来源校验失败回 `403 forbidden`，媒体类型不对回 `415 unsupported-media-type`，
请求体超过 64 KB 回 `413`。

## 安全边界

桥接直接挂在 DSH 的 `node:http` 上，没有 cookie、没有 token，所以插件自己做了防护：

- **Host 校验**：只接受回环主机名（`localhost`、`127.0.0.0/8`、`::1`）或 `webServer.host`
  绑定的地址，挡住 DNS rebinding；
- **Origin / Sec-Fetch-Site 校验**：带 `Origin` 时必须是同源，`Sec-Fetch-Site: cross-site`
  直接拒绝；开发代理用 `allowedOrigins` 显式放开；
- **强制 JSON Content-Type**：跨源「简单请求」只能发 `text/plain`，要求 JSON 就把普通 CSRF
  挡在预检上（本服务不应答 CORS 预检）；
- **路径与迁移日志校验**：`targetPath` 必须是绝对路径，且不能落在会话存储根/迁移日志目录里；
  恢复时只接受 `srcDir`/`dstDir` 严格位于会话存储根下、末段等于 session id 编码结果的日志。
  即使日志被篡改，也不会变成「删除任意目录」的原语。

所有会改文件/注册表的操作（`move`、`move-commit`、崩溃恢复）走同一条**全局串行队列**：
并发搬同一条会话不会在两个项目目录里各留一份（那会让 DSH 永久拒绝打开它）。

> 注意：这些防护假定 DSH 只在本机回环地址上服务。把 `webServer.host` 绑到局域网地址时，
> DSH 本身没有用户鉴权，同网段的人也能调用桥接 —— 请自行用防火墙/反向代理加认证。

---

## 已知限制

- **重发一定会新建一个分支**，这是 DSH 只追加日志的必然结果；原会话不会被「改写」。
- **只认用户亲手发的提问**：注入上下文、压缩检查点、子代理消息、纯图片消息都不算；
  某些会话可能提示「还没有可以编辑的提问」。
- 会话只有**一句**提问时没有更早历史可分叉，只能「仅载入输入框」。
- 重发后的自动发送依赖会话 composer 的 `inputActions.setDraft / submit`；老宿主没有这个公开面时，
  文字仍会尝试填入，发不出去就手动按 Enter（文字不会丢）。
- **正在跑活的那一轮不会换工作目录**（内存 header 冻结）；文件与归属已搬走，下次打开才生效。
- 搬「当前屏幕上打开的那个」之后，页面要刷新一次再打开它。
- 嵌套工作区、多进程共用一个 DSH home 等边界与参考实现一致：宁可少搬、不猜错。
- 小图标复用了当前 DSH 版本官方操作按钮的类名（`_1KfHza_action`）以求视觉一致；
  版本换了类名不在时，插件自带的兜底样式仍让它保持同一排小图标的观感。

---

## 测试

~~~bash
node --test
~~~

- `test/paths.test.js`：路径编码与真实 `~/.dsh/sessions` 目录名比对；
- `test/zstd.test.js`：会话日志的压缩/解压；
- `test/relocate.test.js`：完整迁移 / 回滚 / 崩溃恢复（合成数据，不碰真实会话）；
- `test/last-prompt.test.js`：「上一次提问」的识别规则与 fork 边界；
- `test/client.test.js`：用假 react / document / fetch 把网页端工厂物化，渲染图标、隐藏消费者、
  弹窗与「移动到工作区」状态机。

目录：

~~~
src/last-prompt.js   纯函数：从事件流里找上一次提问
src/paths.js         会话目录编码
src/relocate.js      迁移事务（暂存、改 header、原子改名、日志、恢复）
src/zstd.js          日志压缩/解压
src/plugin.js        主机侧：桥接 + 来源校验 + 迁移/重发路由
lib/client.js        网页端：消息操作行图标、编辑弹窗、移动到工作区
~~~

---

## License

GPL-3.0-or-later（与仓库根目录的 `LICENSE` 一致）。
