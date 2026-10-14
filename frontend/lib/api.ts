import FileCloudSDK, { FileCloudError } from '@sdk/index';

export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
const TOKEN_KEY = 'cs_token';

/** localStorage can be unavailable (private windows, blocked storage): the app then works for this tab only. */
export const storage = {
    get(key: string): string | null {
        try {
            return window.localStorage.getItem(key);
        } catch {
            return null;
        }
    },
    set(key: string, value: string | null): void {
        try {
            if (value === null) window.localStorage.removeItem(key);
            else window.localStorage.setItem(key, value);
        } catch {
            /* ignore */
        }
    },
};

let onUnauthorized: (() => void) | undefined;
export const setUnauthorizedHandler = (fn: () => void): void => {
    onUnauthorized = fn;
};

/** One SDK instance for the whole app. The token is restored from storage on the client. */
export const sdk = new FileCloudSDK({ apiUrl: API_URL, onUnauthorized: () => onUnauthorized?.() });

export function restoreToken(): string | null {
    const t = storage.get(TOKEN_KEY);
    sdk.setToken(t);
    return t;
}

export function persistToken(): void {
    storage.set(TOKEN_KEY, sdk.token);
}

export const errorMessage = (e: unknown): string => (e instanceof FileCloudError ? e.message : e instanceof Error ? e.message : 'Something went wrong');

export { FileCloudError };
