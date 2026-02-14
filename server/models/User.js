import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  roles: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Role'
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  isApproved: {
    type: Boolean,
    default: false  // Новые пользователи требуют одобрения админа
  },
  lastLogin: {
    type: Date
  },
  refreshToken: {
    type: String
  },
  deletedAt: {
    type: Date,
    default: null
  },
  lastActivity: {
    type: Date,
    default: null
  },
  currentPage: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Get all permissions for user
userSchema.methods.getPermissions = async function() {
  await this.populate({
    path: 'roles',
    populate: {
      path: 'permissions'
    }
  });

  const permissions = new Set();
  this.roles.forEach(role => {
    role.permissions.forEach(permission => {
      permissions.add(permission.name);
    });
  });

  return Array.from(permissions);
};

// Check if user has specific permission
userSchema.methods.hasPermission = async function(permissionName) {
  const permissions = await this.getPermissions();
  return permissions.includes(permissionName) || permissions.includes('*');
};

const User = mongoose.model('User', userSchema);

export default User;
