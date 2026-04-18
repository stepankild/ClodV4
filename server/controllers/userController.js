import User from '../models/User.js';
import Role from '../models/Role.js';
import Permission from '../models/Permission.js';
import { createAuditLog } from '../utils/auditLog.js';
import { notDeleted, deletedOnly } from '../utils/softDelete.js';
import { t } from '../utils/i18n.js';

// @desc    Get all users
// @route   GET /api/users
export const getUsers = async (req, res) => {
  try {
    // ?includeDeleted=true — для выпадашек в audit-логе (чтобы можно было фильтровать по уволенным)
    const includeDeleted = req.query.includeDeleted === 'true' || req.query.includeDeleted === '1';
    const filter = includeDeleted ? {} : { ...notDeleted };
    const users = await User.find(filter)
      .select('-password -refreshToken')
      .populate('roles', 'name description')
      .sort({ createdAt: -1 });

    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Get single user
// @route   GET /api/users/:id
export const getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password -refreshToken')
      .populate('roles', 'name description');

    if (!user) {
      return res.status(404).json({ message: t('users.notFound', req.lang) });
    }

    res.json(user);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Create user
// @route   POST /api/users
export const createUser = async (req, res) => {
  try {
    const { email, password, name, roles, isActive } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: t('users.emailExists', req.lang) });
    }

    // Validate roles
    if (roles && roles.length > 0) {
      const validRoles = await Role.find({ _id: { $in: roles } });
      if (validRoles.length !== roles.length) {
        return res.status(400).json({ message: t('users.rolesNotFound', req.lang) });
      }
    }

    const user = await User.create({
      email,
      password,
      name,
      roles: roles || [],
      isActive: isActive !== undefined ? isActive : true
    });

    const populatedUser = await User.findById(user._id)
      .select('-password -refreshToken')
      .populate('roles', 'name description');

    await createAuditLog(req, { action: 'user.create', entityType: 'User', entityId: user._id, details: { email: user.email, name: user.name } });
    res.status(201).json(populatedUser);
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Update user
// @route   PUT /api/users/:id
export const updateUser = async (req, res) => {
  try {
    const { email, password, name, roles, isActive, isApproved } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: t('users.notFound', req.lang) });
    }

    // Check email uniqueness
    if (email && email !== user.email) {
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ message: t('users.emailExists', req.lang) });
      }
    }

    // Validate roles
    if (roles && roles.length > 0) {
      const validRoles = await Role.find({ _id: { $in: roles } });
      if (validRoles.length !== roles.length) {
        return res.status(400).json({ message: t('users.rolesNotFound', req.lang) });
      }
    }

    if (email) user.email = email;
    if (name) user.name = name;
    if (password) user.password = password;
    if (roles !== undefined) user.roles = roles;
    if (isActive !== undefined) user.isActive = isActive;
    if (isApproved !== undefined) user.isApproved = isApproved;

    await user.save();

    const updatedUser = await User.findById(user._id)
      .select('-password -refreshToken')
      .populate('roles', 'name description');

    await createAuditLog(req, { action: 'user.update', entityType: 'User', entityId: user._id, details: { email: user.email, name: user.name, isApproved: user.isApproved } });
    res.json(updatedUser);
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Approve user (shortcut for setting isApproved=true)
// @route   POST /api/users/:id/approve
export const approveUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: t('users.notFound', req.lang) });
    }

    user.isApproved = true;
    await user.save();

    const updatedUser = await User.findById(user._id)
      .select('-password -refreshToken')
      .populate('roles', 'name description');

    await createAuditLog(req, { action: 'user.approve', entityType: 'User', entityId: user._id, details: { email: user.email, name: user.name } });
    res.json(updatedUser);
  } catch (error) {
    console.error('Approve user error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Delete user
// @route   DELETE /api/users/:id
export const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: t('users.notFound', req.lang) });
    }

    // Prevent deleting yourself
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: t('users.cannotDeleteSelf', req.lang) });
    }

    const deletedEmail = user.email;
    const deletedName = user.name;
    user.deletedAt = new Date();
    user.isActiveBeforeDelete = user.isActive;
    user.isActive = false;
    await user.save();

    await createAuditLog(req, { action: 'user.delete', entityType: 'User', entityId: req.params.id, details: { email: deletedEmail, name: deletedName } });
    res.json({ message: t('users.deleted', req.lang) });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Get all roles
