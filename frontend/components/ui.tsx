'use client';

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';

/* ------------------------------------------------------------------ toasts */

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
    id: number;
    kind: ToastKind;
    text: string;
}
interface ToastApi {
    toast: (text: string, kind?: ToastKind) => void;
    confirm: (message: string, options?: { confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
}
const ToastContext = createContext<ToastApi>({ toast: () => undefined, confirm: async () => false });
export const useToast = (): ToastApi => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
    const [items, setItems] = useState<Toast[]>([]);
    const [ask, setAsk] = useState<{ message: string; confirmLabel: string; danger: boolean; resolve: (v: boolean) => void } | null>(null);
    const next = useRef(1);

    const toast = useCallback((text: string, kind: ToastKind = 'success') => {
        const id = next.current++;
        setItems((list) => [...list, { id, kind, text }]);
        setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), kind === 'error' ? 7000 : 4000);
    }, []);

    const confirm = useCallback(
        (message: string, options: { confirmLabel?: string; danger?: boolean } = {}) =>
            new Promise<boolean>((resolve) => setAsk({ message, confirmLabel: options.confirmLabel ?? 'Confirm', danger: options.danger ?? false, resolve })),
        []
    );

    return (
        <ToastContext.Provider value={{ toast, confirm }}>
            {children}
            <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
                {items.map((t) => (
                    <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className={`pointer-events-auto rounded-lg px-4 py-3 text-sm text-white shadow-lg ${t.kind === 'error' ? 'bg-red-600' : t.kind === 'info' ? 'bg-slate-700' : 'bg-emerald-600'}`}>
                        {t.text}
                    </div>
                ))}
            </div>
            {ask && (
                <Modal title="Please confirm" onClose={() => { ask.resolve(false); setAsk(null); }} size="sm">
                    <p className="text-sm text-slate-700">{ask.message}</p>
                    <div className="mt-5 flex justify-end gap-2">
                        <button className="btn btn-secondary" onClick={() => { ask.resolve(false); setAsk(null); }}>Cancel</button>
                        <button className={`btn ${ask.danger ? 'btn-danger' : 'btn-primary'}`} autoFocus onClick={() => { ask.resolve(true); setAsk(null); }}>{ask.confirmLabel}</button>
                    </div>
                </Modal>
            )}
        </ToastContext.Provider>
    );
}

/* ------------------------------------------------------------------- modal */

export function Modal({ title, onClose, children, size = 'md' }: { title: string; onClose: () => void; children: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
    const titleId = useId();
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);
    const width = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <div role="dialog" aria-modal="true" aria-labelledby={titleId} className={`card max-h-[90vh] w-full overflow-y-auto p-5 ${width}`}>
                <div className="mb-4 flex items-start justify-between gap-4">
                    <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
                    <button className="btn btn-ghost -mr-2 -mt-1 px-2 py-1" onClick={onClose} aria-label="Close">✕</button>
                </div>
                {children}
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------- misc */

export function Spinner({ label = 'Loading' }: { label?: string }) {
    return (
        <div className="flex items-center justify-center gap-3 p-8 text-sm text-slate-500" role="status">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
            {label}…
        </div>
    );
}

export function Empty({ icon = '📂', title, hint }: { icon?: string; title: string; hint?: string }) {
    return (
        <div className="flex flex-col items-center gap-2 p-12 text-center text-slate-500">
            <div className="text-4xl">{icon}</div>
            <div className="font-medium text-slate-700">{title}</div>
            {hint && <div className="text-sm">{hint}</div>}
        </div>
    );
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'red' | 'amber' | 'blue' }) {
    const tones = { slate: 'bg-slate-100 text-slate-700', green: 'bg-emerald-100 text-emerald-800', red: 'bg-red-100 text-red-800', amber: 'bg-amber-100 text-amber-800', blue: 'bg-brand-100 text-brand-700' };
    return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function ProgressBar({ percent, tone = 'brand' }: { percent: number; tone?: 'brand' | 'red' | 'green' }) {
    const color = tone === 'red' ? 'bg-red-500' : tone === 'green' ? 'bg-emerald-500' : 'bg-brand-600';
    return (
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full ${color} transition-all`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
        </div>
    );
}

/** A labelled control; the label wraps the input, so screen readers and clicks on the text both reach it. */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
    return (
        <label className="block">
            <span className="label">{label}</span>
            {children}
            {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
        </label>
    );
}

/** Reads a promise-returning loader into state. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]) {
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [tick, setTick] = useState(0);
    useEffect(() => {
        let alive = true;
        setLoading(true);
        loader().then(
            (d) => alive && (setData(d), setError(null), setLoading(false)),
            (e: Error) => alive && (setError(e.message), setLoading(false))
        );
        return () => {
            alive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [...deps, tick]);
    return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}
