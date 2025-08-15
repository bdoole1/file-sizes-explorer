import * as vscode from 'vscode';

type SizeEntry = { size: number; mtime?: number; computedAt: number };
const CACHE_TTL_MS = 15_000; // refresh every 15s

export function activate(context: vscode.ExtensionContext) {
  console.log('File Sizes Explorer activated');

  const config = () => vscode.workspace.getConfiguration('explorerFileSizes');

  // Status bar item (used when badgeMode === "off", and also fine to keep for other modes)
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.name = 'Explorer File Size';
  context.subscriptions.push(
    status,
    vscode.window.onDidChangeActiveTextEditor(e => updateStatus(e?.document?.uri)),
  );
  updateStatus(vscode.window.activeTextEditor?.document.uri);

  const cache = new Map<string, SizeEntry>();
  const onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();

  const provider: vscode.FileDecorationProvider = {
    onDidChangeFileDecorations: onDidChangeFileDecorations.event,
    async provideFileDecoration(uri) {
      try {
        const mode = (config().get<'full' | 'subtle' | 'off'>('badgeMode') || 'full');

        // If user wants no Explorer badges at all, do nothing here (status bar will still show active file size)
        if (mode === 'off') return;

        const stat = await getSize(uri);
        if (!stat) return;

        const decoration: vscode.FileDecoration = {
          badge: mode === 'full' ? twoCharBadge(stat.size) : '•', // subtle dot as a near-invisible hover target
          tooltip: await tooltipFor(uri, stat),
          // color: mode === 'full' ? undefined : new vscode.ThemeColor('list.deemphasizedForeground'),
          propagate: false
        };
        return decoration;
      } catch {
        return;
      }
    }
  };

  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(provider),

    vscode.workspace.onDidSaveTextDocument(doc => {
      cache.delete(doc.uri.toString());
      onDidChangeFileDecorations.fire(doc.uri);
      if (vscode.window.activeTextEditor?.document?.uri.toString() === doc.uri.toString()) {
        updateStatus(doc.uri);
      }
    }),

    vscode.workspace.onDidCreateFiles(e => {
      for (const f of e.files) cache.delete(f.toString());
      onDidChangeFileDecorations.fire([...e.files]); // spread to fix readonly Uri[]
    }),

    vscode.workspace.onDidDeleteFiles(e => {
      for (const f of e.files) cache.delete(f.toString());
      onDidChangeFileDecorations.fire([...e.files]); // spread to fix readonly Uri[]
    }),

    vscode.workspace.onDidRenameFiles(e => {
      for (const { oldUri, newUri } of e.files) {
        cache.delete(oldUri.toString());
        cache.delete(newUri.toString());
      }
      onDidChangeFileDecorations.fire(e.files.map(f => f.newUri));
    }),

    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('explorerFileSizes')) {
        cache.clear();
        onDidChangeFileDecorations.fire(vscode.workspace.workspaceFolders?.map(f => f.uri) || []);
        updateStatus(vscode.window.activeTextEditor?.document.uri);
      }
    })
  );

  async function getSize(uri: vscode.Uri): Promise<SizeEntry | undefined> {
    const key = uri.toString();
    const now = Date.now();
    const cached = cache.get(key);
    if (cached && now - cached.computedAt < CACHE_TTL_MS) return cached;

    let fsStat: vscode.FileStat | undefined;
    try {
      fsStat = await vscode.workspace.fs.stat(uri);
    } catch {
      fsStat = undefined;
    }
    if (!fsStat) return;

    let size = fsStat.size;
    if (fsStat.type & vscode.FileType.Directory) {
      if (config().get<boolean>('enableFolderSizes')) {
        size = await dirSize(uri, config().get<string[]>('excludeGlobs') || []);
      } else {
        cache.set(key, { size: NaN, computedAt: now });
        return cache.get(key);
      }
    }

    const entry: SizeEntry = { size, mtime: fsStat.mtime, computedAt: now };
    cache.set(key, entry);
    return entry;
  }

  async function dirSize(root: vscode.Uri, excludes: string[]): Promise<number> {
    let total = 0;
    const q: vscode.Uri[] = [root];
    while (q.length) {
      const cur = q.shift()!;

      let entries: [string, vscode.FileType][] = [];
      try {
        entries = await vscode.workspace.fs.readDirectory(cur);
      } catch {
        entries = [];
      }

      for (const [name, type] of entries) {
        const child = vscode.Uri.joinPath(cur, name);
        if (isExcluded(child, excludes)) continue;
        if (type & vscode.FileType.Directory) {
          q.push(child);
        } else {
          try {
            const st = await vscode.workspace.fs.stat(child);
            total += st.size;
          } catch {
            // ignore unreadable file
          }
        }
      }
    }
    return total;
  }

  function isExcluded(uri: vscode.Uri, globs: string[]) {
    if (globs.length === 0) return false;
    const p = uri.fsPath.replace(/\\/g, '/');
    return globs.some(g => {
      if (g.includes('node_modules') && p.includes('/node_modules/')) return true;
      if (g.includes('.git') && p.includes('/.git/')) return true;
      return false;
    });
  }

  function twoCharBadge(bytes: number): string {
    if (Number.isNaN(bytes)) return '—'; // folder, sizes disabled
    const KB = 1024, MB = KB * 1024, GB = MB * 1024, TB = GB * 1024;

    if (bytes < KB) return 'B';                                 // <1KB
    if (bytes < 10 * KB) return `${Math.floor(bytes / KB)}K`;   // 1K..9K
    if (bytes < MB) return 'K';                                 // 10K..999K
    if (bytes < 10 * MB) return `${Math.floor(bytes / MB)}M`;   // 1M..9M
    if (bytes < GB) return 'M';                                 // 10M..999M
    if (bytes < 10 * GB) return `${Math.floor(bytes / GB)}G`;   // 1G..9G
    if (bytes < TB) return 'G';                                 // 10G..999G
    const t = Math.floor(bytes / TB);
    return t < 10 ? `${t}T` : 'T';                              // 1T..9T else 'T'
  }

  async function tooltipFor(uri: vscode.Uri, s: SizeEntry): Promise<string> {
    const name = uri.path.split('/').pop() || '';
    const exact = Number.isNaN(s.size) ? 'folder (size disabled)' : humanExact(s.size);
    const mtime = s.mtime ? new Date(s.mtime).toLocaleString() : '';
    return `${name}\n${exact}${mtime ? `\nModified: ${mtime}` : ''}`;
  }

  function humanExact(bytes: number) {
    const mb = (n: number) => (n / (1024 * 1024)).toFixed(2);
    return `${bytes.toLocaleString()} bytes (${mb(bytes)} MB)`;
  }

  async function updateStatus(uri?: vscode.Uri) {
    if (!uri) { status.hide(); return; }
    try {
      const s = await getSize(uri);
      if (s && !Number.isNaN(s.size)) {
        status.text = `$(database) ${humanExact(s.size)}`;
        status.show();
      } else {
        status.hide();
      }
    } catch {
      status.hide();
    }
  }
}

export function deactivate() {}