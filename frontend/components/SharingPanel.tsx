'use client';

import { useState } from 'react';
import type { FileInfo } from '@sdk/index';
import { errorMessage, sdk } from '@/lib/api';
import { copyText, formatDateTime } from '@/lib/format';
import { Badge, Field, Spinner, useAsync, useToast } from './ui';

type LinkRow = { id: string; label?: string; permission: string; status: string; downloadCount: number; maxDownloads?: number; expiresAt?: string; hasPassword?: boolean; createdAt: string };

export default function SharingPanel({ file, onChanged }: { file: FileInfo; onChanged: () => void }) {
    const { toast, confirm } = useToast();
    const people = useAsync(() => sdk.shares(file._id), [file._id]);
    const links = useAsync(() => sdk.links(file._id) as Promise<LinkRow[]>, [file._id]);
    const [email, setEmail] = useState('');
    const [permission, setPermission] = useState<'read' | 'write' | 'admin'>('read');
    const [hours, setHours] = useState('');
    const [password, setPassword] = useState('');
    const [max, setMax] = useState('');
    const [linkPerm, setLinkPerm] = useState<'download' | 'view'>('download');
    const [fresh, setFresh] = useState<{ url: string } | null>(null);
    const [busy, setBusy] = useState(false);

    async function run(fn: () => Promise<unknown>, ok: string) {
        setBusy(true);
        try {
            await fn();
            toast(ok);
            people.reload();
            links.reload();
            onChanged();
        } catch (e) {
            toast(errorMessage(e), 'error');
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="space-y-6">
            <section aria-labelledby="share-people">
                <h3 id="share-people" className="mb-2 font-semibold">Share with people</h3>
                <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => sdk.share(file._id, email, permission).then(() => setEmail('')), 'Shared'); }}>
                    <div className="min-w-[12rem] flex-1">
                        <Field label="Email address">
                            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@example.com" />
                        </Field>
                    </div>
                    <Field label="Can">
                        <select className="input" value={permission} onChange={(e) => setPermission(e.target.value as typeof permission)}>
                            <option value="read">View and download</option>
                            <option value="write">Edit and add versions</option>
                            <option value="admin">Manage sharing and delete</option>
                        </select>
                    </Field>
                    <button className="btn btn-primary" disabled={busy}>Share</button>
                </form>
                {people.loading && !people.data ? <Spinner /> : (
                    <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200" data-testid="people-list">
                        {(people.data ?? []).length === 0 && <li className="p-3 text-sm text-slate-500">Not shared with anyone yet.</li>}
                        {(people.data ?? []).map((p) => (
                            <li key={p.userId} className="flex items-center justify-between gap-2 p-3 text-sm">
                                <div>
                                    <div className="font-medium">{p.name}</div>
                                    <div className="text-xs text-slate-500">{p.email}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Badge tone="blue">{p.permission}</Badge>
                                    <button className="btn btn-ghost text-red-600" onClick={() => void run(() => sdk.unshare(file._id, p.userId), 'Access removed')}>Remove</button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section aria-labelledby="share-links">
                <h3 id="share-links" className="mb-2 font-semibold">Share with a link</h3>
                {file.clientEncryption && <p className="mb-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900">🔐 End-to-end encrypted: people who open the link also need the passphrase. Send it to them separately (not in the same message as the link).</p>}
                <p className="mb-2 text-sm text-slate-500">Anyone with the link can open the file without an account. Pick an expiry and a password for anything sensitive.</p>
                <form className="grid grid-cols-2 gap-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); void run(async () => { const l = await sdk.createLink(file._id, { expiresInHours: hours ? Number(hours) : undefined, password: password || undefined, maxDownloads: max ? Number(max) : undefined, permission: linkPerm }); setFresh({ url: l.url }); setPassword(''); }, 'Link created'); }}>
                    <Field label="Expires after (hours)"><input className="input" type="number" min={1} max={8760} value={hours} onChange={(e) => setHours(e.target.value)} placeholder="never" /></Field>
                    <Field label="Password"><input className="input" type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="none" /></Field>
                    <Field label="Max downloads"><input className="input" type="number" min={1} value={max} onChange={(e) => setMax(e.target.value)} placeholder="unlimited" /></Field>
                    <Field label="Visitors can">
                        <select className="input" value={linkPerm} onChange={(e) => setLinkPerm(e.target.value as typeof linkPerm)}><option value="download">Download</option><option value="view">Only view</option></select>
                    </Field>
                    <div className="col-span-2 sm:col-span-4"><button className="btn btn-primary" disabled={busy}>Create link</button></div>
                </form>
                {fresh && (
                    <div className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm" data-testid="new-link">
                        <div className="mb-1 font-medium text-emerald-800">Copy it now: it will not be shown again.</div>
                        <div className="flex gap-2">
                            <input className="input font-mono text-xs" readOnly value={fresh.url} onFocus={(e) => e.currentTarget.select()} aria-label="Share link" />
                            <button className="btn btn-secondary shrink-0" onClick={async () => toast((await copyText(fresh.url)) ? 'Link copied' : 'Select the link and copy it', 'info')}>Copy</button>
                        </div>
                    </div>
                )}
                {links.loading && !links.data ? <Spinner /> : (
                    <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200" data-testid="link-list">
                        {(links.data ?? []).length === 0 && <li className="p-3 text-sm text-slate-500">No links yet.</li>}
                        {(links.data ?? []).map((l) => (
                            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                                <div>
                                    <div className="flex items-center gap-2 font-medium">Link {l.id.slice(-6)} <Badge tone={l.status === 'active' ? 'green' : 'red'}>{l.status}</Badge>{l.hasPassword && <Badge>🔑 password</Badge>}</div>
                                    <div className="text-xs text-slate-500">{l.permission} · {l.downloadCount}{l.maxDownloads ? `/${l.maxDownloads}` : ''} downloads · {l.expiresAt ? `expires ${formatDateTime(l.expiresAt)}` : 'no expiry'}</div>
                                </div>
                                {l.status === 'active' && <button className="btn btn-ghost text-red-600" onClick={async () => { if (await confirm('Revoke this link? Anyone using it will lose access.', { danger: true, confirmLabel: 'Revoke' })) void run(() => sdk.revokeLink(file._id, l.id), 'Link revoked'); }}>Revoke</button>}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}
