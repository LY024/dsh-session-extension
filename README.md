# dsh-session-extension

**简体中文** | [English](README.en.md)

**在 DSH 里把上一条提问改一改再发一次；顺手把会话跨工作区搬家、删除、归档。**

装完之后多出四类能力，入口都在对话里或侧栏会话行上，不新增左侧栏页面：

| 能力 | 入口 |
| --- | --- |
| **编辑消息并重发** | 最后一条用户消息下方、**复制图标后面**的 **↩**（hover 显示「编辑消息」） |
| **移动会话** | 会话行 **…** → **移动**（悬停展开右侧工作区子菜单）；或把会话**拖到**别的工作区 |
| **删除会话** | 会话行 **…** → **删除**（红色）；或 **Ctrl + 点击**多选后底栏「删除」 |
| **批量归档 / 移动 / 删除** | **Ctrl（⌘）+ 左键**多选 → 侧栏页脚操作条 |

---

## 一、编辑消息并重发

1. 把鼠标移到**最后一条用户消息**上，点它下方 **复制图标后面**的 **↩**；
2. 这条消息的**文字部分**原地变成一块浅灰编辑区（与气泡同宽、无边框、16px 圆角），里面是这条提问的原文，
   光标落在末尾；**已经上传的图片、文档等附件留在原位不动**，消息下方的图标行暂时隐藏；
3. 改完点 **发送**（或 `Ctrl/Cmd + Enter`），也可以点 **取消** 原样退出。

**发送做了什么**：把改好的文字放进**当前会话**的输入框并直接发送，从当前对话继续——
**不会创建新分支**；原来那条提问作为历史保留（附件也原样留在那条消息上）。

> 实现说明：DSH 官方只给助手消息留了操作槽，用户消息行**没有**扩展槽。所以这个入口是
> DOM 注入（MutationObserver 补插），并直接复用官方复制按钮的类名，保证尺寸/颜色/hover 一致。
> hover 提示是自绘气泡（不设原生 `title`，避免两个提示叠在一起）。编辑时只隐藏文字气泡
> （`userStack` 里的 `bubble`），附件行（`attachmentRow`）保持可见。

## 二、移动会话

### 方式一：菜单

1. 鼠标移到侧栏某个对话上，点 **…**；
2. 菜单里是 **移动**（右侧带 `›`）。**鼠标停在它上面**，菜单面板**右侧**展开子菜单：
   从「移动」这一行开始、向下延伸到窗口底部；右边放不下时翻到菜单左侧；
   靠近窗口底部、下方空间不够时改为**向上展开**，底边与「移动」行齐平——保证鼠标水平移过去就能点；
3. 点目标工作区，列表立刻刷新，这个对话出现在目标工作区下；
4. 子菜单最下面是 **其它目录…**：输入绝对路径，目录会被创建并注册成新工作区。

### 方式二：直接拖

把会话**拖到另一个工作区**的分组上（文件夹行、它下面的任意会话行、分组空隙都算），松手就搬。
**组内上下拖动仍然是官方的排序功能**，插件只在别的分组里接管。

### 方式三：Ctrl 多选后批量操作

**按住 Ctrl（macOS 上是 ⌘）+ 鼠标左键点会话行**切换选中，和 Windows 文件管理器一样：

- 选中的行**整行底色加深**（不插勾选圈、不改行布局）；
- 侧栏页脚出现操作条：**已选 N 个 / 取消 / 归档 / 删除 / 移动**；
- **移动** → 弹出目标工作区面板 → 选一个 → 逐条搬；也可以选中多条后直接拖到别的工作区（整批搬）；
- **松开 Ctrl 后点任意地方**退出多选；点已选中的行只退出，不会误打开会话；
- `Esc` 或页脚「取消」也能退出。

### 连同子对话（默认开）

子智能体的会话（`origin: subagent`，侧栏隐藏）默认跟着父对话一起搬/删。每条子会话独立走事务，
失败按条隔离。想只处理父会话：**Plugins → dsh-session-extension → 配置**里关掉。

### 未分组会话

