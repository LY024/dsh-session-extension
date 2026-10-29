# dsh-session-extension

**两件事：把上一次提问改一改再发一次；把对话跨工作区搬家 —— 连正在回答的那个也能搬。**

装完之后：

| 功能 | 入口 |
| --- | --- |
| **编辑上次提问并重发** | 助手消息下方那排小图标里（**复制**后面、**分叉**前面）多一个 **↩**；hover 和复制一样显示名字 |
| **跨工作区搬会话** | 侧栏会话行 **…** → **移动**（鼠标悬停时右侧展开工作区子菜单）；或把会话**拖到**别的工作区；或 **Ctrl + 点击**多选后批量搬/归档；或会话页 composer 上方的工作区 chip |

搬会话与 [DDDMUC/dsh-session-relocate](https://github.com/DDDMUC/dsh-session-relocate) 的功能保持一致，
并保留了你修补版里的安全事务与崩溃恢复。

---

## 一、编辑上一次提问并重发

像 Codex 里「改上一条消息再发」那样：

1. 点任意助手消息下方的 **↩** 小图标；
2. 弹窗里是这条会话**最后一条用户亲手发的提问**（跳过注入上下文、压缩检查点、
   替换副本和纯图片消息）；
3. 改完点 **重发并发送**，或者只点 **仅载入输入框**。

**重发走 DSH 原生分叉**：在「那条提问之前」`fork` 出一个新会话（带着此刻之前的全部历史），
然后打开它、把文字放进输入框并发送。**原会话一个字节都没动**，还在原位，随时可以点回去对照；
新分支标题带分叉标记，不会和原会话混在一起。

只点「仅载入输入框」时不分叉：文字填进**当前**会话的输入框，发送后作为新消息追加
（Codex 里按 ↑ 召回上一条的效果）。

`Ctrl/Cmd + Enter` 直接重发，`Esc` 取消。

> 图标和「复制 / 分叉」同款：同一个官方按钮类名、同一排 28px 图标、同一个 Tooltip。
> 图标在助手消息的操作行里，鼠标移到消息上才浮现，和复制完全一致。

## 二、跨工作区搬会话

### 方式一：菜单

1. 鼠标移到侧边栏里某个对话上，点 **…**；
2. 菜单里是 **移动**（带一个 `›` 箭头）。**鼠标停在它上面**，右侧会展开子菜单，
   列出除「它当前所在的工作区」以外的所有工作区；
3. 点目标工作区。列表立刻刷新，这个对话出现在目标工作区下；
4. 打开它继续聊：它现在就运行在新目录里。

子菜单最下面是 **其它目录…**：输入一个绝对路径 —— 目录会被创建，并自动注册成一个新工作区。
点菜单项本身也能展开（触屏/键盘用）；鼠标移开就收起，不会在菜单里铺一屏列表。

### 方式二：直接拖

把侧边栏里的对话**拖到另一个工作区上**，松手就搬，不用点菜单。

投放目标是**整块工作区分组**：

- 拖到目标工作区的**文件夹行**上 —— 可以；
- 拖到它下面**任意一条会话行**上 —— 也可以；
- 拖到分组里的空隙、或「展开其余 N 个会话」上 —— 一样可以。

松手前，整块目标分组会亮起蓝框。**组内上下拖动仍然是官方的排序功能，插件一点不抢**：
只在**别的**分组里才接管并搬走。

**多选也能拖。** 在多选模式里勾好几条后，抓住其中任意一条拖到目标工作区，松手就是整批搬；
拖的如果是一条没被勾中的行，就只搬它自己。

### 方式三：Ctrl + 点击多选（批量搬 / 批量归档）

**按住 Ctrl（macOS 上是 ⌘）+ 鼠标左键点会话行**，就能切换这一行的选中状态——和 Windows
文件管理器里选文件一样。点第一行时自动进入多选模式：**选中的行底色加深**（不插勾选圈、不改行布局），
侧边栏页脚出现操作条。

- **已选 N 个 / 取消 / 归档 / 移动**
- **移动** → 选目标工作区 → 逐条搬，进度实时显示「正在移动 x/N…」，失败的那条**原地不动**
- **归档** → 逐条归档（DSH 的会话只能归档、不能物理删除；归档后在归档视图里可以恢复）
- 选中多条后**直接拖**到别的工作区也行（整批搬）；拖一条没被选中的行，就只搬它自己
- **松开 Ctrl 后点任意地方**（会话行、侧栏空白、页面别处）就取消多选；点已选中的行只退出多选，
  不会误打开会话
- `Esc` 或页脚「取消」也退出多选

会话行 **…** 菜单里**不再有「多选」入口**——多选只走 Ctrl + 点击。

### 连同子对话（默认开）

子智能体的会话（`origin: subagent`，侧边栏里隐藏）默认会**跟着父对话一起搬**：父搬到哪，
子、孙会话也搬到哪里。每条子会话独立走事务，失败按条隔离。

想只搬父对话：**Plugins → dsh-session-extension → 配置** 里关掉「连同子对话一起移动」
（存在浏览器本地，默认开）。

### 目录已经在目标里、但没归属（未分组）

会话的 `cwd` 已经在某个工作区目录下、但注册表里没有归属（侧栏显示「未分组」）时，
「移动」不会返回 `already-there`，而是把归属补写进目标工作区（回执 `applied: "attached"`），
文件一个字节都不动。

### 会话页常驻的工作区 chip

已开聊的会话，composer 上方会常驻一个工作区 chip（文件夹 + 工作区名）。点它 → 选目标工作区 → 直接搬。
出现方式在插件设置页里三选一：一直出现（默认）/ 悬浮才出现 / 不出现。新会话（hero）页不渲染，
避免和官方的工作区胶囊重复。

### 正在回答的对话也能搬

- **打开着但空闲**：先 `sessions.flush` → `store.detach()` → 探针确认写租约已释放，再动文件；
- **正在跑活**：**就地接管** —— 在写句柄的串行链里换掉 header 的 `cwd` 并搬文件，**不打断这一轮回答**。

一句诚实的话：正在跑的那一轮会继续跑完，但它手里的工具工作目录**仍是旧目录**
（内存 header 冻结）；文件和归属都已经搬走，下次打开才真正在新目录里跑。
想改成「正在跑就拒绝」，把 `moveLive` 设为 `false`。

> 搬的正是屏幕上打开的那个对话时，页面需要刷新一次再打开它（客户端手里那份是旧的）；
> 搬别的对话则完全无感。

### 为什么搬不坏

搬移是**可恢复事务**，不是一次 rename：校验 → 释放/接管写所有权 → 写迁移日志 →
整个会话目录复制到 `_session-move-staging/<opId>/`（DSH 扫描器看不到）→ 在暂存区改每个 generation
的 header `cwd` 并**逐字节自校验** → 原子 `rename` → 删源 → 改注册表归属 → 失效投影缓存。

**改写发生在暂存区，源目录在改名之前一个字节都没被动过**。任何一步失败都能干净回滚；
进程在改名后被杀死，也只会留下「目标已完整 + 源还在」这一种中间态，由恢复流程幂等推完。

---

## 安装

~~~bash
# 从 npm 装（发布后）：
dsh plugin --profile web add dsh-session-extension

# 从源码装：
dsh plugin --profile web add <你 clone 下来的 dsh-session-extension 目录>
~~~

主机侧是 Node 模块，装完**重启一次 `dsh web`**（或用 Plugins 页面的插件管理器安装，它会尝试热加载）。

自检：

~~~bash
curl http://127.0.0.1:3080/api/dsh-session-extension/status
~~~

返回 `{"ok":true, ...}` 就说明主机侧在线。

---

## 配置

`cordis.patch.yml` 里这一行的 `config`（profile 层可覆盖）：

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `bridgePrefix` | `/api/dsh-session-extension` | 主机桥接前缀。改动后客户端自动跟随（引导全局下发）。 |
| `journalsDir` | `<dsh home>/session-move` | 迁移日志目录。 |
| `sessionsRoot` | 后端的 root，退化为 `<dsh home>/sessions` | 会话存储根。一般不用设。 |
| `home` | `$DSH_HOME` 或 `~/.dsh` | DSH home。 |
| `moveLive` | `true` | 正在跑活的对话是否走「就地接管」。设 `false` 则拒绝。 |
| `dragMove` | `true` | 侧边栏拖动搬移。DSH 改了 DOM 约定时可一键关掉（菜单那条路不受影响）。 |
| `releaseLive` | `true` | 打开着但空闲的对话，搬之前是否自动释放。设 `false` 则拒绝。 |
| `releaseRetries` / `releaseRetryDelayMs` | `24` / `150` | 释放后探测写租约的重试次数与间隔。 |
| `verify` | `auto` | 改写后的自校验强度：`auto` 或 `full`。 |
| `fullVerifyLimit` | `2097152`（2 MB） | `verify: auto` 下的分界点。 |
| `allowedHosts` | `[]` | 额外允许的 `Host`（主机名，不含端口）。默认只认回环 + `webServer.host`。 |
| `allowedOrigins` | `[]` | 额外允许的 `Origin`。给 Vite/开发代理用。 |
| `selftest` | `false` | 打开后多挂几个 `__selftest/*` 路由，用来在真实进程里造/清测试会话。 |
| `maxSessions` | `40` | `/sessions` 一次最多返回多少条（上限 200）。 |
| `withTitles` | `false` | `/sessions` 是否顺带读标题（只对 ≤ 20 条生效）。 |

## 桥接 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `<prefix>/describe` | `{ sessionId? }` → 工作区列表；带 sessionId 时额外给出 `currentWorkspaceId`、`live`、`willHandoff`、`willRelease`、`canMove`、`reason`。 |
| POST | `<prefix>/move` | `{ sessionId, targetWorkspaceId }` 或 `{ sessionId, targetPath }` → 迁移回执（`applied: 'live' \| 'pending' \| 'attached'`、`released`、`handedOff`、`verification`）。 |
| POST | `<prefix>/move-commit` | `{ sessionIds }` → 把一批 defer 过的迁移归属一次性写进注册表。 |
| POST | `<prefix>/last-prompt` | `{ sessionId }` → `{ seq, prevSeq, text, time, images, files, replied }`。`prevSeq` 就是 fork 的闭区右端点。 |
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
- **强制 JSON Content-Type**：把普通 CSRF 挡在 CORS 预检上（本服务不应答预检）；
- **路径与迁移日志校验**：`targetPath` 必须是绝对路径，且不能落在会话存储根/迁移日志目录里；
  恢复时只接受严格位于会话存储根下、末段等于 session id 编码结果的日志。

所有会改文件/注册表的操作走同一条**全局串行队列**：并发搬同一条会话不会在两个项目目录里各留一份。

---

## 已知限制

- **重发一定会新建一个分支**，这是 DSH 只追加日志的必然结果；原会话不会被「改写」。
- 只认用户亲手发的提问；注入上下文、压缩检查点、子代理消息、纯图片消息都不算。
- 会话只有**一句**提问时没有更早历史可分叉，只能「仅载入输入框」。
- 重发的自动发送依赖 composer 的 `inputActions.setDraft / submit`；发不出去时文字仍在输入框里，
  按 Enter 即可。
- **拖动搬移依赖官方 DOM 约定**（行属性 + 分组结构）；DSH 改掉会分级退化，菜单那条路始终可用，
  `dragMove: false` 可一键全关。
- **正在跑活的那一轮不会换工作目录**（内存 header 冻结）；文件与归属已搬走，下次打开才生效。
- 搬「当前屏幕上打开的那个」之后，页面要刷新一次再打开它。
- 搬移的接管依赖私有内部结构（`tracker.writers`、写句柄 header、`enqueueChain`、注册表 `mutate`），
  每处都 feature-detect：探测不到就整体放弃（`handoff-failed`），绝不半途而废。
- 重发图标复用当前 DSH 版本的官方按钮类名（`_1KfHza_action`）；版本换了类名不在时，
  插件自带的兜底样式仍让它保持同一排小图标的观感。

---

## 测试

~~~bash
node --test
~~~

- `test/paths.test.js`：路径编码与真实 `~/.dsh/sessions` 目录名比对；
- `test/zstd.test.js`：会话日志压缩/解压；
- `test/relocate.test.js`：完整迁移 / 回滚 / 崩溃恢复（合成数据）；
- `test/last-prompt.test.js`：「上一次提问」的识别规则与 fork 边界；
- `test/relocate-client.test.js`：搬移 UI（菜单、拖动分组归属、批量）——来自参考实现；
- `test/client.test.js`：重发图标、隐藏消费者、编辑弹窗。

目录：

~~~
src/last-prompt.js   纯函数：从事件流里找上一次提问
src/paths.js         会话目录编码
src/relocate.js      迁移事务（暂存、改 header、原子改名、日志、恢复）
src/zstd.js          日志压缩/解压
src/plugin.js        主机侧：桥接 + 来源校验 + 迁移/重发路由
lib/client.js        网页端：搬移入口（菜单/拖动/多选/chip）+ 重发图标与弹窗
~~~

---

## License

GPL-3.0-or-later（与仓库根目录的 `LICENSE` 一致）。
