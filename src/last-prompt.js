/**
 * dsh-session-extension —— 纯函数：从会话日志里找「上一次提问」。
 *
 * 这里刻意不依赖任何 @deepseek-ai/* 包，只吃 dsh-session-query 返回的
 * 事件快照（{ seq, type, time, data, surfaceOp? }）：
 *
 *   - 只认 `user/message`，且 `data.role === 'user'`、`data.source.kind === 'user'`
 *     —— 注入上下文、压缩检查点、子代理消息都有各自的 source.kind，不能当成
 *     用户亲手打的那句话；
 *   - 只认 append 来源的 surface 事件：替换副本（surfaceOp: 'replace'）是模型
 *     可见面的补丁，不是用户看到的对话记录；
 *   - 文本为空（纯附件）的那条不算，因为它没法「改一改再发」。
 *
 * @module dsh-session-extension/last-prompt
 */

/** 一条内容块是不是文本块。 */
export function isTextBlock(block) {
  return (
    block !== null &&
    typeof block === 'object' &&
    block.type === 'text' &&
    typeof block.text === 'string'
  );
}

/**
 * 把一条消息的 content 块拼成纯文本。
 *
 * @param content - user/message 的 content 数组（也可能是字符串）。
 * @returns 拼接后的文本；没有文本块时返回空串。
 */
export function textOfContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (isTextBlock(block)) parts.push(block.text);
  }
  return parts.join('\n');
}

/**
 * 统计一条消息里的非文本块数量（图片、文件……）。
 *
 * @param content - user/message 的 content 数组。
 * @returns { images, files } 两个计数。
 */
export function countAttachments(content) {
  const counts = { images: 0, files: 0 };
  if (!Array.isArray(content)) return counts;
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue;
    if (block.type === 'image') counts.images += 1;
    else if (block.type === 'file') counts.files += 1;
    else if (block.type === 'text') continue;
  }
  return counts;
}

/**
 * 是不是「追加」进入对话记录的事件（替换副本不算）。
 *
 * 老版本日志没有 surfaceOp 字段，按追加处理，否则会把整段历史都当成不可选。
 *
 * @param event - 一条会话事件。
 * @returns true 表示可以进入人类可见的转录。
 */
export function isAppendSurfaceEvent(event) {
  if (event === null || typeof event !== 'object') return false;
  return event.surfaceOp === undefined || event.surfaceOp === 'append';
}

/**
 * 找最后一条用户亲手发送的提问。
 *
 * @param events - 升序排列的完整事件快照。
 * @returns `{ index, seq, prevSeq, text, time, images, files }`，找不到返回 null。
 *   prevSeq 是这条提问**前一条**事件的 seq（没有前一条时为 null），
 *   它正好是 fork 要用的「不含本条提问」的闭区右端点。
 */
export function findLastPrompt(events) {
  if (!Array.isArray(events)) return null;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event === null || typeof event !== 'object') continue;
    if (event.type !== 'user/message') continue;
    if (!isAppendSurfaceEvent(event)) continue;
    const data = event.data;
    if (data === null || typeof data !== 'object') continue;
    if (data.role !== 'user') continue;
    const source = data.source;
    if (source === null || typeof source !== 'object' || source.kind !== 'user') continue;
    const text = textOfContent(data.content).trim();
    if (text.length === 0) continue;
    const attachments = countAttachments(data.content);
    return {
      index,
      seq: event.seq,
      prevSeq: index > 0 && events[index - 1] !== undefined ? events[index - 1].seq : null,
      text,
      time: typeof event.time === 'number' && Number.isFinite(event.time) ? event.time : 0,
      images: attachments.images,
      files: attachments.files,
    };
  }
  return null;
}

/**
 * 那条提问之后有没有已经落盘的助手回复。
 *
 * 只用来给界面加一句说明（有没有「可以对比的旧回答」），不参与迁移逻辑。
 *
 * @param events - 升序排列的完整事件快照。
 * @param promptIndex - findLastPrompt 返回的 index。
 * @returns true 表示这条提问之后至少有一条 assistant/message。
 */
export function hasReplyAfter(events, promptIndex) {
  if (!Array.isArray(events)) return false;
  for (let index = promptIndex + 1; index < events.length; index += 1) {
    const event = events[index];
    if (event === null || typeof event !== 'object') continue;
    if (event.type !== 'assistant/message') continue;
    if (!isAppendSurfaceEvent(event)) continue;
    return true;
  }
  return false;
}
