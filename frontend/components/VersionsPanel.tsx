'use client';

import { useRef, useState } from 'react';
import type { FileInfo } from '@sdk/index';
import { errorMessage, sdk } from '@/lib/api';
import { formatBytes, formatDateTime } from '@/lib/format';
import E2EEPanel from './E2EEPanel';
import { useUploads } from './Uploads';
import { Badge, Spinner, useAsync, useToast } from './ui';

export default function VersionsPanel({ file, canWrite, canDelete, onChanged }: { file: FileInfo; canWrite: boolean; canDelete: boolean; onChanged: () => void }) {
    const { toast, confirm } = useToast();
    const { enqueue } = useUploads();
    const input = useRef<HTMLInputElement>(null);
    const [passphrase, setPassphrase] = useState('');
    const [decrypting, setDecrypting] = useState<number | null>(null);
    // a version is end-to-end encrypted when its own parameters say so (the current one uses the file's)
    const isE2ee = (n: number) => (n === file.currentVersion ? Boolean(file.clientEncryption) : Boolean(file.versions.find((v) => v.versionNumber === n)?.clientEncryption));
    const { data, loading, reload } = useAsync(() => sdk.versions(file._id), [file._id, file.currentVersion]);

    async function act(label: string, fn: () => Promise<unknown>) {
        try {
            await fn();
            toast(label);
            reload();
            onChanged();
        } catch (e) {
            toast(errorMessage(e), 'error');
        }
    }

    async function download(version: number) {
        if (isE2ee(version)) return setDecrypting(version);
        try {
            const { url } = await sdk.downloadUrl(file._id, { version });
            window.open(url, '_blank', 'noopener');
        } catch (e) {
            toast(errorMessage(e), 'error');
        }
    }

    if (loading && !data) return <Spinner />;
    const versions = data?.data.versions ?? [];

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <p className="text-sm text-slate-600">Up to {data?.data.maxVersions} earlier versions are kept. Restoring one keeps the current content in the history.</p>
                {canWrite && (
                    <div className="flex shrink-0 items-center gap-2">
                        {file.clientEncryption && <input className="input w-40" type="password" autoComplete="off" placeholder="Passphrase" aria-label="Passphrase for the new version" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />}
                        <button className="btn btn-primary shrink-0" onClick={() => (file.clientEncryption && passphrase.length < 8 ? toast('The new version of an end-to-end encrypted file needs a passphrase (8+ characters)', 'error') : input.current?.click())}>Upload new version</button>
                        <input ref={input} type="file" hidden data-testid="version-input" onChange={(e) => { if (e.target.files?.[0]) { enqueue([e.target.files[0]], { versionOf: file._id, passphrase: file.clientEncryption ? passphrase : undefined }); toast('Uploading the new version…', 'info'); } e.target.value = ''; }} />
                    </div>
                )}
            </div>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200" data-testid="version-list">
                {versions.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                        <div>
                            <div className="font-medium">Version {v.versionNumber} {v.current && <Badge tone="green">current</Badge>} {isE2ee(v.versionNumber) && <Badge tone="green">🔐</Badge>}</div>
                            <div className="text-xs text-slate-500">{formatBytes(v.size)} · {formatDateTime(v.uploadedAt)}{v.reason ? ` · ${v.reason}` : ''}</div>
                        </div>
                        <div className="flex gap-2">
                            <button className="btn btn-secondary" onClick={() => void download(v.versionNumber)}>Download</button>
                            {!v.current && canWrite && <button className="btn btn-secondary" onClick={() => void act(`Version ${v.versionNumber} restored`, () => sdk.restoreVersion(file._id, v.versionNumber))}>Restore</button>}
                            {!v.current && canDelete && (
                                <button className="btn btn-ghost text-red-600" onClick={async () => { if (await confirm(`Delete version ${v.versionNumber} for good?`, { danger: true, confirmLabel: 'Delete' })) await act('Version deleted', () => sdk.deleteVersion(file._id, v.versionNumber)); }}>Delete</button>
                            )}
                        </div>
                    </li>
                ))}
            </ul>
            {decrypting !== null && (
                <div>
                    <p className="mb-1 text-sm font-medium">Decrypt version {decrypting}</p>
                    <E2EEPanel file={file} version={decrypting} compact />
                </div>
            )}
        </div>
    );
}
