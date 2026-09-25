/**
 * pdf-text.js —— 用 pdf.js 把 PDF 读成"带坐标的文本项"，浏览器本地完成，不上传。
 *
 * 关键点（踩过的坑）：
 *   中文课表 PDF 普遍使用 CID 字体，pdf.js 必须拿到 cMapUrl（pdfjs-dist 自带的 cmaps 目录），
 *   否则会报 "Ensure that the cMapUrl API parameter is provided." 并且**一个文字都取不到**。
 *
 * 环境差异：
 *   - 浏览器：直接以 ES Module 方式加载 /node_modules/pdfjs-dist/build/pdf.mjs + worker；
 *   - Node（只用于测试）：加载 legacy 构建，并禁用 worker。
 */

import { ImportError } from '../importer.js';

const PDFJS_BUILD = '/node_modules/pdfjs-dist/build/pdf.mjs';
const PDFJS_WORKER = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
const PDFJS_CMAPS = '/node_modules/pdfjs-dist/cmaps/';
const PDFJS_FONTS = '/node_modules/pdfjs-dist/standard_fonts/';

export function isBrowser() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

let pdfjsPromise = null;

/** 加载 pdf.js（浏览器用 ESM 构建；Node 用 legacy 构建），只加载一次 */
export async function loadPdfjs() {
  if (pdfjsPromise) return pdfjsPromise;

  pdfjsPromise = (async () => {
    if (isBrowser()) {
      const pdfjs = await import(PDFJS_BUILD);
      try {
        if (pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      } catch {
        /* worker 设置失败时退回主线程解析 */
      }
      return { pdfjs, cMapUrl: PDFJS_CMAPS, standardFontDataUrl: PDFJS_FONTS, node: false };
    }

    const { fileURLToPath, pathToFileURL } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const root = join(here, '..', '..', '..', '..', 'node_modules', 'pdfjs-dist');
    const pdfjs = await import(pathToFileURL(join(root, 'legacy', 'build', 'pdf.mjs')).href);
    return {
      pdfjs,
      cMapUrl: join(root, 'cmaps') + '/',
      standardFontDataUrl: join(root, 'standard_fonts') + '/',
      node: true,
    };
  })();

  try {
    return await pdfjsPromise;
  } catch (error) {
    pdfjsPromise = null;
    throw new ImportError('PDF 解析库加载失败', {
      hint: '请确认已执行 npm install（项目需要 pdfjs-dist）',
      detail: error,
      source: 'pdf',
    });
  }
}

/**
 * 读取 PDF → 每页的文本项（坐标已归一化到"页面坐标系"）。
 *
 * @param {ArrayBuffer|Uint8Array} data PDF 二进制
 * @returns {Promise<{pages:Array<{items:Array<{str:string,x:number,y:number,width:number}>}>, numPages:number}>}
 */
export async function extractPdfTextItems(data) {
  const { pdfjs, cMapUrl, standardFontDataUrl, node } = await loadPdfjs();

  let task;
  try {
    task = pdfjs.getDocument({
      data,
      cMapUrl,
      cMapPacked: true,
      standardFontDataUrl,
      isEvalSupported: false,
      useSystemFonts: false,
      // 浏览器里用 worker；Node 里没有 worker，交给 pdf.js 的假 worker
      disableWorker: node,
    });
  } catch (error) {
    throw new ImportError('无法读取此 PDF，请确认文件未损坏。', { detail: error, source: 'pdf' });
  }

  let doc;
  try {
    doc = await task.promise;
  } catch (error) {
    throw new ImportError('无法读取此 PDF，请确认文件未损坏。', {
      hint: '如果文件有密码保护，请先解除保护后再导入',
      detail: error,
      source: 'pdf',
    });
  }

  const pages = [];
  try {
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
      const page = await doc.getPage(pageNo);
      const content = await page.getTextContent();
      const items = [];

      for (const item of content.items) {
        if (typeof item?.str !== 'string' || item.str.trim() === '') continue;
        items.push({
          str: item.str,
          // transform = [a,b,c,d,e,f]，e/f 就是文字位置的 x/y
          x: Number(item.transform?.[4] ?? 0),
          y: Number(item.transform?.[5] ?? 0),
          width: Number(item.width ?? 0),
        });
      }

      pages.push({ pageNo, items });
    }
  } finally {
    try {
      await task.destroy();
    } catch {
      /* ignore */
    }
  }

  return { pages, numPages: doc.numPages };
}
