import { getConfig, resolveApiKeys } from '../config.mjs';

/** 从模型回复里稳妥地取出 JSON（容忍代码块、前后废话、推理字段） */
export function extractJson(text) {
  if (!text) throw new Error('空回复');
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const objAt = s.indexOf('{');
  const arrAt = s.indexOf('[');
  let start = -1;
  if (arrAt >= 0 && (objAt < 0 || arrAt < objAt)) start = arrAt;
  else if (objAt >= 0) start = objAt;
  if (start < 0) throw new Error(`回复中没有 JSON：${s.slice(0, 200)}`);
  const openCh = s[start];
  const closeCh = openCh === '[' ? ']' : '}';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return JSON.parse(s.slice(start, i + 1));
    }
  }
  throw new Error(`JSON 不完整：${s.slice(0, 200)}`);
}

let cachedKeys = null;
async function apiKeys() {
  if (cachedKeys === null) cachedKeys = await resolveApiKeys();
  return cachedKeys;
}

export function resetApiKeyCache() {
  cachedKeys = null;
}

/**
 * 依次尝试可用的密钥；某一把被上游掐断（如 key 过期/限流）时自动换下一把。
 */
export async function chat(opts) {
  const keys = await apiKeys();
  if (!keys.length) {
    throw new Error(
      '未配置 LLM 密钥：请在网页「设置」里填写，或设置环境变量 LLM_API_KEY，或在 .env 里填 LLM_API_KEY',
    );
  }
  let lastErr;
  for (let i = 0; i < keys.length; i++) {
    try {
      return await chatWithKey(keys[i], opts);
    } catch (err) {
      lastErr = err;
      // 只有看起来像"这把 key 不行"的错误才换 key；批次内容本身有错就别浪费
      const msg = String(err?.message || '');
      const retriable = /terminated|aborted|超时|空内容|50\d|40[13]|fetch failed|ECONN|socket/i.test(msg);
      if (!retriable || i === keys.length - 1) throw err;
    }
  }
  throw lastErr;
}

/**
 * 调 OpenAI 兼容的 /chat/completions（流式）。
 *
 * 用流式不是为了边出边渲染，而是为了稳定：反代/网关通常对**非流式**请求设了
 * 较短的读取空闲超时（本机代理是 90s），而推理模型一次生成常常超过这个时间，
 * 结果就是 200 但 content 为空。流式每次收到分片都会重置空闲计时，长生成不再被误杀。
 */
async function chatWithKey(key, {
  messages, model, maxTokens, temperature = 0.2,
  idleTimeoutMs = 180000, totalTimeoutMs = 900000,
}) {
  const cfg = getConfig();
  const url = `${cfg.llm.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model: model || cfg.llm.model,
    messages,
    max_tokens: maxTokens || cfg.llm.maxTokens,
    temperature,
    stream: true,
  };

  const ac = new AbortController();
  let idleTimer = setTimeout(() => ac.abort(new Error('空闲超时')), idleTimeoutMs);
  const hardTimer = setTimeout(() => ac.abort(new Error('总超时')), totalTimeoutMs);
  const touch = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => ac.abort(new Error('空闲超时')), idleTimeoutMs);
  };
  const cleanup = () => {
    clearTimeout(idleTimer);
    clearTimeout(hardTimer);
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (err) {
    cleanup();
    throw new Error(`请求 LLM 失败（${url}）：${err.message}`);
  }

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    cleanup();
    throw new Error(`LLM 返回 ${res.status}：${raw.slice(0, 400)}`);
  }

  const ctype = res.headers.get('content-type') || '';
  // 服务端没按流式返回时走兜底分支
  if (!ctype.includes('event-stream')) {
    const raw = await res.text();
    cleanup();
    let json;
    try { json = JSON.parse(raw); } catch { throw new Error(`LLM 返回非 JSON：${raw.slice(0, 300)}`); }
    const msg = json.choices?.[0]?.message || {};
    return {
      content: msg.content || '',
      reasoning: msg.reasoning_content || '',
      finishReason: json.choices?.[0]?.finish_reason,
      usage: json.usage,
    };
  }

  let content = '';
  let reasoning = '';
  let finishReason = null;
  let usage = null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      touch();
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let evt;
        try { evt = JSON.parse(payload); } catch { continue; }
        const ch = evt.choices?.[0];
        if (ch?.delta) {
          if (ch.delta.content) content += ch.delta.content;
          if (ch.delta.reasoning_content) reasoning += ch.delta.reasoning_content;
        }
        if (ch?.finish_reason) finishReason = ch.finish_reason;
        if (evt.usage) usage = evt.usage;
      }
    }
  } catch (err) {
    cleanup();
    // 已经收到内容就先用着，别整批丢掉
    if (!content.trim()) throw new Error(`流式读取中断：${err.message}`);
  } finally {
    cleanup();
  }

  if (!content.trim()) {
    throw new Error(
      `模型返回空内容（finish=${finishReason || '?'}，推理 ${reasoning.length} 字）。` +
      '通常是 max_tokens 被思考过程耗尽，可调大 LLM_MAX_TOKENS 或减少批量。',
    );
  }
  return { content, reasoning, finishReason, usage };
}

/** 简易并发池 */
export async function mapPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = { ok: true, value: await worker(items[i], i) };
      } catch (err) {
        results[i] = { ok: false, error: err };
      }
    }
  });
  await Promise.all(runners);
  return results;
}
