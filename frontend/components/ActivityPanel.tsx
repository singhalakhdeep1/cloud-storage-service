'use client';

import type { FileInfo } from '@sdk/index';
import { sdk } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { Empty, Spinner, useAsync } from './ui';

const LABEL: Record<string, string> = {
    upload: 'uploaded the file',
    version: 'uploaded a new version',
    version_restore: 'restored an older version',
    download: 'downloaded it',
    update: 'changed its details',
    trash: 'moved it to the trash',
    restore: 'restored it from the trash',
    share: 'shared it',
    unshare: 'removed a share',
    link_create: 'created a share link',
    link_revoke: 'revoked a share link',
    link_download: 'someone downloaded it through a link',
    image_process: 'processed the image',
    integration_export: 'copied it to another service',
};

export default function ActivityPanel({ file }: { file: FileInfo }) {
    const { data, loading, error } = useAsync(() => sdk.activity(file._id), [file._id, file.updatedAt]);
    if (loading && !data) return <Spinner />;
    if (error) return <p className="text-sm text-red-700">{error}</p>;
    const rows = data?.data ?? [];
    if (!rows.length) return <Empty icon="🕑" title="No activity yet" />;
    return (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200" data-testid="activity-list">
            {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                    <span><strong>{r.actor?.name ?? 'Someone'}</strong> {LABEL[r.action] ?? r.action}</span>
                    <span className="shrink-0 text-xs text-slate-500">{timeAgo(r.createdAt)}</span>
                </li>
            ))}
        </ul>
    );
}
