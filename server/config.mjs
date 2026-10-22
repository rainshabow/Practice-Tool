import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const EXAMS_DIR = path.join(DATA_DIR, 'exams');

/** 极简 .env 解析（不引入 dotenv） */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const fileEnv = loadEnvFile(path.join(ROOT, '.env'));

const pick = (name, fallback) => {
  const v = process.env[name] ?? fileEnv[name];
  return v === undefined || v === '' ? fallback : v;
};

/** 运行期可改的设置（会落盘到 data/settings.json，优先级高于 .env） */
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function saveSettings(patch) {
  const next = { ...readSettings(), ...patch };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export function getConfig() {
  const s = readSettings();
  return {
    port: Number(pick('PORT', 7788)),
    host: pick('HOST', '127.0.0.1'),
    llm: {
      baseUrl: s.llmBaseUrl || pick('LLM_BASE_URL', 'http://127.0.0.1:3050/v1'),
      model: s.llmModel || pick('LLM_MODEL', 'deepseek/deepseek-v4.1-flash'),
      visionModel: s.llmVisionModel || pick('LLM_VISION_MODEL', pick('LLM_MODEL', 'deepseek/deepseek-v4.1-flash')),
      apiKey: s.llmApiKey || pick('LLM_API_KEY', ''),
      concurrency: Number(pick('LLM_CONCURRENCY', 3)),
      batchSize: Number(pick('LLM_BATCH_SIZE', 4)),
      maxTokens: Number(pick('LLM_MAX_TOKENS', 16384)),
    },
    python: pick('PYTHON', 'python'),
  };
}

/** 对外暴露的配置（绝不包含密钥本身） */
export function publicConfig() {
  const c = getConfig();
  return {
    llm: {
      baseUrl: c.llm.baseUrl,
      model: c.llm.model,
      visionModel: c.llm.visionModel,
      hasApiKey: Boolean(c.llm.apiKey),
      apiKeyHint: c.llm.apiKey ? `${c.llm.apiKey.slice(0, 8)}…${c.llm.apiKey.slice(-4)}` : '',
    },
    python: c.python,
  };
}

/**
 * 未配置密钥时，从本机 CommandCodeGo 代理的 sqlite 里取上游密钥。
 * 纯本地只读；失败就静默返回空数组。
 *
 * 代理里可能挂着多把 key，按"最近使用"排序返回：用户刚在管理页换了 key，
 * 最近用过的那把才是在用的；调用方拿到列表后可以逐把失败切换。
 */
export async function resolveApiKeys() {
  const c = getConfig();
  if (c.llm.apiKey) return [c.llm.apiKey];

  const candidates = [
    process.env.COMMANDCODE_DB,
    'D:\\Code\\Github\\CommandCodeGo-manager\\data\\ccp.db',
    process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, 'commandcode', 'data', 'ccp.db')
      : '',
  ].filter(Boolean);
  const dbFile = candidates.find((p) => p && fs.existsSync(p));
  if (!dbFile) return [];

  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbFile, { readOnly: true });
    const rows = db.prepare(
      "select api_key from upstream_keys where status='active' " +
      'order by coalesce(last_used_at, 0) desc, id desc limit 8',
    ).all();
    db.close();
    return rows.map((r) => r.api_key).filter(Boolean);
  } catch {
    return [];
  }
}

/** 兼容单 key 的旧调用：返回最可能可用的那把 */
export async function resolveApiKey() {
  const keys = await resolveApiKeys();
  return keys[0] || '';
}
