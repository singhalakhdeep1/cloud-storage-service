/**
 * Who may do what with a file.
 *
 *   owner / administrator   4   everything
 *   shared "admin"          3   share, create links, delete
 *   shared "write"          2   upload new versions, edit details, process images
 *   shared "read"           1   view and download
 *   public file             1   view and download (any signed-in user who has the id)
 */
import type { FileDoc, Permission, UserDoc } from '../types/models';

export type Need = 'read' | 'write' | 'admin' | 'owner';
export const LEVEL: Record<Need, number> = { read: 1, write: 2, admin: 3, owner: 4 };

const SHARE_LEVEL: Record<Permission, number> = { read: 1, write: 2, admin: 3 };

export function accessLevel(file: FileDoc, user?: UserDoc | null): number {
    if (user) {
        const uid = String(user._id);
        if (String(file.uploadedBy) === uid || user.role === 'admin') return LEVEL.owner;
        const share = file.sharedWith?.find((s) => String(s.user) === uid);
        const shared = share ? SHARE_LEVEL[share.permission] ?? 1 : 0;
        const publicLevel = file.isPublic || file.accessControl === 'public' ? 1 : 0;
        return Math.max(shared, publicLevel);
    }
    return 0;
}

export const can = (file: FileDoc, user: UserDoc | null | undefined, need: Need): boolean => accessLevel(file, user) >= LEVEL[need];

export function permissionName(level: number): 'owner' | 'admin' | 'write' | 'read' | 'none' {
    return level >= LEVEL.owner ? 'owner' : level >= LEVEL.admin ? 'admin' : level >= LEVEL.write ? 'write' : level >= LEVEL.read ? 'read' : 'none';
}

export const isOwner = (file: FileDoc, user: UserDoc): boolean => String(file.uploadedBy) === String(user._id);
