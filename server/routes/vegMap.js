import express from 'express';
import { getVegMap, updateVegMap, clearVegMapPositions } from '../controllers/vegMapController.js';
import { protect } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = express.Router();
router.use(protect);

router.get('/', getVegMap);
router.put('/', checkPermission('vegetation:edit'), updateVegMap);
router.delete('/positions', checkPermission('vegetation:edit'), clearVegMapPositions);

export default router;
