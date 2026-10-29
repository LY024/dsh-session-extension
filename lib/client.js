/**
 * dsh-session-extension —— 网页端。
 *
 * 往侧边栏「会话行 ->  ...  」菜单里注入一项「移动到」：点开列出其它工作区，
 * 选中后调用主机侧桥接 /api/dsh-session-extension/move 完成迁移。
 *
 * 形态是 DSH 客户端的 lazy-CJS 包：只注册一个工厂，模块体副作用在首次物化时才跑。
 * 唯一的外部依赖是 react（平台基座模块），因此不需要打包器。
 *
 * 有意只用 <button role="menuitem"> 作为树的节点（不套 div）：菜单的键盘遍历读 DOM，
 * 这样每一项都能正常加入，也不会破坏既有菜单结构。
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-extension',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require('react');

    var STYLE_ID = 'dsh-session-extension-styles';
    var CSS = [
      '.dshsm-item{display:block;width:100%;box-sizing:border-box;text-align:left;font:inherit;font-size:13px;line-height:1.45;padding:6px 10px;border:0;border-radius:6px;background:0 0;color:inherit;cursor:pointer;white-space:normal;overflow-wrap:anywhere}',
      '.dshsm-item:hover:not(:disabled){background:var(--dsw-alias-fill-secondary,rgba(127,127,127,.12))}',
      '.dshsm-item:disabled{color:inherit;opacity:.45;cursor:default}',
      // 菜单行：左边一个 16px 图标列，和官方那些菜单项（置顶/重命名/分叉…）对齐
      '.dshsm-row{display:flex;align-items:center;gap:16px;padding-left:8px}',
      '.dshsm-rowIcon{display:inline-flex;flex:none;color:var(--dsw-alias-label-secondary,currentColor)}',
      '.dshsm-rowIcon svg{display:block}',
      '.dshsm-rowLabel{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshsm-target{padding-left:18px}',
      '.dshsm-meta{display:block;font-size:11px;color:inherit;opacity:.65;overflow-wrap:anywhere}',
      '.dshsm-bad{color:#ff453a}',
      // 拖动时给工作区行加的高亮（官方行本身没有 drop 语义，所以这个类只由本插件加）
      '.dshsm-drop{outline:2px solid #4c8dff;outline-offset:-2px;border-radius:6px}',
      // 「移动」菜单项右侧的箭头 + 悬停子菜单
      '.dshsm-caret{margin-left:auto;flex:none;display:inline-flex;color:var(--dsw-alias-label-secondary,currentColor);opacity:.75}',
      // 菜单项容器：子菜单渲染在它内部（保持指针在官方菜单里），但用 fixed 定位到菜单面板右侧。
      '.dshsm-entry{position:relative;display:flex;min-width:0;width:100%}',
      '.dshsm-entry > .dshsm-item{flex:1;min-width:0}',
      '.dshsm-move-menu{position:fixed;z-index:2147483590;box-sizing:border-box;display:flex;flex-direction:column;gap:2px;width:248px;overflow:auto;padding:6px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1,#fff));color:var(--dsw-alias-label-primary,inherit);box-shadow:0 12px 32px rgba(0,0,0,.22);font-size:13px;pointer-events:auto}',
      '.dshsm-move-item{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;padding:7px 10px;border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:13px;line-height:18px;text-align:left;cursor:pointer}',
      '.dshsm-move-item:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14))}',
      '.dshsm-move-item:disabled{opacity:.55;cursor:default}',
      '.dshsm-move-item-icon{display:inline-flex;flex:none;color:var(--dsw-alias-label-secondary,currentColor)}',
      '.dshsm-move-item-text{min-width:0;display:flex;flex-direction:column;gap:1px}',
      '.dshsm-move-item-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshsm-move-item-path{font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary,inherit);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshsm-move-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l1,rgba(127,127,127,.25))}',
      '.dshsm-move-note{padding:6px 10px;font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary,inherit);overflow-wrap:anywhere}',
      // 多选模式：选中的会话行**底色加深**（不再插勾选圈）+ 底部操作条
      '[role="treeitem"].dshsm-selected{background:rgba(76,141,255,.16)!important;border-radius:6px}',
      '[role="treeitem"].dshsm-selected:hover{background:rgba(76,141,255,.22)!important}',
      '@media (prefers-color-scheme: dark){[role="treeitem"].dshsm-selected{background:rgba(76,141,255,.24)!important}[role="treeitem"].dshsm-selected:hover{background:rgba(76,141,255,.32)!important}}',
      // 多选底栏：注册进宿主槽 sidebar.footer.action，位置/宽度交给宿主排版。
      '.dshsm-bar{display:flex;align-items:center;gap:8px;width:100%;min-width:0;padding:6px 8px;box-sizing:border-box;font-size:13px}',
      '.dshsm-bar-count{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary,inherit)}',
      '.dshsm-bar-btn{flex:0 0 auto;white-space:nowrap;appearance:none;min-height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));background:var(--dsw-alias-fill-elevated,rgba(128,128,128,.08));color:var(--dsw-alias-label-primary,inherit);border-radius:8px;font:inherit;font-size:13px;cursor:pointer}',
      '.dshsm-bar-btn:disabled{opacity:.5;cursor:default}',
      '.dshsm-bar-primary{border-color:#4c8dff;background:#4c8dff;color:#fff}',
      '.dshsm-bar-danger{border-color:rgba(255,69,58,.45);color:var(--dsw-alias-state-error-primary,#ff453a)}',
      '.dshsm-bar-danger:hover:not(:disabled){background:rgba(255,69,58,.12)}',
      '.dshsm-danger{color:var(--dsw-alias-state-error-primary,#ff453a)}',
      // 图标跟着文字一起红（rowIcon 默认是 secondary 色，这里必须覆盖掉）。
      '.dshsm-danger .dshsm-rowIcon,.dshsm-danger .dshsm-rowIcon svg,.dshsm-danger svg{color:inherit;stroke:currentColor}',
      '.dshsm-danger:hover{background:rgba(255,69,58,.1)}',
      // 用户消息操作行里注入的「编辑上次提问」图标 + 自绘气泡（官方 Tooltip 是 React 组件，DOM 注入用不了）
      '.dshsm-user-action{position:relative}',
      '.dshsm-user-action .dshsm-tip{position:absolute;left:50%;top:calc(100% + 6px);transform:translateX(-50%);white-space:nowrap;padding:4px 8px;border-radius:6px;background:rgba(28,32,40,.94);color:#fff;font-size:12px;line-height:16px;box-shadow:0 4px 12px rgba(0,0,0,.25);opacity:0;pointer-events:none;transition:opacity .12s ease;z-index:2147483600}',
      '.dshsm-user-action:hover .dshsm-tip{opacity:1}',
      // 消息内联编辑器（点图标后直接占用原气泡位置，不弹窗）——参照 ChatGPT 的编辑态：
      // 浅灰底（半透明中性灰，浅色/深色主题都能看出"这是一块编辑区"）、无边框、圆角和原气泡一致。
      '.dshsm-inline-editor{display:flex;flex-direction:column;gap:10px;box-sizing:border-box;width:100%;max-width:none;margin:0;padding:14px 16px;border-radius:16px;background:rgba(127,127,127,.16)}',
      // 编辑期间把消息行/气泡容器临时放宽到整行（默认 82% 会把编辑框压窄、看起来像新消息）。
      '.dshsm-editing-row{width:100%!important}',
      '.dshsm-editing-stack{max-width:100%!important;width:100%!important}',
      '@media (prefers-color-scheme: dark){.dshsm-inline-editor{background:rgba(127,127,127,.22)}}',
      '.dshsm-inline-input{box-sizing:border-box;width:100%;min-height:56px;max-height:40vh;resize:none;padding:0;border:0;border-radius:0;background:transparent;color:inherit;font:inherit;font-size:14px;line-height:1.6;outline:none}',
      '.dshsm-inline-input:focus{border:0;outline:none}',
      '.dshsm-inline-actions{display:flex;justify-content:flex-end;gap:8px}',
      '.dshsm-inline-btn{appearance:none;min-height:32px;padding:0 14px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:13px;cursor:pointer}',
      '.dshsm-inline-btn:hover:not(:disabled){background:rgba(127,127,127,.14)}',
      '.dshsm-inline-btn:disabled{opacity:.5;cursor:default}',
      '.dshsm-inline-primary{border-color:transparent;background:var(--dsw-alias-label-primary,#111);color:var(--dsw-alias-bg-base,#fff)}',
      '.dshsm-inline-primary:hover:not(:disabled){background:var(--dsw-alias-label-primary,#111);opacity:.88}',
      // 老宿主（没有那个槽）时的回退：自绘浮动卡片。
      '.dshsm-bar-float{position:fixed;left:12px;bottom:12px;z-index:2147483600;width:auto;gap:10px;padding:10px 12px;border-radius:12px;border:1px solid transparent;box-shadow:0 8px 28px rgba(0,0,0,.28)}',
      '.dshsm-bar-float.dshsm-dark{background:#1f232b;color:#f2f3f5;border-color:rgba(255,255,255,.18);color-scheme:dark}',
      '.dshsm-bar-float.dshsm-light{background:#fff;color:#12151a;border-color:rgba(0,0,0,.14);color-scheme:light}',
      '.dshsm-dark .dshsm-bar-btn:hover:not(:disabled){background:rgba(255,255,255,.08)}',
      '.dshsm-light .dshsm-bar-btn:hover:not(:disabled){background:rgba(0,0,0,.06)}',
      // 多选期间让页脚其他内容让位。只用**正面选择器点名别人**（[data-dsh-plugin] / [class*="_entryRow"]）；
      // 槽位容器是 display: contents，写「> *:not(.我的类)」会连自己一起藏掉（dsh-delete-session 上踩过三轮）。
      'body.dshsm-selecting [class*="_footArea"] > *:not([class*="_footerActions"]){display:none}',
      'body.dshsm-selecting [data-slot="sidebar.footer.action"] > [data-dsh-plugin]{display:none}',
      'body.dshsm-selecting [data-slot="sidebar.footer.action"] > [class*="_entryRow"]{display:none}',
      '.dshsm-picker-backdrop{position:fixed;inset:0;z-index:2147483602;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.42)}',
      '.dshsm-picker{width:min(440px,92vw);max-height:70vh;overflow:auto;display:flex;flex-direction:column;gap:10px;padding:16px;border-radius:14px;border:1px solid transparent;box-shadow:0 18px 48px rgba(0,0,0,.36)}',
      '.dshsm-picker.dshsm-dark{background:#1f232b;color:#f2f3f5;border-color:rgba(255,255,255,.18);color-scheme:dark}',
      '.dshsm-picker.dshsm-light{background:#fff;color:#12151a;border-color:rgba(0,0,0,.14);color-scheme:light}',
      '.dshsm-picker-title{font-size:14px;font-weight:600}',
      '.dshsm-picker-list{display:flex;flex-direction:column;gap:6px}',
      '.dshsm-picker-item{display:flex;flex-direction:column;gap:2px;width:100%;text-align:left;padding:8px 10px;border-radius:8px;border:1px solid transparent;background:0 0;color:inherit;font:inherit;font-size:13px;cursor:pointer}',
      '.dshsm-dark .dshsm-picker-item:hover{background:rgba(255,255,255,.08)}',
      '.dshsm-light .dshsm-picker-item:hover{background:rgba(0,0,0,.06)}',
      '.dshsm-picker-name{font-weight:500;color:inherit}',
      '.dshsm-picker-path{font-size:11px;overflow-wrap:anywhere}',
      '.dshsm-dark .dshsm-picker-path,.dshsm-dark .dshsm-picker-empty{color:#a7b0bf}',
      '.dshsm-light .dshsm-picker-path,.dshsm-light .dshsm-picker-empty{color:#667085}',
      '.dshsm-picker-count{font-size:11px}',
      '.dshsm-dark .dshsm-picker-count{color:#a7b0bf}',
      '.dshsm-light .dshsm-picker-count{color:#667085}',
      '.dshsm-picker-item:disabled{opacity:.55;cursor:default}',
      '.dshsm-picker-empty{font-size:12px}',
      '.dshsm-picker-actions{display:flex;justify-content:flex-end}',
      '.dshsm-picker-btn{appearance:none;min-height:30px;padding:0 12px;border-radius:8px;border:1px solid rgba(127,127,127,.45);background:0 0;color:inherit;font:inherit;font-size:13px;cursor:pointer}',
      '.dshsm-dark .dshsm-picker-btn:hover:not(:disabled){background:rgba(255,255,255,.08)}',
      '.dshsm-light .dshsm-picker-btn:hover:not(:disabled){background:rgba(0,0,0,.06)}',
      '.dshsm-picker-btn:disabled{opacity:.45;cursor:default}',
      '.dshsm-picker-btn-danger{color:#ff453a;border-color:rgba(255,69,58,.45)}',
      '.dshsm-confirm-text{font-size:13px;line-height:20px;white-space:pre-wrap;overflow-wrap:anywhere}',
      // 插件设置页：连同子对话开关
      '.dshsm-setting{display:flex;align-items:flex-start;gap:16px;padding:12px 0;width:100%}',
      '.dshsm-setting-text{flex:1;min-width:0}',
      '.dshsm-setting-title{font-size:13px;font-weight:600;line-height:20px}',
      '.dshsm-setting-desc{font-size:12px;line-height:18px;opacity:.7;margin-top:2px}',
      '.dshsm-seg{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));flex:none}',
      '.dshsm-segBtn{border:0;background:0 0;color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:12px;line-height:18px;padding:3px 8px;border-radius:6px;cursor:pointer;white-space:nowrap}',
      '.dshsm-segBtn[data-on="true"]{background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,inherit)}',
      '.dshsm-switch{position:relative;flex:none;width:38px;height:22px;border-radius:11px;border:0;padding:0;cursor:pointer;background:rgba(127,127,127,.4)}',
      '.dshsm-switch[aria-checked="true"]{background:#4c8dff}',
      '.dshsm-switch::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s ease}',
      '.dshsm-switch[aria-checked="true"]::after{left:18px}',
      '.dshsm-card{display:flex;flex-direction:column;gap:10px;width:100%}',
      '.dshsm-star{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px;padding:8px 10px;border-radius:8px;border:1px solid rgba(0,0,0,.08);background:rgba(255,196,0,.06);color:inherit;text-decoration:none;font-size:12px;line-height:1.4}',
      '.dshsm-star:hover{background:rgba(255,196,0,.14)}',
      '.dshsm-starIcon{font-size:14px;line-height:1}',
      '.dshsm-starCta{margin-left:auto;color:#8a6d00;font-weight:600}',
      '@media (prefers-color-scheme: dark){.dshsm-star{border-color:rgba(255,255,255,.12);background:rgba(255,196,0,.08)}.dshsm-starCta{color:#e8c15a}}',
      // 会话页 composer 里常驻的工作区 chip —— 逐项对齐官方 hero chip 的计算样式
      '.dshsm-dock-slot{display:contents}',
      '.dshsm-dock{display:flex;align-items:center;justify-content:flex-start;gap:8px;width:min(calc(var(--dsh-composer-card-max-width,760px) + 2 * var(--dsh-composer-side-clearance,0px)),100%);align-self:center;padding:0 16px 0 20px;box-sizing:border-box}',
      '.dshsm-chip{border-radius:var(--dsw-radius-sm,8px);max-width:min(100%,360px);min-height:28px;color:var(--dsw-alias-label-primary,inherit);cursor:pointer;background:0 0;border:none;align-items:center;gap:4px;padding:0 8px;font:inherit;font-size:13px;font-weight:500;line-height:20px;display:inline-flex;min-width:0}',
      '.dshsm-chip:not(:disabled):hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
      '.dshsm-chip-icon{color:var(--dsw-alias-label-primary,inherit);flex:none;display:inline-flex}',
      '.dshsm-chip-icon svg{display:block}',
      '.dshsm-chip-label{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}',
      '.dshsm-chip-chevron{color:var(--dsw-alias-label-caption,#a7b0bf);flex:none;display:inline-flex}',
      '.dshsm-chip-chevron svg{display:block}',
      '.dshsm-chip[data-mode="hover"]{opacity:0;transition:opacity .12s ease}',
      '.dshsm-dock:hover .dshsm-chip[data-mode="hover"]{opacity:1}',
      '.dshsm-dock--hidden{justify-content:flex-end}',
      // 皮肤插件（@linxin666/dsh-client-ui-skin-center）把 input.dock 的每个直接子元素都当
      // 「小配件」刷底板：
      //   html[data-dsh-skin] [data-phase="active"] [data-slot="conversation.input.dock"] > * {
      //     background/border/box-shadow/backdrop-filter … !important }
      // 我们这行是**全宽容器**，于是整条被刷成一块玻璃横条。这条复位只针对自己的容器：
      // 必须带 !important，且比特异性（皮肤最高 (0,4,1)，这里 (0,7,1)），
      // 否则平局时后加载的皮肤赢、看起来像没修好。没装皮肤时是空操作。
      'html:root:root:root [data-phase="active"] [data-slot="conversation.input.dock"] > .dshsm-dock.dshsm-dock,',
      'html:root:root:root [data-slot="conversation.input.dock"] > .dshsm-dock.dshsm-dock{',
      'background:none !important;',
      'background-image:none !important;',
      'border:0 !important;',
      'border-radius:0 !important;',
      'box-shadow:none !important;',
      'backdrop-filter:none !important;',
      '-webkit-backdrop-filter:none !important;',
      'margin:0 !important;',
      'padding:0 16px 0 20px !important;',   // 保留自己的内边距（左 20px 对齐 hero 那条）
      '}',
    ].join('');

    function ensureStyles() {
      if (typeof document === 'undefined') return;
      if (document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]') !== null) return;
      var tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-session-extension';
      tag.dataset.pluginCss = STYLE_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    /**
     * 引导全局。0.3.0 起叫 __DSH_SESSION_EXTENSION__；旧名 __DSH_SESSION_RELOCATE__
     * 作为兼容别名保留（dsh-delete-session 读它），更早的 __DSH_SESSION_MOVE__ 也认。
     * 这样「客户端已改名、主机还没重启」时菜单/拖动不会去请求一个主机不服务的前缀。
     */
    function bootGlobal() {
      if (typeof globalThis === 'undefined') return null;
      var names = ['__DSH_SESSION_EXTENSION__', '__DSH_SESSION_RELOCATE__', '__DSH_SESSION_MOVE__'];
      for (var i = 0; i < names.length; i += 1) {
        var value = globalThis[names[i]];
        if (value !== null && value !== undefined) return value;
      }
      return null;
    }

    /** 桥接前缀由主机侧通过引导全局下发；取不到就用默认值。 */
    function bridgePrefix() {
      var boot = bootGlobal();
      if (boot !== null && typeof boot === 'object' && typeof boot.prefix === 'string' && boot.prefix.length > 0) {
        return boot.prefix;
      }
      return '/api/dsh-session-extension';
    }

    function isChinese() {
      var language = globalThis.navigator !== undefined ? globalThis.navigator.language : '';
      return typeof language === 'string' && /^zh/i.test(language);
    }

    var ZH = {
      open: '移动',
      deleteLabel: '删除',
      deleteTitle: '删除会话',
      deleteConfirm: '删除会话「{title}」？\n\n日志会被物理删除，不能恢复；正在运行的会话会先被停止。',
      deleteDone: '已删除 {n} 个会话',
      deleteFailed: '删除失败：',
      bulkDelete: '删除',
      bulkDeleteConfirm: '删除选中的 {n} 个会话？\n\n日志会被物理删除，不能恢复；正在运行的会话会先被停止。',
      bulkDeleting: '正在删除 {d}/{t}…',
      bulkDeleted: '已删除 {n} 个会话',
      bulkDeletePartial: '已删除 {ok} 个，{fail} 个失败',
      loading: '正在读取工作区…',
      pick: '移动到：',
      noTargets: '没有其它工作区',
      chooseDir: '其它目录…',
      chooseDirPrompt: '输入目标目录的绝对路径（不存在会被创建并注册成新工作区）：',
      moving: '正在移动…',
      done: '已移动',
      pending: '文件已搬移；工作区归属会在下次启动 DSH 时自动补齐',
      attached: '已补上「{ws}」的工作区归属',
      cannot: '这个对话无法移动',
      failed: '移动失败',
      needsReload: '（刷新页面后生效）',
      dragMoved: '已移动到「{ws}」',
      dragFailed: '移动失败：',
      bulk: '多选',
      bulkMove: '移动',
      bulkCancel: '取消',
      bulkSelected: '已选 {n} 个',
      bulkPicking: '移动 {n} 个对话到：',
      bulkProgress: '正在移动 {d}/{t}…',
      bulkDone: '已移动 {ok} 个',
      bulkPartial: '已移动 {ok} 个，{fail} 个失败',
      bulkSkipped: '（{n} 个本来就在目标工作区）',
      bulkPlanMove: '将移动 {m} 个',
      bulkPlanSkip: ' · 跳过 {s} 个',
      bulkPlanAllHere: '全部已在这里',
      bulkFailed: '批量移动失败：',
      bulkArchive: '归档',
      bulkArchiving: '正在归档 {d}/{t}…',
      bulkArchived: '已归档 {n} 个会话',
      bulkArchivePartial: '已归档 {ok} 个，{fail} 个失败',
      bulkArchiveUnavailable: '当前宿主没有提供归档接口，无法批量归档',
      bulkHint: '按住 Ctrl 点会话可多选',
      noteReleaseRetries: '（释放重试 {n} 次）',
      noteSampled: '（大会话：抽样校验）',
      childrenSettingTitle: '连同子对话一起移动',
      childrenSettingDesc: '默认开。移动父对话时，它的子智能体会话（侧边栏里隐藏的 subagent 会话）一起搬到目标工作区；关掉后只搬父对话。',
      chipModeTitle: '工作区 chip 什么时候出现',
      chipModeDesc: '「一直出现」常驻在输入框上方；「悬浮才出现」鼠标移到那一行才显示（位置不变，不会跳）；「不出现」完全不渲染，预设胶囊会自动回到右边。',
      chipModeAlways: '一直出现',
      chipModeHover: '悬浮才出现',
      chipModeNever: '不出现',
      starPrompt: '顺手留颗 Star，作者能高兴一整天',
      starCta: '行，给你一颗 Star',
      chipPick: '移动这个对话到：',
      chipMoved: '已移动到「{ws}」',
      chipAria: '当前工作区「{ws}」，点击移动',
      chipUnknown: '未分组',
    };
    var EN = {
      open: 'Move',
      deleteLabel: 'Delete',
      deleteTitle: 'Delete conversation',
      deleteConfirm: 'Delete conversation "{title}"?\n\nThe log is removed from disk permanently; a running conversation is stopped first.',
      deleteDone: 'Deleted {n} conversation(s)',
      deleteFailed: 'Delete failed: ',
      bulkDelete: 'Delete',
      bulkDeleteConfirm: 'Delete the {n} selected conversations?\n\nThe logs are removed from disk permanently; running conversations are stopped first.',
      bulkDeleting: 'Deleting {d}/{t}…',
      bulkDeleted: 'Deleted {n} conversation(s)',
      bulkDeletePartial: 'Deleted {ok}, {fail} failed',
      loading: 'Loading workspaces…',
      pick: 'Move to:',
      noTargets: 'No other workspace',
      chooseDir: 'Other directory…',
      chooseDirPrompt: 'Absolute path of the target directory (it is created and registered as a new workspace if missing):',
      moving: 'Moving…',
      done: 'Moved',
      pending: 'Files moved; the workspace accounting is completed on the next DSH start',
      attached: 'Workspace membership restored for “{ws}”',
      cannot: 'This conversation cannot be moved',
      failed: 'Move failed',
      needsReload: ' (reload the page to apply)',
      dragMoved: 'Moved to “{ws}”',
      dragFailed: 'Move failed: ',
      bulk: 'Select multiple',
      bulkMove: 'Move',
      bulkCancel: 'Cancel',
      bulkSelected: '{n} selected',
      bulkPicking: 'Move {n} conversations to:',
      bulkProgress: 'Moving {d}/{t}…',
      bulkDone: 'Moved {ok}',
      bulkPartial: 'Moved {ok}, {fail} failed',
      bulkSkipped: ' ({n} already there)',
      bulkPlanMove: 'Move {m}',
      bulkPlanSkip: ' · skip {s}',
      bulkPlanAllHere: 'All already here',
      bulkFailed: 'Bulk move failed: ',
      bulkArchive: 'Archive',
      bulkArchiving: 'Archiving {d}/{t}…',
      bulkArchived: 'Archived {n} conversations',
      bulkArchivePartial: 'Archived {ok}, {fail} failed',
      bulkArchiveUnavailable: 'This host exposes no archive API, so bulk archive is unavailable',
      bulkHint: 'Hold Ctrl and click conversations to multi-select',
      noteReleaseRetries: ' (release retried {n}×)',
      noteSampled: ' (large session: sampled verify)',
      childrenSettingTitle: 'Move child conversations too',
      childrenSettingDesc: 'On by default. Moving a conversation also moves its hidden subagent sessions to the target workspace; turn it off to move only the parent conversation.',
      chipModeTitle: 'When to show the workspace chip',
      chipModeDesc: '"Always" keeps it above the composer; "On hover" reveals it when the pointer enters that row (no layout shift); "Never" hides it and the preset chip moves back to the right.',
      chipModeAlways: 'Always',
      chipModeHover: 'On hover',
      chipModeNever: 'Never',
      starPrompt: 'Leave a star — it makes the author’s day',
      starCta: 'Give a star',
      chipPick: 'Move this conversation to:',
      chipMoved: 'Moved to “{ws}”',
      chipAria: 'Workspace “{ws}” — click to move',
      chipUnknown: 'Ungrouped',
    };

    function text() {
      return isChinese() ? ZH : EN;
    }

    /** 「连同子对话」开关：插件设置页里改，存 localStorage，默认开。 */
    var CHILDREN_KEY = 'dsh-session-extension.includeChildren';
    var LEGACY_CHILDREN_KEY = 'dsh-session-relocate.includeChildren';

    function wantChildren() {
      try {
        if (typeof localStorage !== 'undefined' && localStorage !== null) {
          var stored = localStorage.getItem(CHILDREN_KEY);
          // 兼容改名前的用户设置。
          if (stored === null) stored = localStorage.getItem(LEGACY_CHILDREN_KEY);
          return stored !== 'false';
        }
      } catch (error) { /* 隐私模式读不了就按默认 */ }
      return true;
    }

    function setWantChildren(value) {
      try {
        if (typeof localStorage !== 'undefined' && localStorage !== null) {
          localStorage.setItem(CHILDREN_KEY, value ? 'true' : 'false');
        }
      } catch (error) { /* 写不进去就算了，下次还是默认开 */ }
    }

    // ── 工作区 chip 的出现方式：一直出现 / 悬浮才出现 / 不出现 ────────────────
    var CHIP_MODE_KEY = 'dsh-session-extension.chipMode';
    var LEGACY_CHIP_MODE_KEY = 'dsh-session-relocate.chipMode';
    var CHIP_MODES = ['always', 'hover', 'never'];
    var chipModeListeners = [];

    function chipMode() {
      var stored = null;
      try {
        if (typeof localStorage !== 'undefined' && localStorage !== null) {
          stored = localStorage.getItem(CHIP_MODE_KEY);
          // 兼容改名前的用户设置。
          if (CHIP_MODES.indexOf(stored) < 0) stored = localStorage.getItem(LEGACY_CHIP_MODE_KEY);
        }
      } catch (error) { /* 读不到就按默认 */ }
      return CHIP_MODES.indexOf(stored) >= 0 ? stored : 'always';
    }

    function setChipMode(mode) {
      var next = CHIP_MODES.indexOf(mode) >= 0 ? mode : 'always';
      try {
        if (typeof localStorage !== 'undefined' && localStorage !== null) localStorage.setItem(CHIP_MODE_KEY, next);
      } catch (error) { /* 存不了就只在内存里生效 */ }
      for (var i = 0; i < chipModeListeners.length; i += 1) {
        try { chipModeListeners[i](next); } catch (error) { /* 单个订阅者出错不影响别人 */ }
      }
      return next;
    }

    function subscribeChipMode(listener) {
      chipModeListeners.push(listener);
      return function () {
        var at = chipModeListeners.indexOf(listener);
        if (at >= 0) chipModeListeners.splice(at, 1);
      };
    }

    /** 插件设置页里的「连同子对话」开关（行配置页与包配置页共用）。 */
    function ChildrenSetting() {
      var strings = text();
      var state = react.useState(wantChildren() ? 'on' : 'off');
      var on = state[0] === 'on';
      function toggle() {
        var next = on !== true;
        state[1](next ? 'on' : 'off');
        setWantChildren(next);
      }
      return react.createElement('div', { className: 'dshsm-card' }, [
        react.createElement('div', { className: 'dshsm-setting', key: 'setting' }, [
          react.createElement('div', { className: 'dshsm-setting-text', key: 'text' }, [
            react.createElement('div', { className: 'dshsm-setting-title', key: 'title' }, strings.childrenSettingTitle),
            react.createElement('div', { className: 'dshsm-setting-desc', key: 'desc' }, strings.childrenSettingDesc),
          ]),
          react.createElement('button', {
            key: 'switch',
            type: 'button',
            role: 'switch',
            'aria-checked': on === true ? 'true' : 'false',
            className: 'dshsm-switch',
            onClick: toggle,
          }),
        ]),
        react.createElement('a', {
          key: 'star',
          className: 'dshsm-star',
          href: 'https://github.com/LY024/dsh-session-extension',
          target: '_blank',
          rel: 'noopener noreferrer',
        }, [
          react.createElement('span', { className: 'dshsm-starIcon', key: 'icon' }, '⭐'),
          react.createElement('span', { key: 'prompt' }, strings.starPrompt),
          react.createElement('span', { className: 'dshsm-starCta', key: 'cta' }, strings.starCta),
        ]),
      ]);
    }

    function post(path, body) {
      var options = {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body !== undefined ? body : {}),
        // 桥接只认同源；显式带上 same-origin 让浏览器在跨源时直接拒绝发送。
        credentials: 'same-origin',
        cache: 'no-store',
      };
      return fetch(bridgePrefix() + path, options).then(function (response) {
        return response.json().then(function (payload) { return payload; }, function () {
          return { ok: false, code: 'bad-response', message: 'HTTP ' + String(response.status) };
        });
      });
    }

    function errorText(error) {
      if (error !== null && typeof error === 'object' && typeof error.message === 'string' && error.message.length > 0) {
        return error.message;
      }
      return String(error);
    }

    /**
     * 把回执里值得说一句的信息拼成后缀：释放重试了几次、大会话是不是只做了抽样校验。
     * 没有要说的就返回空串。
     */
    function receiptNotes(result) {
      if (result === null || typeof result !== 'object') return '';
      var strings = text();
      var notes = [];
      if (Number.isSafeInteger(result.releaseAttempts) && result.releaseAttempts > 1) {
        notes.push(strings.noteReleaseRetries.replace('{n}', String(result.releaseAttempts)));
      }
      if (result.verification === 'sampled') notes.push(strings.noteSampled);
      return notes.length === 0 ? '' : notes.join('');
    }

    /** 官方 IconFolderOpenRegular（16px）的原始路径，菜单行图标复用。 */
    var FOLDER_OPEN_PATH = 'M1.50439 3.11059C1.50439 2.55831 1.95211 2.1106 2.50439 2.1106H5.43389C5.67773 2.1106 5.91318 2.19969 6.09593 2.36113L7.71649 3.79265C7.89924 3.95409 8.1347 4.04319 8.3785 4.04319H13.4958C14.0481 4.04319 14.4958 4.4909 14.4958 5.04319V12.8894C14.4958 13.4417 14.0481 13.8894 13.4958 13.8894H2.50439C1.95211 13.8894 1.50439 13.4417 1.50439 12.8894V4.04319V3.11059Z';

    /** 菜单行左边的图标（尺寸/颜色对齐官方菜单行的图标列）。 */
    function rowIcon() {
      return react.createElement('span', { className: 'dshsm-rowIcon', key: 'icon' }, react.createElement('svg', {
        width: 16,
        height: 16,
        viewBox: '0 0 16 16',
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
        'aria-hidden': 'true',
        strokeWidth: 1,
      }, [
        react.createElement('path', { key: 'a', d: FOLDER_OPEN_PATH, stroke: 'currentColor' }),
        react.createElement('path', { key: 'b', d: 'M3.63501 7.66614H12.3647', stroke: 'currentColor' }),
      ]));
    }

    /** 渲染一个菜单按钮。 */
    function button(key, label, options) {
      var props = Object.assign({ key: key, type: 'button', role: 'menuitem', className: 'dshsm-item' }, options || {});
      return react.createElement('button', props, label);
    }

    /** 带标题 + 灰色副标题的两行按钮内容。 */
    function twoLine(title, meta) {
      return [title, react.createElement('span', { key: 'meta', className: 'dshsm-meta' }, meta)];
    }

    /**
     * 让「移动到」这一行和官方菜单项像素对齐：菜单里同时有官方项时，直接量它们的
     * 图标左边缘、标签左边缘，反推我们这行的 padding-left 和图标-标签间距。
     * 量不到（菜单里只有我们一条）就保留 CSS 里的 8px / 16px 兜底。
     */
    function alignRowToSiblings(node) {
      if (node === null || node === undefined || typeof node.closest !== 'function') return;
      var menu = null;
      try { menu = node.closest('[role="menu"]'); } catch (error) { menu = null; }
      if (menu === null || menu === undefined) menu = node.parentElement;
      if (menu === null || menu === undefined || typeof menu.querySelectorAll !== 'function') return;
      var rows = menu.querySelectorAll('[role="menuitem"]');
      var iconLeft = null;
      var labelLeft = null;
      for (var i = 0; i < rows.length; i += 1) {
        var row = rows[i];
        if (row === node || typeof row.querySelector !== 'function') continue;
        var svg = row.querySelector('svg');
        if (svg === null || svg === undefined || typeof svg.getBoundingClientRect !== 'function') continue;
        var labelRect = null;
        try {
          // 只量第一个非空文本节点（官方行的标签），不能用 selectNodeContents(row)——
          // 那是整行内容的包围盒，左边缘等于图标，算出来的间距会是 0。
          var textNode = null;
          if (typeof document.createTreeWalker === 'function') {
            var walker = document.createTreeWalker(row, 4);
            while (walker.nextNode()) {
              var content = walker.currentNode.textContent;
              if (typeof content === 'string' && content.trim().length > 0) { textNode = walker.currentNode; break; }
            }
          }
          if (textNode !== null) {
            var range = document.createRange();
            range.selectNodeContents(textNode);
            labelRect = range.getBoundingClientRect();
          }
        } catch (error) { labelRect = null; }
        if (labelRect === null || labelRect.width <= 0) continue;
        iconLeft = svg.getBoundingClientRect().left;
        labelLeft = labelRect.left;
        break;
      }
      if (iconLeft === null || labelLeft === null) return;
      var rowRect = node.getBoundingClientRect();
      var paddingLeft = Math.round(iconLeft - rowRect.left);
      var gap = Math.round(labelLeft - iconLeft - 16);
      // 量歪了就保留 CSS 兜底（8px / 16px），别把行弄坏。
      if (paddingLeft >= 0 && paddingLeft <= 40) node.style.paddingLeft = paddingLeft + 'px';
      if (gap >= 0 && gap <= 60) node.style.columnGap = gap + 'px';
    }

    // ── 「移动」右侧子菜单 ──────────────────────────────────────────────────
    //
    // 会话行菜单里的「移动」不再点开后在菜单里铺一屏，而是**鼠标悬停时在右侧展开子菜单**
    // （和常见桌面应用的二级菜单一致）。子菜单画在 shell.overlay 上，按触发元素的位置
    // 现算坐标，所以不会被菜单容器的 overflow / transform 裁掉。
    var moveMenu = {
      open: false,
      sessionId: null,
      anchor: null,
      phase: 'loading',
      targets: [],
      error: '',
      closeMenu: null,
      listeners: new Set(),
      hideTimer: null,
    };

    function emitMoveMenu() {
      moveMenu.listeners.forEach(function (listener) {
        try { listener(); } catch (error) { /* ignore */ }
      });
    }

    function useMoveMenuTick() {
      var state = react.useState(0);
      var useEffect = typeof react.useEffect === 'function' ? react.useEffect : function () {};
      useEffect(function () {
        var listener = function () { state[1](function (n) { return n + 1; }); };
        moveMenu.listeners.add(listener);
        return function () { moveMenu.listeners.delete(listener); };
      }, []);
      return state[0];
    }

    function cancelMoveMenuHide() {
      if (moveMenu.hideTimer !== null) {
        clearTimeout(moveMenu.hideTimer);
        moveMenu.hideTimer = null;
      }
    }

    function closeMoveMenu() {
      cancelMoveMenuHide();
      if (moveMenu.open !== true) return;
      moveMenu = Object.assign({}, moveMenu, {
        open: false,
        sessionId: null,
        pos: null,
        phase: 'loading',
        targets: [],
        error: '',
        closeMenu: null,
      });
      emitMoveMenu();
    }

    function scheduleMoveMenuHide() {
      cancelMoveMenuHide();
      if (moveMenu.open !== true) return;
      moveMenu.hideTimer = setTimeout(function () {
        moveMenu.hideTimer = null;
        closeMoveMenu();
      }, 180);
    }

    /**
     * 算出子菜单该贴在哪：
     *   - 横向贴住「…」菜单面板的**右侧**（右边放不下就翻到左侧）；
     *   - 纵向从「移动」这一行开始，向下延伸到 Harness 窗口底部。
     * 若菜单祖先里有 transform/filter（会把 fixed 的包含块变成它），坐标换算成相对它，
     * 并把这个祖先记下来，打开期间放开它的 overflow，避免子菜单被裁掉。
     */
    function computeMovePanelGeometry(rowNode) {
      var fallback = { left: 12, top: 64, maxHeight: 420, container: null };
      if (typeof document === 'undefined' || rowNode === null || rowNode === undefined) return fallback;
      if (typeof rowNode.getBoundingClientRect !== 'function') return fallback;
      var menuNode = typeof rowNode.closest === 'function' ? rowNode.closest('[role="menu"]') : null;
      var rowRect;
      var menuRect = null;
      try {
        rowRect = rowNode.getBoundingClientRect();
        menuRect = menuNode !== null && menuNode !== undefined && typeof menuNode.getBoundingClientRect === 'function'
          ? menuNode.getBoundingClientRect()
          : null;
      } catch (error) {
        return fallback;
      }
      var anchor = menuRect !== null ? menuRect : rowRect;
      var width = 248;
      var viewportWidth = typeof globalThis.innerWidth === 'number' ? globalThis.innerWidth : anchor.right + width + 32;
      var viewportHeight = typeof globalThis.innerHeight === 'number' ? globalThis.innerHeight : anchor.top + 320;
      var left = anchor.right + 4;
      if (left + width > viewportWidth - 8) left = Math.max(8, anchor.left - width - 4);
      var rowTop = Math.max(8, rowRect.top);
      var rowBottom = Math.min(viewportHeight - 8, rowRect.bottom > rowRect.top ? rowRect.bottom : rowRect.top + 28);
      var availableDown = viewportHeight - rowTop - 12;
      // 默认向下展开（顶边对齐「移动」行）；底部空间不够时改为**向上展开**：
      // 底边对齐「移动」行的底边，高度往上长。两种情况子菜单都覆盖这一行的 y 范围，
      // 鼠标在同一行上水平移过去就能进子菜单，不会出现够不着的竖直空隙。
      var mode = availableDown < 220 ? 'up' : 'down';
      var maxHeight = mode === 'up' ? Math.max(160, rowBottom - 8) : Math.max(160, availableDown);
      var top = rowTop;
      var bottom = Math.max(8, viewportHeight - rowBottom);
      // fixed 的包含块：最近的有 transform / filter / perspective 的祖先。
      var container = null;
      var node = menuNode !== null && menuNode !== undefined ? menuNode : rowNode;
      var stop = document.body;
      var depth = 0;
      while (node !== null && node !== undefined && node !== stop && depth < 32) {
        depth += 1;
        if (typeof globalThis.getComputedStyle === 'function') {
          try {
            var style = globalThis.getComputedStyle(node);
            if (style !== null && style !== undefined
              && ((typeof style.transform === 'string' && style.transform !== 'none')
                || (typeof style.filter === 'string' && style.filter !== 'none')
                || (typeof style.perspective === 'string' && style.perspective !== 'none'))) {
              container = node;
              break;
            }
          } catch (error) { /* 读不到就继续往上找 */ }
        }
        node = node.parentElement;
      }
      if (container !== null) {
        try {
          var box = container.getBoundingClientRect();
          left -= box.left;
          top -= box.top;
          bottom = Math.max(0, box.bottom - rowBottom);
        } catch (error) { /* ignore */ }
      }
      return { left: left, top: top, bottom: bottom, mode: mode, maxHeight: maxHeight, container: container };
    }

    /** 打开「移动」子菜单：先占位「正在读取工作区…」，再拉 /describe。 */
    function openMoveMenu(sessionId, geometry, closeMenu) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return;
      cancelMoveMenuHide();
      moveMenu = Object.assign({}, moveMenu, {
        open: true,
        sessionId: sessionId,
        pos: geometry !== null && typeof geometry === 'object'
          ? geometry
          : { left: 12, top: 64, maxHeight: 420, container: null },
        phase: 'loading',
        targets: [],
        error: '',
        closeMenu: typeof closeMenu === 'function' ? closeMenu : null,
      });
      emitMoveMenu();
      post('/describe', { sessionId: sessionId }).then(function (result) {
        if (moveMenu.open !== true || moveMenu.sessionId !== sessionId) return;
        if (result === null || typeof result !== 'object' || result.ok !== true) {
          setMoveMenu({ phase: 'error', error: result !== null && typeof result === 'object' && typeof result.message === 'string' ? result.message : text().failed });
          return;
        }
        var session = result.session !== null && typeof result.session === 'object' ? result.session : {};
        if (session.canMove !== true) {
          setMoveMenu({ phase: 'blocked', error: typeof session.reason === 'string' && session.reason.length > 0 ? session.reason : text().cannot });
          return;
        }
        var all = Array.isArray(result.workspaces) ? result.workspaces : [];
        var targets = all.filter(function (workspace) {
          return workspace !== null && typeof workspace === 'object' && workspace.current !== true;
        });
        setMoveMenu({ phase: 'ready', targets: targets });
      }, function (error) {
        if (moveMenu.open !== true) return;
        setMoveMenu({ phase: 'error', error: errorText(error) });
      });
    }

    function setMoveMenu(patch) {
      moveMenu = Object.assign({}, moveMenu, patch);
      emitMoveMenu();
    }

    /** 从子菜单里执行一次移动；成功后收起子菜单与菜单。 */
    function runMoveFromMenu(body) {
      if (moveMenu.open !== true || typeof moveMenu.sessionId !== 'string') return;
      var sessionId = moveMenu.sessionId;
      var closeMenu = moveMenu.closeMenu;
      var strings = text();
      setMoveMenu({ phase: 'moving', error: '' });
      post('/move', Object.assign({ sessionId: sessionId }, body)).then(function (result) {
        if (result === null || typeof result !== 'object' || result.ok !== true) {
          if (moveMenu.open !== true) return;
          setMoveMenu({ phase: 'ready', error: result !== null && typeof result === 'object' && typeof result.message === 'string' ? result.message : strings.failed });
          return;
        }
        var title = typeof result.targetTitle === 'string' ? result.targetTitle : (typeof result.to === 'string' ? result.to : '');
        var summary = result.applied === 'attached' ? strings.attached.replace('{ws}', title) : strings.done + ' ' + title;
        summary += receiptNotes(result);
        toast(summary);
        closeMoveMenu();
        if (typeof closeMenu === 'function') {
          try { closeMenu(false); } catch (error) { /* ignore */ }
        }
        refreshSidebar();
      }, function (error) {
        if (moveMenu.open !== true) return;
        setMoveMenu({ phase: 'ready', error: errorText(error) });
      });
    }

    function chooseMoveDirectory() {
      var strings = text();
      var picked = globalThis.prompt(strings.chooseDirPrompt, '');
      if (typeof picked !== 'string' || picked.trim().length === 0) return;
      runMoveFromMenu({ targetPath: picked.trim() });
    }

    /**
     * 子菜单面板本身（纯渲染）。它由菜单项在自己的 DOM 里渲染 —— 这样指针移进来时
     * 仍然停留在官方菜单的子树里，菜单不会因为「指针离开」而自己关掉；
     * 位置由 CSS 贴在菜单项右侧（`.dshsm-entry` + `left:100%`），纵向顶端对齐。
     */
    function renderMoveMenuPanel() {
      var state = moveMenu;
      if (state.open !== true) return null;

      var strings = text();

      var rows = [];
      if (state.phase === 'loading') {
        rows.push(react.createElement('div', { className: 'dshsm-move-note', key: 'loading' }, strings.loading));
      } else if (state.phase === 'blocked' || state.phase === 'error') {
        rows.push(react.createElement('div', { className: 'dshsm-move-note dshsm-bad', key: 'blocked' }, state.error));
      } else {
        for (var i = 0; i < state.targets.length; i += 1) {
          (function (workspace) {
            rows.push(react.createElement('button', {
              key: 'ws-' + String(workspace.id),
              type: 'button',
              role: 'menuitem',
              className: 'dshsm-move-item',
              disabled: state.phase === 'moving',
              onClick: function () { runMoveFromMenu({ targetWorkspaceId: workspace.id }); },
            }, [
              react.createElement('span', { key: 'icon', className: 'dshsm-move-item-icon' }, rowIcon()),
              react.createElement('span', { key: 'text', className: 'dshsm-move-item-text' }, [
                react.createElement('span', { key: 'name', className: 'dshsm-move-item-name' }, workspace.title),
                typeof workspace.path === 'string' && workspace.path.length > 0
                  ? react.createElement('span', { key: 'path', className: 'dshsm-move-item-path' }, workspace.path)
                  : null,
              ]),
            ]));
          })(state.targets[i]);
        }
        if (state.targets.length === 0) {
          rows.push(react.createElement('div', { className: 'dshsm-move-note', key: 'empty' }, strings.noTargets));
        }
        rows.push(react.createElement('div', { className: 'dshsm-move-sep', key: 'sep' }));
        rows.push(react.createElement('button', {
          key: 'choose-dir',
          type: 'button',
          role: 'menuitem',
          className: 'dshsm-move-item',
          disabled: state.phase === 'moving',
          onClick: chooseMoveDirectory,
        }, [
          react.createElement('span', { key: 'icon', className: 'dshsm-move-item-icon' }, rowIcon()),
          react.createElement('span', { key: 'text', className: 'dshsm-move-item-text' }, [
            react.createElement('span', { key: 'name', className: 'dshsm-move-item-name' }, strings.chooseDir),
          ]),
        ]));
        if (state.phase === 'moving') {
          rows.push(react.createElement('div', { className: 'dshsm-move-note', key: 'moving' }, strings.moving));
        } else if (typeof state.error === 'string' && state.error.length > 0) {
          rows.push(react.createElement('div', { className: 'dshsm-move-note dshsm-bad', key: 'error' }, state.error));
        }
      }

      var pos = state.pos !== null && typeof state.pos === 'object'
        ? state.pos
        : { left: 12, top: 64, bottom: 0, mode: 'down', maxHeight: 420 };
      var panelStyle = {
        left: (typeof pos.left === 'number' ? pos.left : 12) + 'px',
        maxHeight: (typeof pos.maxHeight === 'number' ? pos.maxHeight : 420) + 'px',
      };
      // 底部空间不够时用 bottom 定位：底边钉在「移动」行底边，高度往上长，
      // 这样鼠标停在这一行上水平移过去就能进子菜单。
      if (pos.mode === 'up' && typeof pos.bottom === 'number') panelStyle.bottom = pos.bottom + 'px';
      else panelStyle.top = (typeof pos.top === 'number' ? pos.top : 64) + 'px';
      return react.createElement('div', {
        className: 'dshsm-move-menu',
        role: 'menu',
        style: panelStyle,
        onMouseEnter: cancelMoveMenuHide,
      }, rows);
    }

    /**
     * 会话行菜单项。
     * props: sessionId / displayTitle / useMenuOpenState（由 slot 提供）。
     */
    function Entry(props) {
      var sessionId = props.sessionId;
      var useMenuOpenState = props.useMenuOpenState;

      // 必须在顶层无条件调用（hooks 规则）。
      var menuState = null;
      if (typeof useMenuOpenState === 'function') {
        try {
          menuState = useMenuOpenState();
        } catch (error) {
          menuState = null;
        }
      }
      var setMenuOpen = menuState !== null && Array.isArray(menuState) && typeof menuState[1] === 'function' ? menuState[1] : null;

      var strings = text();
      var useRef = typeof react.useRef === 'function' ? react.useRef : function () { return { current: null }; };
      var useEffect = typeof react.useEffect === 'function' ? react.useEffect : function () {};
      var rowRef = useRef(null);
      var buttonRef = useRef(null);
      // 让面板跟着 moveMenu 状态重渲染；同时把子菜单渲染在**本菜单项内部**。
      useMoveMenuTick();
      var isMine = moveMenu.open === true && moveMenu.sessionId === sessionId;

      useEffect(function () {
        alignRowToSiblings(buttonRef.current);
      }, []);

      // 打开期间：点别处 / Esc / 窗口变化 收起。判断用行容器（button + 子菜单都在里面），
      // 所以指针/点击落在子菜单上不会被当成「别处」。
      useEffect(function () {
        if (!isMine) return undefined;
        // 若 fixed 的包含块是某个 transform 祖先，子菜单可能被它裁掉：打开期间放开它的 overflow。
        var relaxed = null;
        var container = moveMenu.pos !== null && typeof moveMenu.pos === 'object' && moveMenu.pos.container !== undefined
          ? moveMenu.pos.container
          : null;
        if (container !== null && container !== undefined && container.style !== undefined) {
          var computed = typeof globalThis.getComputedStyle === 'function' ? globalThis.getComputedStyle(container) : null;
          if (computed !== null && (computed.overflow !== 'visible' || computed.overflowY !== 'visible')) {
            relaxed = { root: container, overflow: container.style.overflow };
            container.style.overflow = 'visible';
          }
        }
        function onDown(event) {
          var target = event !== null && event !== undefined ? event.target : null;
          var node = rowRef.current;
          if (node !== null && target !== null && typeof node.contains === 'function' && node.contains(target)) return;
          closeMoveMenu();
        }
        function onKey(event) {
          if (event !== null && event.key === 'Escape') closeMoveMenu();
        }
        function onViewportChange() { closeMoveMenu(); }
        document.addEventListener('mousedown', onDown, true);
        document.addEventListener('keydown', onKey, true);
        if (typeof globalThis.addEventListener === 'function') {
          globalThis.addEventListener('resize', onViewportChange);
        }
        return function () {
          document.removeEventListener('mousedown', onDown, true);
          document.removeEventListener('keydown', onKey, true);
          if (typeof globalThis.removeEventListener === 'function') {
            globalThis.removeEventListener('resize', onViewportChange);
          }
          if (relaxed !== null) relaxed.root.style.overflow = relaxed.overflow;
        };
      }, [isMine]);

      function open() {
        // 已经在为这条会话显示子菜单了：只取消收起计时，不重复拉 describe。
        if (moveMenu.open === true && moveMenu.sessionId === sessionId) {
          cancelMoveMenuHide();
          return;
        }
        openMoveMenu(sessionId, computeMovePanelGeometry(rowRef.current), setMenuOpen);
      }

      if (typeof sessionId !== 'string' || sessionId.length === 0) return null;

      return react.createElement('div', {
        className: 'dshsm-entry',
        ref: rowRef,
        onMouseEnter: open,
        onMouseLeave: scheduleMoveMenuHide,
      }, [
        button('open', [
          rowIcon(),
          react.createElement('span', { className: 'dshsm-rowLabel', key: 'label' }, strings.open),
          react.createElement('span', { className: 'dshsm-caret', key: 'caret', 'aria-hidden': 'true' }, '\u203A'),
        ], {
          className: 'dshsm-item dshsm-row',
          ref: buttonRef,
          onFocus: open,
          onClick: open,
        }),
        isMine ? renderMoveMenuPanel() : null,
      ]);
    }

    /** 垃圾桶图标（菜单行 16px 列）。 */
    function trashIcon() {
      return react.createElement('span', { className: 'dshsm-rowIcon', key: 'icon' }, react.createElement('svg', {
        width: 16,
        height: 16,
        viewBox: '0 0 16 16',
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
        'aria-hidden': 'true',
        strokeWidth: 1,
      }, [
        react.createElement('path', { key: 'a', d: 'M2.8 4.3h10.4M6 4.3V3.2c0-.4.3-.7.7-.7h2.6c.4 0 .7.3.7.7v1.1M4.1 4.3l.6 8.1c0 .5.4.8.9.8h4.8c.5 0 .9-.3.9-.8l.6-8.1', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' }),
        react.createElement('path', { key: 'b', d: 'M6.7 6.9v4.2M9.3 6.9v4.2', stroke: 'currentColor', strokeLinecap: 'round' }),
      ]));
    }

    /** 会话行菜单里的「删除」：二次确认后物理删除会话（含子代理会话，跟随设置）。 */
    function DeleteEntry(props) {
      var strings = text();
      var sessionId = props !== null && props !== undefined && typeof props.sessionId === 'string' ? props.sessionId : undefined;
      var displayTitle = props !== null && props !== undefined && typeof props.displayTitle === 'string' && props.displayTitle.length > 0
        ? props.displayTitle
        : (typeof sessionId === 'string' ? sessionId.slice(0, 8) : 'session');
      var useMenuOpenState = props !== null && props !== undefined ? props.useMenuOpenState : null;
      var menuState = null;
      if (typeof useMenuOpenState === 'function') {
        try { menuState = useMenuOpenState(); } catch (error) { menuState = null; }
      }
      // 和「移动」一样：挂载后量一下同菜单里官方条目的图标/文字位置，把自己的
      // 左内边距和图标-文字间距对齐过去（否则删除项会比别人右移几个像素）。
      var useRef = typeof react.useRef === 'function' ? react.useRef : function () { return { current: null }; };
      var useEffect = typeof react.useEffect === 'function' ? react.useEffect : function () {};
      var buttonRef = useRef(null);
      useEffect(function () {
        alignRowToSiblings(buttonRef.current);
      }, []);
      if (typeof sessionId !== 'string' || sessionId.length === 0) return null;

      function remove() {
        confirmDanger(strings.deleteConfirm.replace('{title}', displayTitle)).then(function (confirmed) {
          if (confirmed !== true) return;
          if (menuState !== null && Array.isArray(menuState) && typeof menuState[1] === 'function') {
            try { menuState[1](false); } catch (error) { /* ignore */ }
          }
          post('/delete', { sessionId: sessionId, includeChildren: wantChildren() }).then(function (result) {
            if (result !== null && typeof result === 'object' && result.ok === true && result.deleted > 0) {
              toast(strings.deleteDone.replace('{n}', String(result.deleted)));
            } else {
              var detail = result !== null && typeof result === 'object' && Array.isArray(result.results) && result.results[0] !== undefined
                ? String(result.results[0].message || '')
                : '';
              toast(strings.deleteFailed + (detail.length > 0 ? detail : strings.failed));
            }
            refreshSidebar();
          }, function (error) {
            toast(strings.deleteFailed + errorText(error));
          });
        });
      }

      // 和「移动」用同一个外层容器：菜单项的内边距/图标列才会跟官方条目对齐。
      return react.createElement('div', { className: 'dshsm-entry' }, [
        button('delete', [
          trashIcon(),
          react.createElement('span', { className: 'dshsm-rowLabel', key: 'label' }, strings.deleteLabel),
        ], { className: 'dshsm-item dshsm-row dshsm-danger', ref: buttonRef, onClick: remove }),
      ]);
    }

    // ── 拖动搬移 ────────────────────────────────────────────────────────────
    //
    // 官方侧边栏给每一行都写了稳定的 data-row-key（client-ui-workspace）：
    //   会话行   data-row-key="session:<sessionId>"      (client.js:2250)
    //   工作区行 data-row-key="workspace:<workspaceId>"  (client.js:1945，key 就是 workspaceId)
    // 所以这里**不依赖任何未公开的拖拽载荷**（dataTransfer 在 dragover 阶段本来就取不到
    // 数据），只读这两个属性。
    //
    // 官方自己的拖动只做排序：会话拖到别的会话行上 = 在**本工作区**内重排
    // （commitSessionDrag → setSessionOrder(accountKey, …)，accountKey 就是源工作区），
    // 拖到工作区行上官方什么都不做。跨工作区搬移是官方没有的语义，所以由本插件接管。
    //
    // 关键：按**分组归属**决定介不介入，而不是按「指针下那一行是不是文件夹行」。
    // 官方每个工作区渲染成一个分组容器（renderGroup → div.groupSection：先文件夹行、再它的会话行），
    // 于是：
    //   - 指针在**别的**分组里（文件夹行 / 它的任意一条会话行 / 分组里的空隙）→ 接管，搬过去；
    //   - 指针在**它自己所在**的那个分组里 → 完全让路，官方的工作区内排序照旧。
    // 这样「拖到对应工作区那块区域就能换」成立，官方的组内重排一点也没被抢。
    var ROW_KEY_ATTR = 'data-row-key';
    var SESSION_PREFIX = 'session:';
    var WORKSPACE_PREFIX = 'workspace:';
    var DROP_CLASS = 'dshsm-drop';
    var TOAST_ATTR = 'data-dshsm-toast';
    var ROW_WALK_LIMIT = 8;

    var dragState = {
      sessionId: null,
      sessionIds: null,
      sourceWorkspaceId: null,
      targetSection: null,
      hostSelected: false,
    };
    var dragInstallRefs = 0;
    var toastNode = null;
    var toastTimer = null;

    /** 从事件目标向上找最近的 data-row-key 元素（会话行 / 工作区行都不是彼此的祖先）。 */
    function nearestRow(target) {
      var node = target;
      for (var depth = 0; depth < ROW_WALK_LIMIT && node !== null && node !== undefined; depth += 1) {
        if (typeof node.getAttribute === 'function') {
          var key = node.getAttribute(ROW_KEY_ATTR);
          if (typeof key === 'string' && key.length > 0) return node;
        }
        node = node.parentElement;
      }
      return null;
    }

    var WORKSPACE_ROW_SELECTOR = '[' + ROW_KEY_ATTR + '^="' + WORKSPACE_PREFIX + '"]';

    /**
     * 指针下这个位置属于哪个工作区分组 —— **整块分组区域都算投放目标**，不再只认那 34px 的文件夹行。
     *
     * 官方侧边栏把每个工作区渲染成一个分组容器（renderGroup → div.groupSection：先放工作区行，
     * 再放它自己的会话行）。所以「最近的、恰好只含一个工作区行的祖先」就是这个分组：
     *   - 指针落在文件夹行上 → 就是它自己那一层；
     *   - 指针落在它下面任意一条会话行上（或「展开其余 N 个会话」上、或分组里的空隙上）→ 向上走到同一个容器；
     *   - 再往上整棵 role="tree" 列表含多个工作区行，说明指针不在任何分组里 → null。
     *
     * 拿不到分组（老版本 DSH / 结构变了）就返回 null，自动退化成「只认工作区行」的老行为。
     */
    function workspaceGroupOf(target) {
      var node = target;
      var best = null;
      for (var depth = 0; depth < ROW_WALK_LIMIT && node !== null && node !== undefined; depth += 1) {
        // 列表根（role="tree"）之上就再没有分组了，别把整棵列表当成分组。
        if (typeof node.getAttribute === 'function' && node.getAttribute('role') === 'tree') break;
        if (typeof node.querySelectorAll === 'function') {
          var rows = node.querySelectorAll(WORKSPACE_ROW_SELECTOR);
          if (rows !== null && rows !== undefined && typeof rows.length === 'number') {
            // 含多个工作区行 = 已经越过分组这一层（整棵列表 / 滚动容器），停。
            if (rows.length > 1) break;
            // 恰好一个 = 就是「这个分组」（或行外面那层 wrapper）→ 继续向上取最高的那一层。
            if (rows.length === 1) best = { section: node, row: rows[0], workspaceId: workspaceIdOf(rows[0]) };
          }
        }
        node = node.parentElement;
      }
      return best !== null && best.workspaceId !== null ? best : null;
    }

    function workspaceIdOf(row) {
      if (row === null || row === undefined || typeof row.getAttribute !== 'function') return null;
      var key = row.getAttribute(ROW_KEY_ATTR);
      if (typeof key !== 'string' || key.indexOf(WORKSPACE_PREFIX) !== 0) return null;
      var id = key.slice(WORKSPACE_PREFIX.length);
      return id.length > 0 ? id : null;
    }

    function toggleDropClass(row, on) {
      if (row === null || row === undefined) return;
      var list = row.classList;
      if (list === undefined || list === null || typeof list.add !== 'function') return;
      if (on) list.add(DROP_CLASS);
      else list.remove(DROP_CLASS);
    }

    /** 高亮**整块分组**（不是那一行）：让人一眼看出「松手就搬到这个工作区」。 */
    function highlightGroup(section) {
      if (dragState.targetSection === section) return;
      clearHighlight();
      dragState.targetSection = section;
      toggleDropClass(section, true);
    }

    function clearHighlight() {
      toggleDropClass(dragState.targetSection, false);
      dragState.targetSection = null;
    }

    function resetDrag() {
      clearHighlight();
      dragState.sessionId = null;
      dragState.sessionIds = null;
      dragState.sourceWorkspaceId = null;
      dragState.hostSelected = false;
    }

    /** 解析投放目标：没有正在拖的会话、或指针不在任何工作区分组里，就返回 null。 */
    function resolveDrop(event) {
      if (dragState.sessionId === null) return null;
      var target = event !== null && event !== undefined ? event.target : null;
      var group = workspaceGroupOf(target);
      if (group === null) {
        // 退化路径：读不到分组结构（老版本 DSH / 结构变了）时，回到「只认工作区行」的老行为，
        // 绝不因为读不到就去乱接管（那会破坏官方的工作区内排序）。
        var row = nearestRow(target);
        var fallbackId = row === null ? null : workspaceIdOf(row);
        if (fallbackId === null) return null;
        if (dragState.sourceWorkspaceId !== null && dragState.sourceWorkspaceId === fallbackId) return null;
        return { sessionId: dragState.sessionId, targetWorkspaceId: fallbackId, section: row };
      }
      // 落在**它自己所在的那个分组**里 = 官方的工作区内排序区，让路（官方照旧重排）。
      if (dragState.sourceWorkspaceId !== null && dragState.sourceWorkspaceId === group.workspaceId) return null;
      return { sessionId: dragState.sessionId, targetWorkspaceId: group.workspaceId, section: group.section };
    }

    /**
     * 当前多选中的会话 id。两个来源：
     *   - 我们自己的多选模式（bulkState）；
     *   - dsh-delete-session 的多选底栏：它给选中行的复选框挂 `.dsdel-check-on`
     *     （那是它的 DOM 契约，我们只读、不改）。
     * 没有多选时返回空数组。
     */
    function selectedIdsForDrag() {
      if (bulkState.selecting === true) return bulkSelectedIds();
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return [];
      var marks = document.querySelectorAll('.dsdel-check-on');
      var ids = [];
      for (var i = 0; marks !== null && marks !== undefined && i < marks.length; i += 1) {
        var row = nearestRow(marks[i]);
        var id = row === null ? null : sessionIdFromRow(row);
        if (id !== null && ids.indexOf(id) < 0) ids.push(id);
      }
      return ids;
    }

    function onDragStart(event) {
      var row = nearestRow(event !== null && event !== undefined ? event.target : null);
      if (row === null || typeof row.getAttribute !== 'function') return;
      var key = row.getAttribute(ROW_KEY_ATTR);
      if (typeof key !== 'string' || key.indexOf(SESSION_PREFIX) !== 0) return;
      var sessionId = key.slice(SESSION_PREFIX.length);
      if (sessionId.length === 0) return;
      resetDrag();
      dragState.sessionId = sessionId;
      // 多选拖动：宿主底栏（或我们自己的多选）里选中的整批一起搬。
      var selectedIds = selectedIdsForDrag();
      var multi = selectedIds.length > 1 && selectedIds.indexOf(sessionId) >= 0;
      dragState.sessionIds = multi ? selectedIds : [sessionId];
      dragState.hostSelected = bulkState.selecting !== true && selectedIds.indexOf(sessionId) >= 0;
      // 源工作区**每次**从 DOM 现读（同步、稳）：拖起来的那一行就在它自己的分组里。
      // 不能跨拖动缓存 —— 会话可能刚被搬走，旧分组已经不是它的家了。
      // 读不到再问主机；还是拿不到也无所谓 —— 服务端会用 already-there 兜住。
      var own = workspaceGroupOf(row);
      if (own !== null) {
        dragState.sourceWorkspaceId = own.workspaceId;
        return;
      }
      post('/describe', { sessionId: sessionId }).then(function (result) {
        var session = result !== null && result !== undefined ? result.session : null;
        if (session === null || session === undefined) return;
        if (dragState.sessionId === sessionId) dragState.sourceWorkspaceId = session.currentWorkspaceId;
      }, function () { /* 探测失败就让服务端兜 */ });
    }

    function onDragOver(event) {
      if (dragState.sessionId === null) return;
      var drop = resolveDrop(event);
      if (drop === null) {
        clearHighlight();
        return;
      }
      if (typeof event.preventDefault === 'function') event.preventDefault();
      var transfer = event.dataTransfer;
      if (transfer !== undefined && transfer !== null) {
        try {
          transfer.dropEffect = 'move';
        } catch (error) { /* 只读实现就算了 */ }
      }
      highlightGroup(drop.section);
    }

    function onDrop(event) {
      if (dragState.sessionId === null) return;
      var drop = resolveDrop(event);
      if (drop === null) {
        clearHighlight();
        return;
      }
      // 必须吃掉这个事件：官方在会话行上还有一套排序用的 drop 处理。
      if (typeof event.stopPropagation === 'function') event.stopPropagation();
      if (typeof event.preventDefault === 'function') event.preventDefault();
      var sessionId = drop.sessionId;
      var targetWorkspaceId = drop.targetWorkspaceId;
      var ids = dragState.sessionIds !== null && dragState.sessionIds.length > 1 ? dragState.sessionIds : [sessionId];
      var hostSelected = dragState.hostSelected === true;
      resetDrag();
      if (ids.length > 1) moveManyByDrag(ids, targetWorkspaceId, hostSelected);
      else moveByDrag(sessionId, targetWorkspaceId, hostSelected);
    }

    function onDragEnd() {
      resetDrag();
    }

    function onDragLeave(event) {
      var related = event !== null && event !== undefined ? event.relatedTarget : null;
      if (related === null || related === undefined) {
        clearHighlight();
        return;
      }
      if (typeof document !== 'undefined' && document.body !== undefined && document.body !== null
        && typeof document.body.contains === 'function' && document.body.contains(related) === false) {
        clearHighlight();
      }
    }

    /** 拖完立刻搬（不再问一次；搬错了再拖回去就行）。 */
    function moveByDrag(sessionId, targetWorkspaceId, hostSelected) {
      var strings = text();
      toast(strings.moving);
      var payload = { sessionId: sessionId, targetWorkspaceId: targetWorkspaceId };
      if (wantChildren() === false) payload.includeChildren = false;
      post('/move', payload).then(function (result) {
        if (result !== null && result !== undefined && result.ok === true) {
          var title = result.targetTitle;
          var label = typeof title === 'string' && title.length > 0 ? title : targetWorkspaceId;
          var summary = result.applied === 'attached'
            ? strings.attached.replace('{ws}', label)
            : strings.dragMoved.replace('{ws}', label);
          toast(summary + receiptNotes(result));
          if (bulkState.selecting === true) exitBulk();
          else if (hostSelected === true) dismissHostSelection();
          return;
        }
        var message = result !== null && result !== undefined && typeof result.message === 'string' ? result.message : '';
        toast(strings.dragFailed + message);
      }, function (error) {
        toast(strings.dragFailed + errorText(error));
      });
    }

    /** 多选拖动：整批搬到同一个目标（目标就是松手的分组，不再弹选择面板）。 */
    function moveManyByDrag(ids, targetWorkspaceId, hostSelected) {
      var strings = text();
      toast(strings.moving);
      runBulkMove(ids, targetWorkspaceId, {
        onProgress: function (done, total) {
          toast(strings.bulkProgress.replace('{d}', String(done)).replace('{t}', String(total)));
        },
      }).then(function (result) {
        var summary = result.failed === 0
          ? strings.bulkDone.replace('{ok}', String(result.moved))
          : strings.bulkPartial.replace('{ok}', String(result.moved)).replace('{fail}', String(result.failed));
        if (result.skipped > 0) summary += strings.bulkSkipped.replace('{n}', String(result.skipped));
        summary += receiptNotes(result);
        toast(summary);
        if (bulkState.selecting === true) exitBulk();
        else if (hostSelected === true) dismissHostSelection();
        refreshSidebar();
      }, function (error) {
        toast(strings.bulkFailed + errorText(error));
      });
    }

    /**
     * 收起宿主（dsh-delete-session）的多选态：它监听 document 的 Escape（capture），
     * 我们只发一个 Escape，不碰它的内部状态。
     */
    function dismissHostSelection() {
      if (typeof document === 'undefined' || typeof document.dispatchEvent !== 'function') return;
      var event = typeof KeyboardEvent === 'function'
        ? new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        : { type: 'keydown', key: 'Escape', bubbles: true, stopPropagation: function () {}, preventDefault: function () {} };
      try { document.dispatchEvent(event); } catch (error) { /* ignore */ }
    }

    /** 自绘 toast（不依赖官方是否暴露通知服务）。 */
    function toast(message) {
      if (typeof document === 'undefined' || document.body === undefined || document.body === null) return;
      if (toastNode === null || toastNode.parentNode === null || toastNode.parentNode === undefined) {
        toastNode = document.createElement('div');
        toastNode.setAttribute(TOAST_ATTR, '');
        toastNode.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:10000;'
          + 'max-width:70vw;padding:8px 14px;border-radius:8px;background:rgba(28,32,40,.92);color:#fff;'
          + 'font-size:13px;line-height:1.5;overflow-wrap:anywhere;pointer-events:none;opacity:0;'
          + 'box-shadow:0 6px 24px rgba(0,0,0,.28);transition:opacity .22s ease';
        document.body.appendChild(toastNode);
      }
      toastNode.textContent = message;
      toastNode.style.opacity = '1';
      if (toastTimer !== null) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () {
        toastTimer = null;
        if (toastNode !== null) toastNode.style.opacity = '0';
      }, 2600);
    }

    /** 拖动搬移是否启用（主机侧 config.dragMove，默认开）。 */
    function dragEnabled() {
      var boot = bootGlobal();
      if (boot !== null && typeof boot === 'object' && boot.drag === false) return false;
      return true;
    }

    /**
     * 挂上拖动搬移，返回卸载函数。环境没有 document 就整个不启用。
     *
     * 引用计数：客户端可能被重复 apply（热重载 / 换 fiber）。DOM 里同一个监听函数
     * 重复 add 是 no-op，但 remove 一次就真删掉了 —— 不计数的话，旧的 disposer 一跑
     * 就会把还在用的监听整套撤掉（菜单还在、拖动却全没了）。
     */
    function installDrag() {
      if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
        return function () {};
      }
      var capture = true; // 捕获阶段先于官方（React）的处理
      if (dragInstallRefs === 0) {
        document.addEventListener('dragstart', onDragStart, capture);
        document.addEventListener('dragover', onDragOver, capture);
        document.addEventListener('drop', onDrop, capture);
        document.addEventListener('dragend', onDragEnd, capture);
        document.addEventListener('dragleave', onDragLeave, capture);
      }
      dragInstallRefs += 1;
      var disposed = false;
      return function () {
        if (disposed) return;
        disposed = true;
        dragInstallRefs -= 1;
        if (dragInstallRefs > 0) return;
        document.removeEventListener('dragstart', onDragStart, capture);
        document.removeEventListener('dragover', onDragOver, capture);
        document.removeEventListener('drop', onDrop, capture);
        document.removeEventListener('dragend', onDragEnd, capture);
        document.removeEventListener('dragleave', onDragLeave, capture);
        resetDrag();
      };
    }

    // ── 批量搬移（多选）───────────────────────────────────────────────────────
    //
    // 两条路，靠 dsh-delete-session 显式暴露的能力位决定走哪条：
    //   A. 它装了且支持批量动作（window.__DSH_DELETE_SESSION__.supportsBulkMove）→ 它那根
    //      底栏上出现「移动」，它调我们暴露的 window.__DSH_SESSION_RELOCATE__.moveSelection(ids, hooks)。
    //   B. 只有我们 → 菜单里多一项「多选」，自己画勾选圈 + 底栏（已选 N / 取消 / 移动）。
    // 判断只认能力位、不猜 DOM：它没给能力位就按 B 走（宁可多一个入口，也不静默丢功能）。
    var CHECK_CLASS = 'dshsm-check';
    var CHECK_ON_CLASS = 'dshsm-check-on';
    /** 多选时给会话行加的类：只换底色，不插任何节点。 */
    var SELECTED_CLASS = 'dshsm-selected';
    var bulkState = { selecting: false, selected: {}, bar: null, countNode: null, moveNode: null, archiveNode: null, deleteNode: null, raf: null, moveSelectionFn: null, text: '', busy: false };
    /** 批量归档用的宿主接口（apply 时注入；拿不到就只显示移动）。 */
    var bulkArchiveFn = null;
    /** 宿主有没有 sidebar.footer.action 这个槽（老宿主没有 → 回退自绘浮动卡片）。 */
    var bulkSlotReady = false;
    var bulkListeners = [];

    /** 宿主（dsh-delete-session）是否支持把「移动」放进它那根底栏。 */
    function hostSupportsBulkMove() {
      var host = globalThis.__DSH_DELETE_SESSION__;
      return host !== null && typeof host === 'object' && host.supportsBulkMove === true;
    }

    /** 搬完让侧边栏重新取一次（官方一般会因会话事件自己刷新，这里补一次兜底）。 */
    function refreshSidebar() {
      try { globalThis.dispatchEvent(new Event('resize')); } catch (error) { /* 没有 Event 的环境就算了 */ }
    }

    // ── composer 里常驻的工作区 chip ───────────────────────────────────────────
    //
    // 用官方槽 `conversation.input.dock` —— 和 dsh-preset-workbench 的预设胶囊**同一个槽**。
    // 宿主里只有这个槽在「空白会话 / 已开聊会话」都渲染（composer 的 zone !== undefined），
    // 而且节点由 React 自己维护：不会像 DOM 注入那样被重渲染顶掉、来回跳。
    // 位置：靠自绘容器（宽度抄 .wSkVaW_composerHero、左内边距 20px 抄 .wSkVaW_heroWorkspaceRow），
    // 槽本身不负责定位。

    /** 从 /describe 结果里挑出这条会话该显示的工作区名（注册表优先，其次 cwd 命中）。 */
    function titleFromDescribe(result) {
      if (result === null || typeof result !== 'object') return null;
      var session = result.session;
      var workspaceId = session !== null && session !== undefined && typeof session === 'object'
        ? (session.currentWorkspaceId !== undefined && session.currentWorkspaceId !== null
          ? session.currentWorkspaceId
          : session.cwdMatchesWorkspaceId)
        : null;
      var spaces = Array.isArray(result.workspaces) ? result.workspaces : [];
      for (var i = 0; i < spaces.length; i += 1) {
        if (spaces[i] !== null && spaces[i] !== undefined && spaces[i].id === workspaceId) return spaces[i].title;
      }
      return workspaceId === null || workspaceId === undefined ? text().chipUnknown : null;
    }

    /** 从 composer chip 弹目标面板；取消返回 null。 */
    function pickMoveTarget(sessionId) {
      return new Promise(function (resolve) {
        var strings = text();
        var backdrop = document.createElement('div');
        backdrop.className = 'dshsm-picker-backdrop';
        var panel = document.createElement('div');
        panel.className = 'dshsm-picker ' + themeClass();
        panel.setAttribute('role', 'dialog');
        var title = document.createElement('div');
        title.className = 'dshsm-picker-title';
        title.textContent = strings.chipPick;
        panel.appendChild(title);
        var list = document.createElement('div');
        list.className = 'dshsm-picker-list';
        panel.appendChild(list);
        var actions = document.createElement('div');
        actions.className = 'dshsm-picker-actions';
        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'dshsm-picker-btn';
        cancel.textContent = strings.bulkCancel;
        actions.appendChild(cancel);
        panel.appendChild(actions);
        backdrop.appendChild(panel);
        document.body.appendChild(backdrop);

        var settled = false;
        function done(value) {
          if (settled) return;
          settled = true;
          if (typeof backdrop.remove === 'function') backdrop.remove();
          document.removeEventListener('keydown', onKey, true);
          resolve(value);
        }
        function onKey(event) {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          done(null);
        }
        cancel.addEventListener('click', function () { done(null); });
        backdrop.addEventListener('mousedown', function (event) { if (event.target === backdrop) done(null); });
        document.addEventListener('keydown', onKey, true);

        var loading = document.createElement('div');
        loading.className = 'dshsm-picker-empty';
        loading.textContent = strings.loading;
        list.appendChild(loading);

        post('/describe', { sessionId: sessionId }).then(function (result) {
          if (settled) return;
          if (typeof list.removeChild === 'function') list.removeChild(loading);
          var spaces = result !== null && typeof result === 'object' && Array.isArray(result.workspaces) ? result.workspaces : [];
          var targets = [];
          for (var i = 0; i < spaces.length; i += 1) {
            if (spaces[i] !== null && spaces[i] !== undefined && spaces[i].current !== true) targets.push(spaces[i]);
          }
          if (targets.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'dshsm-picker-empty';
            empty.textContent = strings.noTargets;
            list.appendChild(empty);
            return;
          }
          for (var j = 0; j < targets.length; j += 1) {
            (function (workspace) {
              var item = document.createElement('button');
              item.type = 'button';
              item.className = 'dshsm-picker-item';
              var name = document.createElement('span');
              name.className = 'dshsm-picker-name';
              name.textContent = workspace.title;
              item.appendChild(name);
              if (typeof workspace.path === 'string' && workspace.path.length > 0) {
                var path = document.createElement('span');
                path.className = 'dshsm-picker-path';
                path.textContent = workspace.path;
                item.appendChild(path);
              }
              item.addEventListener('click', function () { done(workspace); });
              list.appendChild(item);
            })(targets[j]);
          }
        }, function (error) {
          if (settled) return;
          if (typeof list.removeChild === 'function') list.removeChild(loading);
          var failed = document.createElement('div');
          failed.className = 'dshsm-picker-empty';
          failed.textContent = strings.dragFailed + errorText(error);
          list.appendChild(failed);
        });
      });
    }

    /** 搬完通知 chip 换名字（回执里就有新工作区名）。 */
    /**
     * 自绘的危险操作确认框（不依赖 window.confirm —— Electron 里它不一定可用）。
     * 没有 document 时直接返回 true，方便测试与无浏览器环境。
     */
    function confirmDanger(message) {
      return new Promise(function (resolve) {
        if (typeof document === 'undefined' || document.body === undefined || document.body === null) {
          resolve(true);
          return;
        }
        var strings = text();
        var backdrop = document.createElement('div');
        backdrop.className = 'dshsm-picker-backdrop';
        var panel = document.createElement('div');
        panel.className = 'dshsm-picker ' + themeClass();
        panel.setAttribute('role', 'dialog');
        var title = document.createElement('div');
        title.className = 'dshsm-picker-title';
        title.textContent = strings.deleteTitle;
        panel.appendChild(title);
        var body = document.createElement('div');
        body.className = 'dshsm-confirm-text';
        body.textContent = message;
        panel.appendChild(body);
        var actions = document.createElement('div');
        actions.className = 'dshsm-picker-actions';
        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'dshsm-picker-btn';
        cancel.textContent = strings.bulkCancel;
        var ok = document.createElement('button');
        ok.type = 'button';
        ok.className = 'dshsm-picker-btn dshsm-picker-btn-danger';
        ok.textContent = strings.deleteLabel;
        actions.appendChild(cancel);
        actions.appendChild(ok);
        panel.appendChild(actions);
        backdrop.appendChild(panel);
        document.body.appendChild(backdrop);

        var settled = false;
        function done(value) {
          if (settled) return;
          settled = true;
          if (typeof backdrop.remove === 'function') backdrop.remove();
          document.removeEventListener('keydown', onKey, true);
          resolve(value);
        }
        function onKey(event) {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          done(false);
        }
        cancel.addEventListener('click', function () { done(false); });
        ok.addEventListener('click', function () { done(true); });
        backdrop.addEventListener('mousedown', function (event) { if (event.target === backdrop) done(false); });
        document.addEventListener('keydown', onKey, true);
      });
    }

    function moveFromChip(sessionId, workspace, onMoved) {
      var strings = text();
      toast(strings.moving);
      var payload = { sessionId: sessionId, targetWorkspaceId: workspace.id };
      if (wantChildren() === false) payload.includeChildren = false;
      post('/move', payload).then(function (result) {
        if (result !== null && typeof result === 'object' && result.ok === true) {
          var title = typeof result.targetTitle === 'string' && result.targetTitle.length > 0 ? result.targetTitle : workspace.title;
          toast(result.applied === 'attached'
            ? strings.attached.replace('{ws}', title)
            : strings.chipMoved.replace('{ws}', title));
          if (typeof onMoved === 'function') onMoved(title);
          refreshSidebar();
          return;
        }
        var message = result !== null && typeof result === 'object' && typeof result.message === 'string' ? result.message : '';
        toast(strings.dragFailed + message);
      }, function (error) {
        toast(strings.dragFailed + errorText(error));
      });
    }

    /**
     * composer 里常驻的工作区 chip（注册进 conversation.input.dock）。
     * 外观逐项对齐官方 hero 那条：同一个文件夹图标 / 箭头 / 圆角 / 高度 / 字号 / hover。
     */
    function WorkspaceDockChip(props) {
      var strings = text();
      var sessionId = props !== null && props !== undefined
        ? (typeof props.sessionId === 'string'
          ? props.sessionId
          : (props.session !== undefined && props.session !== null && typeof props.session.id === 'string' ? props.session.id : undefined))
        : undefined;
      // 官方 hero 那一排（工作区胶囊 + 预设胶囊）在的时候，我们完全不渲染 ——
      // 否则同一条工作区 chip 会同时出现两次（官方一条、我们一条）。
      var session = props !== null && props !== undefined && props.session !== null && typeof props.session === 'object'
        ? props.session
        : undefined;
      var heroPresent = session !== undefined && session.blank === true;
      if (!heroPresent && typeof document !== 'undefined' && typeof document.querySelector === 'function') {
        try {
          heroPresent = document.querySelector('[class*="heroWorkspaceRow"]') !== null;
        } catch (error) {
          heroPresent = false;
        }
      }

      var useState = typeof react.useState === 'function' ? react.useState : function (initial) { return [initial, function () {}]; };
      var useEffect = typeof react.useEffect === 'function' ? react.useEffect : function () {};
      var useRef = typeof react.useRef === 'function' ? react.useRef : function () { return { current: null }; };
      var chipRef = useRef(null);
      var state = useState(strings.chipUnknown);
      var title = state[0];
      var setTitle = state[1];
      var modeState = useState(chipMode());
      var mode = modeState[0];
      useEffect(function () {
        return subscribeChipMode(function (next) { modeState[1](next); });
      }, []);

      useEffect(function () {
        if (heroPresent || typeof sessionId !== 'string' || sessionId.length === 0) return function () {};
        var alive = true;
        post('/describe', { sessionId: sessionId }).then(function (result) {
          if (!alive) return;
          var next = titleFromDescribe(result);
          if (next !== null && next !== undefined) setTitle(next);
        }, function () { /* 读不到就保持上一次的显示 */ });
        return function () { alive = false; };
      }, [sessionId, heroPresent]);

      // hooks 都调用过了，这里提前退出是安全的（顺序不变）。
      if (heroPresent) return null;

      function onOpen() {
        if (typeof sessionId !== 'string' || sessionId.length === 0) return;
        openMoveMenu(sessionId, computeMovePanelGeometry(chipRef.current), null);
      }

      var renderSlot = props !== null && props !== undefined && typeof props.renderSlot === 'function' ? props.renderSlot : null;
      var SessionProvider = props !== null && props !== undefined && typeof props.SessionProvider === 'function' ? props.SessionProvider : null;
      var tail = null;
      if (renderSlot !== null) {
        // 子槽是 session 作用域：必须用 SessionProvider 包一层，否则子槽拿不到会话、什么都不渲染。
        // 不传 session prop —— renderer 里 Object.hasOwn(props,'session') 为 false 时继承当前会话绑定。
        // 新槽名 + 旧槽名都渲染：dsh-preset-workbench 等外部插件可能还注册在旧名下。
        var parts = [];
        var innerNew = renderSlot('session-extension.dock', { sessionId: sessionId });
        var innerOld = renderSlot('session-relocate.dock', { sessionId: sessionId });
        if (innerNew !== null && innerNew !== undefined) {
          parts.push(react.createElement(react.Fragment, { key: 'extension' }, innerNew));
        }
        if (innerOld !== null && innerOld !== undefined) {
          parts.push(react.createElement(react.Fragment, { key: 'legacy' }, innerOld));
        }
        var inner = parts.length === 0 ? null : (parts.length === 1 ? parts[0] : parts);
        tail = inner === null ? null : (SessionProvider === null ? inner : react.createElement(SessionProvider, null, inner));
      }
      var label = typeof title === 'string' && title.length > 0 ? title : strings.chipUnknown;
      var folderPath = 'M1.50439 3.11059C1.50439 2.55831 1.95211 2.1106 2.50439 2.1106H5.43389C5.67773 2.1106 5.91318 2.19969 6.09593 2.36113L7.71649 3.79265C7.89924 3.95409 8.1347 4.04319 8.3785 4.04319H13.4958C14.0481 4.04319 14.4958 4.4909 14.4958 5.04319V12.8894C14.4958 13.4417 14.0481 13.8894 13.4958 13.8894H2.50439C1.95211 13.8894 1.50439 13.4417 1.50439 12.8894V4.04319V3.11059Z';
      var chipNode = mode === 'never' ? null : react.createElement('button', {
          key: 'chip',
          type: 'button',
          className: 'dshsm-chip',
          'data-mode': mode,
          'aria-label': strings.chipAria.replace('{ws}', label),
          title: strings.chipAria.replace('{ws}', label),
          ref: chipRef,
          onClick: onOpen,
        }, [
          react.createElement('span', { className: 'dshsm-chip-icon', key: 'icon' }, react.createElement('svg', {
            key: 'folder', width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
            xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': 'true', strokeWidth: 1,
          }, [
            react.createElement('path', { key: 'a', d: folderPath, stroke: 'currentColor' }),
            react.createElement('path', { key: 'b', d: 'M3.63501 7.66614H12.3647', stroke: 'currentColor' }),
          ])),
          react.createElement('span', { className: 'dshsm-chip-label', key: 'label' }, label),
          react.createElement('span', { className: 'dshsm-chip-chevron', key: 'chevron' }, react.createElement('svg', {
            key: 'chevron', width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none',
            xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': 'true', strokeWidth: 1,
          }, react.createElement('path', { key: 'a', d: 'M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6', stroke: 'currentColor' }))),
        ]);
      return react.createElement('div', { className: mode === 'never' ? 'dshsm-dock dshsm-dock--hidden' : 'dshsm-dock' }, [
        chipNode,
        tail === null ? null : react.createElement('span', { className: 'dshsm-dock-slot', key: 'slot' }, tail),
      ]);
    }


    /**
     * 纯逻辑：串行把一批会话搬到同一个目标工作区。不碰 DOM，方便单测。
     *
     * 两段式：先逐条 `/move` + `deferRegistry`（每条只做文件事务，进度能实时显示），
     * 最后一次性 `/move-commit` 把整批归属写进注册表 —— N 条会话只付 2 次注册表写，
     * 而不是 2N 次（实测这是单条搬移里最贵的部分）。
     */
    function runBulkMove(sessionIds, targetWorkspaceId, hooks) {
      var ids = Array.isArray(sessionIds) ? sessionIds.filter(function (id) { return typeof id === 'string' && id.length > 0; }) : [];
      if (ids.length === 0) return Promise.resolve({ canceled: false, moved: 0, failed: 0, skipped: 0, total: 0, results: [] });
      // 主机支不支持两段式，问一次 /status 并缓存：不支持就退回逐条单发（老主机照常能用）。
      return hostSupportsDefer().then(function (twoPhase) {
        return runBulkMoveInner(ids, targetWorkspaceId, hooks, twoPhase);
      });
    }

    var bulkCapability = null;
    function hostSupportsDefer() {
      if (bulkCapability !== null) return Promise.resolve(bulkCapability);
      return post('/status').then(function (result) {
        bulkCapability = result !== null && typeof result === 'object' && result.bulkDefer === true;
        return bulkCapability;
      }, function () {
        bulkCapability = false;
        return false;
      });
    }

    function runBulkMoveInner(ids, targetWorkspaceId, hooks, twoPhase) {
      var byId = {};
      var deferred = [];
      var moved = 0;
      var failed = 0;
      var skipped = 0;
      var sampled = false;
      var releaseRetries = 0;
      function record(entry) {
        byId[entry.sessionId] = entry;
      }
      function finish() {
        // results 按传入顺序输出（commit 会把成功项推到后面，这里统一回填）。
        var ordered = [];
        for (var i = 0; i < ids.length; i += 1) if (byId[ids[i]] !== undefined) ordered.push(byId[ids[i]]);
        return {
          canceled: false,
          moved: moved,
          failed: failed,
          skipped: skipped,
          total: ids.length,
          results: ordered,
          verification: sampled ? 'sampled' : 'full',
          releaseAttempts: releaseRetries,
        };
      }
      /** 第二段：一次提交，把 defer 过的归属一次性写进注册表。 */
      function commit(pending) {
        return post('/move-commit', { sessionIds: pending }).then(function (result) {
          var okCommit = result !== null && typeof result === 'object' && result.ok === true;
          var committed = result !== null && typeof result === 'object' && Array.isArray(result.results) ? result.results : [];
          var byId = {};
          for (var i = 0; i < committed.length; i += 1) {
            var entry = committed[i];
            if (entry !== null && typeof entry === 'object' && typeof entry.sessionId === 'string') byId[entry.sessionId] = entry;
          }
          for (var j = 0; j < pending.length; j += 1) {
            var id = pending[j];
            var one = byId[id];
            if (okCommit && one !== undefined && one.status === 'moved') {
              moved += 1;
              record({ sessionId: id, status: 'moved', targetWorkspaceId: targetWorkspaceId });
            } else {
              failed += 1;
              record({
                sessionId: id,
                status: 'failed',
                code: one !== undefined && typeof one.status === 'string' ? one.status : 'commit-failed',
                message: one !== undefined && typeof one.message === 'string'
                  ? one.message
                  : (result !== null && typeof result === 'object' && typeof result.message === 'string' ? result.message : ''),
              });
            }
          }
          return finish();
        }, function (error) {
          for (var k = 0; k < pending.length; k += 1) {
            failed += 1;
            record({ sessionId: pending[k], status: 'failed', code: 'commit-failed', message: errorText(error) });
          }
          return finish();
        });
      }
      function step(index) {
        if (index >= ids.length) return twoPhase && deferred.length > 0 ? commit(deferred) : Promise.resolve(finish());
        var sessionId = ids[index];
        var payload = { sessionId: sessionId, targetWorkspaceId: targetWorkspaceId, deferRegistry: twoPhase };
        if (wantChildren() === false) payload.includeChildren = false;
        var done = post('/move', payload).then(function (result) {
          if (result !== null && typeof result === 'object' && result.ok === true) {
            if (result.verification === 'sampled') sampled = true;
            if (Number.isSafeInteger(result.releaseAttempts) && result.releaseAttempts > releaseRetries) releaseRetries = result.releaseAttempts;
            if (result.applied === 'attached') {
              // 目录本来就在目标、只补了归属：没有可提交的文件事务，直接算已搬。
              moved += 1;
              record({ sessionId: sessionId, status: 'moved', targetWorkspaceId: targetWorkspaceId, applied: 'attached' });
            } else if (twoPhase) {
              deferred.push(sessionId);
            } else {
              moved += 1;
              record({ sessionId: sessionId, status: 'moved', targetWorkspaceId: targetWorkspaceId });
            }
          } else if (result !== null && typeof result === 'object' && result.code === 'already-there') {
            skipped += 1;
            record({ sessionId: sessionId, status: 'skipped', code: 'already-there', message: typeof result.message === 'string' ? result.message : '' });
          } else {
            failed += 1;
            record({
              sessionId: sessionId,
              status: 'failed',
              code: result !== null && typeof result === 'object' && typeof result.code === 'string' ? result.code : 'failed',
              message: result !== null && typeof result === 'object' && typeof result.message === 'string' ? result.message : '',
            });
          }
        }, function (error) {
          failed += 1;
          record({ sessionId: sessionId, status: 'failed', code: 'network', message: errorText(error) });
        });
        return done.then(function () {
          if (hooks !== null && hooks !== undefined && typeof hooks.onProgress === 'function') {
            try { hooks.onProgress(index + 1, ids.length); } catch (error) { /* 回调抛错不能打断批量 */ }
          }
          return step(index + 1);
        });
      }
      return step(0);
    }

    /** 把一个 CSS 颜色转成 0..1 的相对亮度；透明 / 解析不了返回 null。 */
    function colorLuminance(value) {
      var match = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(String(value));
      if (match === null) return null;
      if (match[4] !== undefined && Number(match[4]) === 0) return null;
      return (0.2126 * Number(match[1]) + 0.7152 * Number(match[2]) + 0.0722 * Number(match[3])) / 255;
    }

    /**
     * 页面是深色还是浅色 —— 先看 body 的**背景亮度**，背景拿不到再看**文字亮度**。
     * 不读 `--dsw-*` token：实测某些主题/皮肤下 token 缺失或与背景不配对，选择面板会变成
     * 「深底 + 深字」。拿不到任何样式时退回深色（深底浅字在任何主题下都能看清）。
     */
    function pageIsDark() {
      try {
        if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return true;
        var style = getComputedStyle(document.body);
        var bg = colorLuminance(style.backgroundColor);
        if (bg !== null) return bg < 0.5;
        var fg = colorLuminance(style.color);
        if (fg !== null) return fg > 0.5;
        return true;
      } catch (error) {
        return true;
      }
    }

    function themeClass() {
      return pageIsDark() ? 'dshsm-dark' : 'dshsm-light';
    }

    /** 这条会话现在挂在哪个工作区分组里（按侧边栏 DOM；行没渲染就返回 null）。 */
    function ownerWorkspaceOf(sessionId) {
      if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return null;
      var row = null;
      try {
        // session id 来自 DOM 属性；转义引号/反斜杠，避免拼进选择器时被截断。
        var safe = String(sessionId).replace(/["\\]/g, '\\$&');
        row = document.querySelector('[data-row-key="session:' + safe + '"]');
      } catch (error) {
        row = null;
      }
      if (row === null || row === undefined) return null;
      var group = workspaceGroupOf(row);
      return group === null ? null : group.workspaceId;
    }

    /**
     * 纯逻辑：按每条会话的归属，给每个目标算出「将移动 m / 跳过 s」。
     * 归属未知（行没渲染、读不到分组）一律算「会搬」，宁可多问一次也不误导用户。
     */
    function planTargetsWith(ids, workspaces, ownerOf) {
      var owners = {};
      for (var i = 0; i < ids.length; i += 1) {
        try { owners[ids[i]] = ownerOf(ids[i]); } catch (error) { owners[ids[i]] = null; }
      }
      var plans = [];
      for (var j = 0; j < workspaces.length; j += 1) {
        var workspace = workspaces[j];
        var moved = 0;
        var skipped = 0;
        for (var k = 0; k < ids.length; k += 1) {
          var owner = owners[ids[k]];
          if (owner !== null && owner !== undefined && owner === workspace.id) skipped += 1;
          else moved += 1;
        }
        plans.push({ workspace: workspace, moved: moved, skipped: skipped, disabled: moved === 0 });
      }
      return plans;
    }

    function planTargets(ids, workspaces) {
      return planTargetsWith(ids, workspaces, ownerWorkspaceOf);
    }

    /** 弹一个居中的目标工作区面板；取消返回 { canceled: true }。 */
    function pickBulkTarget(sessionIds) {
      var ids = Array.isArray(sessionIds) ? sessionIds.filter(function (id) { return typeof id === 'string' && id.length > 0; }) : [];
      return new Promise(function (resolve) {
        var strings = text();
        var backdrop = document.createElement('div');
        backdrop.className = 'dshsm-picker-backdrop';
        var panel = document.createElement('div');
        panel.className = 'dshsm-picker ' + themeClass();
        panel.setAttribute('role', 'dialog');
        var title = document.createElement('div');
        title.className = 'dshsm-picker-title';
        title.textContent = strings.bulkPicking.replace('{n}', String(ids.length));
        panel.appendChild(title);
        var list = document.createElement('div');
        list.className = 'dshsm-picker-list';
        panel.appendChild(list);
        var actions = document.createElement('div');
        actions.className = 'dshsm-picker-actions';
        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'dshsm-picker-btn';
        cancel.textContent = strings.bulkCancel;
        actions.appendChild(cancel);
        panel.appendChild(actions);
        backdrop.appendChild(panel);
        document.body.appendChild(backdrop);

        var settled = false;
        function done(value) {
          if (settled) return;
          settled = true;
          if (typeof backdrop.remove === 'function') backdrop.remove();
          document.removeEventListener('keydown', onKey, true);
          resolve(value);
        }
        function onKey(event) {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          done({ canceled: true });
        }
        cancel.addEventListener('click', function () { done({ canceled: true }); });
        backdrop.addEventListener('mousedown', function (event) { if (event.target === backdrop) done({ canceled: true }); });
        document.addEventListener('keydown', onKey, true);

        var loading = document.createElement('div');
        loading.className = 'dshsm-picker-empty';
        loading.textContent = strings.loading;
        list.appendChild(loading);

        post('/describe', {}).then(function (result) {
          if (settled) return;
          if (typeof list.removeChild === 'function') list.removeChild(loading);
          var spaces = result !== null && typeof result === 'object' && Array.isArray(result.workspaces) ? result.workspaces : [];
          if (spaces.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'dshsm-picker-empty';
            empty.textContent = strings.noTargets;
            list.appendChild(empty);
            return;
          }
          var plans = planTargets(ids, spaces);
          for (var i = 0; i < plans.length; i += 1) {
            (function (plan) {
              var workspace = plan.workspace;
              var item = document.createElement('button');
              item.type = 'button';
              item.className = 'dshsm-picker-item';
              var name = document.createElement('span');
              name.className = 'dshsm-picker-name';
              name.textContent = workspace.title;
              item.appendChild(name);
              if (typeof workspace.path === 'string' && workspace.path.length > 0) {
                var path = document.createElement('span');
                path.className = 'dshsm-picker-path';
                path.textContent = workspace.path;
                item.appendChild(path);
              }
              var countLine = document.createElement('span');
              countLine.className = 'dshsm-picker-count';
              countLine.textContent = plan.disabled === true
                ? strings.bulkPlanAllHere
                : strings.bulkPlanMove.replace('{m}', String(plan.moved))
                  + (plan.skipped > 0 ? strings.bulkPlanSkip.replace('{s}', String(plan.skipped)) : '');
              item.appendChild(countLine);
              if (plan.disabled === true) {
                item.disabled = true;
              } else {
                item.addEventListener('click', function () { done({ workspace: workspace }); });
              }
              list.appendChild(item);
            })(plans[i]);
          }
        }, function (error) {
          if (settled) return;
          if (typeof list.removeChild === 'function') list.removeChild(loading);
          var failedNode = document.createElement('div');
          failedNode.className = 'dshsm-picker-empty dshsm-bad';
          failedNode.textContent = strings.failed + '：' + errorText(error);
          list.appendChild(failedNode);
        });
      });
    }

    /**
     * 对外契约（dsh-delete-session 会用）：选目标 → 串行搬 → 汇总。
     * 返回 { canceled?, moved, failed, skipped, total, results[] }；
     * hooks.onProgress(done, total) 的 done = 已处理条数（成功 + 失败 + 跳过）。
     */
    function moveSelection(sessionIds, hooks) {
      var ids = Array.isArray(sessionIds) ? sessionIds.filter(function (id) { return typeof id === 'string' && id.length > 0; }) : [];
      if (ids.length === 0) {
        return Promise.resolve({ canceled: false, moved: 0, failed: 0, skipped: 0, total: 0, results: [] });
      }
      return pickBulkTarget(ids).then(function (picked) {
        if (picked === null || picked === undefined || picked.workspace === undefined) {
          return { canceled: true, moved: 0, failed: 0, skipped: 0, total: ids.length, results: [] };
        }
        return runBulkMove(ids, picked.workspace.id, hooks);
      });
    }

    /** 行 → 会话 id（只认会话行；工作区行不是会话）。 */
    function sessionIdFromRow(row) {
      var node = row;
      for (var depth = 0; depth < ROW_WALK_LIMIT && node !== null && node !== undefined; depth += 1) {
        if (typeof node.getAttribute === 'function') {
          var key = node.getAttribute(ROW_KEY_ATTR);
          if (typeof key === 'string' && key.indexOf(SESSION_PREFIX) === 0 && key.length > SESSION_PREFIX.length) {
            return key.slice(SESSION_PREFIX.length);
          }
        }
        node = node.parentElement;
      }
      return null;
    }

    function bulkDecorate() {
      bulkState.raf = null;
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
      var rows = Array.prototype.slice.call(document.querySelectorAll('[role="treeitem"]'));
      for (var i = 0; i < rows.length; i += 1) {
        var row = rows[i];
        var id = sessionIdFromRow(row);
        if (id === null) continue;
        // 兼容旧版本残留：把之前插过的小勾选圈摘掉（现在只用底色表达选中）。
        var legacy = typeof row.querySelector === 'function' ? row.querySelector(':scope > .' + CHECK_CLASS) : null;
        if (legacy !== null && typeof legacy.remove === 'function') legacy.remove();
        var classes = row.classList;
        if (classes === undefined || classes === null) continue;
        if (bulkState.selecting === true && bulkState.selected[id] === true) classes.add(SELECTED_CLASS);
        else classes.remove(SELECTED_CLASS);
      }
    }

    function scheduleBulkDecorate() {
      if (bulkState.raf !== null) return;
      bulkState.raf = typeof globalThis.requestAnimationFrame === 'function'
        ? globalThis.requestAnimationFrame(bulkDecorate)
        : setTimeout(bulkDecorate, 16);
    }

    function bulkSelectedIds() {
      var ids = [];
      for (var key in bulkState.selected) if (bulkState.selected[key] === true) ids.push(key);
      return ids;
    }

    function bulkUpdateBar() {
      var count = bulkSelectedIds().length;
      bulkState.text = text().bulkSelected.replace('{n}', String(count));
      bulkState.busy = false;
      if (bulkState.countNode !== null) bulkState.countNode.textContent = bulkState.text;
      if (bulkState.moveNode !== null) bulkState.moveNode.disabled = count === 0;
      if (bulkState.archiveNode !== null) bulkState.archiveNode.disabled = count === 0;
      if (bulkState.deleteNode !== null) bulkState.deleteNode.disabled = count === 0;
      bulkNotify();
      return count;
    }

    function buildBulkBar() {
      var strings = text();
      var bar = document.createElement('div');
      bar.className = 'dshsm-bar dshsm-bar-float ' + themeClass();
      bar.setAttribute('role', 'toolbar');
      var count = document.createElement('span');
      count.className = 'dshsm-bar-count';
      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'dshsm-bar-btn';
      cancel.textContent = strings.bulkCancel;
      cancel.addEventListener('click', function (event) { if (event) event.stopPropagation(); exitBulk(); });
      var move = document.createElement('button');
      move.type = 'button';
      move.className = 'dshsm-bar-btn dshsm-bar-primary';
      move.textContent = strings.bulkMove;
      move.disabled = true;
      move.addEventListener('click', function (event) {
        if (event) event.stopPropagation();
        bulkMoveSelected();
      });
      var archive = document.createElement('button');
      archive.type = 'button';
      archive.className = 'dshsm-bar-btn';
      archive.textContent = strings.bulkArchive;
      archive.disabled = true;
      archive.addEventListener('click', function (event) {
        if (event) event.stopPropagation();
        bulkArchiveSelected();
      });
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'dshsm-bar-btn dshsm-bar-danger';
      remove.textContent = strings.bulkDelete;
      remove.disabled = true;
      remove.addEventListener('click', function (event) {
        if (event) event.stopPropagation();
        bulkDeleteSelected();
      });
      bar.appendChild(count);
      bar.appendChild(cancel);
      bar.appendChild(archive);
      bar.appendChild(remove);
      bar.appendChild(move);
      document.body.appendChild(bar);
      bulkState.bar = bar;
      bulkState.countNode = count;
      bulkState.moveNode = move;
      bulkState.archiveNode = archive;
      bulkState.deleteNode = remove;
      bulkUpdateBar();
    }

    function bulkMoveSelected() {
      var strings = text();
      var ids = bulkSelectedIds();
      if (ids.length === 0) return;
      if (bulkState.moveNode !== null) bulkState.moveNode.disabled = true;
      bulkState.busy = true;
      bulkNotify();
      var run = typeof bulkState.moveSelectionFn === 'function' ? bulkState.moveSelectionFn : moveSelection;
      run(ids, {
        onProgress: function (done, total) {
          bulkState.text = strings.bulkProgress.replace('{d}', String(done)).replace('{t}', String(total));
          if (bulkState.countNode !== null) bulkState.countNode.textContent = bulkState.text;
          bulkNotify();
        },
      }).then(function (result) {
        if (result.canceled === true) { bulkUpdateBar(); return; }
        var summary = result.failed === 0
          ? strings.bulkDone.replace('{ok}', String(result.moved))
          : strings.bulkPartial.replace('{ok}', String(result.moved)).replace('{fail}', String(result.failed));
        if (result.skipped > 0) summary += strings.bulkSkipped.replace('{n}', String(result.skipped));
        summary += receiptNotes(result);
        toast(summary);
        exitBulk();
        refreshSidebar();
      }, function (error) {
        toast(strings.bulkFailed + errorText(error));
        bulkUpdateBar();
      });
    }

    /** 批量归档：逐条调用宿主的归档接口，失败隔离；DSH 允许归档后恢复。 */
    function bulkArchiveSelected() {
      var strings = text();
      var ids = bulkSelectedIds();
      if (ids.length === 0) return;
      if (typeof bulkArchiveFn !== 'function') {
        toast(strings.bulkArchiveUnavailable);
        return;
      }
      bulkState.busy = true;
      if (bulkState.archiveNode !== null) bulkState.archiveNode.disabled = true;
      if (bulkState.moveNode !== null) bulkState.moveNode.disabled = true;
      bulkNotify();
      var done = 0;
      var failed = 0;
      var total = ids.length;
      function report() {
        bulkState.text = strings.bulkArchiving.replace('{d}', String(done + failed)).replace('{t}', String(total));
        if (bulkState.countNode !== null) bulkState.countNode.textContent = bulkState.text;
        bulkNotify();
      }
      report();
      var chain = Promise.resolve();
      ids.forEach(function (id) {
        chain = chain.then(function () {
          return Promise.resolve().then(function () {
            return bulkArchiveFn(id, { stopActivity: false });
          }).then(function () {
            done += 1;
          }, function () {
            failed += 1;
          });
        }).then(report);
      });
      chain.then(function () {
        toast(failed === 0
          ? strings.bulkArchived.replace('{n}', String(done))
          : strings.bulkArchivePartial.replace('{ok}', String(done)).replace('{fail}', String(failed)));
        exitBulk();
        refreshSidebar();
      }, function (error) {
        toast(strings.bulkFailed + errorText(error));
        bulkUpdateBar();
      });
    }

    /** 批量删除：二次确认后逐条调用 /delete，失败隔离。 */
    function bulkDeleteSelected() {
      var strings = text();
      var ids = bulkSelectedIds();
      if (ids.length === 0) return;
      confirmDanger(strings.bulkDeleteConfirm.replace('{n}', String(ids.length))).then(function (confirmed) {
        if (confirmed !== true) return;
        bulkState.busy = true;
        if (bulkState.deleteNode !== null) bulkState.deleteNode.disabled = true;
        if (bulkState.moveNode !== null) bulkState.moveNode.disabled = true;
        if (bulkState.archiveNode !== null) bulkState.archiveNode.disabled = true;
        bulkNotify();
        var done = 0;
        var failed = 0;
        var total = ids.length;
        function report() {
          bulkState.text = strings.bulkDeleting.replace('{d}', String(done + failed)).replace('{t}', String(total));
          if (bulkState.countNode !== null) bulkState.countNode.textContent = bulkState.text;
          bulkNotify();
        }
        report();
        var chain = Promise.resolve();
        ids.forEach(function (id) {
          chain = chain.then(function () {
            return post('/delete', { sessionId: id, includeChildren: wantChildren() }).then(function (result) {
              if (result !== null && typeof result === 'object' && result.ok === true && result.deleted > 0) done += 1;
              else failed += 1;
            }, function () {
              failed += 1;
            });
          }).then(report);
        });
        chain.then(function () {
          toast(failed === 0
            ? strings.bulkDeleted.replace('{n}', String(done))
            : strings.bulkDeletePartial.replace('{ok}', String(done)).replace('{fail}', String(failed)));
          exitBulk();
          refreshSidebar();
        });
      });
    }

    /**
     * Ctrl / ⌘ + 左键点会话行：切换这一行的选中状态（和 Windows 文件管理器一致），
     * 不打开会话。第一次按下时自动进入多选模式，页脚操作条随之出现。
     */
    function onBulkModifierClick(event) {
      if (event === null || event === undefined) return;
      if (event.button !== undefined && event.button !== 0) return;
      if (event.ctrlKey !== true && event.metaKey !== true) return;
      var row = nearestRow(event.target);
      if (row === null || row === undefined) return;
      var sessionId = sessionIdFromRow(row);
      if (sessionId === null) return;
      if (typeof event.preventDefault === 'function') event.preventDefault();
      // 阻断同一节点上后面的监听（包括本插件自己的背景点击处理），只切一次。
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      else if (typeof event.stopPropagation === 'function') event.stopPropagation();
      if (bulkState.selecting !== true) enterBulk();
      if (bulkState.selected[sessionId] === true) delete bulkState.selected[sessionId];
      else bulkState.selected[sessionId] = true;
      scheduleBulkDecorate();
      bulkUpdateBar();
    }

    function installBulkSelect() {
      if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return function () {};
      document.addEventListener('click', onBulkModifierClick, true);
      document.addEventListener('click', onBulkBackgroundClick, true);
      return function () {
        if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
          document.removeEventListener('click', onBulkModifierClick, true);
          document.removeEventListener('click', onBulkBackgroundClick, true);
        }
      };
    }

    /**
     * 没按 Ctrl 的点击：多选模式下点会话行/空白退出多选。
     * 点页脚底栏按钮、移动子菜单、批量目标面板这类交互控件不算「点空白」。
     */
    function onBulkBackgroundClick(event) {
      if (bulkState.selecting !== true) return;
      if (event === null || event === undefined) return;
      if (event.ctrlKey === true || event.metaKey === true) return;
      var target = event.target;
      var row = nearestRow(target);
      var sessionId = row === null || row === undefined ? null : sessionIdFromRow(row);
      // 点会话行：已选中的只退出多选并阻止打开；其它行退出多选后照常打开。
      if (sessionId !== null) {
        if (bulkState.selected[sessionId] === true) {
          if (typeof event.preventDefault === 'function') event.preventDefault();
          if (typeof event.stopPropagation === 'function') event.stopPropagation();
        }
        exitBulk();
        return;
      }
      // 交互控件：让它们的 click 正常跑，别先把底栏卸掉（否则「归档/删除/移动」点了没反应）。
      if (target !== null && target !== undefined && typeof target.closest === 'function') {
        var control = target.closest('button, [role="menu"], [role="menuitem"], [role="dialog"], .dshsm-bar, .dshsm-picker-backdrop, [data-slot="sidebar.footer.action"]');
        if (control !== null) return;
      }
      exitBulk();
    }

    function onBulkKeydown(event) {
      if (bulkState.selecting !== true) return;
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      exitBulk();
    }

    function enterBulk() {
      if (typeof document === 'undefined' || document.body === undefined || document.body === null) return;
      if (bulkState.selecting === true) return;
      bulkState.selecting = true;
      bulkState.selected = {};
      markSelecting(true);
      // 宿主有 sidebar.footer.action 就用它那根底栏（位置/宽度交给宿主排版）；没有才自绘浮动卡片。
      if (bulkSlotReady !== true) buildBulkBar();
      bulkUpdateBar();   // 初始化文案（已选 0 个）+ 通知订阅者重渲染
      document.addEventListener('keydown', onBulkKeydown, true);
      scheduleBulkDecorate();
    }

    function exitBulk() {
      if (bulkState.selecting !== true) return;
      bulkState.selecting = false;
      bulkState.selected = {};
      if (bulkState.raf !== null) {
        try {
          if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(bulkState.raf);
          else clearTimeout(bulkState.raf);
        } catch (error) { /* ignore */ }
        bulkState.raf = null;
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('keydown', onBulkKeydown, true);
      }
      if (bulkState.bar !== null) {
        if (typeof bulkState.bar.remove === 'function') bulkState.bar.remove();
        bulkState.bar = null;
        bulkState.countNode = null;
        bulkState.moveNode = null;
        bulkState.archiveNode = null;
        bulkState.deleteNode = null;
      }
      bulkState.text = '';
      bulkState.busy = false;
      markSelecting(false);
      bulkNotify();
      bulkDecorate();
    }

    // ── 多选底栏（宿主槽 sidebar.footer.action） ───────────────────────────────
    //
    // 不再自绘 position:fixed 的卡片：位置、宽度、和页脚其它按钮的关系都交给宿主排版，
    // 也就不会压住账户行、不会和别家页脚按钮互相顶。选择期间用 body 上的
    // dshsm-selecting 让用量胶囊/账户行/别家按钮让位（见上面三条样式）。

    /** 多选期间给 body 打标记（进出多选时切换）。 */
    function markSelecting(on) {
      if (typeof document === 'undefined' || document.body === undefined || document.body === null) return;
      var classes = document.body.classList;
      if (classes === undefined || classes === null || typeof classes.add !== 'function' || typeof classes.remove !== 'function') return;
      if (on === true) classes.add('dshsm-selecting');
      else classes.remove('dshsm-selecting');
    }

    function bulkSubscribe(listener) {
      bulkListeners.push(listener);
      return function () {
        var at = bulkListeners.indexOf(listener);
        if (at >= 0) bulkListeners.splice(at, 1);
      };
    }

    function bulkNotify() {
      for (var i = 0; i < bulkListeners.length; i += 1) {
        try { bulkListeners[i](); } catch (error) { /* 单个订阅者出错不影响别人 */ }
      }
    }

    /** 底栏渲染用的一份快照（每次 notify 重新取，保证是新对象）。 */
    function bulkSnapshot() {
      return {
        selecting: bulkState.selecting === true,
        count: bulkSelectedIds().length,
        text: typeof bulkState.text === 'string' ? bulkState.text : '',
        busy: bulkState.busy === true,
      };
    }

    function useBulkSnapshot() {
      var useState = typeof react.useState === 'function' ? react.useState : function (initial) { return [initial, function () {}]; };
      var useEffect = typeof react.useEffect === 'function' ? react.useEffect : function () {};
      var pair = useState(bulkSnapshot());
      useEffect(function () {
        return bulkSubscribe(function () { pair[1](bulkSnapshot()); });
      }, []);
      return pair[0];
    }

    /**
     * 多选底栏：注册进 sidebar.footer.action（list / scope root，宿主渲染在 footArea > footerActions）。
     * 槽位组件是**常驻**的，靠返回 null 表示「不存在」——不要用 display:none 的 DOM 当开关。
     */
    function BulkBar() {
      // 装了 dsh-delete-session 时走路径 A，它那根底栏负责一切；这里让位，否则页脚里并排两根。
      var skip = hostSupportsBulkMove();
      var snapshot = useBulkSnapshot();
      if (skip || snapshot.selecting !== true) return null;
      var strings = text();
      return react.createElement('div', { className: 'dshsm-bar', role: 'toolbar' }, [
        react.createElement('span', { className: 'dshsm-bar-count', key: 'count' }, snapshot.text),
        react.createElement('button', {
          key: 'cancel',
          type: 'button',
          className: 'dshsm-bar-btn',
          onClick: function (event) { if (event) event.stopPropagation(); exitBulk(); },
        }, strings.bulkCancel),
        react.createElement('button', {
          key: 'archive',
          type: 'button',
          className: 'dshsm-bar-btn',
          disabled: snapshot.count === 0 || snapshot.busy === true,
          onClick: function (event) { if (event) event.stopPropagation(); bulkArchiveSelected(); },
        }, strings.bulkArchive),
        react.createElement('button', {
          key: 'delete',
          type: 'button',
          className: 'dshsm-bar-btn dshsm-bar-danger',
          disabled: snapshot.count === 0 || snapshot.busy === true,
          onClick: function (event) { if (event) event.stopPropagation(); bulkDeleteSelected(); },
        }, strings.bulkDelete),
        react.createElement('button', {
          key: 'move',
          type: 'button',
          className: 'dshsm-bar-btn dshsm-bar-primary',
          disabled: snapshot.count === 0 || snapshot.busy === true,
          onClick: function (event) { if (event) event.stopPropagation(); bulkMoveSelected(); },
        }, strings.bulkMove),
      ]);
    }

    /** 菜单里的「多选」入口：宿主支持批量动作时让位给它那根底栏。 */
    function BulkEntry(props) {
      var useMenuOpenState = props !== null && props !== undefined ? props.useMenuOpenState : null;
      var menuState = null;
      if (typeof useMenuOpenState === 'function') {
        try { menuState = useMenuOpenState(); } catch (error) { menuState = null; }
      }
      if (hostSupportsBulkMove()) return null;
      return button('bulk', text().bulk, {
        onClick: function () {
          if (menuState !== null && Array.isArray(menuState) && typeof menuState[1] === 'function') {
            try { menuState[1](false); } catch (error) { /* ignore */ }
          }
          enterBulk();
        },
      });
    }

    // =====================================================================
    // 会话重发：编辑上一次提问，从它之前 fork 出新分支并重新发送。
    //
    // 入口只有消息操作行里的一个小图标（复制后面、分叉前面），hover 用和复制
    // 一样的 Tooltip 显示名字。搬会话的入口仍由本文件上面那套（菜单 / 拖动 /
    // 多选 / 工作区 chip）负责，两者互不干扰。
    // =====================================================================

    // 防御式 hooks：宿主/测试替身缺 useEffect / useRef 时也不至于整块崩掉。
    var rwUseState = typeof react.useState === 'function' ? react.useState : function (initial) {
      return [typeof initial === 'function' ? initial() : initial, function () {}];
    };
    var rwUseEffect = typeof react.useEffect === 'function' ? react.useEffect : function () {};
    var rwUseRef = typeof react.useRef === 'function' ? react.useRef : function () { return { current: null }; };

    var REWRITE_STYLE_ID = 'dsh-session-extension-rewrite-styles';
    /**
     * 官方消息操作行按钮的类名（当前 DSH 版本构建产物里的 CSS Module 名）。
     * 用它让图标和「复制 / 分叉」完全同款；版本换了、类名不在了，
     * dsrw-action 的兜底样式仍然让它保持同一排小图标的观感。
     */
    var OFFICIAL_ACTION_CLASS = '_1KfHza_action';
    var REWRITE_CSS = [
      '.dsrw-action{width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));box-sizing:border-box;border-radius:var(--dsw-radius-sm,8px);color:var(--dsw-alias-label-secondary,rgba(127,127,127,.9));cursor:pointer;background:0 0;border:none;display:inline-flex;justify-content:center;align-items:center;padding:6px;flex:none}',
      '.dsrw-action svg{width:calc(15px + var(--dsh-content-font-delta,0px));height:calc(15px + var(--dsh-content-font-delta,0px));display:block}',
      '.dsrw-action:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,inherit)}',
      '.dsrw-action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c8dff);outline-offset:1px}',
      '.dsrw-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;box-sizing:border-box;min-height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.45));background:transparent;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:13px;line-height:18px;cursor:pointer;white-space:nowrap}',
      '.dsrw-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12))}',
      '.dsrw-btn:disabled{opacity:.5;cursor:default}',
      '.dsrw-btn-primary{border-color:transparent;background:var(--dsw-alias-brand-primary,#4c8dff);color:#fff}',
      '.dsrw-btn-primary:hover:not(:disabled){background:var(--dsw-alias-brand-primary,#4c8dff);filter:brightness(1.06)}',
      '.dsrw-icon{display:inline-flex;flex:none;color:currentColor}',
      '.dsrw-icon svg{display:block}',
      '.dsrw-backdrop{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;background:rgba(0,0,0,.42);pointer-events:auto}',
      '.dsrw-dialog{display:flex;flex-direction:column;gap:12px;box-sizing:border-box;width:min(620px,94vw);max-height:min(78vh,720px);padding:18px;border-radius:14px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1,#1f232b));color:var(--dsw-alias-label-primary,inherit);box-shadow:0 18px 48px rgba(0,0,0,.36);overflow:auto}',
      '.dsrw-title{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;line-height:22px}',
      '.dsrw-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,inherit)}',
      '.dsrw-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,inherit);overflow-wrap:anywhere}',
      '.dsrw-textarea{box-sizing:border-box;width:100%;min-height:140px;max-height:40vh;resize:vertical;padding:10px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.45));background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;font:inherit;font-size:13px;line-height:1.55;outline:none}',
      '.dsrw-textarea:focus{border-color:var(--dsw-alias-brand-primary,#4c8dff)}',
      '.dsrw-error{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#ff453a);overflow-wrap:anywhere}',
      '.dsrw-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}',
      '.dsrw-spacer{flex:1}',
      '.dsrw-loading{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary,inherit);padding:10px 2px}',
      '.dsrw-spin{width:12px;height:12px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2,rgba(127,127,127,.5));border-top-color:var(--dsw-alias-brand-primary,#4c8dff);animation:dsrw-spin .8s linear infinite;flex:none}',
      '@keyframes dsrw-spin{to{transform:rotate(360deg)}}',
    ].join('');

    function ensureRewriteStyles() {
      if (typeof document === 'undefined') return;
      if (document.querySelector('style[data-plugin-css="' + REWRITE_STYLE_ID + '"]') !== null) return;
      var tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-session-extension';
      tag.dataset.pluginCss = REWRITE_STYLE_ID;
      tag.textContent = REWRITE_CSS;
      document.head.appendChild(tag);
    }

    /**
     * 官方 Tooltip（和复制图标同款）。拿不到 ui-primitives 时退回原生 title，
     * 至少名字还在，只是气泡样式/延迟不同。
     */
    var uiPrimitives = null;
    try {
      uiPrimitives = require('@deepseek-ai/dsh-client-ui-primitives');
    } catch (error) {
      uiPrimitives = null;
    }

    function rewriteTooltip(child, label) {
      var Tooltip = uiPrimitives !== null && typeof uiPrimitives === 'object' && typeof uiPrimitives.Tooltip === 'function'
        ? uiPrimitives.Tooltip
        : null;
      if (Tooltip === null) return child;
      return react.createElement(Tooltip, { label: label, side: 'bottom' }, child);
    }

    var REWRITE_ZH = {
      iconTitle: '编辑消息',
      dialogTitle: '编辑上次提问',
      dialogHint: '改好的内容会成为新分支的第一句话；原会话不会被修改，随时可以回去。',
      forkNote: '将从「{time}」这条提问之前分叉',
      firstNote: '这是第一句提问，没有更早的历史可以分叉；只能载入输入框后作为新消息发送。',
      cancel: '取消',
      send: '重发并发送',
      sendInline: '发送',
      loadOnly: '仅载入输入框',
      loading: '正在读取上一次提问…',
      failed: '读取失败',
      noPrompt: '这个会话里还没有可以编辑的提问',
      busy: '正在创建分支…',
      images: '{n} 张图片',
      files: '{n} 个文件',
      replied: '有旧回答',
      forkFailed: '分叉失败：',
      notReady: '插件还没就绪，请刷新页面后再试',
    };
    var REWRITE_EN = {
      iconTitle: 'Edit message',
      dialogTitle: 'Edit previous prompt',
      dialogHint: 'The edited text becomes the first message of a new branch. The original conversation is never modified.',
      forkNote: 'Forks right before the prompt from {time}',
      firstNote: 'This is the first prompt, so there is no earlier history to fork. It can only be loaded into the composer as a new message.',
      cancel: 'Cancel',
      send: 'Resend & send',
      sendInline: 'Send',
      loadOnly: 'Load into composer',
      loading: 'Reading the previous prompt…',
      failed: 'Failed to read',
      noPrompt: 'This session has no editable prompt yet',
      busy: 'Creating branch…',
      images: '{n} images',
      files: '{n} files',
      replied: 'Has a reply',
      forkFailed: 'Fork failed: ',
      notReady: 'Plugin is not ready yet; refresh the page and try again',
    };

    function rewriteText(key, vars) {
      var dict = isChinese() ? REWRITE_ZH : REWRITE_EN;
      var text = typeof dict[key] === 'string' ? dict[key] : (typeof REWRITE_ZH[key] === 'string' ? REWRITE_ZH[key] : key);
      if (vars !== null && typeof vars === 'object') {
        text = text.replace(/\{([a-zA-Z0-9_]+)\}/g, function (match, name) {
          return vars[name] !== undefined ? String(vars[name]) : match;
        });
      }
      return text;
    }

    var rewriteServices = { sessions: null, uiWorkspace: null, inputActions: null };
    /** 当前打开会话的 id：由常驻的 RewritePrefillConsumer 写入，DOM 注入的按钮靠它定位会话。 */
    var activeRewriteSessionId = null;
    var rewritePrefill = { items: Object.create(null), listeners: new Set() };
    var rewriteDialog = { state: null, listeners: new Set() };

    function emitRewritePrefill() {
      rewritePrefill.listeners.forEach(function (listener) {
        try { listener(); } catch (error) { /* ignore */ }
      });
    }

    function putRewritePrefill(sessionId, item) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return;
      rewritePrefill.items[sessionId] = item;
      emitRewritePrefill();
    }

    function takeRewritePrefill(sessionId) {
      var item = rewritePrefill.items[sessionId];
      if (item === undefined) return null;
      delete rewritePrefill.items[sessionId];
      return item;
    }

    function useRewritePrefillTick() {
      var state = rwUseState(0);
      rwUseEffect(function () {
        function listener() { state[1](function (n) { return n + 1; }); }
        rewritePrefill.listeners.add(listener);
        return function () { rewritePrefill.listeners.delete(listener); };
      }, []);
      return state[0];
    }

    function emitRewriteDialog() {
      rewriteDialog.listeners.forEach(function (listener) {
        try { listener(); } catch (error) { /* ignore */ }
      });
    }

    function setRewriteDialog(patch) {
      if (rewriteDialog.state === null) return;
      rewriteDialog.state = Object.assign({}, rewriteDialog.state, patch);
      emitRewriteDialog();
    }

    function closeRewriteDialog() {
      rewriteDialog.state = null;
      emitRewriteDialog();
    }

    function openRewriteDialog(request) {
      var sessionId = request !== null && typeof request === 'object' ? request.sessionId : undefined;
      if (typeof sessionId !== 'string' || sessionId.length === 0) return;
      rewriteDialog.state = { sessionId: sessionId, title: '', phase: 'loading', text: '', error: '', source: null };
      emitRewriteDialog();
      post('/last-prompt', { sessionId: sessionId }).then(function (result) {
        if (rewriteDialog.state === null || rewriteDialog.state.sessionId !== sessionId) return;
        if (result === null || typeof result !== 'object' || result.ok !== true) {
          var code = result !== null && typeof result === 'object' && result.code === 'no-prompt' ? 'no-prompt' : 'error';
          var message = result !== null && typeof result === 'object' && typeof result.message === 'string'
            ? result.message
            : rewriteText('failed');
          setRewriteDialog({ phase: 'error', error: code === 'no-prompt' ? rewriteText('noPrompt') : message });
          return;
        }
        setRewriteDialog({ phase: 'ready', text: typeof result.text === 'string' ? result.text : '', source: result, error: '' });
      });
    }

    function useRewriteDialogState() {
      var state = rwUseState(0);
      rwUseEffect(function () {
        var listener = function () { state[1](function (n) { return n + 1; }); };
        rewriteDialog.listeners.add(listener);
        return function () { rewriteDialog.listeners.delete(listener); };
      }, []);
      return state[0];
    }

    function RewriteReplyIcon(props) {
      var size = props !== null && typeof props === 'object' && typeof props.size === 'number' ? props.size : 15;
      return react.createElement('span', { className: 'dsrw-icon', 'aria-hidden': 'true' }, react.createElement('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
      }, [
        react.createElement('path', {
          key: 'head',
          d: 'M6.2 3.1 2.4 6.9l3.8 3.8',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        react.createElement('path', {
          key: 'tail',
          d: 'M2.4 6.9h6.1a4.3 4.3 0 0 1 0 8.6H6.2',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      ]));
    }

    function formatRewriteTime(value) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '';
      try {
        return new Intl.DateTimeFormat(undefined, {
          month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
        }).format(new Date(value));
      } catch (error) {
        return '';
      }
    }

    function rewriteSessionIdOf(props) {
      if (props === null || props === undefined) return undefined;
      if (typeof props.sessionId === 'string' && props.sessionId.length > 0) return props.sessionId;
      if (props.session !== null && props.session !== undefined && typeof props.session.id === 'string') return props.session.id;
      return undefined;
    }

    function openRewriteSession(sessionId) {
      var workspace = rewriteServices.uiWorkspace;
      if (workspace !== null && workspace !== undefined && typeof workspace.openSession === 'function') {
        workspace.openSession(sessionId);
        return true;
      }
      return false;
    }

    function deliverRewriteText(sessionId, text, submit) {
      putRewritePrefill(sessionId, { text: text, submit: submit === true });
      openRewriteSession(sessionId);
    }

    function loadRewriteIntoComposer() {
      if (rewriteDialog.state === null || rewriteDialog.state.phase !== 'ready') return;
      var text = rewriteDialog.state.text;
      if (text.trim().length === 0) return;
      deliverRewriteText(rewriteDialog.state.sessionId, text, false);
      closeRewriteDialog();
    }

    function forkAndRewriteSend() {
      if (rewriteDialog.state === null || rewriteDialog.state.phase !== 'ready') return;
      var state = rewriteDialog.state;
      var text = state.text;
      if (text.trim().length === 0) return;
      var source = state.source;
      var prevSeq = source !== null && typeof source === 'object' ? source.prevSeq : null;
      if (typeof prevSeq !== 'number') {
        setRewriteDialog({ error: rewriteText('firstNote') });
        return;
      }
      var sessions = rewriteServices.sessions;
      if (sessions === null || sessions === undefined || typeof sessions.fork !== 'function') {
        setRewriteDialog({ error: rewriteText('notReady') });
        return;
      }
      setRewriteDialog({ phase: 'busy', error: '' });
      var request = { sessionId: state.sessionId, atSeq: prevSeq, increaseTitle: true };
      Promise.resolve().then(function () {
        return sessions.fork(request);
      }).then(function (childId) {
        if (typeof childId !== 'string' || childId.length === 0) throw new Error('fork returned no session id');
        putRewritePrefill(childId, { text: text, submit: true });
        if (!openRewriteSession(childId)) {
          takeRewritePrefill(childId);
          setRewriteDialog({ phase: 'ready', error: rewriteText('notReady') });
          return;
        }
        closeRewriteDialog();
      }, function (error) {
        setRewriteDialog({ phase: 'ready', error: rewriteText('forkFailed') + String(error && error.message ? error.message : error) });
      });
    }

    /** 消息操作行里的小图标：复制后面、分叉前面。 */
    function RewriteAssistantAction(props) {
      var sessionId = rewriteSessionIdOf(props);
      if (typeof sessionId !== 'string' || sessionId.length === 0) return null;
      var label = rewriteText('iconTitle');
      var child = react.createElement('button', {
        type: 'button',
        className: OFFICIAL_ACTION_CLASS + ' dsrw-action',
        title: label,
        'aria-label': label,
        onClick: function () { openRewriteDialog({ sessionId: sessionId }); },
      }, react.createElement(RewriteReplyIcon, { size: 15 }));
      return rewriteTooltip(child, label);
    }

    /** 待载入文字的消费者：不渲染任何东西，只把分叉后的文字放进当前会话输入框。 */
    function RewritePrefillConsumer(props) {
      var tick = useRewritePrefillTick();
      var sessionId = rewriteSessionIdOf(props);
      var actions = props !== null && props !== undefined && props.inputActions !== null && typeof props.inputActions === 'object'
        ? props.inputActions
        : null;
      if (typeof sessionId === 'string' && sessionId.length > 0) {
        activeRewriteSessionId = sessionId;
        // 记下当前会话的输入动作：编辑提交时直接在**当前会话**里发送，不再 fork。
        if (actions !== null && typeof actions.setDraft === 'function' && typeof actions.submit === 'function') {
          rewriteServices.inputActions = actions;
        }
        // 会话 id 可能要等 composer 挂载后才知道：拿到后补一次注入。
        scheduleUserRewriteDecorate();
      }
      rwUseEffect(function () {
        if (typeof sessionId !== 'string' || sessionId.length === 0) return;
        if (actions === null || typeof actions.setDraft !== 'function') return;
        var item = takeRewritePrefill(sessionId);
        if (item === null) return;
        try {
          actions.setDraft(item.text);
        } catch (error) {
          return;
        }
        if (item.submit === true && typeof actions.submit === 'function') {
          setTimeout(function () {
            try { actions.submit(); } catch (error) { /* 输入框自己会提示 */ }
          }, 300);
        }
      }, [sessionId, tick]);
      return null;
    }

    // ---- 用户消息操作行里的入口（官方没有 user-actions 槽，只能 DOM 注入）--------
    //
    // 官方用户消息的操作行是 MessageIconActions（复制 + 时间），没有给插件留扩展槽；
    // 所以这里把按钮插到**最后一条用户消息**的复制按钮后面，并复用它那一套官方类名，
    // 保证尺寸/颜色/hover 都和复制一致。MutationObserver 负责在消息变化后补插。

    var userRewriteRaf = null;

    /** 和内联 React 图标同一个形状的内联 SVG 字符串（DOM 注入用）。 */
    function rewriteIconMarkup(size) {
      return '<svg width="' + String(size) + '" height="' + String(size) + '" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
        + '<path d="M6.2 3.1 2.4 6.9l3.8 3.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'
        + '<path d="M2.4 6.9h6.1a4.3 4.3 0 0 1 0 8.6H6.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'
        + '</svg>';
    }

    // ---- 消息内联编辑（点击图标后直接用可编辑框改这条消息，不弹窗）----------------
    var inlineEditor = null;

    function closeInlineEditor() {
      if (inlineEditor === null) return;
      if (inlineEditor.node !== null && inlineEditor.node.parentNode !== null) {
        inlineEditor.node.parentNode.removeChild(inlineEditor.node);
      }
      // 把原来那条气泡放回来。
      if (inlineEditor.bubble !== null && inlineEditor.bubble !== undefined && inlineEditor.bubble.style !== undefined) {
        inlineEditor.bubble.style.display = inlineEditor.bubbleDisplay;
      }
      // 图标行也放回来。
      if (inlineEditor.actionRow !== null && inlineEditor.actionRow !== undefined && inlineEditor.actionRow.style !== undefined) {
        inlineEditor.actionRow.style.display = inlineEditor.actionDisplay;
      }
      // 放开编辑期间临时加宽的容器。
      if (inlineEditor.stack !== null && inlineEditor.stack !== undefined && inlineEditor.stack.classList !== null && inlineEditor.stack.classList !== undefined && typeof inlineEditor.stack.classList.remove === 'function') {
        inlineEditor.stack.classList.remove('dshsm-editing-stack');
      }
      if (inlineEditor.stackNode !== null && inlineEditor.stackNode !== undefined && inlineEditor.stackNode.classList !== null && inlineEditor.stackNode.classList !== undefined && typeof inlineEditor.stackNode.classList.remove === 'function') {
        inlineEditor.stackNode.classList.remove('dshsm-editing-row');
      }
      inlineEditor = null;
    }

    /**
     * 在某条用户消息里原地展开编辑框：
     *   读上一次提问 → 消息下方出现输入框 + 取消/重发 → 提交时 fork 并发送。
     */
    function openInlineEditor(userNode, sessionId) {
      closeInlineEditor();
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        toast(rewriteText('notReady'));
        return;
      }
      post('/last-prompt', { sessionId: sessionId }).then(function (result) {
        if (result === null || typeof result !== 'object' || result.ok !== true) {
          var message = result !== null && typeof result === 'object' && typeof result.message === 'string'
            ? result.message
            : rewriteText('failed');
          toast(rewriteText('failed') + message);
          return;
        }
        var text = typeof result.text === 'string' ? result.text : '';
        var prevSeq = result.prevSeq;

        var box = document.createElement('div');
        box.className = 'dshsm-inline-editor';
        var area = document.createElement('textarea');
        area.className = 'dshsm-inline-input';
        area.value = text;
        area.rows = Math.min(10, Math.max(3, text.split('\n').length + 1));
        var actions = document.createElement('div');
        actions.className = 'dshsm-inline-actions';
        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'dshsm-inline-btn';
        cancel.textContent = rewriteText('cancel');
        var send = document.createElement('button');
        send.type = 'button';
        send.className = 'dshsm-inline-btn dshsm-inline-primary';
        send.textContent = rewriteText('sendInline');
        actions.appendChild(cancel);
        actions.appendChild(send);
        box.appendChild(area);
        box.appendChild(actions);
        // 编辑框只替换**文字气泡**：附件（图片/文档）留在原位不动，
        // 所以定位到 userStack 里的 bubble，而不是整个消息节点。
        var stack = typeof userNode.querySelector === 'function' ? userNode.querySelector('[class*="userStack"]') : null;
        if (stack === null || stack === undefined) {
          try {
            stack = userNode.children !== undefined && userNode.children.length > 0 ? userNode.children[0] : null;
          } catch (error) {
            stack = null;
          }
        }
        var bubble = stack !== null && stack !== undefined && typeof stack.querySelector === 'function'
          ? stack.querySelector('[class*="bubble"]')
          : null;
        var bubbleDisplay = bubble !== null && bubble !== undefined && bubble.style !== undefined ? bubble.style.display : '';
        if (bubble !== null && bubble !== undefined && bubble.style !== undefined) bubble.style.display = 'none';
        // 编辑期间把消息下方的图标行也藏起来（和 ChatGPT 编辑态一致）。
        var actionRow = typeof userNode.querySelector === 'function' ? userNode.querySelector('[class*="_actions"]') : null;
        var actionDisplay = actionRow !== null && actionRow !== undefined && actionRow.style !== undefined ? actionRow.style.display : '';
        if (actionRow !== null && actionRow !== undefined && actionRow.style !== undefined) actionRow.style.display = 'none';
        // 编辑框**占用文字气泡的位置**（不是消息下方另起一块），并把这一行临时放宽到整行，
        // 这样既覆盖原消息、又是整行宽；附件（attachmentRow）留在原位不动。
        var canClass = function (node) {
          return node !== null && node !== undefined && node.classList !== null && node.classList !== undefined
            && typeof node.classList.add === 'function' && typeof node.classList.remove === 'function';
        };
        if (canClass(userNode)) userNode.classList.add('dshsm-editing-row');
        if (canClass(stack)) stack.classList.add('dshsm-editing-stack');
        if (stack !== null && stack !== undefined && typeof stack.insertBefore === 'function' && bubble !== null && bubble !== undefined && bubble.parentNode === stack) {
          stack.insertBefore(box, bubble);
        } else if (stack !== null && stack !== undefined && typeof stack.appendChild === 'function') {
          stack.appendChild(box);
        } else {
          userNode.appendChild(box);
        }
        inlineEditor = { node: box, bubble: bubble, bubbleDisplay: bubbleDisplay, actionRow: actionRow, actionDisplay: actionDisplay, stack: stack, stackNode: userNode, sessionId: sessionId };
        try {
          area.focus();
          area.setSelectionRange(area.value.length, area.value.length);
        } catch (error) { /* ignore */ }

        function submit() {
          var next = area.value;
          if (next.trim().length === 0) return;
          send.disabled = true;
          // 不再 fork 新分支：把改好的文字送进**当前会话**的输入框并直接发送，
          // 从当前对话继续（原来的提问作为历史保留）。
          var input = rewriteServices.inputActions;
          if (input === null || input === undefined || typeof input.setDraft !== 'function' || typeof input.submit !== 'function') {
            send.disabled = false;
            toast(rewriteText('notReady'));
            return;
          }
          try {
            input.setDraft(next);
          } catch (error) {
            send.disabled = false;
            toast(rewriteText('failed') + String(error && error.message ? error.message : error));
            return;
          }
          closeInlineEditor();
          setTimeout(function () {
            try { input.submit(); } catch (error) { /* 输入框自己会提示 */ }
          }, 150);
        }

        cancel.addEventListener('click', function (event) {
          if (event !== null && event !== undefined && typeof event.stopPropagation === 'function') event.stopPropagation();
          closeInlineEditor();
        });
        send.addEventListener('click', function (event) {
          if (event !== null && event !== undefined && typeof event.stopPropagation === 'function') event.stopPropagation();
          submit();
        });
        area.addEventListener('keydown', function (event) {
          if (event === null || event === undefined) return;
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            submit();
          }
        });
      });
    }

    function decorateUserRewriteAction() {
      userRewriteRaf = null;
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
      // 编辑中：确保原气泡与图标行仍是隐藏的（React 重渲染可能把 display 写回来）。
      if (inlineEditor !== null) {
        if (inlineEditor.bubble !== null && inlineEditor.bubble !== undefined && inlineEditor.bubble.style !== undefined) {
          inlineEditor.bubble.style.display = 'none';
        }
        if (inlineEditor.actionRow !== null && inlineEditor.actionRow !== undefined && inlineEditor.actionRow.style !== undefined) {
          inlineEditor.actionRow.style.display = 'none';
        }
        if (inlineEditor.stack !== null && inlineEditor.stack !== undefined && inlineEditor.stack.classList !== null && inlineEditor.stack.classList !== undefined && typeof inlineEditor.stack.classList.add === 'function') {
          inlineEditor.stack.classList.add('dshsm-editing-stack');
        }
        if (inlineEditor.stackNode !== null && inlineEditor.stackNode !== undefined && inlineEditor.stackNode.classList !== null && inlineEditor.stackNode.classList !== undefined && typeof inlineEditor.stackNode.classList.add === 'function') {
          inlineEditor.stackNode.classList.add('dshsm-editing-row');
        }
      }
      var users = document.querySelectorAll('[data-chat-flow-kind="user"]');
      if (users.length === 0) return;
      var last = users[users.length - 1];
      if (last === null || last === undefined || typeof last.querySelector !== 'function') return;
      var row = last.querySelector('[class*="_actions"]');
      if (row === null || row === undefined || typeof row.querySelector !== 'function') return;
      var copy = row.querySelector('button');
      if (copy === null || copy === undefined) return;

      // 这一行已经插过就**原样保留**：每次都移除重插会让点击落在被替换掉的旧节点上，
      // 表现就是「按钮点不动」。顺手清掉旧版本留下的 title（会跟自绘气泡重叠）。
      var existing = typeof row.querySelector === 'function' ? row.querySelector('[data-dshsm-rewrite]') : null;
      if (existing !== null && existing !== undefined) {
        if (typeof existing.getAttribute === 'function' && existing.getAttribute('title') !== null) {
          existing.removeAttribute('title');
        }
        return;
      }
      // 其它消息行上遗留的旧按钮清掉（切换会话 / 新消息后消息行会被重建）。
      var stale = document.querySelectorAll('[data-dshsm-rewrite]');
      for (var index = 0; index < stale.length; index += 1) {
        if (stale[index].parentNode !== null && stale[index].parentNode !== row) {
          stale[index].parentNode.removeChild(stale[index]);
        }
      }

      var label = rewriteText('iconTitle');
      var sessionId = typeof activeRewriteSessionId === 'string' ? activeRewriteSessionId : '';
      var button = document.createElement('button');
      button.type = 'button';
      button.className = String(copy.className || '') + ' dshsm-user-action';
      button.setAttribute('data-dshsm-rewrite', '');
      button.setAttribute('data-dshsm-session', sessionId);
      button.setAttribute('aria-label', label);
      // 不设 title：否则浏览器原生提示会在 1 秒后盖在自绘气泡上，看起来像「出现两次」。
      button.innerHTML = rewriteIconMarkup(15) + '<span class="dshsm-tip">' + label + '</span>';
      // mousedown 与 click 都接：即使按钮在 mouseup 前被官方重渲染换掉，
      // mousedown 也已经把弹窗打开了（click 丢失不再等于「点了没反应」）。
      var activated = false;
      function activate(event) {
        if (event !== null && event !== undefined) {
          if (typeof event.preventDefault === 'function') event.preventDefault();
          if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
          else if (typeof event.stopPropagation === 'function') event.stopPropagation();
        }
        if (activated) return;
        activated = true;
        setTimeout(function () { activated = false; }, 400);
        var id = button.getAttribute('data-dshsm-session');
        if (typeof id !== 'string' || id.length === 0) id = activeRewriteSessionId;
        if (typeof id !== 'string' || id.length === 0) {
          toast(rewriteText('notReady'));
          return;
        }
        // 直接在这条消息里改成可编辑，不再弹窗。
        var userNode = typeof button.closest === 'function' ? button.closest('[data-chat-flow-kind="user"]') : null;
        if (userNode === null || userNode === undefined) {
          openRewriteDialog({ sessionId: id });
          return;
        }
        openInlineEditor(userNode, id);
      }
      button.addEventListener('mousedown', activate);
      button.addEventListener('click', activate);
      if (copy.nextSibling !== null && copy.nextSibling !== undefined) row.insertBefore(button, copy.nextSibling);
      else row.appendChild(button);
    }

    function scheduleUserRewriteDecorate() {
      if (userRewriteRaf !== null) return;
      userRewriteRaf = typeof globalThis.requestAnimationFrame === 'function'
        ? globalThis.requestAnimationFrame(decorateUserRewriteAction)
        : setTimeout(decorateUserRewriteAction, 16);
    }

    function installUserRewriteAction() {
      if (typeof document === 'undefined' || document.body === undefined || typeof MutationObserver !== 'function') {
        return function () {};
      }
      var observer = new MutationObserver(function () { scheduleUserRewriteDecorate(); });
      observer.observe(document.body, { childList: true, subtree: true });
      scheduleUserRewriteDecorate();
      return function () {
        observer.disconnect();
        if (userRewriteRaf !== null) {
          try {
            if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(userRewriteRaf);
            else clearTimeout(userRewriteRaf);
          } catch (error) { /* ignore */ }
          userRewriteRaf = null;
        }
      };
    }

    function RewriteDialogHost() {
      useRewriteDialogState();
      var state = rewriteDialog.state;
      var open = state !== null;
      var textareaRef = rwUseRef(null);
      var readySessionId = state !== null && state.phase === 'ready' ? state.sessionId : null;

      rwUseEffect(function () {
        if (!open) return undefined;
        function onKeyDown(event) {
          if (event.key === 'Escape') {
            if (rewriteDialog.state !== null && rewriteDialog.state.phase === 'busy') return;
            event.stopPropagation();
            closeRewriteDialog();
          }
        }
        document.addEventListener('keydown', onKeyDown, true);
        return function () { document.removeEventListener('keydown', onKeyDown, true); };
      }, [open]);

      rwUseEffect(function () {
        if (readySessionId === null) return;
        var node = textareaRef.current;
        if (node === null || node === undefined) return;
        try {
          node.focus();
          var length = node.value.length;
          node.setSelectionRange(length, length);
        } catch (error) { /* ignore */ }
      }, [readySessionId]);

      if (state === null) return null;

      var busy = state.phase === 'busy';
      var text = typeof state.text === 'string' ? state.text : '';
      var source = state.source;
      var prevSeq = source !== null && typeof source === 'object' ? source.prevSeq : null;
      var canFork = typeof prevSeq === 'number';
      var metaParts = [];
      if (source !== null && typeof source === 'object') {
        var when = formatRewriteTime(source.time);
        if (when.length > 0) metaParts.push(when);
        if (source.replied === true) metaParts.push(rewriteText('replied'));
        if (typeof source.images === 'number' && source.images > 0) metaParts.push(rewriteText('images', { n: source.images }));
        if (typeof source.files === 'number' && source.files > 0) metaParts.push(rewriteText('files', { n: source.files }));
      }

      var body = [];
      if (state.phase === 'loading') {
        body.push(react.createElement('div', { className: 'dsrw-loading', key: 'loading' }, [
          react.createElement('span', { key: 'spin', className: 'dsrw-spin' }),
          react.createElement('span', { key: 'text' }, rewriteText('loading')),
        ]));
      } else if (state.phase === 'error') {
        body.push(react.createElement('div', { className: 'dsrw-error', key: 'error' }, state.error));
      } else {
        body.push(react.createElement('textarea', {
          key: 'textarea',
          ref: textareaRef,
          className: 'dsrw-textarea',
          value: text,
          spellCheck: false,
          onChange: function (event) { setRewriteDialog({ text: event.target.value }); },
          onKeyDown: function (event) {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              forkAndRewriteSend();
            }
          },
        }));
        body.push(react.createElement('p', { key: 'hint', className: 'dsrw-hint' },
          canFork
            ? rewriteText('forkNote', { time: source !== null && typeof source === 'object' ? (formatRewriteTime(source.time) || '—') : '—' })
            : rewriteText('firstNote')));
        if (typeof state.error === 'string' && state.error.length > 0) {
          body.push(react.createElement('div', { key: 'err', className: 'dsrw-error' }, state.error));
        }
      }

      var actions = [];
      if (busy) {
        actions.push(react.createElement('div', { key: 'busy', className: 'dsrw-loading' }, [
          react.createElement('span', { key: 'spin', className: 'dsrw-spin' }),
          react.createElement('span', { key: 'text' }, rewriteText('busy')),
        ]));
      }
      actions.push(react.createElement('span', { key: 'spacer', className: 'dsrw-spacer' }));
      actions.push(react.createElement('button', {
        key: 'cancel',
        type: 'button',
        className: 'dsrw-btn',
        disabled: busy,
        onClick: closeRewriteDialog,
      }, rewriteText('cancel')));
      if (state.phase === 'ready') {
        actions.push(react.createElement('button', {
          key: 'load',
          type: 'button',
          className: 'dsrw-btn',
          disabled: busy || text.trim().length === 0,
          onClick: loadRewriteIntoComposer,
        }, rewriteText('loadOnly')));
        if (canFork) {
          actions.push(react.createElement('button', {
            key: 'send',
            type: 'button',
            className: 'dsrw-btn dsrw-btn-primary',
            disabled: busy || text.trim().length === 0,
            onClick: forkAndRewriteSend,
          }, rewriteText('send')));
        }
      }

      return react.createElement('div', {
        className: 'dsrw-backdrop',
        key: 'backdrop',
        onMouseDown: function (event) {
          if (event.target !== event.currentTarget) return;
          if (rewriteDialog.state !== null && rewriteDialog.state.phase === 'busy') return;
          closeRewriteDialog();
        },
      }, react.createElement('div', {
        className: 'dsrw-dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': rewriteText('dialogTitle'),
      }, [
        react.createElement('div', { className: 'dsrw-title', key: 'title' }, [
          react.createElement(RewriteReplyIcon, { key: 'icon', size: 16 }),
          react.createElement('span', { key: 'text' }, rewriteText('dialogTitle')),
        ]),
        metaParts.length > 0
          ? react.createElement('div', { className: 'dsrw-meta', key: 'meta' }, metaParts.map(function (part, index) {
            return react.createElement('span', { key: 'm' + index }, part);
          }))
          : null,
        react.createElement('p', { className: 'dsrw-hint', key: 'dialogHint' }, rewriteText('dialogHint')),
      ].concat(body).concat([
        react.createElement('div', { className: 'dsrw-actions', key: 'actions' }, actions),
      ])));
    }

    /** 需要 slots 服务。 */
    var inject = ['slots'];

    function apply(ctx) {
      ensureStyles();
      ensureRewriteStyles();
      if (typeof ctx.inject === 'function') {
        ctx.inject(['sessions'], function (scoped) { rewriteServices.sessions = scoped.sessions; });
        ctx.inject(['uiWorkspace'], function (scoped) {
          rewriteServices.uiWorkspace = scoped.uiWorkspace;
          bulkArchiveFn = scoped.uiWorkspace !== null && typeof scoped.uiWorkspace.archiveSession === 'function'
            ? scoped.uiWorkspace.archiveSession.bind(scoped.uiWorkspace)
            : null;
        });
      }
      // Ctrl / ⌘ + 左键多选：会话行菜单里不再有「多选」入口。
      if (typeof ctx.effect === 'function') {
        ctx.effect(installBulkSelect, 'dsh-session-extension:bulk-select');
      } else {
        installBulkSelect();
      }
      // 对外契约：dsh-delete-session 会检测这个全局，把「移动」放进它那根底栏。
      var boot = bootGlobal();
      var version = boot !== null && typeof boot === 'object' && typeof boot.version === 'string' ? boot.version : '0.0.0';
      // 注意：这个全局**同时**是主机注入的引导信息（prefix / version / drag）和客户端对外契约，
      // 所以只能合并、不能整个覆盖 —— 覆盖掉 prefix 会让桥接请求打到一个不存在的地址。
      var contract = globalThis.__DSH_SESSION_EXTENSION__;
      if (contract === null || typeof contract !== 'object') contract = globalThis.__DSH_SESSION_RELOCATE__;
      if (contract === null || typeof contract !== 'object') contract = {};
      contract.version = version;
      contract.supportsBulkMove = true;
      contract.moveSelection = moveSelection;
      globalThis.__DSH_SESSION_EXTENSION__ = contract;
      // 兼容 dsh-delete-session：它读的是改名前的全局名。
      globalThis.__DSH_SESSION_RELOCATE__ = contract;
      try {
        document.dispatchEvent(new CustomEvent('dsh-session-extension:ready', { detail: { version: version } }));
        // 兼容还监听旧事件名的插件。
        document.dispatchEvent(new CustomEvent('dsh-session-relocate:ready', { detail: { version: version } }));
      } catch (error) { /* 没有 CustomEvent 的环境就算了 */ }
      // 拖动搬移：与菜单那条路并存（拖不动就点菜单）。
      if (!dragEnabled()) {
        // 主机侧关掉了：什么都不挂。
      } else if (typeof ctx.effect === 'function') {
        ctx.effect(installDrag, 'dsh-session-extension:drag');
      } else {
        installDrag();
      }
      var disposers = [];
      // 会话页 composer 上方的工作区 chip 已移除：搬移入口只保留会话行菜单的「移动」、
      // 拖动、Ctrl 多选和批量底栏，避免同一功能在页面上出现两次。
      // 多选底栏：宿主有 sidebar.footer.action 就注册进去（位置/宽度交给宿主排版），
      // 没有（老宿主）就退回自绘浮动卡片。order 40：dsh-delete-session 用的是 30。
      if (typeof ctx.slots.inject === 'function') {
        disposers.push(ctx.slots.inject('sidebar.footer.action', function () {
          bulkSlotReady = true;
          return ctx.slots.register(
            { name: 'sidebar.footer.action', id: 'session-extension-bulkbar', order: 40 },
            BulkBar,
          );
        }));
      }
      // 插件设置页（Plugins → 本插件）：把「连同子对话」开关挂到这一行的配置页。
      // 槽的 renderSlot 用 options.key 过滤，所以这里把「行 id 的两种可能写法」都登记上，
      // 行页和包页各一条，匹配不上的那条不会渲染。
      if (typeof ctx.slots.inject === 'function') {
        disposers.push(ctx.slots.inject('plugins.row.config', function () {
          var keys = ['dsh-session-extension#session-extension', 'dsh-session-extension#dsh-session-extension'];
          var entries = [];
          for (var i = 0; i < keys.length; i += 1) {
            entries.push(ctx.slots.register(
              { name: 'plugins.row.config', key: keys[i], id: 'session-extension-children-row-' + i, order: 100 },
              ChildrenSetting,
            ));
          }
          return function () {
            for (var j = 0; j < entries.length; j += 1) {
              if (typeof entries[j] === 'function') {
                try { entries[j](); } catch (error) { /* ignore */ }
              }
            }
          };
        }));
        disposers.push(ctx.slots.inject('plugins.bundle.config', function () {
          return ctx.slots.register(
            { name: 'plugins.bundle.config', key: 'dsh-session-extension', id: 'session-extension-children-bundle', order: 100 },
            ChildrenSetting,
          );
        }));
      }
      disposers.push(ctx.slots.inject('sidebar.workspaces.session.menu.item', function () {
        var items = [];
        // 「多选」已改为 Ctrl/⌘ + 左键点会话行，会话行菜单里不再出现这个入口。
        items.push(ctx.slots.register(
          { name: 'sidebar.workspaces.session.menu.item', id: 'session-extension', order: 350 },
          Entry,
        ));
        // 「删除」：会话行菜单里的危险操作，点击后二次确认。
        items.push(ctx.slots.register(
          { name: 'sidebar.workspaces.session.menu.item', id: 'session-extension-delete', order: 360 },
          DeleteEntry,
        ));
        return function () {
          for (var i = 0; i < items.length; i += 1) {
            if (typeof items[i] === 'function') {
              try { items[i](); } catch (error) { /* ignore */ }
            }
          }
        };
      }));
      // 「编辑上次提问」入口已移到**用户消息**操作行（复制图标后面）。
      // 官方没有 user-actions 扩展槽，所以用 MutationObserver 做 DOM 注入；
      // 助手消息行不再注册任何东西。
      if (typeof ctx.effect === 'function') {
        ctx.effect(installUserRewriteAction, 'dsh-session-extension:user-rewrite-action');
      } else {
        installUserRewriteAction();
      }
      // 隐藏的待载入消费者：分叉后把文字放进新会话的输入框。
      disposers.push(ctx.slots.inject('conversation.input.dock', function () {
        return ctx.slots.register(
          { name: 'conversation.input.dock', id: 'session-extension-rewrite-prefill', order: 12 },
          RewritePrefillConsumer,
        );
      }));
      // 编辑弹窗画在整帧浮动层，不会被会话切换带走。
      disposers.push(ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register(
          { name: 'shell.overlay', id: 'session-extension-rewrite-dialog' },
          RewriteDialogHost,
        );
      }));
      return function () {
        for (var i = 0; i < disposers.length; i += 1) {
          if (typeof disposers[i] === 'function') {
            try { disposers[i](); } catch (error) { /* ignore */ }
          }
        }
      };
    }

    exports.apply = apply;
    exports.__rewrite = {
      openDialog: openRewriteDialog,
      closeDialog: closeRewriteDialog,
      forkAndSend: forkAndRewriteSend,
      loadIntoComposer: loadRewriteIntoComposer,
      deliverText: deliverRewriteText,
      putPrefill: putRewritePrefill,
      takePrefill: takeRewritePrefill,
      prefillState: function () { return rewritePrefill.items; },
      dialogState: function () { return rewriteDialog.state; },
      AssistantAction: RewriteAssistantAction,
      decorateUserAction: decorateUserRewriteAction,
      installUserAction: installUserRewriteAction,
      PrefillConsumer: RewritePrefillConsumer,
      DialogHost: RewriteDialogHost,
      zh: REWRITE_ZH,
      en: REWRITE_EN,
    };
    exports.__ui = { pageIsDark: pageIsDark, themeClass: themeClass, css: function () { return CSS; } };
    exports.__settings = {
      ChildrenSetting: ChildrenSetting,
      wantChildren: wantChildren,
      setWantChildren: setWantChildren,
      chipMode: chipMode,
      setChipMode: setChipMode,
    };
    exports.inject = inject;
    exports.__entry = Entry;
    exports.__moveMenu = {
      open: openMoveMenu,
      close: closeMoveMenu,
      host: renderMoveMenuPanel,
      state: function () { return moveMenu; },
      chooseDirectory: chooseMoveDirectory,
      run: runMoveFromMenu,
    };
    exports.__bulkEntry = BulkEntry;
    // 给测试用的内部入口（浏览器里没人用）。
    exports.__bulk = {
      moveSelection: moveSelection,
      runBulkMove: runBulkMove,
      pickBulkTarget: pickBulkTarget,
      planTargetsWith: planTargetsWith,
      hostSupportsBulkMove: hostSupportsBulkMove,
      BulkBar: BulkBar,
      bulkSnapshot: bulkSnapshot,
      bulkUpdateBar: bulkUpdateBar,
      markSelecting: markSelecting,
      slotReady: function () { return bulkSlotReady; },
      enterBulk: enterBulk,
      exitBulk: exitBulk,
      bulkDecorate: bulkDecorate,
      bulkMoveSelected: bulkMoveSelected,
      bulkArchiveSelected: bulkArchiveSelected,
      bulkDeleteSelected: bulkDeleteSelected,
      confirmDanger: confirmDanger,
      DeleteEntry: DeleteEntry,
      onModifierClick: onBulkModifierClick,
      onBackgroundClick: onBulkBackgroundClick,
      installBulkSelect: installBulkSelect,
      setArchiveFn: function (fn) { bulkArchiveFn = typeof fn === 'function' ? fn : null; },
      state: bulkState,
      sessionIdFromRow: sessionIdFromRow,
    };
    exports.__drag = {
      installDrag: installDrag,
      onDragStart: onDragStart,
      onDragOver: onDragOver,
      onDrop: onDrop,
      onDragEnd: onDragEnd,
      onDragLeave: onDragLeave,
      state: dragState,
      reset: resetDrag,
      nearestRow: nearestRow,
      workspaceGroupOf: workspaceGroupOf,
      workspaceIdOf: workspaceIdOf,
    };
    return module.exports;
  },
});
