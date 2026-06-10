'use strict';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const PYTHON_CMD = process.env.PYTHON_CMD || 'python3';
const WORKER_PATH = path.join(__dirname, 'image_tools_worker.py');
const TIMEOUT_MS = 90_000;

function runImageTool(args, output) {
  return new Promise((resolve, reject) => {
    let stdoutBuf = '', stderrBuf = '', finished = false;
    const child = spawn(PYTHON_CMD, [WORKER_PATH, ...args], { stdio: ['ignore','pipe','pipe'], env: { ...process.env } });
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      try { child.kill('SIGTERM'); } catch (_) {}
      try { if (fs.existsSync(output)) fs.unlinkSync(output); } catch (_) {}
      reject(new Error('انتهت مهلة معالجة الصورة'));
    }, TIMEOUT_MS);
    child.stdout.on('data', d => stdoutBuf += d.toString());
    child.stderr.on('data', d => stderrBuf += d.toString());
    child.on('error', err => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      try { if (fs.existsSync(output)) fs.unlinkSync(output); } catch (_) {}
      reject(new Error(`فشل تشغيل image_tools_worker: ${err.message}`));
    });
    child.on('close', code => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      let last = null;
      for (const line of stdoutBuf.split('\n').filter(Boolean)) {
        try { const evt = JSON.parse(line); if (evt.type === 'done' || evt.type === 'error') last = evt; } catch (_) {}
      }
      if (code !== 0 || !last || last.type === 'error') {
        try { if (fs.existsSync(output)) fs.unlinkSync(output); } catch (_) {}
        return reject(new Error((last && last.message) || stderrBuf.slice(-300) || `worker خرج بكود ${code}`));
      }
      if (!fs.existsSync(output) || fs.statSync(output).size < 10) {
        try { if (fs.existsSync(output)) fs.unlinkSync(output); } catch (_) {}
        return reject(new Error('الصورة الناتجة فارغة'));
      }
      resolve({ path: output, meta: last });
    });
  });
}

async function enhanceImage(buffer, mimeType = 'image/jpeg') {
  const ext = mimeType.includes('png') ? '.png' : '.jpg';
  const input = path.join(os.tmpdir(), `medterm_img_in_${crypto.randomBytes(8).toString('hex')}${ext}`);
  const output = path.join(os.tmpdir(), `medterm_img_enhanced_${crypto.randomBytes(8).toString('hex')}.jpg`);
  fs.writeFileSync(input, buffer);
  try { return await runImageTool(['enhance', input, output], output); }
  finally { fs.unlink(input, () => {}); }
}

async function generateLocalImage(prompt) {
  const output = path.join(os.tmpdir(), `medterm_generated_${crypto.randomBytes(8).toString('hex')}.jpg`);
  return runImageTool(['generate', prompt || 'صورة', output], output);
}

module.exports = { enhanceImage, generateLocalImage };
