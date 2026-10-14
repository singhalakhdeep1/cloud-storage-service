'use client';

import { useEffect, useState } from 'react';
import { errorMessage, sdk } from '@/lib/api';
import { formatBytes, formatDate } from '@/lib/format';
import { BarChart } from './AnalyticsView';
import { Badge, Spinner, useAsync, useToast } from './ui';

type Sub = 'users' | 'overview' | 'system';

function Users() {
    const { toast, confirm } = useToast();
    const [search, setSearch] = useState('');
    const [q, setQ] = useState('');
    const [page, setPage] = useState(1);
    const { data, loading, reload } = useAsync(() => sdk.admin.users({ search: q || undefined, page, limit: 15 }), [q, page]);
    useEffect(() => { const t = setTimeout(() => { setQ(search); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);

    async function act(label: string, fn: () => Promise<unknown>) {
        try {
            await fn();
            toast(label);
            reload();
        } catch (e) {
            toast(errorMessage(e), 'error');
        }
    }

    return (
        <div className="space-y-3">
            <input className="input max-w-xs" type="search" placeholder="Search users…" aria-label="Search users" value={search} onChange={(e) => setSearch(e.target.value)} />
            {loading && !data ? <Spinner /> : (
                <div className="card overflow-x-auto">
                    <table className="w-full text-sm" data-testid="user-table">
                        <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">User</th><th className="p-3">Role</th><th className="p-3">Usage</th><th className="p-3">Joined</th><th className="p-3">Status</th><th className="p-3" /></tr></thead>
                        <tbody>
                            {data?.data.users.map((u) => (
                                <tr key={u.id} className="border-b border-slate-100 last:border-0">
                                    <td className="p-3"><div className="font-medium">{u.name}</div><div className="text-xs text-slate-500">{u.email}</div></td>
                                    <td className="p-3"><Badge tone={u.role === 'admin' ? 'blue' : 'slate'}>{u.role}</Badge></td>
                                    <td className="p-3">{formatBytes(u.storageUsed)} / {formatBytes(u.storageLimit)} · {u.fileCount} files</td>
                                    <td className="p-3">{formatDate((u as unknown as { createdAt: string }).createdAt)}</td>
                                    <td className="p-3"><Badge tone={u.isActive ? 'green' : 'red'}>{u.isActive ? 'active' : 'locked'}</Badge></td>
                                    <td className="space-x-1 p-3 text-right">
                                        <button className="btn btn-secondary" onClick={async () => { const gb = window.prompt('New storage limit in GB', String(Math.round(u.storageLimit / 1024 ** 3 * 10) / 10)); if (gb && Number(gb) > 0) await act('Limit updated', () => sdk.admin.updateUser(u.id, { storageLimit: Math.round(Number(gb) * 1024 ** 3) })); }}>Quota</button>
                                        <button className="btn btn-secondary" onClick={() => void act(u.isActive ? 'User locked' : 'User unlocked', () => sdk.admin.updateUser(u.id, { isActive: !u.isActive }))}>{u.isActive ? 'Lock' : 'Unlock'}</button>
                                        <button className="btn btn-secondary" onClick={() => void act('Role changed', () => sdk.admin.updateUser(u.id, { role: u.role === 'admin' ? 'user' : 'admin' }))}>{u.role === 'admin' ? 'Make user' : 'Make admin'}</button>
                                        <button className="btn btn-ghost text-red-600" onClick={async () => { if (await confirm(`Delete ${u.email} and ALL their files for good?`, { danger: true, confirmLabel: 'Delete user' })) await act('User deleted', () => sdk.admin.deleteUser(u.id)); }}>Delete</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {data && data.data.pagination.pages > 1 && (
                <div className="flex items-center justify-center gap-3 text-sm">
                    <button className="btn btn-secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
                    <span>Page {page} of {data.data.pagination.pages}</span>
                    <button className="btn btn-secondary" disabled={page >= data.data.pagination.pages} onClick={() => setPage(page + 1)}>Next</button>
                </div>
            )}
        </div>
    );
}

function Overview() {
    const { data, loading } = useAsync(async () => (await sdk.admin.stats()).data as Record<string, any>, []); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (loading && !data) return <Spinner />;
    if (!data) return null;
    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[['Users', data.users], ['Files', data.totalFiles], ['Stored', formatBytes(data.totalSize)], ['Allocated', formatBytes(data.storageAllocated)]].map(([k, v]) => (
                    <div key={String(k)} className="card p-4"><div className="text-xs uppercase text-slate-500">{k}</div><div className="mt-1 text-2xl font-semibold">{v}</div></div>
                ))}
            </div>
            <section className="card p-4"><h2 className="mb-2 font-semibold">Uploads, last 30 days</h2><BarChart label="Uploads per day" data={data.uploadsOverTime.map((d: { date: string; uploads: number }) => ({ key: d.date, value: d.uploads, title: `${d.date}: ${d.uploads}` }))} /></section>
            <div className="grid gap-6 lg:grid-cols-2">
                <section className="card p-4"><h2 className="mb-2 font-semibold">By provider</h2><ul className="space-y-1 text-sm">{data.storageByProvider.map((p: { provider: string; count: number; size: number }) => (<li key={p.provider} className="flex justify-between"><span>{p.provider}</span><span className="text-slate-500">{p.count} files · {formatBytes(p.size)}</span></li>))}</ul></section>
                <section className="card p-4"><h2 className="mb-2 font-semibold">Biggest users</h2><ol className="space-y-1 text-sm">{data.topUsers.map((u: { userId: string; name?: string; email?: string; files: number; size: number }) => (<li key={u.userId} className="flex justify-between"><span className="truncate">{u.name ?? u.email}</span><span className="text-slate-500">{u.files} · {formatBytes(u.size)}</span></li>))}</ol></section>
            </div>
        </div>
    );
}

function System() {
    const { toast } = useToast();
    const { data, loading, reload } = useAsync(() => sdk.admin.system(), []);
    if (loading && !data) return <Spinner />;
    const s = data?.data;
    return (
        <div className="space-y-4">
            <section className="card p-4">
                <h2 className="mb-3 font-semibold">Storage providers</h2>
                <ul className="divide-y divide-slate-100 text-sm" data-testid="provider-list">
                    {s?.providers.map((p) => (
                        <li key={p.name} className="flex flex-wrap items-center justify-between gap-2 py-2">
                            <span className="font-medium">{p.name} {p.isDefault && <Badge tone="blue">default</Badge>}</span>
                            <span className="flex items-center gap-2 text-slate-500">{p.bucket && <span>{p.bucket}</span>}{p.error && <span className="text-red-600">{p.error}</span>}<Badge tone={!p.configured ? 'slate' : p.healthy ? 'green' : 'red'}>{!p.configured ? 'not configured' : p.healthy ? 'healthy' : 'unreachable'}</Badge></span>
                        </li>
                    ))}
                </ul>
            </section>
            <section className="card flex flex-wrap items-center gap-6 p-4 text-sm">
                <span>Redis: <Badge tone={s?.redis === null ? 'slate' : s?.redis ? 'green' : 'red'}>{s?.redis === null ? 'not used' : s?.redis ? 'connected' : 'down'}</Badge></span>
                <span>Virus scanner: <Badge tone={s?.virusScanner === null ? 'slate' : s?.virusScanner ? 'green' : 'red'}>{s?.virusScanner === null ? 'off' : s?.virusScanner ? 'reachable' : 'unreachable'}</Badge></span>
                <button className="btn btn-secondary ml-auto" onClick={async () => { try { const r = await sdk.admin.runJanitor(); const d = r.data as Record<string, number>; toast(`Cleanup done: ${d.uploadSessions} stale uploads, ${d.expiredFiles} expired files, ${d.trashPurged} from trash`); reload(); } catch (e) { toast(errorMessage(e), 'error'); } }}>Run cleanup now</button>
            </section>
        </div>
    );
}

export default function AdminView() {
    const [sub, setSub] = useState<Sub>('users');
    return (
        <div className="space-y-4">
            <div className="flex gap-1 border-b border-slate-200" role="tablist">
                {(['users', 'overview', 'system'] as const).map((s) => (
                    <button key={s} role="tab" aria-selected={sub === s} className={`border-b-2 px-4 py-2 text-sm font-medium capitalize ${sub === s ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500'}`} onClick={() => setSub(s)}>{s}</button>
                ))}
            </div>
            {sub === 'users' && <Users />}
            {sub === 'overview' && <Overview />}
            {sub === 'system' && <System />}
        </div>
    );
}
