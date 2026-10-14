'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { UserInfo } from '@sdk/index';
import { persistToken, restoreToken, sdk, setUnauthorizedHandler } from './api';

interface SessionApi {
    user: UserInfo | null;
    ready: boolean;
    signIn: (email: string, password: string) => Promise<void>;
    signUp: (name: string, email: string, password: string) => Promise<void>;
    signOut: () => Promise<void>;
    refresh: () => Promise<void>;
    setUser: (u: UserInfo | null) => void;
}

const SessionContext = createContext<SessionApi | null>(null);
export const useSession = (): SessionApi => {
    const ctx = useContext(SessionContext);
    if (!ctx) throw new Error('useSession outside SessionProvider');
    return ctx;
};

export function SessionProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<UserInfo | null>(null);
    const [ready, setReady] = useState(false);

    const refresh = useCallback(async () => {
        try {
            setUser(await sdk.me());
        } catch {
            setUser(null);
        }
    }, []);

    useEffect(() => {
        setUnauthorizedHandler(() => {
            sdk.setToken(null);
            persistToken();
            setUser(null);
        });
        if (restoreToken()) refresh().finally(() => setReady(true));
        else setReady(true);
    }, [refresh]);

    const signIn = useCallback(async (email: string, password: string) => {
        setUser(await sdk.login(email, password));
        persistToken();
    }, []);
    const signUp = useCallback(async (name: string, email: string, password: string) => {
        setUser(await sdk.register(name, email, password));
        persistToken();
    }, []);
    const signOut = useCallback(async () => {
        await sdk.logout();
        persistToken();
        setUser(null);
    }, []);

    return <SessionContext.Provider value={{ user, ready, signIn, signUp, signOut, refresh, setUser }}>{children}</SessionContext.Provider>;
}
