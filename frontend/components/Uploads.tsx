'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { FileInfo } from '@sdk/index';
import { errorMessage, FileCloudError, sdk } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { ProgressBar, useToast } from './ui';

/** Files above this size go through the resumable chunked upload instead of one request. */
export const LARGE_FILE = 20 * 1024 * 1024;

export interface UploadItem {
    id: number;
    name: string;
    size: number;
    status: 'queued' | 'uploading' | 'done' | 'error' | 'cancelled';
    percent: number;
    resumable: boolean;
    uploadId?: string;
    error?: string;
    versionOf?: string;
}

interface UploadsApi {
    items: UploadItem[];
    enqueue: (files: File[], options?: { versionOf?: string; tags?: string[] }) => void;
    /** Called after any upload finishes, so lists can refresh. */
    onFinished: (fn: (file: FileInfo) => void) => () => void;
}

const UploadsContext = createContext<UploadsApi>({ items: [], enqueue: () => undefined, onFinished: () => () => undefined });
export const useUploads = (): UploadsApi => useContext(UploadsContext);

interface Job extends UploadItem {
    file: File;
    controller: AbortController;
    tags?: string[];
}

export function UploadProvider({ children }: { children: ReactNode }) {
    const { toast } = useToast();
    const jobs = useRef<Job[]>([]);
    const [items, setItems] = useState<UploadItem[]>([]);
    const listeners = useRef(new Set<(f: FileInfo) => void>());
    const nextId = useRef(1);
    const running = useRef(0);

    const publish = useCallback(() => setItems(jobs.current.map(({ file: _f, controller: _c, tags: _t, ...view }) => view)), []);
    const patch = useCallback(
        (job: Job, change: Partial<UploadItem>) => {
            Object.assign(job, change);
            publish();
        },
        [publish]
    );

    const pump = useCallback(() => {
        while (running.current < 2) {
            const job = jobs.current.find((j) => j.status === 'queued');
            if (!job) return;
            running.current++;
            patch(job, { status: 'uploading', percent: 0 });
            const onProgress = (p: { percent: number }) => patch(job, { percent: p.percent });
            const run = job.resumable
                ? sdk.uploadLarge(job.file, job.name, { versionOf: job.versionOf, tags: job.tags, signal: job.controller.signal, uploadId: job.uploadId, onSession: (id) => (job.uploadId = id), onProgress })
                : job.versionOf
                  ? sdk.uploadVersion(job.versionOf, job.file, job.name, undefined, { onProgress, signal: job.controller.signal })
                  : sdk.upload(job.file, job.name, { tags: job.tags, onProgress, signal: job.controller.signal });
            run.then(
                (file) => {
                    patch(job, { status: 'done', percent: 100 });
                    listeners.current.forEach((fn) => fn(file));
                },
                (e: unknown) => {
                    const cancelled = job.controller.signal.aborted;
                    patch(job, { status: cancelled ? 'cancelled' : 'error', error: cancelled ? undefined : errorMessage(e) });
                    if (!cancelled && e instanceof FileCloudError && e.code === 'quota_exceeded') toast('Not enough storage space for this file', 'error');
                }
            ).finally(() => {
                running.current--;
                pump();
            });
        }
    }, [patch, toast]);

    const enqueue = useCallback(
        (files: File[], options: { versionOf?: string; tags?: string[] } = {}) => {
            for (const file of files) {
                jobs.current.push({ id: nextId.current++, name: file.name, size: file.size, status: 'queued', percent: 0, resumable: file.size > LARGE_FILE, versionOf: options.versionOf, tags: options.tags, file, controller: new AbortController() });
            }
            publish();
            pump();
        },
        [publish, pump]
    );

    const onFinished = useCallback((fn: (f: FileInfo) => void) => {
        listeners.current.add(fn);
        return () => void listeners.current.delete(fn);
    }, []);

    // closing the tab mid-upload loses non-resumable uploads: warn
    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => {
            if (jobs.current.some((j) => j.status === 'uploading' || j.status === 'queued')) e.preventDefault();
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, []);

    const cancel = (id: number) => {
        const job = jobs.current.find((j) => j.id === id);
        if (!job) return;
        job.controller.abort();
        if (job.status === 'queued') patch(job, { status: 'cancelled' });
        if (job.uploadId && job.resumable) sdk.cancelUpload(job.uploadId).catch(() => undefined);
    };
    const retry = (id: number) => {
        const job = jobs.current.find((j) => j.id === id);
        if (!job) return;
        job.controller = new AbortController();
        patch(job, { status: 'queued', error: undefined, percent: 0 });
        pump();
    };
    const clear = () => {
        jobs.current = jobs.current.filter((j) => j.status === 'queued' || j.status === 'uploading');
        publish();
    };

    const active = items.filter((i) => i.status === 'queued' || i.status === 'uploading').length;

    return (
        <UploadsContext.Provider value={{ items, enqueue, onFinished }}>
            {children}
            {items.length > 0 && (
                <aside className="card fixed bottom-4 left-4 z-40 w-80 max-w-[calc(100vw-2rem)]" aria-label="Uploads">
                    <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 text-sm font-medium">
                        <span>{active ? `Uploading ${active} file${active > 1 ? 's' : ''}` : 'Uploads finished'}</span>
                        <button className="text-xs text-slate-500 hover:text-slate-800" onClick={clear}>Clear</button>
                    </div>
                    <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto" data-testid="upload-list">
                        {items.map((i) => (
                            <li key={i.id} className="space-y-1 px-4 py-2 text-sm">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="truncate" title={i.name}>{i.name}</span>
                                    <span className="shrink-0 text-xs text-slate-500">{formatBytes(i.size)}</span>
                                </div>
                                {(i.status === 'uploading' || i.status === 'queued') && (
                                    <>
                                        <ProgressBar percent={i.percent} />
                                        <div className="flex justify-between text-xs text-slate-500">
                                            <span>{i.status === 'queued' ? 'Waiting' : `${i.percent}%${i.resumable ? ' · resumable' : ''}`}</span>
                                            <button className="text-red-600 hover:underline" onClick={() => cancel(i.id)}>Cancel</button>
                                        </div>
                                    </>
                                )}
                                {i.status === 'done' && <div className="text-xs text-emerald-700">Uploaded</div>}
                                {i.status === 'cancelled' && <div className="text-xs text-slate-500">Cancelled</div>}
                                {i.status === 'error' && (
                                    <div className="flex items-center justify-between gap-2 text-xs text-red-700">
                                        <span className="truncate" title={i.error}>{i.error}</span>
                                        <button className="shrink-0 text-brand-700 hover:underline" onClick={() => retry(i.id)}>{i.resumable && i.uploadId ? 'Resume' : 'Retry'}</button>
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                </aside>
            )}
        </UploadsContext.Provider>
    );
}
