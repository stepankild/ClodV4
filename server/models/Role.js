import mongoose from 'mongoose';

const roleSchema = new mongoose.Schema({
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
  permissions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Permission'
  }],
  isSystem: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

const Role = mongoose.model('Role', roleSchema);

export default Role;
