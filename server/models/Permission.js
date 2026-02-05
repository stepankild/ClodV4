import mongoose from 'mongoose';

const permissionSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  module: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

const Permission = mongoose.model('Permission', permissionSchema);

export default Permission;
