'use client';

import { useEffect, useState } from 'react';
import type { FileInfo } from '@sdk/index';
import { errorMessage, sdk } from '@/lib/api';
import { categoryIcon, formatBytes, formatDateTime } from '@/lib/format';
import ActivityPanel from './ActivityPanel';
import E2EEPanel from './E2EEPanel';
import ExportPanel from './ExportPanel';
import ImageTools from './ImageTools';
import Preview from './Preview';
import SharingPanel from './SharingPanel';
import { useUploads } from './Uploads';
import VersionsPanel from './VersionsPanel';
import { Badge, Field, Modal, Spinner, useToast } from './ui';

type Tab = 'details' | 'versions' | 'sharing' | 'image' | 'activity' | 'export';

export default function FileDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
    const { toast, confirm } = useToast();
    const { onFinished } = useUploads();
    const [file, setFile] = useState<FileInfo | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [tab, setTab] = useState<Tab>('details');

    const [name, setName] = useState('');
    const [tags, setTags] = useState('');
    const [description, setDescription] = useState('');
    const [expires, setExpires] = useState('');
    const [saving, setSaving] = useState(false);

    const load = async () => {
        try {
            const f = await sdk.get(id);
            setFile(f);
            setName(f.originalName);
            setTags(f.tags.join(', '));
            setDescription(f.description ?? '');
            setExpires(f.expiresAt ? f.expiresAt.slice(0, 16) : '');
        } catch (e) {
            setError(errorMessage(e));
        }
    };
    useEffect(() => void load(), [id]); // eslint-disable-line react-hooks/exhaustive-deps
    // a new version uploaded from this dialog finishes in the background: show it when it lands
    useEffect(() => onFinished((f) => f._id === id && void load()), [id, onFinished]); // eslint-disable-line react-hooks/exhaustive-deps

    if (error) return <Modal title="File" onClose={onClose}><p className="text-red-700" role="alert">{error}</p></Modal>;
    if (!file) return <Modal title="File" onClose={onClose}><Spinner /></Modal>;

    const canWrite = ['owner', 'admin', 'write'].includes(file.permission);
    const canAdmin = ['owner', 'admin'].includes(file.permission);
    const tabs: { id: Tab; label: string; show: boolean }[] = [
        { id: 'details', label: 'Details', show: true },
        { id: 'versions', label: `Versions (${file.currentVersion})`, show: true },
        { id: 'sharing', label: 'Sharing', show: canAdmin },
        { id: 'image', label: 'Image tools', show: file.category === 'image' && !file.clientEncryption },
        { id: 'activity', label: 'Activity', show: canAdmin },
        { id: 'export', label: 'Export', show: true },
    ];

    const refresh = () => { void load(); onChanged(); };

    async function save() {
        setSaving(true);
        try {
            const patch: Parameters<typeof sdk.update>[1] = { name, tags: tags.split(',').map((t) => t.trim()).filter(Boolean), description };
            if (canAdmin) patch.expiresAt = expires ? new Date(expires).toISOString() : null;
            setFile(await sdk.update(id, patch));
            toast('Saved');
            onChanged();
        } catch (e) {
            toast(errorMessage(e), 'error');
        } finally {
            setSaving(false);
        }
    }

    async function download() {
        try {
            const { url } = await sdk.downloadUrl(id);
            const a = document.createElement('a');
            a.href = url;
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => void load(), 800);
        } catch (e) {
            toast(errorMessage(e), 'error');
        }
    }

    async function setVisibility(isPublic: boolean) {
        try {
            setFile(await sdk.update(id, { isPublic }));
            toast(isPublic ? 'Any signed-in user with the file id can open it' : 'File is private again');
            onChanged();
        } catch (e) {
            toast(errorMessage(e), 'error');
        }
    }

    async function trash() {
        if (!(await confirm(`Move “${file!.originalName}” to the trash?`, { confirmLabel: 'Move to trash' }))) return;
        try {
            await sdk.trash(id);
            toast('Moved to trash');
            onChanged();
            onClose();
        } catch (e) {
            toast(errorMessage(e), 'error');
        }
    }

    return (
        <Modal title={file.originalName} onClose={onClose} size="xl">
            <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <span aria-hidden>{categoryIcon[file.category]}</span>
                <span>{file.clientEncryption?.mimetype ?? file.mimetype}</span>·<span>{formatBytes(file.clientEncryption?.size ?? file.size)}</span>·<Badge tone="blue">{file.permission}</Badge>
                {file.clientEncryption && <Badge tone="green">🔐 end-to-end encrypted</Badge>}
                {file.isEncrypted && <Badge tone="green">🔒 encrypted</Badge>}
                {file.isPublic && <Badge tone="amber">public</Badge>}
                {file.virusScanned && <Badge tone="green">scanned</Badge>}
            </div>
            <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
                {tabs.filter((t) => t.show).map((t) => (
                    <button key={t.id} role="tab" aria-selected={tab === t.id} className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${tab === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`} onClick={() => setTab(t.id)}>{t.label}</button>
                ))}
            </div>

            {tab === 'details' && (
                <div className="grid gap-5 md:grid-cols-2">
                    {file.clientEncryption ? <E2EEPanel file={file} /> : <Preview file={file} />}
                    <div className="space-y-3">
                        <Field label="Name"><input className="input" value={name} disabled={!canWrite} onChange={(e) => setName(e.target.value)} /></Field>
                        <Field label="Tags" hint="Separate with commas"><input className="input" value={tags} disabled={!canWrite} onChange={(e) => setTags(e.target.value)} /></Field>
                        <Field label="Description"><textarea className="input" rows={2} value={description} disabled={!canWrite} onChange={(e) => setDescription(e.target.value)} /></Field>
                        {canAdmin && <Field label="Delete automatically on" hint="Leave empty to keep it until you delete it"><input className="input" type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} /></Field>}
                        {canWrite && <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>}
                        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-slate-100 pt-3 text-sm">
                            <dt className="text-slate-500">Uploaded</dt><dd>{formatDateTime(file.createdAt)}</dd>
                            <dt className="text-slate-500">Changed</dt><dd>{formatDateTime(file.updatedAt)}</dd>
                            <dt className="text-slate-500">Downloads</dt><dd>{file.downloadCount}</dd>
                            <dt className="text-slate-500">Stored on</dt><dd>{file.provider}</dd>
                            {file.metadata?.width && (<><dt className="text-slate-500">Dimensions</dt><dd>{file.metadata.width}×{file.metadata.height}</dd></>)}
                            {file.checksum && (<><dt className="text-slate-500">SHA-256</dt><dd className="truncate font-mono text-xs" title={file.checksum}>{file.checksum.slice(0, 16)}…</dd></>)}
                        </dl>
                        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                            {!file.clientEncryption && <button className="btn btn-primary" onClick={() => void download()}>⬇️ Download</button>}
                            {canAdmin && <button className="btn btn-secondary" onClick={() => void setVisibility(!file.isPublic)}>{file.isPublic ? 'Make private' : 'Make public'}</button>}
                            {canAdmin && <button className="btn btn-secondary text-red-600" onClick={() => void trash()}>🗑️ Move to trash</button>}
                        </div>
                    </div>
                </div>
            )}
            {tab === 'versions' && <VersionsPanel file={file} canWrite={canWrite} canDelete={canAdmin} onChanged={refresh} />}
            {tab === 'sharing' && canAdmin && <SharingPanel file={file} onChanged={refresh} />}
            {tab === 'image' && <ImageTools file={file} canWrite={canWrite} onChanged={refresh} />}
            {tab === 'activity' && canAdmin && <ActivityPanel file={file} />}
            {tab === 'export' && <ExportPanel file={file} />}
        </Modal>
    );
}
