'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileInfo, ListParams, Page } from '@sdk/index';
import { errorMessage, sdk, storage } from '@/lib/api';
import { categoryIcon, formatBytes, formatDate } from '@/lib/format';
import FileDrawer from './FileDrawer';
import { useUploads } from './Uploads';
import { Badge, Empty, Spinner, useToast } from './ui';

const CATEGORIES = [
    { id: '', label: 'All' },
    { id: 'image', label: 'Images' },
    { id: 'document', label: 'Documents' },
    { id: 'video', label: 'Video' },
    { id: 'audio', label: 'Audio' },
    { id: 'other', label: 'Other' },
];

export default function FilesView({ scope, onChanged }: { scope: 'mine' | 'shared'; onChanged: () => void }) {
    const { toast, confirm } = useToast();
    const { enqueue, onFinished } = useUploads();
    const [params, setParams] = useState<ListParams>({ scope, page: 1, limit: 24, sort: 'createdAt', order: 'desc' });
    const [search, setSearch] = useState('');
    const [view, setView] = useState<'grid' | 'list'>('grid');
    const [data, setData] = useState<Page<FileInfo> | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [open, setOpen] = useState<string | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [dragging, setDragging] = useState(false);
    const [e2ee, setE2ee] = useState(false);
    const [passphrase, setPassphrase] = useState('');
    const input = useRef<HTMLInputElement>(null);

    useEffect(() => setView(storage.get('cs_view') === 'list' ? 'list' : 'grid'), []);

    // several loads can overlap (uploads finishing, filters changing): only the latest answer may update the list
    const latest = useRef(0);
    const load = useCallback(async () => {
        const mine = ++latest.current;
        setLoading(true);
        try {
            const page = await sdk.list(params);
            if (mine === latest.current) {
                setData(page);
                setError(null);
            }
        } catch (e) {
            if (mine === latest.current) setError(errorMessage(e));
        } finally {
            if (mine === latest.current) setLoading(false);
        }
    }, [params]);
    useEffect(() => void load(), [load]);

    // new uploads show up without a manual refresh
    useEffect(() => onFinished(() => { void load(); onChanged(); }), [onFinished, load, onChanged]);

    // search as you type, after a short pause
    useEffect(() => {
        const t = setTimeout(() => setParams((p) => (p.search === (search || undefined) ? p : { ...p, search: search || undefined, page: 1 })), 300);
        return () => clearTimeout(t);
    }, [search]);

    const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
    const files = data?.files ?? [];

    async function trashSelected() {
        if (!(await confirm(`Move ${selected.size} file${selected.size > 1 ? 's' : ''} to the trash?`, { confirmLabel: 'Move to trash' }))) return;
        const results = await Promise.allSettled([...selected].map((id) => sdk.trash(id)));
        const failed = results.filter((r) => r.status === 'rejected').length;
        toast(failed ? `${failed} could not be moved (you may only have read access)` : 'Moved to trash', failed ? 'error' : 'success');
        setSelected(new Set());
        await load();
        onChanged();
    }

    /** Uploads with the end-to-end option when it is on (the passphrase must be usable first). */
    const add = (list: File[]) => {
        if (!e2ee) return enqueue(list);
        if (passphrase.length < 8) return toast('Enter a passphrase of at least 8 characters for end-to-end encryption', 'error');
        enqueue(list, { passphrase });
    };

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        if (scope === 'mine' && e.dataTransfer.files.length) add([...e.dataTransfer.files]);
    };

    return (
        <div onDragOver={(e) => { if (scope === 'mine') { e.preventDefault(); setDragging(true); } }} onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)} onDrop={onDrop} className={`relative min-h-[60vh] rounded-xl ${dragging ? 'ring-2 ring-brand-500 ring-offset-4' : ''}`}>
            <div className="mb-4 flex flex-wrap items-center gap-2">
                <input className="input max-w-xs" type="search" placeholder="Search files…" aria-label="Search files" value={search} onChange={(e) => setSearch(e.target.value)} />
                <select className="input w-auto" aria-label="Sort" value={`${params.sort}:${params.order}`} onChange={(e) => { const [sort, order] = e.target.value.split(':'); setParams((p) => ({ ...p, sort: sort as ListParams['sort'], order: order as ListParams['order'], page: 1 })); }}>
                    <option value="createdAt:desc">Newest first</option>
                    <option value="createdAt:asc">Oldest first</option>
                    <option value="name:asc">Name A–Z</option>
                    <option value="name:desc">Name Z–A</option>
                    <option value="size:desc">Largest first</option>
                    <option value="size:asc">Smallest first</option>
                </select>
                <div className="flex rounded-lg border border-slate-300 bg-white text-sm" role="group" aria-label="View">
                    {(['grid', 'list'] as const).map((v) => (
                        <button key={v} aria-pressed={view === v} className={`px-3 py-2 ${view === v ? 'bg-slate-200 font-medium' : ''}`} onClick={() => { setView(v); storage.set('cs_view', v); }}>{v === 'grid' ? 'Grid' : 'List'}</button>
                    ))}
                </div>
                <div className="ml-auto flex items-center gap-2">
                    {selected.size > 0 && scope === 'mine' && <button className="btn btn-secondary" onClick={() => void trashSelected()}>🗑️ Trash {selected.size}</button>}
                    {scope === 'mine' && (
                        <>
                            <label className="flex items-center gap-1 text-sm text-slate-600" title="Encrypt in this browser before upload; only someone with the passphrase can open the file">
                                <input type="checkbox" checked={e2ee} onChange={(e) => setE2ee(e.target.checked)} data-testid="e2ee-toggle" /> 🔐 End-to-end
                            </label>
                            {e2ee && <input className="input w-44" type="password" autoComplete="new-password" placeholder="Passphrase" aria-label="Encryption passphrase" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />}
                            <button className="btn btn-primary" onClick={() => input.current?.click()}>⬆️ Upload</button>
                            <input ref={input} type="file" multiple hidden data-testid="file-input" onChange={(e) => { if (e.target.files?.length) add([...e.target.files]); e.target.value = ''; }} />
                        </>
                    )}
                </div>
            </div>

            <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Category">
                {CATEGORIES.map((c) => (
                    <button key={c.id} aria-pressed={(params.category ?? '') === c.id} className={`rounded-full px-3 py-1 text-sm ${(params.category ?? '') === c.id ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-300 hover:bg-slate-100'}`} onClick={() => setParams((p) => ({ ...p, category: (c.id || undefined) as ListParams['category'], page: 1 }))}>{c.label}</button>
                ))}
            </div>

            {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
            {loading && !data ? (
                <Spinner />
            ) : files.length === 0 ? (
                <Empty icon={scope === 'mine' ? '📂' : '👥'} title={params.search || params.category ? 'No files match' : scope === 'mine' ? 'No files yet' : 'Nothing has been shared with you'} hint={scope === 'mine' && !params.search ? 'Drop files here or press Upload' : undefined} />
            ) : view === 'grid' ? (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" data-testid="file-grid">
                    {files.map((f) => (
                        <li key={f._id} className="card group relative overflow-hidden">
                            {scope === 'mine' && <input type="checkbox" aria-label={`Select ${f.originalName}`} className="absolute left-2 top-2 z-10 h-4 w-4" checked={selected.has(f._id)} onChange={() => toggle(f._id)} />}
                            <button className="block w-full text-left" onClick={() => setOpen(f._id)} aria-label={`Open ${f.originalName}`}>
                                <div className="flex h-28 items-center justify-center bg-slate-100">
                                    {f.thumbnailUrl ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={f.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                                    ) : (
                                        <span className="text-4xl" aria-hidden>{categoryIcon[f.category]}</span>
                                    )}
                                </div>
                                <div className="p-2">
                                    <div className="truncate text-sm font-medium" title={f.originalName}>{f.originalName}</div>
                                    <div className="flex items-center justify-between text-xs text-slate-500">
                                        <span>{formatBytes(f.clientEncryption?.size ?? f.size)}</span>
                                        <span>{formatDate(f.createdAt)}</span>
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                        {f.clientEncryption && <Badge tone="green">🔐 e2e</Badge>}
                                        {f.isEncrypted && <Badge tone="green">🔒</Badge>}
                                        {f.isPublic && <Badge tone="amber">public</Badge>}
                                        {f.sharedWithCount > 0 && <Badge tone="blue">shared</Badge>}
                                        {f.currentVersion > 1 && <Badge>v{f.currentVersion}</Badge>}
                                    </div>
                                </div>
                            </button>
                        </li>
                    ))}
                </ul>
            ) : (
                <div className="card overflow-x-auto">
                    <table className="w-full text-sm" data-testid="file-table">
                        <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                            <tr>
                                {scope === 'mine' && <th className="w-8 p-3" />}
                                <th className="p-3">Name</th>
                                <th className="p-3">Size</th>
                                <th className="p-3">Type</th>
                                <th className="p-3">Added</th>
                                <th className="p-3">Access</th>
                            </tr>
                        </thead>
                        <tbody>
                            {files.map((f) => (
                                <tr key={f._id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                                    {scope === 'mine' && <td className="p-3"><input type="checkbox" aria-label={`Select ${f.originalName}`} checked={selected.has(f._id)} onChange={() => toggle(f._id)} /></td>}
                                    <td className="p-3"><button className="flex items-center gap-2 text-left font-medium hover:text-brand-700" onClick={() => setOpen(f._id)}><span aria-hidden>{categoryIcon[f.category]}</span>{f.originalName}</button></td>
                                    <td className="p-3 text-slate-600">{formatBytes(f.clientEncryption?.size ?? f.size)}</td>
                                    <td className="p-3 text-slate-600">{f.clientEncryption ? `🔐 ${f.clientEncryption.mimetype}` : f.mimetype}</td>
                                    <td className="p-3 text-slate-600">{formatDate(f.createdAt)}</td>
                                    <td className="p-3"><Badge tone={f.permission === 'owner' ? 'green' : 'blue'}>{f.permission}</Badge></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {data && data.pagination.pages > 1 && (
                <nav className="mt-4 flex items-center justify-center gap-3 text-sm" aria-label="Pages">
                    <button className="btn btn-secondary" disabled={params.page === 1} onClick={() => setParams((p) => ({ ...p, page: (p.page ?? 1) - 1 }))}>Previous</button>
                    <span>Page {data.pagination.page} of {data.pagination.pages}</span>
                    <button className="btn btn-secondary" disabled={(params.page ?? 1) >= data.pagination.pages} onClick={() => setParams((p) => ({ ...p, page: (p.page ?? 1) + 1 }))}>Next</button>
                </nav>
            )}

            {dragging && <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-brand-50/80 text-xl font-semibold text-brand-700">Drop to upload</div>}
            {open && <FileDrawer id={open} onClose={() => setOpen(null)} onChanged={() => { void load(); onChanged(); }} />}
        </div>
    );
}
