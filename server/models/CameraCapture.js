import mongoose from 'mongoose';

const cameraCaptureSchema = new mongoose.Schema({
  zoneId: { type: String, required: true },
  timestamp: { type: Date, required: true, default: Date.now },
  image: { type: String },           // base64 JPEG data
  width: { type: Number },
  height: { type: Number },
  fileSize: { type: Number },         // bytes of original JPEG
}, {
  timestamps: false
});

cameraCaptureSchema.index({ zoneId: 1, timestamp: -1 });
cameraCaptureSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 3600 }); // 90 days TTL

export default mongoose.model('CameraCapture', cameraCaptureSchema);
