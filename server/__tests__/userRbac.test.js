import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { connectDB, closeDB, clearDB, mockReq, mockRes } from './testHelper.js';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Role from '../models/Role.js';
import Permission from '../models/Permission.js';
import {
  getUsers,
  getUser,
  createUser,
  updateUser,
  approveUser,
  deleteUser,
  getRoles,
  getPermissions,
  updateRole,
  createRole,
  deleteRole,
  getDeletedUsers,
  restoreUser,
  getDeletedRoles,
  restoreRole
} from '../controllers/userController.js';

let db;

beforeAll(async () => {
  db = await connectDB();
});

afterAll(async () => {
  await closeDB();
});

beforeEach(async () => {
  await clearDB();
});

// ── Helpers ──

async function seedPermission(name, module = 'test') {
  return Permission.create({
    name,
    description: `${name} permission`,
    module
  });
}

async function seedRole(name, permissions = [], overrides = {}) {
  return Role.create({
    name,
    description: `${name} role`,
    permissions,
    ...overrides
  });
}

async function seedUser(overrides = {}) {
  const defaults = {
    email: 'user@example.com',
    password: 'password123',
    name: 'Test User',
    isActive: true,
    isApproved: false,
    roles: []
  };
  return User.create({ ...defaults, ...overrides });
}

// ═══════════════════════════════════════════
// getUsers
// ═══════════════════════════════════════════

describe('getUsers', () => {
  test('returns all non-deleted users', async () => {
    await seedUser({ email: 'a@test.com', name: 'Alice' });
    await seedUser({ email: 'b@test.com', name: 'Bob' });
    // Soft-deleted user should NOT appear
    await seedUser({ email: 'c@test.com', name: 'Charlie', deletedAt: new Date(), isActive: false });

    const req = mockReq();
    const res = mockRes();

    await getUsers(req, res);

    expect(res.json).toHaveBeenCalled();
    const users = res.json.mock.calls[0][0];
    expect(users).toHaveLength(2);

    const names = users.map(u => u.name);
    expect(names).toContain('Alice');
    expect(names).toContain('Bob');
    expect(names).not.toContain('Charlie');
  });

  test('excludes password and refreshToken from response', async () => {
    await seedUser({ email: 'secure@test.com' });

    const req = mockReq();
    const res = mockRes();

    await getUsers(req, res);

    const users = res.json.mock.calls[0][0];
    expect(users).toHaveLength(1);
    expect(users[0].password).toBeUndefined();
    expect(users[0].refreshToken).toBeUndefined();
  });

  test('populates roles with name and description', async () => {
    const role = await seedRole('admin');
    await seedUser({ email: 'roled@test.com', roles: [role._id] });

    const req = mockReq();
    const res = mockRes();

    await getUsers(req, res);

    const users = res.json.mock.calls[0][0];
    expect(users[0].roles).toHaveLength(1);
    expect(users[0].roles[0].name).toBe('admin');
    expect(users[0].roles[0].description).toBe('admin role');
  });
});

// ═══════════════════════════════════════════
// getUser
// ═══════════════════════════════════════════

