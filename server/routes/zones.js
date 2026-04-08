import express from 'express';
import {
  getZones,
  getZone,
  createZone,
  updateZone,
  deleteZone,
  getReadings,
  getLatestReading,
  getDisplayData,
  controlHumidifier,
  getHumidifierStatus,
  getHumidifierLog,
  controlIrrigation,
  getIrrigationStatus,
  getIrrigationLog,
  getAlertConfig,
  updateAlertConfig,
  getAlertLog,
  testTelegramAlert,
  triggerDailySummary
} from '../controllers/zoneController.js';
import { protect } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = express.Router();

router.use(protect);

// Read — iot:view
router.get('/', checkPermission('iot:view'), getZones);
router.get('/:zoneId', checkPermission('iot:view'), getZone);
router.get('/:zoneId/readings', checkPermission('iot:view'), getReadings);
router.get('/:zoneId/readings/latest', checkPermission('iot:view'), getLatestReading);
router.get('/:zoneId/display', checkPermission('iot:view'), getDisplayData);

// Humidifier control
router.get('/:zoneId/humidifier/status', checkPermission('iot:view'), getHumidifierStatus);
router.get('/:zoneId/humidifier/log', checkPermission('iot:view'), getHumidifierLog);
router.post('/:zoneId/humidifier', checkPermission('iot:manage'), controlHumidifier);

// Irrigation control
router.get('/:zoneId/irrigation/status', checkPermission('iot:view'), getIrrigationStatus);
router.get('/:zoneId/irrigation/log', checkPermission('iot:view'), getIrrigationLog);
router.post('/:zoneId/irrigation', checkPermission('iot:manage'), controlIrrigation);

// Alert config
router.get('/:zoneId/alerts', checkPermission('iot:view'), getAlertConfig);
router.get('/:zoneId/alerts/log', checkPermission('iot:view'), getAlertLog);
router.put('/:zoneId/alerts', checkPermission('iot:manage'), updateAlertConfig);
router.post('/alerts/test', checkPermission('iot:manage'), testTelegramAlert);
router.post('/alerts/summary', checkPermission('iot:manage'), triggerDailySummary);

// Write — iot:manage
router.post('/', checkPermission('iot:manage'), createZone);
router.put('/:zoneId', checkPermission('iot:manage'), updateZone);
router.delete('/:zoneId', checkPermission('iot:manage'), deleteZone);

export default router;
