'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { errorMessage, sdk } from '@/lib/api';
import { formatBytes, formatDateTime } from '@/lib/format';
import { Spinner, useAsync, useToast } from './ui';

type ObjectRow = { key: string; size: number; lastModified?: string };

/** Administrators: buckets / containers of each configured cloud provider and the objects in them. */
export default function BucketBrowser() {
    const { toast, confirm } = useToast();
    const providers = useAsync(() => sdk.admin.storage.providers(), []);
    const usable = (providers.data?.data ?? []).filter((p) => p.configured && p.buckets);
    const [provider, setProvider] = useState('');
    const [bucket, setBucket] = useState<string | null>(null);
    const [newBucket, setNewBucket] = useState('');
    const [prefix, setPrefix] = useState('');
    const [objects, setObjects] = useState<ObjectRow[]>([]);
    const [cursor, setCursor] = useState<string | undefined>();
    const [loadingObjects, setLoadingObjects] = useState(false);

    useEffect(() => {
        if (!provider && usable[0]) setProvider(usable[0].name);
    }, [provider, usable]);
    const buckets = useAsync(() => (provider ? sdk.admin.storage.buckets(provider) : Promise.resolve({ data: [] as string[] })), [provider]);

    async function loadObjects(name: string, more = false) {
        setLoadingObjects(true);
        try {
            const r = await sdk.admin.storage.objects(provider, name, { prefix: prefix || undefined, limit: 100, cursor: more ? cursor : undefined });
            setObjects((o) => (more ? [...o, ...r.data.files] : r.data.files));
            setCursor(r.data.nextCursor);
        } catch (e) {
            toast(errorMessage(e), 'error');
        } finally {
            setLoadingObjects(false);
        }
    }

    function open(name: string) {
        setBucket(name);
        setObjects([]);
        setCursor(undefined);
        void loadObjects(name);
    }

    async function create(e: FormEvent) {
        e.preventDefault();
        try {
            await sdk.admin.storage.createBucket(provider, newBucket.trim());
            toast(`Bucket ${newBucket.trim()} created`);
            setNewBucket('');
            buckets.reload();
        } catch (err) {
            toast(errorMessage(err), 'error');
        }
    }

    async function remove(name: string) {
        if (!(await confirm(`Delete the bucket “${name}”? It must be empty.`, { danger: true, confirmLabel: 'Delete bucket' }))) return;
        try {
            await sdk.admin.storage.deleteBucket(provider, name);
            toast('Bucket deleted');
            if (bucket === name) setBucket(null);
            buckets.reload();
        } catch (e) {
            toast(errorMessage(e), 'error');
        }
    }

    async function download(key: string) {
        try {
            const { url } = await sdk.admin.storage.presign(provider, bucket as string, key);
            window.open(url, '_blank', 'noopener');
        } catch (e) {
            toast(errorMessage(e), 'error');
        }
    }

    if (providers.loading && !providers.data) return <Spinner />;
    if (!usable.length) return <p className="text-sm text-slate-500">No cloud provider is configured (local disk has no buckets).</p>;

    return (
        <div className="space-y-3" data-testid="bucket-browser">
            <div className="flex flex-wrap items-end gap-2">
                <label className="block">
                    <span className="label">Provider</span>
                    <select className="input" value={provider} onChange={(e) => { setProvider(e.target.value); setBucket(null); }}>
                        {usable.map((p) => <option key={p.name} value={p.name}>{p.name}{p.isDefault ? ' (default)' : ''}</option>)}
                    </select>
                </label>
                <form className="flex items-end gap-2" onSubmit={(e) => void create(e)}>
                    <label className="block"><span className="label">New bucket</span><input className="input" value={newBucket} onChange={(e) => setNewBucket(e.target.value)} placeholder="my-bucket" pattern="[a-z0-9][a-z0-9.\-]{1,61}[a-z0-9]" required /></label>
                    <button className="btn btn-secondary">Create</button>
                </form>
            </div>
            {buckets.loading && !buckets.data ? <Spinner /> : buckets.error ? <p className="text-sm text-red-700" role="alert">{buckets.error}</p> : (
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm" data-testid="bucket-list">
                    {(buckets.data?.data ?? []).length === 0 && <li className="p-3 text-slate-500">No buckets.</li>}
                    {(buckets.data?.data ?? []).map((b) => (
                        <li key={b} className={`flex items-center justify-between gap-2 p-2 ${bucket === b ? 'bg-brand-50' : ''}`}>
                            <button className="font-medium hover:text-brand-700" onClick={() => open(b)}>🪣 {b}</button>
                            <button className="btn btn-ghost text-red-600" onClick={() => void remove(b)}>Delete</button>
                        </li>
                    ))}
                </ul>
            )}
            {bucket && (
                <div className="space-y-2">
                    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); open(bucket); }}>
                        <input className="input max-w-xs" placeholder="Key prefix, e.g. files/" aria-label="Key prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
                        <button className="btn btn-secondary">Filter</button>
                    </form>
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                        <table className="w-full text-sm" data-testid="object-table">
                            <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Key</th><th className="p-2">Size</th><th className="p-2">Modified</th><th className="p-2" /></tr></thead>
                            <tbody>
                                {objects.map((o) => (
                                    <tr key={o.key} className="border-b border-slate-100 last:border-0">
                                        <td className="max-w-md truncate p-2 font-mono text-xs" title={o.key}>{o.key}</td>
                                        <td className="p-2">{formatBytes(o.size)}</td>
                                        <td className="p-2">{o.lastModified ? formatDateTime(o.lastModified) : '—'}</td>
                                        <td className="p-2 text-right"><button className="btn btn-ghost" onClick={() => void download(o.key)}>Open</button></td>
                                    </tr>
                                ))}
                                {!objects.length && !loadingObjects && <tr><td className="p-3 text-slate-500" colSpan={4}>Empty.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                    {loadingObjects && <Spinner />}
                    {cursor && !loadingObjects && <button className="btn btn-secondary" onClick={() => void loadObjects(bucket, true)}>Load more</button>}
                </div>
            )}
        </div>
    );
}