describe('getUser', () => {
  test('returns a single user by id', async () => {
    const user = await seedUser({ email: 'single@test.com', name: 'Single' });

    const req = mockReq({}, { id: user._id.toString() });
    const res = mockRes();

    await getUser(req, res);

    expect(res.json).toHaveBeenCalled();
    const result = res.json.mock.calls[0][0];
    expect(result.email).toBe('single@test.com');
    expect(result.name).toBe('Single');
    expect(result.password).toBeUndefined();
    expect(result.refreshToken).toBeUndefined();
  });

  test('returns 404 for non-existent user', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq({}, { id: fakeId.toString() });
    const res = mockRes();

    await getUser(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════
// createUser
// ═══════════════════════════════════════════

describe('createUser', () => {
  test('creates a user successfully', async () => {
    const req = mockReq({
      email: 'new@test.com',
      password: 'secret123',
      name: 'New User'
    });
    const res = mockRes();

    await createUser(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.email).toBe('new@test.com');
    expect(body.name).toBe('New User');
    expect(body.password).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
  });

  test('hashes password — not stored in plaintext', async () => {
    const req = mockReq({
      email: 'hash@test.com',
      password: 'plaintext123',
      name: 'Hash Test'
    });
    const res = mockRes();

    await createUser(req, res);

    expect(res.status).toHaveBeenCalledWith(201);

    const dbUser = await User.findOne({ email: 'hash@test.com' });
    expect(dbUser).not.toBeNull();
    expect(dbUser.password).not.toBe('plaintext123');
    const isHashed = await bcrypt.compare('plaintext123', dbUser.password);
    expect(isHashed).toBe(true);
  });

  test('rejects duplicate email', async () => {
    await seedUser({ email: 'dup@test.com' });

    const req = mockReq({
      email: 'dup@test.com',
      password: 'another123',
      name: 'Duplicate'
    });
    const res = mockRes();

    await createUser(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBeDefined();
  });

  test('creates user with valid roles', async () => {
    const role = await seedRole('grower');

    const req = mockReq({
      email: 'roled@test.com',
      password: 'secret123',
      name: 'Roled User',
      roles: [role._id.toString()]
    });
    const res = mockRes();

    await createUser(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.roles).toHaveLength(1);
    expect(body.roles[0].name).toBe('grower');
  });

  test('rejects invalid role IDs', async () => {
    const fakeRoleId = new mongoose.Types.ObjectId();

    const req = mockReq({
      email: 'badrole@test.com',
      password: 'secret123',
      name: 'Bad Role User',
      roles: [fakeRoleId.toString()]
    });
    const res = mockRes();

    await createUser(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBeDefined();
  });
});

// ═══════════════════════════════════════════
// updateUser
// ═══════════════════════════════════════════

describe('updateUser', () => {
  test('updates user name and email', async () => {
    const user = await seedUser({ email: 'old@test.com', name: 'Old Name' });

    const req = mockReq(
      { email: 'new@test.com', name: 'New Name' },
      { id: user._id.toString() }
    );
    const res = mockRes();

    await updateUser(req, res);

    expect(res.json).toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.email).toBe('new@test.com');
    expect(body.name).toBe('New Name');
  });

  test('rejects duplicate email on update', async () => {
    await seedUser({ email: 'existing@test.com', name: 'Existing' });
    const user = await seedUser({ email: 'tochange@test.com', name: 'ToChange' });

    const req = mockReq(
      { email: 'existing@test.com' },
      { id: user._id.toString() }
    );
    const res = mockRes();

    await updateUser(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBeDefined();
  });

  test('allows keeping the same email (no false duplicate)', async () => {
    const user = await seedUser({ email: 'keep@test.com', name: 'Keep' });

    const req = mockReq(
      { email: 'keep@test.com', name: 'Updated Keep' },
      { id: user._id.toString() }
    );
    const res = mockRes();

    await updateUser(req, res);

    expect(res.status).not.toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.name).toBe('Updated Keep');
  });

  test('validates roles on update', async () => {
    const user = await seedUser({ email: 'roleupdate@test.com' });
    const fakeRoleId = new mongoose.Types.ObjectId();

    const req = mockReq(
      { roles: [fakeRoleId.toString()] },
      { id: user._id.toString() }
    );
    const res = mockRes();

    await updateUser(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBeDefined();
  });

  test('updates roles with valid role IDs', async () => {
    const role = await seedRole('manager');
    const user = await seedUser({ email: 'rolevalid@test.com' });

    const req = mockReq(
      { roles: [role._id.toString()] },
      { id: user._id.toString() }
    );
    const res = mockRes();

    await updateUser(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.roles).toHaveLength(1);
    expect(body.roles[0].name).toBe('manager');
  });

  test('returns 404 for non-existent user', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq({ name: 'Nope' }, { id: fakeId.toString() });
    const res = mockRes();

    await updateUser(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('updates password — new password is hashed', async () => {
    const user = await seedUser({ email: 'pwupdate@test.com', password: 'oldpass123' });

    const req = mockReq(
      { password: 'newpass456' },
      { id: user._id.toString() }
    );
    const res = mockRes();

    await updateUser(req, res);

    expect(res.json).toHaveBeenCalled();

    const dbUser = await User.findById(user._id);
    expect(dbUser.password).not.toBe('newpass456');
    const isHashed = await bcrypt.compare('newpass456', dbUser.password);
    expect(isHashed).toBe(true);
  });
});

// ═══════════════════════════════════════════
// approveUser
// ═══════════════════════════════════════════

describe('approveUser', () => {
  test('sets isApproved to true', async () => {
    const user = await seedUser({ email: 'approve@test.com', isApproved: false });

    const req = mockReq({}, { id: user._id.toString() });
    const res = mockRes();

    await approveUser(req, res);

    expect(res.json).toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.isApproved).toBe(true);

    // Verify in DB
    const dbUser = await User.findById(user._id);
    expect(dbUser.isApproved).toBe(true);
  });

  test('returns 404 for non-existent user', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq({}, { id: fakeId.toString() });
    const res = mockRes();

    await approveUser(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('excludes password and refreshToken from response', async () => {
    const user = await seedUser({ email: 'approvesec@test.com' });

    const req = mockReq({}, { id: user._id.toString() });
    const res = mockRes();

    await approveUser(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.password).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
  });
});

// ═══════════════════════════════════════════
// deleteUser (soft delete)
// ═══════════════════════════════════════════

describe('deleteUser', () => {
  test('soft-deletes user by setting deletedAt and isActive=false', async () => {
    const user = await seedUser({ email: 'delete@test.com', name: 'Delete Me' });

    const req = mockReq({}, { id: user._id.toString() });
    const res = mockRes();

    await deleteUser(req, res);

    expect(res.json).toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBeDefined();

    // Verify in DB
    const dbUser = await User.findById(user._id);
    expect(dbUser.deletedAt).not.toBeNull();
    expect(dbUser.deletedAt).toBeInstanceOf(Date);
    expect(dbUser.isActive).toBe(false);
  });

  test('prevents self-deletion', async () => {
    const user = await seedUser({ email: 'myself@test.com' });

    // mockReq user._id matches the target user._id
    const req = mockReq({}, { id: user._id.toString() }, {}, { _id: user._id, name: 'Self' });
    const res = mockRes();

    await deleteUser(req, res);

    expect(res.status).toHaveBeenCalledWith(400);

    // Verify user is NOT deleted in DB
    const dbUser = await User.findById(user._id);
    expect(dbUser.deletedAt).toBeNull();
    expect(dbUser.isActive).toBe(true);
  });

  test('returns 404 for non-existent user', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq({}, { id: fakeId.toString() });
    const res = mockRes();

    await deleteUser(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════
// getDeletedUsers
// ═══════════════════════════════════════════

describe('getDeletedUsers', () => {
  test('returns only soft-deleted users', async () => {
    await seedUser({ email: 'active@test.com', name: 'Active' });
    await seedUser({ email: 'del1@test.com', name: 'Deleted1', deletedAt: new Date(), isActive: false });
    await seedUser({ email: 'del2@test.com', name: 'Deleted2', deletedAt: new Date(), isActive: false });

    const req = mockReq();
    const res = mockRes();

    await getDeletedUsers(req, res);

    expect(res.json).toHaveBeenCalled();
    const users = res.json.mock.calls[0][0];
    expect(users).toHaveLength(2);

    const names = users.map(u => u.name);
    expect(names).toContain('Deleted1');
    expect(names).toContain('Deleted2');
    expect(names).not.toContain('Active');
  });

  test('excludes password and refreshToken', async () => {
    await seedUser({ email: 'delsec@test.com', deletedAt: new Date(), isActive: false });

    const req = mockReq();
    const res = mockRes();

    await getDeletedUsers(req, res);

    const users = res.json.mock.calls[0][0];
    expect(users).toHaveLength(1);
    expect(users[0].password).toBeUndefined();
    expect(users[0].refreshToken).toBeUndefined();
  });
});

// ═══════════════════════════════════════════
// restoreUser
// ═══════════════════════════════════════════

describe('restoreUser', () => {
  test('restores soft-deleted user, sets deletedAt=null and isActive=true', async () => {
    const user = await seedUser({
      email: 'restore@test.com',
      name: 'Restore Me',
      deletedAt: new Date(),
      isActive: false
    });

    const req = mockReq({}, { id: user._id.toString() });
    const res = mockRes();

    await restoreUser(req, res);

    expect(res.json).toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.email).toBe('restore@test.com');

    // Verify in DB
    const dbUser = await User.findById(user._id);
    expect(dbUser.deletedAt).toBeNull();
    expect(dbUser.isActive).toBe(true);
  });

  test('returns 404 for non-deleted (active) user', async () => {
    const user = await seedUser({ email: 'notdeleted@test.com' });

    const req = mockReq({}, { id: user._id.toString() });
    const res = mockRes();

    await restoreUser(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 404 for non-existent user', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq({}, { id: fakeId.toString() });
    const res = mockRes();

    await restoreUser(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════
// getRoles
// ═══════════════════════════════════════════

describe('getRoles', () => {
  test('returns all non-deleted roles', async () => {
    await seedRole('admin');
    await seedRole('grower');
    // Soft-deleted role should NOT appear
    await seedRole('deleted-role', [], { deletedAt: new Date() });

    const req = mockReq();
    const res = mockRes();

    await getRoles(req, res);

    expect(res.json).toHaveBeenCalled();
    const roles = res.json.mock.calls[0][0];
    expect(roles).toHaveLength(2);

    const names = roles.map(r => r.name);
    expect(names).toContain('admin');
    expect(names).toContain('grower');
    expect(names).not.toContain('deleted-role');
  });

  test('populates permissions', async () => {
    const perm = await seedPermission('users.manage', 'users');
    await seedRole('admin', [perm._id]);

    const req = mockReq();
    const res = mockRes();

    await getRoles(req, res);

    const roles = res.json.mock.calls[0][0];
    expect(roles[0].permissions).toHaveLength(1);
    expect(roles[0].permissions[0].name).toBe('users.manage');
    expect(roles[0].permissions[0].module).toBe('users');
  });
});

// ═══════════════════════════════════════════
// getPermissions
// ═══════════════════════════════════════════

describe('getPermissions', () => {
  test('returns all permissions sorted by module then name', async () => {
    await seedPermission('plants.view', 'plants');
    await seedPermission('users.manage', 'users');
    await seedPermission('plants.edit', 'plants');

    const req = mockReq();
    const res = mockRes();

    await getPermissions(req, res);

    expect(res.json).toHaveBeenCalled();
    const perms = res.json.mock.calls[0][0];
    expect(perms).toHaveLength(3);

    // Should be sorted: plants.edit, plants.view, users.manage
    expect(perms[0].name).toBe('plants.edit');
    expect(perms[1].name).toBe('plants.view');
    expect(perms[2].name).toBe('users.manage');
  });
});

// ═══════════════════════════════════════════
// createRole
// ═══════════════════════════════════════════

describe('createRole', () => {
  test('creates a custom role successfully', async () => {
    const req = mockReq({
      name: 'custom-role',
      description: 'A custom role'
    });
    const res = mockRes();

    await createRole(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.name).toBe('custom-role');
    expect(body.description).toBe('A custom role');
    expect(body.isSystem).toBe(false);
  });

  test('creates role with permissions', async () => {
    const perm1 = await seedPermission('plants.view');
    const perm2 = await seedPermission('plants.edit');

    const req = mockReq({
      name: 'grower',
      description: 'Grower role',
      permissions: [perm1._id.toString(), perm2._id.toString()]
    });
    const res = mockRes();

    await createRole(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.permissions).toHaveLength(2);
  });

  test('rejects duplicate role name', async () => {
    await seedRole('existing-role');

    const req = mockReq({
      name: 'existing-role',
      description: 'Duplicate'
    });
    const res = mockRes();

    await createRole(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBeDefined();
  });

  test('rejects empty name', async () => {
    const req = mockReq({
      name: '',
      description: 'No name'
    });
    const res = mockRes();

    await createRole(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects invalid permission IDs', async () => {
    const fakePermId = new mongoose.Types.ObjectId();

    const req = mockReq({
      name: 'bad-perm-role',
      description: 'Bad perms',
      permissions: [fakePermId.toString()]
    });
    const res = mockRes();

    await createRole(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBeDefined();
  });
});

// ═══════════════════════════════════════════
// updateRole
// ═══════════════════════════════════════════

describe('updateRole', () => {
  test('updates role name and description', async () => {
    const role = await seedRole('old-name');

    const req = mockReq(
      { name: 'new-name', description: 'Updated desc' },
      { id: role._id.toString() }
    );
    const res = mockRes();

    await updateRole(req, res);

    expect(res.json).toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.name).toBe('new-name');
    expect(body.description).toBe('Updated desc');
  });

  test('updates role permissions', async () => {
    const perm = await seedPermission('harvest.manage');
    const role = await seedRole('updater');

    const req = mockReq(
      { permissions: [perm._id.toString()] },
      { id: role._id.toString() }
    );
    const res = mockRes();

    await updateRole(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.permissions).toHaveLength(1);
    expect(body.permissions[0].name).toBe('harvest.manage');
  });

  test('rejects invalid permission IDs on update', async () => {
    const role = await seedRole('perm-test');
    const fakePermId = new mongoose.Types.ObjectId();

    const req = mockReq(
      { permissions: [fakePermId.toString()] },
      { id: role._id.toString() }
    );
    const res = mockRes();

    await updateRole(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 404 for non-existent role', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq({ name: 'Nope' }, { id: fakeId.toString() });
    const res = mockRes();

    await updateRole(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════
// deleteRole
// ═══════════════════════════════════════════

describe('deleteRole', () => {
  test('soft-deletes a custom role', async () => {
    const role = await seedRole('custom', [], { isSystem: false });

    const req = mockReq({}, { id: role._id.toString() });
    const res = mockRes();

    await deleteRole(req, res);

    expect(res.json).toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBeDefined();

    // Verify in DB
    const dbRole = await Role.findById(role._id);
    expect(dbRole.deletedAt).not.toBeNull();
    expect(dbRole.deletedAt).toBeInstanceOf(Date);
  });

  test('prevents deletion of system role', async () => {
    const role = await seedRole('system-admin', [], { isSystem: true });

    const req = mockReq({}, { id: role._id.toString() });
    const res = mockRes();

    await deleteRole(req, res);

    expect(res.status).toHaveBeenCalledWith(400);

    // Verify role is NOT deleted
    const dbRole = await Role.findById(role._id);
    expect(dbRole.deletedAt).toBeNull();
  });

  test('prevents deletion when users are assigned the role', async () => {
    const role = await seedRole('in-use', [], { isSystem: false });
    await seedUser({ email: 'hasrole@test.com', roles: [role._id] });

    const req = mockReq({}, { id: role._id.toString() });
    const res = mockRes();

    await deleteRole(req, res);

    expect(res.status).toHaveBeenCalledWith(400);

    // Verify role is NOT deleted
    const dbRole = await Role.findById(role._id);
    expect(dbRole.deletedAt).toBeNull();
  });

  test('returns 404 for non-existent role', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq({}, { id: fakeId.toString() });
    const res = mockRes();

    await deleteRole(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════
// getDeletedRoles
// ═══════════════════════════════════════════

describe('getDeletedRoles', () => {
  test('returns only soft-deleted roles', async () => {
    await seedRole('active-role');
    await seedRole('deleted-role1', [], { deletedAt: new Date() });
    await seedRole('deleted-role2', [], { deletedAt: new Date() });

    const req = mockReq();
    const res = mockRes();

    await getDeletedRoles(req, res);

    expect(res.json).toHaveBeenCalled();
    const roles = res.json.mock.calls[0][0];
    expect(roles).toHaveLength(2);

    const names = roles.map(r => r.name);
    expect(names).toContain('deleted-role1');
    expect(names).toContain('deleted-role2');
    expect(names).not.toContain('active-role');
  });

  test('populates permissions on deleted roles', async () => {
    const perm = await seedPermission('some.perm');
    await seedRole('deleted-with-perms', [perm._id], { deletedAt: new Date() });

    const req = mockReq();
    const res = mockRes();

    await getDeletedRoles(req, res);

    const roles = res.json.mock.calls[0][0];
    expect(roles).toHaveLength(1);
    expect(roles[0].permissions[0].name).toBe('some.perm');
  });
});

// ═══════════════════════════════════════════
// restoreRole
// ═══════════════════════════════════════════

describe('restoreRole', () => {
  test('restores a soft-deleted role by clearing deletedAt', async () => {
    const role = await seedRole('restore-me', [], { deletedAt: new Date() });

    const req = mockReq({}, { id: role._id.toString() });
    const res = mockRes();

    await restoreRole(req, res);

    expect(res.json).toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.name).toBe('restore-me');

    // Verify in DB
    const dbRole = await Role.findById(role._id);
    expect(dbRole.deletedAt).toBeNull();
  });

  test('returns 404 for non-deleted (active) role', async () => {
    const role = await seedRole('not-deleted');

    const req = mockReq({}, { id: role._id.toString() });
    const res = mockRes();

    await restoreRole(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('returns 404 for non-existent role', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const req = mockReq({}, { id: fakeId.toString() });
    const res = mockRes();

    await restoreRole(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════
// Password hashing (model-level)
// ═══════════════════════════════════════════

describe('Password hashing', () => {
  test('password is hashed on user creation', async () => {
    const user = await seedUser({ email: 'hashtest@test.com', password: 'cleartext' });

    const dbUser = await User.findById(user._id);
    expect(dbUser.password).not.toBe('cleartext');
    expect(dbUser.password.startsWith('$2')).toBe(true); // bcrypt hash prefix
  });

  test('comparePassword returns true for correct password', async () => {
    const user = await seedUser({ email: 'compare@test.com', password: 'mypassword' });

    const dbUser = await User.findById(user._id);
    const result = await dbUser.comparePassword('mypassword');
    expect(result).toBe(true);
  });

  test('comparePassword returns false for wrong password', async () => {
    const user = await seedUser({ email: 'wrong@test.com', password: 'rightpass' });

    const dbUser = await User.findById(user._id);
    const result = await dbUser.comparePassword('wrongpass');
    expect(result).toBe(false);
  });
});