会话的 `cwd` 已在某个工作区目录下、但注册表里没有归属时，「移动」会把归属补写进去
（回执 `applied: "attached"`），文件一个字节都不动。

### 正在回答的对话也能搬

- **打开着但空闲**：先 `flush` → `detach` → 探针确认写租约已释放，再动文件；
- **正在跑活**：就地接管，在写句柄的串行链里换 header 的 `cwd` 并搬文件，不打断这一轮回答。

诚实地说：正在跑的那一轮会继续跑完，但那一轮的工具工作目录**仍是旧目录**（内存 header 冻结）；
文件与归属都搬走了，下次打开才真正在新目录里跑。想改成「正在跑就拒绝」，把 `moveLive` 设为 `false`。

### 搬移为什么不会坏

校验 → 释放/接管写所有权 → 写迁移日志 → 整个会话目录复制到 `_session-move-staging/<opId>/`
（DSH 扫描器看不到）→ 在暂存区改每个 generation 的 header `cwd` 并**逐字节自校验** →
原子 `rename` → 删源 → 改注册表归属 → 失效投影缓存。

**改写发生在暂存区，源目录在改名之前一个字节都没被动过**；任何一步失败都能干净回滚，
进程在改名后被杀死也只会留下「目标已完整 + 源还在」一种中间态，由恢复流程幂等推完。

## 三、删除会话

**危险操作：日志会被物理删除，不能恢复。**

- 会话行 **…** → **删除**（红色垃圾桶 + 红字，与其它菜单项左对齐）；
- 或 **Ctrl + 点击**多选 → 页脚底栏 **删除**；
- 点删除会先弹**确认框**（自绘，不依赖 `window.confirm`），确认后执行；
- 正在运行的会话会**先被停止**再删（否则日志被占用）；删不掉会明确告诉你原因；
- 默认连同子代理会话一起删（跟随「连同子对话」设置）。

删除同样是事务化的：先把会话目录**原子挪进** `<sessionsRoot>/_session-delete-trash/<opId>/`，
摘完工作区归属、失效投影后再清空暂存；中途失败会把已挪走的目录挪回原位。
删的是**会话日志**，工作区目录里的文件不受影响。

## 四、归档

DSH 的会话可以归档（归档后可恢复）；多选底栏的 **归档** 会逐条调用宿主的归档接口，
失败隔离，进度显示「正在归档 x/N…」。

---

## 安装

### 用 Harness 插件管理器安装（推荐）

在 **Plugins → 安装插件** 的输入框里粘贴安装规格：

~~~text
github:LY024/dsh-session-extension#v0.6.4
~~~

命令行等价：

~~~bash
dsh plugin --profile web add github:LY024/dsh-session-extension#v0.6.4
~~~

也可以直接给仓库地址（同义写法）：

~~~bash
dsh plugin --profile web add https://github.com/LY024/dsh-session-extension#v0.6.4
~~~

如果拉 git 太慢，可以先把 Release 里的 `dsh-session-extension-0.7.0.tgz` 下载到本地，再装这个文件：

~~~bash
dsh plugin --profile web add /绝对路径/dsh-session-extension-0.7.0.tgz
~~~

### 从 npm / 源码装

~~~bash
# 从 npm 装（发布后）：
dsh plugin --profile web add dsh-session-extension

# 从源码装（把路径换成你 clone 下来的目录）：
dsh plugin --profile web add <你 clone 下来的 dsh-session-extension 目录>
~~~

装完**重启一次 `dsh web`**（插件管理器安装会尝试热加载；命令行安装必须重启）。

自检：

~~~bash
curl http://127.0.0.1:3080/api/dsh-session-extension/status
~~~

返回 `{"ok":true, ...}` 就说明主机侧在线；刷新页面后，最后一条用户消息下方应出现 **↩**。

---

## 配置

