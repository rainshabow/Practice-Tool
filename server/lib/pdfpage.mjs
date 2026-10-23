import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, getConfig } from '../config.mjs';
import { examDir } from './store.mjs';

const CACHE = path.join(DATA_DIR, 'cache', 'pages');

const SCRIPT = `
import sys, pymupdf
pdf, page, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
doc = pymupdf.open(pdf)
if page < 1 or page > doc.page_count:
    sys.exit(3)
pix = doc[page - 1].get_pixmap(matrix=pymupdf.Matrix(2, 2))
pix.save(out)
print(pix.width, pix.height)
`;

/** 把某套卷的某一页渲染成 PNG（带磁盘缓存），给编辑页对照原卷用 */
export function renderPage(examId, page, variant = '') {
  const dir = examDir(examId);
  if (!fs.existsSync(dir)) throw new Error('题集不存在');
  // 题目的 page 是按导入时用的那份 PDF 记的：有原卷就用原卷，否则用解析版
  const order = variant ? [variant] : ['source', 'solution'];
  const pdf = order.map((v) => path.join(dir, `${v}.pdf`)).find((p) => fs.existsSync(p));
  if (!pdf) throw new Error('这套卷没有保留原始 PDF');

  fs.mkdirSync(CACHE, { recursive: true });
  const tag = `${examId}__${path.basename(pdf, '.pdf')}__${page}.png`;
  const out = path.join(CACHE, tag);
  if (fs.existsSync(out)) return out;

  const py = getConfig().python || 'python';
  return new Promise((resolve, reject) => {
    execFile(py, ['-c', SCRIPT, pdf, String(page), out], { timeout: 30000 }, (err, stdout) => {
      if (err) {
        // 页码越界时别留半张图
        try { fs.unlinkSync(out); } catch { /* ignore */ }
        reject(new Error(err.code === 3 ? '页码超出范围' : `PDF 渲染失败：${err.message}`));
        return;
      }
      resolve(out);
    });
  });
}