// @route   GET /api/users/roles
export const getRoles = async (req, res) => {
  try {
    const roles = await Role.find({ ...notDeleted })
      .populate('permissions', 'name description module')
      .sort({ name: 1 });

    res.json(roles);
  } catch (error) {
    console.error('Get roles error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Get all permissions (for role editor)
// @route   GET /api/users/permissions
export const getPermissions = async (req, res) => {
  try {
    const permissions = await Permission.find().sort({ module: 1, name: 1 });
    res.json(permissions);
  } catch (error) {
    console.error('Get permissions error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Update role (name, description, permissions)
// @route   PUT /api/users/roles/:id
export const updateRole = async (req, res) => {
  try {
    const { name, description, permissions: permissionIds } = req.body;
    const role = await Role.findById(req.params.id);

    if (!role) {
      return res.status(404).json({ message: t('roles.notFound', req.lang) });
    }

    if (name !== undefined && name.trim()) role.name = name.trim();
    if (description !== undefined) role.description = description;

    if (permissionIds !== undefined && Array.isArray(permissionIds)) {
      const valid = await Permission.find({ _id: { $in: permissionIds } });
      if (valid.length !== permissionIds.length) {
        return res.status(400).json({ message: t('roles.permissionsNotFound', req.lang) });
      }
      role.permissions = permissionIds;
    }

    await role.save();

    const updated = await Role.findById(role._id)
      .populate('permissions', 'name description module');

    res.json(updated);
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Create custom role
// @route   POST /api/users/roles
export const createRole = async (req, res) => {
  try {
    const { name, description, permissions: permissionIds } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: t('roles.nameRequired', req.lang) });
    }

    const existing = await Role.findOne({ name: name.trim() });
    if (existing) {
      return res.status(400).json({ message: t('roles.nameExists', req.lang) });
    }

    const permissions = Array.isArray(permissionIds) && permissionIds.length > 0
      ? await Permission.find({ _id: { $in: permissionIds } })
      : [];
    if (Array.isArray(permissionIds) && permissionIds.length > 0 && permissions.length !== permissionIds.length) {
      return res.status(400).json({ message: t('roles.permissionsNotFound', req.lang) });
    }

    const role = await Role.create({
      name: name.trim(),
      description: (description && String(description).trim()) || '',
      permissions: permissions.map((p) => p._id),
      isSystem: false
    });

    const populated = await Role.findById(role._id)
      .populate('permissions', 'name description module');

    await createAuditLog(req, { action: 'role.create', entityType: 'Role', entityId: role._id, details: { name: role.name } });
    res.status(201).json(populated);
  } catch (error) {
    console.error('Create role error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Delete custom role (only non-system)
// @route   DELETE /api/users/roles/:id
export const deleteRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);

    if (!role) {
      return res.status(404).json({ message: t('roles.notFound', req.lang) });
    }

    if (role.isSystem) {
      return res.status(400).json({ message: t('roles.cannotDeleteSystem', req.lang) });
    }

    const usersWithRole = await User.countDocuments({ roles: role._id });
    if (usersWithRole > 0) {
      return res.status(400).json({ message: t('roles.hasUsers', req.lang) });
    }

    const roleName = role.name;
    role.deletedAt = new Date();
    await role.save();
    await createAuditLog(req, { action: 'role.delete', entityType: 'Role', entityId: req.params.id, details: { name: roleName } });
    res.json({ message: t('roles.deleted', req.lang) });
  } catch (error) {
    console.error('Delete role error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Get deleted users
// @route   GET /api/users/deleted
export const getDeletedUsers = async (req, res) => {
  try {
    const users = await User.find({ ...deletedOnly })
      .select('-password -refreshToken')
      .populate('roles', 'name')
      .sort({ deletedAt: -1 })
      .limit(200);
    res.json(users);
  } catch (error) {
    console.error('Get deleted users error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Restore deleted user
// @route   POST /api/users/deleted/:id/restore
export const restoreUser = async (req, res) => {
  try {
    const user = await User.findOne({ _id: req.params.id, ...deletedOnly }).select('-password -refreshToken');
    if (!user) return res.status(404).json({ message: t('users.deletedNotFound', req.lang) });
    user.deletedAt = null;
    // Восстанавливаем прежнее состояние активации; если флаг не был записан (старая запись) — активируем
    user.isActive = user.isActiveBeforeDelete == null ? true : user.isActiveBeforeDelete;
    user.isActiveBeforeDelete = null;
    await user.save();
    await createAuditLog(req, { action: 'user.restore', entityType: 'User', entityId: user._id, details: { email: user.email, name: user.name } });
    res.json(user);
  } catch (error) {
    console.error('Restore user error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Get deleted roles
// @route   GET /api/users/roles/deleted
export const getDeletedRoles = async (req, res) => {
  try {
    const roles = await Role.find({ ...deletedOnly })
      .populate('permissions', 'name description module')
      .sort({ deletedAt: -1 })
      .limit(200);
    res.json(roles);
  } catch (error) {
    console.error('Get deleted roles error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Restore deleted role
// @route   POST /api/users/roles/deleted/:id/restore
export const restoreRole = async (req, res) => {
  try {
    const role = await Role.findOne({ _id: req.params.id, ...deletedOnly });
    if (!role) return res.status(404).json({ message: t('roles.deletedNotFound', req.lang) });
    role.deletedAt = null;
    await role.save();
    await createAuditLog(req, { action: 'role.restore', entityType: 'Role', entityId: role._id, details: { name: role.name } });
    res.json(role);
  } catch (error) {
    console.error('Restore role error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};