`cordis.patch.yml` 里这一行的 `config`（profile 层可覆盖）：

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `bridgePrefix` | `/api/dsh-session-extension` | 主机桥接前缀，客户端通过引导全局自动跟随。 |
| `journalsDir` | `<dsh home>/session-move` | 迁移日志目录。 |
| `sessionsRoot` | 后端 root，退化为 `<dsh home>/sessions` | 会话存储根。一般不用设。 |
| `home` | `$DSH_HOME` 或 `~/.dsh` | DSH home。 |
| `moveLive` | `true` | 正在跑活的对话是否走「就地接管」；`false` 则拒绝。 |
| `releaseLive` | `true` | 打开着但空闲的对话，搬之前是否自动释放；`false` 则拒绝。 |
| `dragMove` | `true` | 侧边栏拖动搬移；DSH 改了 DOM 约定时可一键关掉（菜单不受影响）。 |
| `releaseRetries` / `releaseRetryDelayMs` | `24` / `150` | 释放后探测写租约的重试次数与间隔。 |
| `verify` | `auto` | 搬移后的自校验强度：`auto` 或 `full`。 |
| `fullVerifyLimit` | `2097152`（2 MB） | `verify: auto` 的分界点。 |
| `allowedHosts` | `[]` | 额外允许的 `Host`（主机名，不含端口）。默认只认回环 + `webServer.host`。 |
| `allowedOrigins` | `[]` | 额外允许的 `Origin`，给 Vite/开发代理用。 |
| `selftest` | `false` | 打开后多挂几个 `__selftest/*` 路由。 |
| `maxSessions` | `40` | `/sessions` 一次最多返回多少条（上限 200）。 |
| `withTitles` | `false` | `/sessions` 是否顺带读标题（只对 ≤ 20 条生效）。 |

## 桥接 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `<prefix>/describe` | `{ sessionId? }` → 工作区列表；带 sessionId 时额外给出 `currentWorkspaceId`、`live`、`willHandoff`、`willRelease`、`canMove`、`reason`。 |
| POST | `<prefix>/move` | `{ sessionId, targetWorkspaceId }` 或 `{ sessionId, targetPath }` → 迁移回执（`applied`、`released`、`handedOff`、`verification`）。 |
| POST | `<prefix>/move-commit` | `{ sessionIds }` → 把一批 defer 过的迁移归属一次性写进注册表。 |
| POST | `<prefix>/last-prompt` | `{ sessionId }` → `{ seq, prevSeq, text, time, images, files, replied }`；`prevSeq` 就是编辑发送时的 fork 边界。 |
| POST | `<prefix>/delete` | `{ sessionId \| sessionIds, includeChildren? }` → `{ deleted, failed, results[] }`；物理删除日志 + 摘归属 + 失效投影。 |
| POST | `<prefix>/sessions` | `{ limit?, withTitles? }` → 会话目录（只读 header）。 |
| GET/POST | `<prefix>/status` | 版本、配置、待收尾的迁移列表；调用时顺带尝试恢复。 |

失败一律 `{ ok: false, code, message }`。POST 必须带 `Content-Type: application/json`；
来源校验失败回 `403`，媒体类型不对回 `415`，请求体超过 64 KB 回 `413`。

## 安全边界

桥接直接挂在 DSH 的 `node:http` 上，没有 cookie、没有 token，所以插件自己做了防护：

- **Host 校验**：只接受回环主机名（`localhost`、`127.0.0.0/8`、`::1`）或 `webServer.host`
  绑定的地址，挡住 DNS rebinding；
- **Origin / Sec-Fetch-Site 校验**：带 `Origin` 时必须同源，`Sec-Fetch-Site: cross-site` 直接拒绝；
- **强制 JSON Content-Type**：把普通 CSRF 挡在 CORS 预检上（本服务不应答预检）；
- **路径与迁移日志校验**：`targetPath` 必须是绝对路径且不能落在会话存储根/迁移日志目录里；
  恢复时只接受严格位于会话存储根下、末段等于 session id 编码结果的日志；
- **删除也走同一套校验**：`sessionId` 长度受限，只接受存储根下匹配该 id 的目录。

所有会改文件/注册表的操作（`move`、`move-commit`、`delete`、崩溃恢复）走同一条**全局串行队列**。

