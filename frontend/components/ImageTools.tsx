'use client';

import { useState } from 'react';
import type { FileInfo } from '@sdk/index';
import { errorMessage, sdk } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { Field, useToast } from './ui';

/** Image processing: each result is stored as a variant of the file (the original is never touched, except auto-orient, which makes a new version). */
export default function ImageTools({ file, canWrite, onChanged }: { file: FileInfo; canWrite: boolean; onChanged: () => void }) {
    const { toast, confirm } = useToast();
    const [width, setWidth] = useState('400');
    const [height, setHeight] = useState('300');
    const [fit, setFit] = useState('cover');
    const [format, setFormat] = useState('webp');
    const [quality, setQuality] = useState('80');
    const [busy, setBusy] = useState(false);
    const [meta, setMeta] = useState<Record<string, unknown> | null>(null);

    async function run(label: string, fn: () => Promise<unknown>) {
        setBusy(true);
        try {
            await fn();
            toast(`${label} done`);
            onChanged();
        } catch (e) {
            toast(errorMessage(e), 'error');
        } finally {
            setBusy(false);
        }
    }

    async function open(variantId: string) {
        try {
            const { url } = await sdk.downloadUrl(file._id, { variant: variantId, inline: true });
            window.open(url, '_blank', 'noopener');
        } catch (e) {
            toast(errorMessage(e), 'error');
        }
    }

    return (
        <div className="space-y-5">
            {canWrite ? (
                <div className="grid gap-4 sm:grid-cols-2">
                    <fieldset className="card space-y-3 p-4">
                        <legend className="px-1 text-sm font-semibold">Resize</legend>
                        <div className="grid grid-cols-2 gap-2">
                            <Field label="Width"><input className="input" type="number" min={1} max={10000} value={width} onChange={(e) => setWidth(e.target.value)} /></Field>
                            <Field label="Height"><input className="input" type="number" min={1} max={10000} value={height} onChange={(e) => setHeight(e.target.value)} /></Field>
                        </div>
                        <Field label="Fit">
                            <select className="input" value={fit} onChange={(e) => setFit(e.target.value)}>{['cover', 'contain', 'fill', 'inside', 'outside'].map((f) => <option key={f}>{f}</option>)}</select>
                        </Field>
                        <button className="btn btn-primary w-full" disabled={busy} onClick={() => void run('Resize', () => sdk.imageResize(file._id, Number(width), Number(height), fit))}>Resize</button>
                    </fieldset>
                    <fieldset className="card space-y-3 p-4">
                        <legend className="px-1 text-sm font-semibold">Convert and compress</legend>
                        <div className="grid grid-cols-2 gap-2">
                            <Field label="Format"><select className="input" value={format} onChange={(e) => setFormat(e.target.value)}>{['jpeg', 'png', 'webp', 'avif', 'gif', 'tiff'].map((f) => <option key={f}>{f}</option>)}</select></Field>
                            <Field label="Quality"><input className="input" type="number" min={1} max={100} value={quality} onChange={(e) => setQuality(e.target.value)} /></Field>
                        </div>
                        <div className="flex gap-2">
                            <button className="btn btn-primary flex-1" disabled={busy} onClick={() => void run('Convert', () => sdk.imageConvert(file._id, format, Number(quality)))}>Convert</button>
                            <button className="btn btn-secondary flex-1" disabled={busy} onClick={() => void run('Compress', () => sdk.imageCompress(file._id, Number(quality), format))}>Compress</button>
                        </div>
                    </fieldset>
                    <div className="flex flex-wrap gap-2 sm:col-span-2">
                        <button className="btn btn-secondary" disabled={busy} onClick={() => void run('Thumbnail', () => sdk.imageThumbnail(file._id, 200, 200))}>New 200px thumbnail</button>
                        <button className="btn btn-secondary" disabled={busy} onClick={async () => { if (await confirm('Rotate the pixels to match the photo’s orientation tag? The current image is kept as the previous version.', { confirmLabel: 'Fix orientation' })) void run('Auto-orient', () => sdk.imageAutoOrient(file._id)); }}>Fix orientation (EXIF)</button>
                        <button className="btn btn-secondary" disabled={busy} onClick={() => void run('Metadata', async () => setMeta((await sdk.imageMetadata(file._id)).data))}>Show metadata</button>
                    </div>
                </div>
            ) : (
                <p className="text-sm text-slate-500">You need edit access to process this image.</p>
            )}

            {meta && (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-4" data-testid="image-meta">
                    {Object.entries(meta).filter(([, v]) => v !== undefined).map(([k, v]) => (<div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd>{String(v)}</dd></div>))}
                </dl>
            )}

            <div>
                <h3 className="mb-2 font-semibold">Variants</h3>
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200" data-testid="variant-list">
                    {file.variants.length === 0 && <li className="p-3 text-sm text-slate-500">No variants yet.</li>}
                    {file.variants.map((v) => (
                        <li key={v.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                            <span>{v.type} · {v.dimensions?.width}×{v.dimensions?.height} · {v.format} · {formatBytes(v.size)}</span>
                            <span className="flex gap-2">
                                <button className="btn btn-secondary" onClick={() => void open(v.id)}>Open</button>
                                {canWrite && <button className="btn btn-ghost text-red-600" onClick={async () => { if (await confirm('Delete this variant?', { danger: true, confirmLabel: 'Delete' })) void run('Delete', () => sdk.deleteVariant(file._id, v.id)); }}>Delete</button>}
                            </span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
