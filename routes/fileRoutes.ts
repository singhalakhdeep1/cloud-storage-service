import { Router } from 'express';
import { cleanupTempFiles, uploadFiles } from '../config/multer';
import * as files from '../controllers/fileController';
import * as shares from '../controllers/shareController';
import { protect } from '../middleware/auth';
import { loadFile } from '../middleware/fileAccess';
import { uploadLimiter } from '../middleware/rateLimits';
import { schemas, validate, validateStorageLimit } from '../middleware/validation';

const router = Router();
router.use(protect);

// uploads
router.post('/upload', uploadLimiter, validateStorageLimit, cleanupTempFiles, uploadFiles.single('file'), validate(schemas.uploadFields), files.uploadFile);
router.post('/upload-image', uploadLimiter, validateStorageLimit, cleanupTempFiles, uploadFiles.single('image'), validate(schemas.uploadFields), files.uploadImage);
router.post('/upload-multiple', uploadLimiter, validateStorageLimit, cleanupTempFiles, uploadFiles.array('files', 10), validate(schemas.uploadFields), files.uploadMultiple);
router.post('/presigned-url', uploadLimiter, validate(schemas.presignedUpload), files.getPresignedUploadURL);
router.post('/confirm-upload', uploadLimiter, validate(schemas.confirmUpload), files.confirmUpload);

// collections
router.get('/', validate(schemas.listFiles, 'query'), files.getAllFiles);
router.get('/stats', files.getStats);
router.get('/capabilities', files.getCapabilities);
router.get('/trash', files.getTrash);
router.delete('/trash', files.emptyTrash);

// one file
router.get('/:id', loadFile('read'), files.getFile);
router.patch('/:id', loadFile('write'), validate(schemas.updateFile), files.updateFile);
router.get('/:id/download', loadFile('read'), files.downloadFile);
router.get('/:id/stream', loadFile('read'), files.streamFile);
router.get('/:id/thumbnail', loadFile('read'), files.getThumbnail);
router.get('/:id/activity', loadFile('admin'), files.getActivity);
router.post('/:id/trash', loadFile('admin'), files.trashFile);
router.post('/:id/restore', loadFile('admin', { trashed: 'only' }), files.restoreFile);
router.delete('/:id', loadFile('admin', { trashed: 'any' }), files.deleteFile);

// versions
router.get('/:id/versions', loadFile('read'), files.listVersions);
router.post('/:id/versions', uploadLimiter, loadFile('write'), validateStorageLimit, cleanupTempFiles, uploadFiles.single('file'), files.uploadVersion);
router.post('/:id/versions/:version/restore', loadFile('write'), files.restoreVersion);
router.delete('/:id/versions/:version', loadFile('admin'), files.deleteVersion);

// sharing with people and with links
router.get('/:id/shares', loadFile('admin'), shares.listShares);
router.post('/:id/shares', loadFile('admin'), validate(schemas.fileShare), shares.shareFile);
router.delete('/:id/shares/:userId', loadFile('admin'), shares.unshareFile);
router.get('/:id/links', loadFile('admin'), shares.listLinks);
router.post('/:id/links', loadFile('admin'), validate(schemas.linkCreate), shares.createLink);
router.delete('/:id/links/:linkId', loadFile('admin'), shares.revokeLink);

export default router;
