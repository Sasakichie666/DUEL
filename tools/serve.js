// tools/serve.js
// 零依赖本地服务器（Node 18+）—— 让「卡包 JSON 丢进 cardPacks/ 就能被游戏识别」成立 ✓
//
//   ① 静态托管整个项目（和普通静态服务器一样，顺带解决了 file:// 下 fetch 读不到卡包的问题）
//   ② GET  /api/packs → 扫描 cardPacks/ 目录，返回 { packs: [{ file, name, count }] }
//      游戏端会优先用它，因此【不需要再手改 manifest.json】
//   ③ POST /api/pack  → 写入卡包文件（编辑器在浏览器不支持目录授权时的兜底保存方式）
//
// 用法：node tools/serve.js [端口]        默认 8080
//       浏览器打开 http://localhost:8080
//
// 说明：卡包文件支持两种格式（都能识别）
//   · 纯数组：            [ {卡1}, {卡2} ]                        → 卡包名 = JSON 文件名
//   · 带名字的对象：      { name: "黎明启示", cards: [ … ] }      → 卡包名 = name ✓

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PACK_DIR = path.join(ROOT, 'cardPacks');
const PORT = Number(process.argv[2] || 8080);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.mp3': 'audio/mpeg'
};

/** 扫描 cardPacks/ 目录，列出所有卡包（排除 manifest 自身） */
function listPacks() {
    if (!fs.existsSync(PACK_DIR)) return [];
    return fs.readdirSync(PACK_DIR)
        .filter(f => /\.json$/i.test(f) && f.toLowerCase() !== 'manifest.json')
        .map(f => {
            let name = f.replace(/\.json$/i, '');
            let count = 0;
            try {
                const data = JSON.parse(fs.readFileSync(path.join(PACK_DIR, f), 'utf8'));
                if (Array.isArray(data)) {
                    count = data.length;
                } else if (data && Array.isArray(data.cards)) {
                    count = data.cards.length;
                    if (typeof data.name === 'string' && data.name.trim()) name = data.name.trim();
                }
            } catch (e) {
                // 坏文件也列出来（前端会提示"里没有卡牌"），方便排查
                count = -1;
            }
            return { file: f, name, count };
        });
}

function sendJson(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(body);
}

/** 防止 ../ 越界读取（只允许访问项目目录内的文件） */
function resolveSafe(urlPath) {
    const clean = decodeURIComponent(urlPath.split('?')[0]);
    const target = path.join(ROOT, path.normalize(clean).replace(/^([/\\])+/, ''));
    return target.startsWith(ROOT) ? target : null;
}

function serveStatic(req, res, urlPath) {
    let filePath = resolveSafe(urlPath);
    if (!filePath) { res.writeHead(403); res.end('Forbidden'); return; }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
    }
    if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found: ' + urlPath);
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store'          // 改完卡包/代码刷新就生效，省得清缓存
    });
    fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
    const urlPath = (req.url || '/').split('?')[0];

    // ---- API：卡包清单（游戏端用它 → 免 manifest）----
    if (urlPath === '/api/packs' || urlPath === '/api/packs/') {
        sendJson(res, 200, { packs: listPacks() });
        return;
    }

    // ---- API：写入卡包（编辑器兜底保存）----
    if (urlPath === '/api/pack' && req.method === 'POST') {
        let raw = '';
        req.on('data', chunk => {
            raw += chunk;
            if (raw.length > 5 * 1024 * 1024) req.destroy();     // 5MB 上限，防止误传大文件
        });
        req.on('end', () => {
            try {
                const payload = JSON.parse(raw);
                const file = String(payload.file || '').replace(/[\\/]/g, '').trim();
                if (!/\.json$/i.test(file)) { sendJson(res, 400, { ok: false, error: '文件名必须以 .json 结尾' }); return; }
                fs.writeFileSync(path.join(PACK_DIR, file), JSON.stringify(payload.data, null, 2), 'utf8');
                console.log(`[serve] 已写入 cardPacks/${file}`);
                sendJson(res, 200, { ok: true, file });
            } catch (e) {
                sendJson(res, 500, { ok: false, error: String(e && e.message || e) });
            }
        });
        return;
    }

    // ---- 静态文件 ----
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405); res.end('Method Not Allowed');
        return;
    }
    serveStatic(req, res, urlPath);
});

server.listen(PORT, () => {
    const packs = listPacks();
    console.log('');
    console.log('  卡牌对战模拟器 · 本地服务已启动 ✓');
    console.log('  ─────────────────────────────────────────');
    console.log(`  游戏地址：   http://localhost:${PORT}/`);
    console.log(`  卡牌编辑器： http://localhost:${PORT}/卡牌编辑器/`);
    console.log(`  卡包清单API：http://localhost:${PORT}/api/packs`);
    console.log('  ─────────────────────────────────────────');
    console.log(`  已扫描到 ${packs.length} 个卡包：`);
    packs.forEach(p => {
        const note = p.count < 0 ? '（文件解析失败 ✗）' : `${p.count} 张`;
        console.log(`    · ${p.file}  →  ${p.name}  ${note}`);
    });
    console.log('');
    console.log('  提示：把新的卡包 JSON 放进 cardPacks/ 后，在游戏里点「🔄 重新加载卡包」即可识别（不用改 manifest）');
    console.log('');
});
