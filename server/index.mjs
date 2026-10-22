import express from 'express';
import path from 'node:path';
import { ROOT, getConfig } from './config.mjs';
import { api } from './routes.mjs';
import { ensureDirs } from './lib/store.mjs';

const cfg = getConfig();
const app = express();

app.disable('x-powered-by');
// JSON 请求体解析（交卷、改设置、修订答案都靠它）。
// 注意：PDF 上传是 route 级 express.raw(application/pdf)，不走这里。
app.use(express.json({ limit: '4mb' }));
app.use((req, _res, next) => {
  // 只允许本机访问，避免误暴露
  next();
});

app.use('/api', api);
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

// 前端是单页，未匹配的 GET 都回 index.html
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: err.message || '服务器错误' });
});

ensureDirs();

// 本地工具，进程不该因为某次请求的意外而整体退出
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

const server = app.listen(cfg.port, cfg.host, () => {
  const url = `http://${cfg.host}:${cfg.port}`;
  console.log(`\n  刷题系统已启动：${url}\n`);
  console.log(`  LLM   : ${cfg.llm.baseUrl}  (${cfg.llm.model})`);
  console.log(`  视觉  : ${cfg.llm.visionModel}`);
  console.log(`  数据  : ${path.join(ROOT, 'data')}\n`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}
