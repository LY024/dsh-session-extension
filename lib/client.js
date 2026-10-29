/**
 * dsh-session-extension —— 网页端。
 *
 * 三块 UI，全部挂 DSH 自己的公开槽位：
 *
 *   1. 左侧栏入口（sidebar.panellist + main）：「会话重发台」，
 *      列出可见会话，可打开、可「编辑上次提问」；
 *   2. 会话 composer 上方（conversation.input.dock）：一个「编辑上次提问」按钮，
 *      点开就是当前会话的上一条提问；
 *   3. 会话行「…」菜单（sidebar.workspaces.session.menu.item）：同一个入口，
 *      不用先打开会话。
 *
 * 「重发」不改日志、不搬文件，走 DSH 原生 fork：
 *   ctx.sessions.fork({ sessionId, atSeq: prevSeq })  →  新分支
 *   ctx.uiWorkspace.openSession(childId)              →  打开新分支
 *   inputActions.setDraft(text) / submit()            →  把改好的话放进去并发送
 * 原会话原样保留，随时还能回去。
 *
 * 形态是 DSH 客户端的 lazy-CJS 包：只注册一个工厂，模块体副作用在首次物化时才跑。
 * 唯一的外部依赖是 react（平台基座模块），因此不需要打包器。
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-extension',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require('react');

    var NS = 'dsh-session-extension';
    var PANEL_ID = 'session-extension';
    var DEFAULT_PREFIX = '/api/dsh-session-extension';
    var BOOT_GLOBAL = '__DSH_SESSION_EXTENSION__';
    var STYLE_ID = 'dsh-session-extension-styles';

    // ---- 样式 -------------------------------------------------------------
    // 只用主题 token（Theme 目录里列出来的那些）+ 中性回退，暗色主题自动跟随。
    var CSS = [
      // 通用按钮
      '.dsse-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;box-sizing:border-box;min-height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.45));background:transparent;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:13px;line-height:18px;cursor:pointer;white-space:nowrap}',
      '.dsse-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12))}',
      '.dsse-btn:disabled{opacity:.5;cursor:default}',
      '.dsse-btn-primary{border-color:transparent;background:var(--dsw-alias-brand-primary,#4c8dff);color:#fff}',
      '.dsse-btn-primary:hover:not(:disabled){background:var(--dsw-alias-brand-primary,#4c8dff);filter:brightness(1.06)}',
      '.dsse-btn-ghost{border-color:transparent;background:transparent;min-height:28px;padding:0 8px}',
      '.dsse-icon{display:inline-flex;flex:none;color:currentColor}',
      '.dsse-icon svg{display:block}',

      // 面板
      '.dsse-panel{box-sizing:border-box;display:flex;flex-direction:column;gap:16px;width:100%;height:100%;min-height:0;padding:24px 28px 20px;overflow:auto;color:var(--dsw-alias-label-primary,inherit)}',
      '.dsse-panel-head{display:flex;flex-direction:column;gap:6px;min-width:0}',
      '.dsse-panel-title{display:flex;align-items:center;gap:8px;margin:0;font-size:18px;font-weight:600;line-height:26px}',
      '.dsse-panel-sub{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,inherit);max-width:760px}',
      '.dsse-toolbar{display:flex;align-items:center;gap:10px;min-width:0}',
      '.dsse-search{flex:1;min-width:0;box-sizing:border-box;height:32px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.45));background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;font:inherit;font-size:13px;outline:none}',
      '.dsse-search:focus{border-color:var(--dsw-alias-brand-primary,#4c8dff)}',
      '.dsse-count{font-size:12px;color:var(--dsw-alias-label-secondary,inherit);white-space:nowrap}',
      '.dsse-list{list-style:none;margin:0;padding:0;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-1,transparent)}',
      '.dsse-row{display:flex;align-items:center;gap:12px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));min-width:0}',
      '.dsse-row:first-child{border-top:0}',
      '.dsse-row:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08))}',
      '.dsse-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;background:transparent;border:0;padding:0;text-align:left;color:inherit;font:inherit;cursor:pointer}',
      '.dsse-row-title{font-size:13px;line-height:20px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsse-row-meta{display:flex;align-items:center;gap:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,inherit);min-width:0}',
      '.dsse-row-path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsse-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#2ea043)}',
      '.dsse-row-actions{display:flex;align-items:center;gap:6px;flex:none}',
      '.dsse-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:32px 16px;border:1px dashed var(--dsw-alias-border-l2,rgba(127,127,127,.4));border-radius:12px;color:var(--dsw-alias-label-secondary,inherit);font-size:13px}',
      '.dsse-foot{margin-top:auto;padding-top:8px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,inherit);display:flex;gap:8px;flex-wrap:wrap}',
      '.dsse-badge{display:inline-flex;align-items:center;padding:0 6px;height:16px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));font-size:10px;line-height:14px}',

      // composer 上方的入口
      '.dsse-dock{display:flex;flex-direction:column;gap:6px;width:100%;min-width:0;padding:0 2px 6px}',
      '.dsse-dock-row{display:flex;align-items:center;gap:8px;min-width:0}',
      '.dsse-chip{appearance:none;display:inline-flex;align-items:center;gap:6px;max-width:100%;min-height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}',
      '.dsse-chip:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,inherit)}',
      '.dsse-chip-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsse-note{display:flex;align-items:flex-start;gap:8px;box-sizing:border-box;width:100%;padding:6px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,inherit)}',
      '.dsse-note-text{flex:1;min-width:0;overflow-wrap:anywhere}',
      '.dsse-note-close{appearance:none;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;padding:0 2px;opacity:.7}',
      '.dsse-note-close:hover{opacity:1}',
      '.dsse-manual{width:100%;box-sizing:border-box;resize:vertical;min-height:64px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;font:inherit;font-size:12px;line-height:18px;padding:6px 8px}',

      // 会话行菜单项（对齐官方菜单行：16px 图标列 + 16px 间距）
      '.dsse-menu-item{display:flex;align-items:center;gap:16px;box-sizing:border-box;width:100%;padding:6px 10px 6px 8px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:13px;line-height:1.45;text-align:left;cursor:pointer;white-space:normal;overflow-wrap:anywhere}',
      '.dsse-menu-item:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12))}',
      '.dsse-menu-icon{display:inline-flex;flex:none;color:var(--dsw-alias-label-secondary,currentColor)}',
      '.dsse-menu-icon svg{display:block}',

      // 编辑对话框
      // shell.overlay 整层是点击穿透的（pointer-events:none），弹窗必须自己重新打开指针事件，
      // 否则遮罩和对话框都点不动 —— pointer-events 会继承，只写 backdrop 一处即可。
      '.dsse-backdrop{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;background:rgba(0,0,0,.42);pointer-events:auto}',
      '.dsse-dialog{display:flex;flex-direction:column;gap:12px;box-sizing:border-box;width:min(620px,94vw);max-height:min(78vh,720px);padding:18px;border-radius:14px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1,#1f232b));color:var(--dsw-alias-label-primary,inherit);box-shadow:0 18px 48px rgba(0,0,0,.36)}',
      '.dsse-dialog-title{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;line-height:22px}',
      '.dsse-dialog-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,inherit)}',
      '.dsse-dialog-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,inherit);overflow-wrap:anywhere}',
      '.dsse-textarea{box-sizing:border-box;width:100%;min-height:150px;max-height:46vh;resize:vertical;padding:10px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.45));background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;font:inherit;font-size:13px;line-height:1.55;outline:none}',
      '.dsse-textarea:focus{border-color:var(--dsw-alias-brand-primary,#4c8dff)}',
      '.dsse-dialog-error{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#ff453a);overflow-wrap:anywhere}',
      '.dsse-dialog-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}',
      '.dsse-spacer{flex:1}',
      '.dsse-loading{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary,inherit);padding:14px 2px}',
      '.dsse-spin{width:12px;height:12px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2,rgba(127,127,127,.5));border-top-color:var(--dsw-alias-brand-primary,#4c8dff);animation:dsse-spin .8s linear infinite}',
      '@keyframes dsse-spin{to{transform:rotate(360deg)}}',
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

    // ---- 桥接 -------------------------------------------------------------
    function bootInfo() {
      if (typeof globalThis === 'undefined') return null;
      var value = globalThis[BOOT_GLOBAL];
      return value !== null && typeof value === 'object' ? value : null;
    }

    function bridgePrefix() {
      var boot = bootInfo();
      if (boot !== null && typeof boot.prefix === 'string' && boot.prefix.length > 0) {
        return boot.prefix.replace(/\/+$/, '');
      }
      return DEFAULT_PREFIX;
    }

    function pluginVersion() {
      var boot = bootInfo();
      return boot !== null && typeof boot.version === 'string' ? boot.version : '0.0.0';
    }

    function postJson(path, body) {
      var options = {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body !== undefined ? body : {}),
        credentials: 'same-origin',
        cache: 'no-store',
      };
      return fetch(bridgePrefix() + path, options).then(function (response) {
        return response.json().then(function (payload) { return payload; }, function () {
          return { ok: false, code: 'bad-response', message: 'HTTP ' + String(response.status) };
        });
      }, function (error) {
        return { ok: false, code: 'network-error', message: errorText(error) };
      });
    }

    function errorText(error) {
      if (error !== null && typeof error === 'object' && typeof error.message === 'string' && error.message.length > 0) {
        return error.message;
      }
      return String(error);
    }

    // ---- 文案 -------------------------------------------------------------
    var DICT = {
      zh: {
        nav: '会话重发',
        panelTitle: '会话重发台',
        panelSubtitle: '编辑上一次提问后重新发送。重发走 DSH 原生分叉：新分支从那条提问之前开始，原会话原样保留。',
        search: '搜索标题或目录',
        count: '{n} 个会话',
        open: '打开',
        rewrite: '编辑重发',
        empty: '这里还没有可见的会话',
        noHook: '当前宿主没有提供会话列表接口，无法列出会话',
        running: '运行中',
        ungrouped: '未分组',
        dialogTitle: '编辑上一次提问',
        dialogHint: '改好的内容会成为新分支的第一句话；原会话不会被修改，随时可以回去。',
        forkNote: '将从「{time}」这条提问之前分叉',
        firstNote: '这是第一句提问，没有更早的历史可以分叉；只能载入输入框后作为新消息发送。',
        cancel: '取消',
        send: '重发并发送',
        loadOnly: '仅载入输入框',
        loading: '正在读取上一次提问…',
        failed: '读取失败',
        noPrompt: '这个会话里还没有可以编辑的提问',
        busy: '正在创建分支…',
        applied: '已载入上一次提问，修改后发送即可。',
        manual: '输入框没有准备好。复制下面这段文字，粘贴到输入框里即可。',
        dismiss: '知道了',
        images: '{n} 张图片',
        files: '{n} 个文件',
        replied: '有旧回答',
        notReplied: '尚无回答',
        menuLabel: '编辑上次提问…',
        chipLabel: '编辑上次提问',
        navAria: '会话重发台',
        forkFailed: '分叉失败：',
        notReady: '插件还没就绪，请刷新页面后再试',
        readFailed: '读取失败：',
        version: 'v{version}',
        kept: '原会话保留',
        loadingSessions: '正在读取会话…',
      },
      en: {
        nav: 'Session Rewrite',
        panelTitle: 'Session Rewrite',
        panelSubtitle: 'Edit your previous prompt and send it again. Resending forks the session before that prompt; the original conversation is kept as-is.',
        search: 'Search title or directory',
        count: '{n} sessions',
        open: 'Open',
        rewrite: 'Edit & resend',
        empty: 'No visible sessions yet',
        noHook: 'This host does not expose the session list to plugins',
        running: 'Running',
        ungrouped: 'Ungrouped',
        dialogTitle: 'Edit previous prompt',
        dialogHint: 'The edited text becomes the first message of a new branch. The original conversation is never modified.',
        forkNote: 'Forks right before the prompt from {time}',
        firstNote: 'This is the first prompt, so there is no earlier history to fork. It can only be loaded into the composer as a new message.',
        cancel: 'Cancel',
        send: 'Resend & send',
        loadOnly: 'Load into composer',
        loading: 'Reading the previous prompt…',
        failed: 'Failed to read',
        noPrompt: 'This session has no editable prompt yet',
        busy: 'Creating branch…',
        applied: 'Previous prompt loaded. Edit it and send.',
        manual: 'The composer is not ready. Copy the text below into the composer.',
        dismiss: 'Got it',
        images: '{n} images',
        files: '{n} files',
        replied: 'Has a reply',
        notReplied: 'No reply yet',
        menuLabel: 'Edit previous prompt…',
        chipLabel: 'Edit previous prompt',
        navAria: 'Session Rewrite',
        forkFailed: 'Fork failed: ',
        notReady: 'Plugin is not ready yet; refresh the page and try again',
        readFailed: 'Read failed: ',
        version: 'v{version}',
        kept: 'Original kept',
        loadingSessions: 'Reading sessions…',
      },
    };

    var localeService = null;

    function dictionary() {
      var id = 'zh';
      if (localeService !== null && typeof localeService.getLocale === 'function') {
        try {
          var snap = localeService.getLocale();
          if (snap !== null && typeof snap === 'object' && typeof snap.id === 'string') id = snap.id;
        } catch (error) { id = 'zh'; }
      }
      return DICT[id] !== undefined ? DICT[id] : DICT.zh;
    }

    function t(key, vars) {
      var dict = dictionary();
      var text = typeof dict[key] === 'string' ? dict[key] : (typeof DICT.zh[key] === 'string' ? DICT.zh[key] : key);
      if (vars !== null && typeof vars === 'object') {
        text = text.replace(/\{([a-zA-Z0-9_]+)\}/g, function (match, name) {
          return vars[name] !== undefined ? String(vars[name]) : match;
        });
      }
      return text;
    }

    /** 语言切换后重渲染（locale 服务不可用时退化成静态）。 */
    function useLocaleTick() {
      var state = react.useState(0);
      react.useEffect(function () {
        if (localeService === null || typeof localeService.subscribe !== 'function') return undefined;
        var off = localeService.subscribe(function () {
          state[1](function (n) { return n + 1; });
        });
        return typeof off === 'function' ? off : undefined;
      }, []);
      return state[0];
    }

    // ---- 服务引用（apply 里按需注入） --------------------------------------
    var services = { sessions: null, uiWorkspace: null };

    // ---- 待载入输入框的文本 ------------------------------------------------
    //
    // 分叉后要打开新会话，而「把文字放进输入框」只有那个会话的 composer 能做。
    // 所以这里只放一份按会话 id 索引的待办，让那个会话的 DockChip 取走。
    var prefill = { items: Object.create(null), listeners: new Set() };

    function emitPrefill() {
      prefill.listeners.forEach(function (listener) {
        try { listener(); } catch (error) { /* 别人的回调，别影响自己 */ }
      });
    }

    function putPrefill(sessionId, item) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return;
      prefill.items[sessionId] = item;
      emitPrefill();
    }

    function takePrefill(sessionId) {
      var item = prefill.items[sessionId];
      if (item === undefined) return null;
      delete prefill.items[sessionId];
      return item;
    }

    function subscribePrefill(listener) {
      prefill.listeners.add(listener);
      return function () { prefill.listeners.delete(listener); };
    }

    function usePrefillTick() {
      var state = react.useState(0);
      react.useEffect(function () {
        return subscribePrefill(function () {
          state[1](function (n) { return n + 1; });
        });
      }, []);
      return state[0];
    }

    // ---- 编辑对话框状态 ----------------------------------------------------
    var dialog = { state: null, listeners: new Set() };

    function emitDialog() {
      dialog.listeners.forEach(function (listener) {
        try { listener(); } catch (error) { /* ignore */ }
      });
    }

    function setDialog(patch) {
      if (dialog.state === null) return;
      dialog.state = Object.assign({}, dialog.state, patch);
      emitDialog();
    }

    function closeDialog() {
      dialog.state = null;
      emitDialog();
    }

    function openDialog(request) {
      var sessionId = request !== null && typeof request === 'object' ? request.sessionId : undefined;
      if (typeof sessionId !== 'string' || sessionId.length === 0) return;
      dialog.state = {
        sessionId: sessionId,
        title: typeof request.title === 'string' ? request.title : '',
        phase: 'loading',
        text: '',
        error: '',
        source: null,
      };
      emitDialog();
      postJson('/last-prompt', { sessionId: sessionId }).then(function (result) {
        if (dialog.state === null || dialog.state.sessionId !== sessionId) return;
        if (result === null || typeof result !== 'object' || result.ok !== true) {
          var message = result !== null && typeof result === 'object' && typeof result.message === 'string'
            ? result.message
            : t('failed');
          var code = result !== null && typeof result === 'object' && result.code === 'no-prompt' ? 'no-prompt' : 'error';
          setDialog({ phase: 'error', error: code === 'no-prompt' ? t('noPrompt') : message, errorCode: code });
          return;
        }
        setDialog({ phase: 'ready', text: typeof result.text === 'string' ? result.text : '', source: result, error: '' });
      });
    }

    function useDialogState() {
      var state = react.useState(0);
      react.useEffect(function () {
        var listener = function () { state[1](function (n) { return n + 1; }); };
        dialog.listeners.add(listener);
        return function () { dialog.listeners.delete(listener); };
      }, []);
      return state[0];
    }

    // ---- 图标 -------------------------------------------------------------
    /** 「回复」箭头：弯回左边的箭头，表示把上一句拿回来重发。 */
    function replyPaths() {
      return [
        react.createElement('path', {
          key: 'head',
          d: 'M6.2 3.1 2.4 6.9l3.8 3.8',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.25,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        react.createElement('path', {
          key: 'tail',
          d: 'M2.4 6.9h6.1a4.3 4.3 0 0 1 0 8.6H6.2',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.25,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      ];
    }

    function ReplyIcon(props) {
      var size = props !== null && typeof props === 'object' && typeof props.size === 'number' ? props.size : 16;
      return react.createElement('span', { className: 'dsse-icon', 'aria-hidden': 'true' }, react.createElement('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
      }, replyPaths()));
    }

    /** 左侧栏入口图标（sidebar.panellist owner props：size / active）。 */
    function SidebarEntryIcon(props) {
      var size = props !== null && typeof props === 'object' && typeof props.size === 'number' ? props.size : 16;
      var active = props !== null && typeof props === 'object' && props.active === true;
      return react.createElement('span', {
        className: 'dsse-icon',
        style: { opacity: active ? 1 : 0.78 },
        'aria-hidden': 'true',
      }, react.createElement('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
      }, replyPaths()));
    }

    // ---- 工具 -------------------------------------------------------------
    function formatTime(value) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '';
      try {
        return new Intl.DateTimeFormat(undefined, {
          month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
        }).format(new Date(value));
      } catch (error) {
        return '';
      }
    }

    function selectAll(state) { return state; }

    function useNothing() { return null; }

    function keyOfSession(row) {
      return row !== null && typeof row === 'object' && typeof row.id === 'string' ? row.id : '';
    }

    function titleOfSession(row, fallbackId) {
      if (row !== null && typeof row === 'object') {
        if (typeof row.displayTitle === 'string' && row.displayTitle.length > 0) return row.displayTitle;
        if (typeof row.title === 'string' && row.title.length > 0) return row.title;
      }
      return typeof fallbackId === 'string' && fallbackId.length > 0 ? fallbackId.slice(0, 8) : 'session';
    }

    function workspaceOfSession(workspaces, sessionId) {
      if (workspaces === null || typeof workspaces !== 'object' || !Array.isArray(workspaces.items)) return null;
      for (var i = 0; i < workspaces.items.length; i += 1) {
        var item = workspaces.items[i];
        if (item === null || typeof item !== 'object' || !Array.isArray(item.sessionIds)) continue;
        if (item.sessionIds.indexOf(sessionId) >= 0) return item;
      }
      return null;
    }

    // ---- 重发动作 ---------------------------------------------------------
    function openSession(sessionId) {
      if (services.uiWorkspace !== null && typeof services.uiWorkspace.openSession === 'function') {
        services.uiWorkspace.openSession(sessionId);
        return true;
      }
      return false;
    }

    /**
     * 把改好的文字送回某个会话：先登记待办，再打开它。
     * 打开后由那个会话的 DockChip 取走，setDraft / submit。
     */
    function deliverText(sessionId, text, submit) {
      putPrefill(sessionId, { text: text, submit: submit === true });
      openSession(sessionId);
    }

    /** 对话框：仅载入输入框（不分叉，作为当前会话的新消息）。 */
    function loadIntoComposer() {
      if (dialog.state === null || dialog.state.phase !== 'ready') return;
      var text = dialog.state.text;
      if (text.trim().length === 0) return;
      deliverText(dialog.state.sessionId, text, false);
      closeDialog();
    }

    /** 对话框：分叉并发送。 */
    function forkAndSend() {
      if (dialog.state === null || dialog.state.phase !== 'ready') return;
      var state = dialog.state;
      var text = state.text;
      if (text.trim().length === 0) return;
      var source = state.source;
      var prevSeq = source !== null && typeof source === 'object' ? source.prevSeq : null;
      if (typeof prevSeq !== 'number') {
        setDialog({ error: t('firstNote') });
        return;
      }
      if (services.sessions === null || typeof services.sessions.fork !== 'function') {
        setDialog({ error: t('notReady') });
        return;
      }
      setDialog({ phase: 'busy', error: '' });
      var request = { sessionId: state.sessionId, atSeq: prevSeq, increaseTitle: true };
      Promise.resolve().then(function () {
        return services.sessions.fork(request);
      }).then(function (childId) {
        if (typeof childId !== 'string' || childId.length === 0) throw new Error('fork returned no session id');
        putPrefill(childId, { text: text, submit: true });
        if (!openSession(childId)) {
          // 没打开成功就把待办撤掉，免得它一直挂在那儿等一个不会出现的 composer。
          takePrefill(childId);
          setDialog({ phase: 'ready', error: t('notReady') });
          return;
        }
        closeDialog();
      }, function (error) {
        setDialog({ phase: 'ready', error: t('forkFailed') + errorText(error) });
      });
    }

    // ---- 左侧栏入口（main 面板） -------------------------------------------
    function Panel(props) {
      useLocaleTick();
      var sessions = props !== null && props !== undefined && typeof props.useSessions === 'function' ? props : null;
      var useSessionsHook = sessions !== null ? sessions.useSessions : useNothing;
      var useWorkspacesHook = props !== null && props !== undefined && typeof props.useWorkspaces === 'function'
        ? props.useWorkspaces
        : useNothing;
      var sessionState = useSessionsHook(selectAll);
      var workspaceState = useWorkspacesHook(selectAll);
      var queryState = react.useState('');
      var query = queryState[0];
      var setQuery = queryState[1];

      var rows = [];
      if (sessionState !== null && typeof sessionState === 'object' && sessionState.byId !== null && typeof sessionState.byId === 'object') {
        var ids = Array.isArray(sessionState.ids) ? sessionState.ids : Object.keys(sessionState.byId);
        var archived = workspaceState !== null && typeof workspaceState === 'object' && Array.isArray(workspaceState.archivedSessionIds)
          ? workspaceState.archivedSessionIds
          : [];
        var archivedSet = new Set(archived);
        var needle = typeof query === 'string' ? query.trim().toLowerCase() : '';
        for (var index = 0; index < ids.length; index += 1) {
          var id = ids[index];
          var row = sessionState.byId[id];
          if (row === null || typeof row !== 'object') continue;
          if (row.origin === 'subagent') continue;
          if (row.blank === true) continue;
          if (archivedSet.has(id)) continue;
          var workspace = workspaceOfSession(workspaceState, id);
          var title = titleOfSession(row, id);
          var cwd = typeof row.cwd === 'string' ? row.cwd : (workspace !== null && typeof workspace.path === 'string' ? workspace.path : '');
          if (needle.length > 0) {
            var haystack = (title + '\n' + cwd + '\n' + id).toLowerCase();
            if (haystack.indexOf(needle) < 0) continue;
          }
          rows.push({ id: id, row: row, title: title, cwd: cwd, workspace: workspace });
        }
        rows.sort(function (a, b) {
          var au = typeof a.row.updatedAt === 'number' ? a.row.updatedAt : 0;
          var bu = typeof b.row.updatedAt === 'number' ? b.row.updatedAt : 0;
          return bu - au;
        });
      }

      function onOpen(id) {
        if (!openSession(id)) return;
      }

      var countText = t('count', { n: rows.length });

      return react.createElement('div', { className: 'dsse-panel' }, [
        react.createElement('div', { className: 'dsse-panel-head', key: 'head' }, [
          react.createElement('h1', { className: 'dsse-panel-title', key: 'title' }, [
            react.createElement(ReplyIcon, { key: 'icon', size: 18 }),
            react.createElement('span', { key: 'text' }, t('panelTitle')),
          ]),
          react.createElement('p', { className: 'dsse-panel-sub', key: 'sub' }, t('panelSubtitle')),
        ]),
        react.createElement('div', { className: 'dsse-toolbar', key: 'toolbar' }, [
          react.createElement('input', {
            key: 'search',
            className: 'dsse-search',
            type: 'search',
            value: query,
            placeholder: t('search'),
            'aria-label': t('search'),
            onChange: function (event) { setQuery(event.target.value); },
          }),
          react.createElement('span', { className: 'dsse-count', key: 'count' }, countText),
        ]),
        sessionState === null
          ? react.createElement('div', { className: 'dsse-empty', key: 'nohook' }, t('noHook'))
          : rows.length === 0
            ? react.createElement('div', { className: 'dsse-empty', key: 'empty' }, t('empty'))
            : react.createElement('ul', { className: 'dsse-list', key: 'list' }, rows.map(function (entry) {
              var workspaceTitle = entry.workspace !== null
                ? (typeof entry.workspace.title === 'string' && entry.workspace.title.length > 0 ? entry.workspace.title : t('ungrouped'))
                : t('ungrouped');
              var updated = formatTime(entry.row.updatedAt);
              var meta = [workspaceTitle, updated].filter(function (part) { return typeof part === 'string' && part.length > 0; }).join(' · ');
              return react.createElement('li', { className: 'dsse-row', key: entry.id }, [
                react.createElement('button', {
                  key: 'main',
                  type: 'button',
                  className: 'dsse-row-main',
                  title: entry.cwd || entry.id,
                  onClick: function () { onOpen(entry.id); },
                }, [
                  react.createElement('span', { className: 'dsse-row-title', key: 't' }, entry.title),
                  react.createElement('span', { className: 'dsse-row-meta', key: 'm' }, [
                    entry.row.running === true ? react.createElement('span', { key: 'dot', className: 'dsse-dot', title: t('running') }) : null,
                    react.createElement('span', { key: 'text' }, meta),
                  ]),
                ]),
                react.createElement('div', { className: 'dsse-row-actions', key: 'actions' }, [
                  react.createElement('button', {
                    key: 'rewrite',
                    type: 'button',
                    className: 'dsse-btn dsse-btn-primary',
                    onClick: function () { openDialog({ sessionId: entry.id, title: entry.title }); },
                  }, t('rewrite')),
                  react.createElement('button', {
                    key: 'open',
                    type: 'button',
                    className: 'dsse-btn',
                    onClick: function () { onOpen(entry.id); },
                  }, t('open')),
                ]),
              ]);
            })),
        react.createElement('div', { className: 'dsse-foot', key: 'foot' }, [
          react.createElement('span', { key: 'hint' }, t('kept')),
          react.createElement('span', { key: 'ver', className: 'dsse-badge' }, t('version', { version: pluginVersion() })),
        ]),
      ]);
    }

    // ---- composer 上方的入口 -----------------------------------------------
    function DockChip(props) {
      useLocaleTick();
      var prefillTick = usePrefillTick();
      var sessionId = props !== null && props !== undefined
        ? (typeof props.sessionId === 'string'
          ? props.sessionId
          : (props.session !== null && props.session !== undefined && typeof props.session.id === 'string' ? props.session.id : undefined))
        : undefined;
      var blank = props !== null && props !== undefined && props.session !== null && typeof props.session === 'object'
        ? props.session.blank === true
        : false;
      var actions = props !== null && props !== undefined && props.inputActions !== null && typeof props.inputActions === 'object'
        ? props.inputActions
        : null;
      var noteState = react.useState(null);
      var note = noteState[0];
      var setNote = noteState[1];

      react.useEffect(function () {
        if (typeof sessionId !== 'string' || sessionId.length === 0) return;
        if (blank) return;
        var item = takePrefill(sessionId);
        if (item === null) return;
        var canDraft = actions !== null && typeof actions.setDraft === 'function';
        if (!canDraft) {
          setNote({ kind: 'manual', text: item.text });
          return;
        }
        try {
          actions.setDraft(item.text);
        } catch (error) {
          setNote({ kind: 'manual', text: item.text, error: errorText(error) });
          return;
        }
        if (item.submit === true && typeof actions.submit === 'function') {
          // 给编辑器一帧把 draft 落进 DOM/状态，再提交。
          setTimeout(function () {
            try { actions.submit(); } catch (error) { /* 由输入框自己的错误条报告 */ }
          }, 80);
        }
        setNote({ kind: 'ok', text: '' });
      }, [sessionId, prefillTick, blank]);

      if (typeof sessionId !== 'string' || sessionId.length === 0) return null;
      if (blank) return null;

      var parts = [];
      parts.push(react.createElement('div', { className: 'dsse-dock-row', key: 'row' }, [
        react.createElement('button', {
          key: 'chip',
          type: 'button',
          className: 'dsse-chip',
          title: t('chipLabel'),
          onClick: function () { openDialog({ sessionId: sessionId }); },
        }, [
          react.createElement(ReplyIcon, { key: 'icon', size: 14 }),
          react.createElement('span', { key: 'label', className: 'dsse-chip-label' }, t('chipLabel')),
        ]),
      ]));

      if (note !== null) {
        if (note.kind === 'manual') {
          parts.push(react.createElement('div', { className: 'dsse-note', key: 'manual' }, [
            react.createElement('div', { key: 'body', className: 'dsse-note-text' }, [
              react.createElement('div', { key: 'msg' }, t('manual')),
              react.createElement('textarea', {
                key: 'ta',
                className: 'dsse-manual',
                readOnly: true,
                value: note.text,
                rows: 4,
                onFocus: function (event) { try { event.target.select(); } catch (error) { /* ignore */ } },
              }),
            ]),
            react.createElement('button', {
              key: 'close',
              type: 'button',
              className: 'dsse-note-close',
              onClick: function () { setNote(null); },
            }, t('dismiss')),
          ]));
        } else {
          parts.push(react.createElement('div', { className: 'dsse-note', key: 'ok' }, [
            react.createElement('span', { key: 'text', className: 'dsse-note-text' }, t('applied')),
            react.createElement('button', {
              key: 'close',
              type: 'button',
              className: 'dsse-note-close',
              onClick: function () { setNote(null); },
            }, t('dismiss')),
          ]));
        }
      }

      return react.createElement('div', { className: 'dsse-dock' }, parts);
    }

    // ---- 会话行「…」菜单 ---------------------------------------------------
    function MenuItem(props) {
      useLocaleTick();
      var sessionId = props !== null && props !== undefined && typeof props.sessionId === 'string' ? props.sessionId : undefined;
      var useMenuOpenState = props !== null && props !== undefined && typeof props.useMenuOpenState === 'function'
        ? props.useMenuOpenState
        : null;
      var menuState = null;
      if (useMenuOpenState !== null) {
        try { menuState = useMenuOpenState(); } catch (error) { menuState = null; }
      }
      if (typeof sessionId !== 'string' || sessionId.length === 0) return null;
      return react.createElement('button', {
        type: 'button',
        role: 'menuitem',
        className: 'dsse-menu-item',
        onClick: function () {
          if (Array.isArray(menuState) && typeof menuState[1] === 'function') {
            try { menuState[1](false); } catch (error) { /* ignore */ }
          }
          openDialog({ sessionId: sessionId });
        },
      }, [
        react.createElement('span', { key: 'icon', className: 'dsse-menu-icon' }, react.createElement(ReplyIcon, { size: 16 })),
        react.createElement('span', { key: 'label' }, t('menuLabel')),
      ]);
    }

    // ---- 编辑对话框 -------------------------------------------------------
    function DialogHost() {
      useDialogState();
      useLocaleTick();
      var textareaRef = react.useRef(null);
      var state = dialog.state;
      var open = state !== null;

      react.useEffect(function () {
        if (!open) return undefined;
        function onKeyDown(event) {
          if (event.key === 'Escape') {
            if (dialog.state !== null && dialog.state.phase === 'busy') return;
            event.stopPropagation();
            closeDialog();
          }
        }
        document.addEventListener('keydown', onKeyDown, true);
        return function () { document.removeEventListener('keydown', onKeyDown, true); };
      }, [open]);

      var readySessionId = state !== null && state.phase === 'ready' ? state.sessionId : null;

      react.useEffect(function () {
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
      var loadingPhase = state.phase === 'loading';
      var text = typeof state.text === 'string' ? state.text : '';
      var source = state.source;
      var prevSeq = source !== null && typeof source === 'object' ? source.prevSeq : null;
      var canFork = typeof prevSeq === 'number';
      var metaParts = [];
      if (state.title.length > 0) metaParts.push(state.title);
      if (source !== null && typeof source === 'object') {
        var when = formatTime(source.time);
        if (when.length > 0) metaParts.push(when);
        if (source.replied === true) metaParts.push(t('replied'));
        if (typeof source.images === 'number' && source.images > 0) metaParts.push(t('images', { n: source.images }));
        if (typeof source.files === 'number' && source.files > 0) metaParts.push(t('files', { n: source.files }));
      }

      var body = [];
      if (loadingPhase) {
        body.push(react.createElement('div', { className: 'dsse-loading', key: 'loading' }, [
          react.createElement('span', { key: 'spin', className: 'dsse-spin' }),
          react.createElement('span', { key: 'text' }, t('loading')),
        ]));
      } else if (state.phase === 'error') {
        body.push(react.createElement('div', { className: 'dsse-dialog-error', key: 'error' }, state.error));
      } else {
        body.push(react.createElement('textarea', {
          key: 'textarea',
          ref: textareaRef,
          className: 'dsse-textarea',
          value: text,
          spellCheck: false,
          onChange: function (event) { setDialog({ text: event.target.value }); },
          onKeyDown: function (event) {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              forkAndSend();
            }
          },
        }));
        body.push(react.createElement('p', { key: 'hint', className: 'dsse-dialog-hint' },
          canFork
            ? t('forkNote', { time: source !== null && typeof source === 'object' ? (formatTime(source.time) || '—') : '—' })
            : t('firstNote')));
        if (typeof state.error === 'string' && state.error.length > 0) {
          body.push(react.createElement('div', { key: 'err', className: 'dsse-dialog-error' }, state.error));
        }
      }

      var actions = [];
      if (busy) {
        actions.push(react.createElement('div', { key: 'busy', className: 'dsse-loading' }, [
          react.createElement('span', { key: 'spin', className: 'dsse-spin' }),
          react.createElement('span', { key: 'text' }, t('busy')),
        ]));
      }
      actions.push(react.createElement('span', { key: 'spacer', className: 'dsse-spacer' }));
      actions.push(react.createElement('button', {
        key: 'cancel',
        type: 'button',
        className: 'dsse-btn',
        disabled: busy,
        onClick: closeDialog,
      }, t('cancel')));
      if (state.phase === 'ready') {
        actions.push(react.createElement('button', {
          key: 'load',
          type: 'button',
          className: 'dsse-btn',
          disabled: busy || text.trim().length === 0,
          onClick: loadIntoComposer,
        }, t('loadOnly')));
        if (canFork) {
          actions.push(react.createElement('button', {
            key: 'send',
            type: 'button',
            className: 'dsse-btn dsse-btn-primary',
            disabled: busy || text.trim().length === 0,
            onClick: forkAndSend,
          }, t('send')));
        }
      }

      return react.createElement('div', {
        className: 'dsse-backdrop',
        key: 'backdrop',
        onMouseDown: function (event) {
          if (event.target !== event.currentTarget) return;
          if (dialog.state !== null && dialog.state.phase === 'busy') return;
          closeDialog();
        },
      }, react.createElement('div', {
        className: 'dsse-dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('dialogTitle'),
      }, [
        react.createElement('div', { className: 'dsse-dialog-title', key: 'title' }, [
          react.createElement(ReplyIcon, { key: 'icon', size: 16 }),
          react.createElement('span', { key: 'text' }, t('dialogTitle')),
        ]),
        metaParts.length > 0
          ? react.createElement('div', { className: 'dsse-dialog-meta', key: 'meta' }, metaParts.map(function (part, index) {
            return react.createElement('span', { key: 'm' + index }, part);
          }))
          : null,
        react.createElement('p', { className: 'dsse-dialog-hint', key: 'dialogHint' }, t('dialogHint')),
      ].concat(body).concat([react.createElement('div', { className: 'dsse-dialog-actions', key: 'actions' }, actions)])));
    }

    // ---- 挂载 -------------------------------------------------------------
    var inject = ['slots'];

    function apply(ctx) {
      ensureStyles();

      ctx.inject(['locale'], function (scoped) {
        localeService = scoped.locale;
        try {
          scoped.locale.register(NS, { zh: DICT.zh, en: DICT.en });
        } catch (error) { /* 已注册过就算了 */ }
      });
      ctx.inject(['sessions'], function (scoped) {
        services.sessions = scoped.sessions;
      });
      ctx.inject(['uiWorkspace'], function (scoped) {
        services.uiWorkspace = scoped.uiWorkspace;
      });

      var disposers = [];

      // 左侧栏入口：图标 + 同名 main 面板。
      disposers.push(ctx.slots.inject('sidebar.panellist', function () {
        return ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 2,
          label: function () { return t('nav'); },
        }, SidebarEntryIcon);
      }));
      disposers.push(ctx.slots.inject('main', function () {
        return ctx.slots.register({ name: 'main', key: PANEL_ID }, Panel);
      }));

      // 会话页 composer 上方的入口。
      disposers.push(ctx.slots.inject('conversation.input.dock', function () {
        return ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'session-extension-edit',
          order: 12,
        }, DockChip);
      }));

      // 会话行「…」菜单。
      disposers.push(ctx.slots.inject('sidebar.workspaces.session.menu.item', function () {
        return ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'session-extension-edit',
          order: 340,
        }, MenuItem);
      }));

      // 对话框画在 shell.overlay（整帧浮动层），不会被会话切换带走。
      disposers.push(ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register({
          name: 'shell.overlay',
          id: 'session-extension-dialog',
        }, DialogHost);
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
    exports.inject = inject;
    exports.__internal = {
      DICT: DICT,
      panelId: PANEL_ID,
      bridgePrefix: bridgePrefix,
      openDialog: openDialog,
      closeDialog: closeDialog,
      forkAndSend: forkAndSend,
      loadIntoComposer: loadIntoComposer,
      deliverText: deliverText,
      putPrefill: putPrefill,
      takePrefill: takePrefill,
      prefillState: function () { return prefill.items; },
      dialogState: function () { return dialog.state; },
      Panel: Panel,
      DockChip: DockChip,
      MenuItem: MenuItem,
      DialogHost: DialogHost,
      SidebarEntryIcon: SidebarEntryIcon,
    };
    return module.exports;
  },
});
