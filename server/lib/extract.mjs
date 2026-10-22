import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, getConfig } from '../config.mjs';

/**
 * 调 Python 抽取脚本（PyMuPDF 负责坐标级切题与图片裁剪）。
 * 返回解析后的 JSON。
 */
export function extractPdf({ pdfPath, mediaDir, jsonPath, onLog }) {
  const cfg = getConfig();
  const script = path.join(ROOT, 'tools', 'pdf_extract.py');
  if (!fs.existsSync(script)) throw new Error(`找不到抽取脚本：${script}`);
  fs.mkdirSync(mediaDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const child = spawn(cfg.python, [script, pdfPath, mediaDir, jsonPath], {
      cwd: ROOT,
      windowsHide: true,
    });
    let stderr = '';
    child.stdout.on('data', (d) => onLog?.(String(d)));
    child.stderr.on('data', (d) => {
      stderr += String(d);
      onLog?.(String(d));
    });
    child.on('error', (err) => {
      reject(new Error(
        `无法启动 Python（${cfg.python}）：${err.message}\n` +
        'PDF 抽取依赖 Python + PyMuPDF，请先执行：pip install pymupdf',
      ));
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`PDF 抽取失败（exit ${code}）：\n${stderr.slice(-1500)}`));
        return;
      }
      try {
        resolve(JSON.parse(fs.readFileSync(jsonPath, 'utf8')));
      } catch (err) {
        reject(new Error(`解析抽取结果失败：${err.message}`));
      }
    });
  });
}

/** 检查 Python 环境与 PyMuPDF 是否就绪 */
export function checkPython() {
  const cfg = getConfig();
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    const child = spawn(cfg.python, ['-c', 'import pymupdf,sys;print(pymupdf.__doc__ or "ok")'], {
      cwd: ROOT,
      windowsHide: true,
    });
    child.stdout.on('data', (d) => { out += String(d); });
    child.stderr.on('data', (d) => { err += String(d); });
    child.on('error', () => resolve({ ok: false, detail: `找不到 ${cfg.python}，请安装 Python 并加入 PATH` }));
    child.on('close', (code) => {
      if (code === 0) resolve({ ok: true, detail: out.trim().slice(0, 80) });
      else resolve({ ok: false, detail: `PyMuPDF 未安装：执行 pip install pymupdf（${err.trim().slice(0, 160)}）` });
    });
  });
}
