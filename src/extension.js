"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const CACHE_TTL_MS = 15_000; // refresh every 15s
function activate(context) {
    console.log('File Sizes Explorer activated');
    const config = () => vscode.workspace.getConfiguration('explorerFileSizes');
    const cache = new Map();
    const onDidChangeFileDecorations = new vscode.EventEmitter();
    const provider = {
        onDidChangeFileDecorations: onDidChangeFileDecorations.event,
        async provideFileDecoration(uri) {
            try {
                const stat = await getSize(uri);
                if (!stat)
                    return;
                const short = humanShort(stat.size, config().get('maxBadgeLength') || 4);
                return {
                    badge: short,
                    tooltip: await tooltipFor(uri, stat),
                    propagate: false
                };
            }
            catch {
                return;
            }
        }
    };
    context.subscriptions.push(vscode.window.registerFileDecorationProvider(provider), vscode.workspace.onDidSaveTextDocument(doc => {
        cache.delete(doc.uri.toString());
        onDidChangeFileDecorations.fire(doc.uri);
    }), vscode.workspace.onDidCreateFiles(e => {
        for (const f of e.files)
            cache.delete(f.toString());
        onDidChangeFileDecorations.fire([...e.files]); // spread to fix readonly Uri[]
    }), vscode.workspace.onDidDeleteFiles(e => {
        for (const f of e.files)
            cache.delete(f.toString());
        onDidChangeFileDecorations.fire([...e.files]); // spread to fix readonly Uri[]
    }), vscode.workspace.onDidRenameFiles(e => {
        for (const { oldUri, newUri } of e.files) {
            cache.delete(oldUri.toString());
            cache.delete(newUri.toString());
        }
        onDidChangeFileDecorations.fire(e.files.map(f => f.newUri));
    }), vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('explorerFileSizes')) {
            cache.clear();
            onDidChangeFileDecorations.fire(vscode.workspace.workspaceFolders?.map(f => f.uri) || []);
        }
    }));
    async function getSize(uri) {
        const key = uri.toString();
        const now = Date.now();
        const cached = cache.get(key);
        if (cached && now - cached.computedAt < CACHE_TTL_MS)
            return cached;
        let fsStat;
        try {
            fsStat = await vscode.workspace.fs.stat(uri);
        }
        catch {
            fsStat = undefined;
        }
        if (!fsStat)
            return;
        let size = fsStat.size;
        if (fsStat.type & vscode.FileType.Directory) {
            if (config().get('enableFolderSizes')) {
                size = await dirSize(uri, config().get('excludeGlobs') || []);
            }
            else {
                cache.set(key, { size: NaN, computedAt: now });
                return cache.get(key);
            }
        }
        const entry = { size, mtime: fsStat.mtime, computedAt: now };
        cache.set(key, entry);
        return entry;
    }
    async function dirSize(root, excludes) {
        let total = 0;
        const q = [root];
        while (q.length) {
            const cur = q.shift();
            let entries = [];
            try {
                entries = await vscode.workspace.fs.readDirectory(cur);
            }
            catch {
                entries = [];
            }
            for (const [name, type] of entries) {
                const child = vscode.Uri.joinPath(cur, name);
                if (isExcluded(child, excludes))
                    continue;
                if (type & vscode.FileType.Directory) {
                    q.push(child);
                }
                else {
                    try {
                        const st = await vscode.workspace.fs.stat(child);
                        total += st.size;
                    }
                    catch {
                        // ignore unreadable file
                    }
                }
            }
        }
        return total;
    }
    function isExcluded(uri, globs) {
        if (globs.length === 0)
            return false;
        const p = uri.fsPath.replace(/\\/g, '/');
        return globs.some(g => {
            if (g.includes('node_modules') && p.includes('/node_modules/'))
                return true;
            if (g.includes('.git') && p.includes('/.git/'))
                return true;
            return false;
        });
    }
    function humanShort(bytes, maxLen) {
        if (Number.isNaN(bytes))
            return '—';
        const units = ['B', 'K', 'M', 'G', 'T'];
        let i = 0, val = bytes;
        while (val >= 1024 && i < units.length - 1) {
            val /= 1024;
            i++;
        }
        const s = val >= 100 ? Math.round(val).toString() : val.toFixed(1);
        const out = `${s}${units[i]}`;
        return out.length > maxLen ? out.slice(0, maxLen) : out;
    }
    async function tooltipFor(uri, s) {
        const name = uri.path.split('/').pop() || '';
        const mb = (n) => (n / (1024 * 1024)).toFixed(2);
        const exact = Number.isNaN(s.size) ? 'folder (size disabled)' : `${s.size.toLocaleString()} bytes (${mb(s.size)} MB)`;
        const mtime = s.mtime ? new Date(s.mtime).toLocaleString() : '';
        return `${name}\n${exact}${mtime ? `\nModified: ${mtime}` : ''}`;
    }
}
function deactivate() { }