> 这些防护假定 DSH 只在本机回环地址上服务。把 `webServer.host` 绑到局域网地址时，
> DSH 本身没有用户鉴权，同网段的人也能调用桥接 —— 请自行用防火墙/反向代理加认证。

---

## 已知限制

- **编辑消息的入口依赖官方用户消息行的 DOM**（`data-chat-flow-kind="user"` +
  操作行的 `*_actions` 类名）。DSH 换版本改掉这些约定时，图标可能不再出现；
- 编辑框是 DOM 注入的节点，流式输出期间官方重渲染有概率把它顶掉（插件有 MutationObserver
  补插 + 重新压住原气泡，但极端情况下仍可能闪一下）；
- **删除不可恢复**：日志被物理删除；正在运行的会话会先被停止；
- **正在跑活的那一轮不会换工作目录**（内存 header 冻结）；文件和归属已搬走，下次打开才生效；
- 搬「当前屏幕上打开的那个」之后，页面要刷新一次再打开它；
- **拖动搬移依赖官方 DOM 约定**（行属性 + 分组结构）；改掉会分级退化，菜单那条路始终可用，
  `dragMove: false` 可一键全关；
- 搬移的「就地接管」依赖私有内部结构（`tracker.writers`、写句柄 header、`enqueueChain`、
  注册表 `mutate`），每处都 feature-detect：探测不到就整体放弃（`handoff-failed`），绝不半途而废；
- 会话页 composer 上方原来那条「工作区 chip」已移除，搬移入口统一到菜单 / 拖动 / 多选。

---

## 测试

~~~bash
node --test
~~~

| 文件 | 覆盖 |
| --- | --- |
| `test/paths.test.js` | 会话目录编码与真实 `~/.dsh/sessions` 目录名比对 |
| `test/zstd.test.js` | 会话日志压缩/解压 |
| `test/relocate.test.js` | 完整迁移 / 回滚 / 崩溃恢复（合成数据） |
| `test/last-prompt.test.js` | 「上一次提问」的识别规则与 fork 边界 |
| `test/relocate-client.test.js` | 搬移 UI（菜单子面板、拖动分组归属、Ctrl 多选、底栏、删除确认） |
| `test/client.test.js` | 编辑消息入口、待载入消费者、弹窗 |

当前共 **97 项**测试，全部用合成数据，不碰真实会话。

### 目录

~~~
src/last-prompt.js   纯函数：从事件流里找上一次提问
src/paths.js         会话目录编码
src/relocate.js      迁移事务（暂存、改 header、原子改名、日志、恢复）
src/zstd.js          日志压缩/解压
src/plugin.js        主机侧：桥接 + 来源校验 + 迁移/删除/重发路由
lib/client.js        网页端：用户消息行编辑入口、搬移 UI（菜单/拖动/多选/底栏）
test/                单元测试
~~~

---

## 参考项目

本插件的搬移能力不是从零写的，它对齐或沿用了下面这些项目/实现：

- **[DDDMUC/dsh-session-relocate](https://github.com/DDDMUC/dsh-session-relocate)** ——
  跨工作区搬移的原始设计与实现：会话菜单的「移动」、拖放、多选批量、空闲会话释放、
  正在回答时的就地接管，以及「暂存 → 改 header → 原子改名 → 改归属」的迁移流程。
  本插件的搬移行为与它对齐。
- **本项目的早期修补版（[LY024/dsh-session-extension](https://github.com/LY024/dsh-session-extension) 历史提交）** ——
  在上游基础上补的崩溃恢复与安全校验：暂存区逐字节自校验、`rename` 失败回滚、
  启动/调用时幂等恢复、来源校验与路径约束；本插件沿用这一套事务。
- **DSH 官方客户端扩展点** —— `dsh-client-ui-slots` / `conversation.input.dock` /
  `conversation.chat.*` 等公开槽位，以及用户消息行、操作行的官方 DOM 约定；
  所有 UI 入口都通过这些接入，没有改 DSH 本体。

编辑消息、内联编辑态、删除/归档入口是在以上基础上由本插件新增的能力。

---

## License

GPL-3.0-or-later（与仓库根目录的 `LICENSE` 一致）。
