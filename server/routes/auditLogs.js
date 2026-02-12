import express from 'express';
import { getAuditLogs, getSessions } from '../controllers/auditLogController.js';
import { protect } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = express.Router();
router.use(protect);
router.get('/sessions', checkPermission('audit:read'), getSessions);
router.get('/', checkPermission('audit:read'), getAuditLogs);

export default router;
