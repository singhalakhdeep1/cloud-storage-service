'use client';

import { useState } from 'react';
import type { FileInfo } from '@sdk/index';
import { errorMessage, sdk } from '@/lib/api';
import { Field, Spinner, useAsync, useToast } from './ui';

/** Copy the file to a service the user has connected under Integrations. */
export default function ExportPanel({ file }: { file: FileInfo }) {
    const { toast } = useToast();
    const status = useAsync(() => sdk.integrations(), []);
    const [busy, setBusy] = useState<string | null>(null);
    const [path, setPath] = useState('');
    const [folder, setFolder] = useState('');
    const [message, setMessage] = useState('');

    async function go(type: 'slack' | 'dropbox' | 'google-drive') {
        setBusy(type);
        try {
            await sdk.exportTo(type, file._id, { message: message || undefined, path: path || undefined, folderId: folder || undefined });
            toast(type === 'slack' ? 'Posted to Slack' : `Copied to ${type === 'dropbox' ? 'Dropbox' : 'Google Drive'}`);
            status.reload();
        } catch (e) {
            toast(errorMessage(e), 'error');
        } finally {
            setBusy(null);
        }
    }

    if (status.loading && !status.data) return <Spinner />;
    const i = status.data?.integrations;
    const rows: { type: 'slack' | 'dropbox' | 'google-drive'; key: string; title: string; connected: boolean }[] = [
        { type: 'slack', key: 'slack', title: 'Slack', connected: Boolean(i?.slack?.configured) },
        { type: 'dropbox', key: 'dropbox', title: 'Dropbox', connected: Boolean(i?.dropbox?.configured) },
        { type: 'google-drive', key: 'googleDrive', title: 'Google Drive', connected: Boolean(i?.googleDrive?.configured) },
    ];
    return (
        <div className="space-y-3">
            <p className="text-sm text-slate-500">Connect services under Integrations first. Exports send the file to your own account there.</p>
            <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Slack message"><input className="input" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="optional" /></Field>
                <Field label="Dropbox path"><input className="input" value={path} onChange={(e) => setPath(e.target.value)} placeholder={`/${file.originalName}`} /></Field>
                <Field label="Drive folder id"><input className="input" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="optional" /></Field>
            </div>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {rows.map((r) => (
                    <li key={r.type} className="flex items-center justify-between gap-2 p-3 text-sm">
                        <span className="font-medium">{r.title} {!r.connected && <span className="text-xs font-normal text-slate-500">(not connected)</span>}</span>
                        <button className="btn btn-secondary" disabled={!r.connected || busy !== null} onClick={() => void go(r.type)}>{busy === r.type ? 'Sending…' : r.type === 'slack' ? 'Post' : 'Copy'}</button>
                    </li>
                ))}
            </ul>
        </div>
    );
}
