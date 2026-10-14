/** Rate limits (token buckets from services/rate-limiting). A window is "max requests per windowSeconds". */
import { rateLimit } from '../services/rate-limiting/rate-limiting.service';

const byUserOrIp = (req: { user?: { _id: unknown }; ip?: string }): string => (req.user ? `u:${String(req.user._id)}` : `ip:${req.ip ?? 'unknown'}`);

/** Everything under /api, per client address. */
export const apiLimiter = rateLimit({ max: 1000, windowSeconds: 15 * 60, prefix: 'api', skip: (req) => req.path.startsWith('/storage/local/') });

/** Uploads, per signed-in user. */
export const uploadLimiter = rateLimit({ max: 200, windowSeconds: 15 * 60, prefix: 'upload', keyFn: byUserOrIp, message: 'Too many upload requests, please try again later.' });

/** Sign-in attempts, per address and e-mail (so one address cannot hammer many accounts, nor many addresses one account). */
export const loginLimiter = rateLimit({
    max: 10,
    windowSeconds: 15 * 60,
    prefix: 'login',
    keyFn: (req) => `${req.ip}:${String((req.body as { email?: string } | undefined)?.email ?? '').toLowerCase()}`,
    message: 'Too many authentication attempts, please try again later.',
});

export const registerLimiter = rateLimit({ max: 10, windowSeconds: 60 * 60, prefix: 'register', message: 'Too many accounts created from this address, please try again later.' });

/** The public share-link endpoints (no sign-in), per address. */
export const publicLimiter = rateLimit({ max: 120, windowSeconds: 60, prefix: 'public' });

/** Processing and exports are CPU / bandwidth heavy. */
export const heavyLimiter = rateLimit({ max: 60, windowSeconds: 15 * 60, prefix: 'heavy', keyFn: byUserOrIp });
