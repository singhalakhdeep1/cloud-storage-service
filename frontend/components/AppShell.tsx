'use client';

import { useEffect, useState } from 'react';
import { storage } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { useSession } from '@/lib/session';
import AdminView from './AdminView';
import AnalyticsView from './AnalyticsView';
import FilesView from './FilesView';
import IntegrationsView from './IntegrationsView';
import SettingsView from './SettingsView';
import TrashView from './TrashView';
import { UploadProvider } from './Uploads';
import { ProgressBar } from './ui';

type Tab = 'files' | 'shared' | 'trash' | 'analytics' | 'integrations' | 'settings' | 'admin';

const TABS: { id: Tab; label: string; icon: string; admin?: boolean }[] = [
    { id: 'files', label: 'My files', icon: '📁' },
    { id: 'shared', label: 'Shared with me', icon: '👥' },
    { id: 'trash', label: 'Trash', icon: '🗑️' },
    { id: 'analytics', label: 'Analytics', icon: '📊' },
    { id: 'integrations', label: 'Integrations', icon: '🔌' },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
    { id: 'admin', label: 'Admin', icon: '🛡️', admin: true },
];

export default function AppShell() {
    const { user, signOut, refresh } = useSession();
    const [tab, setTab] = useState<Tab>('files');
    // lets the quota bar and lists refresh after uploads and deletions
    const [version, setVersion] = useState(0);

    useEffect(() => {
        const saved = storage.get('cs_tab') as Tab | null;
        if (saved && TABS.some((t) => t.id === saved && (!t.admin || user?.role === 'admin'))) setTab(saved);
    }, [user?.role]);
    const choose = (t: Tab) => {
        setTab(t);
        storage.set('cs_tab', t);
    };
    const changed = () => {
        setVersion((v) => v + 1);
        void refresh();
    };

    if (!user) return null;
    const pct = user.storageLimit ? (user.storageUsed / user.storageLimit) * 100 : 0;

    return (
        <UploadProvider>
            <div className="flex min-h-screen flex-col md:flex-row">
                <aside className="border-b border-slate-200 bg-white md:w-64 md:border-b-0 md:border-r">
                    <div className="flex items-center gap-2 px-5 py-4 text-lg font-bold">
                        <span aria-hidden>☁️</span> Cloud Storage
                    </div>
                    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible" aria-label="Main">
                        {TABS.filter((t) => !t.admin || user.role === 'admin').map((t) => (
                            <button key={t.id} onClick={() => choose(t.id)} aria-current={tab === t.id ? 'page' : undefined} className={`flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium ${tab === t.id ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'}`}>
                                <span aria-hidden>{t.icon}</span>
                                {t.label}
                            </button>
                        ))}
                    </nav>
                    <div className="hidden px-5 py-4 md:block">
                        <div className="mb-1 flex justify-between text-xs text-slate-500">
                            <span>Storage</span>
                            <span data-testid="quota-text">{formatBytes(user.storageUsed)} of {formatBytes(user.storageLimit)}</span>
                        </div>
                        <ProgressBar percent={pct} tone={pct > 90 ? 'red' : 'brand'} />
                        <div className="mt-1 text-xs text-slate-500">{user.fileCount} file{user.fileCount === 1 ? '' : 's'}</div>
                    </div>
                </aside>

                <div className="flex min-w-0 flex-1 flex-col">
                    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
                        <h1 className="text-lg font-semibold">{TABS.find((t) => t.id === tab)?.label}</h1>
                        <div className="flex items-center gap-3 text-sm">
                            <span className="hidden text-slate-600 sm:inline">{user.name}</span>
                            <button className="btn btn-secondary" onClick={() => void signOut()}>Sign out</button>
                        </div>
                    </header>
                    <main className="flex-1 p-4 md:p-6">
                        {tab === 'files' && <FilesView scope="mine" onChanged={changed} />}
                        {tab === 'shared' && <FilesView scope="shared" onChanged={changed} />}
                        {tab === 'trash' && <TrashView key={`t${version}`} onChanged={changed} />}
                        {tab === 'analytics' && <AnalyticsView key={`a${version}`} />}
                        {tab === 'integrations' && <IntegrationsView />}
                        {tab === 'settings' && <SettingsView />}
                        {tab === 'admin' && user.role === 'admin' && <AdminView />}
                    </main>
                </div>
            </div>
        </UploadProvider>
    );
}
